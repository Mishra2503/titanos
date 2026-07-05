import { NextRequest, NextResponse } from "next/server";
import { Readable, Transform, pipeline } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { db } from "@/lib/server/db";
import { v2 as cloudinary } from "cloudinary";
import { apiError, unauthorized, badRequest, serverError } from "@/lib/server/errors";
import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/upload-limits";

const CAP_MB = Math.round(SERVER_UPLOAD_MAX_BYTES / 1024 / 1024);
const TOO_LARGE_MSG = `the server upload fallback accepts at most ${CAP_MB}MB — larger files must upload directly to Cloudinary from the browser`;

function configureCloudinary() {
  const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
  if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
    throw new Error("cloudinary_not_configured");
  }
  cloudinary.config({ cloud_name: CLOUDINARY_CLOUD_NAME, api_key: CLOUDINARY_API_KEY, api_secret: CLOUDINARY_API_SECRET, secure: true });
}

// Streams the raw request body straight into Cloudinary instead of buffering the
// whole file in memory. The old req.formData() + file.arrayBuffer() approach used a
// strict, fully-buffered multipart parser that throws "Failed to parse body as
// FormData" the moment a large upload's body arrives incomplete (slow connection,
// proxy timeout, memory pressure) — the same large-file risk /api/media/sign's direct
// Cloudinary path was built to avoid in the first place. Streaming sidesteps both the
// memory cost and the brittle multipart framing.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const filename = req.nextUrl.searchParams.get("filename") ?? "reel";
    if (!req.body) return badRequest("missing_file", "file body is required");

    const contentLength = Number(req.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > SERVER_UPLOAD_MAX_BYTES) {
      return apiError(413, "payload_too_large", `File is ${Math.round(contentLength / 1024 / 1024)}MB — ${TOO_LARGE_MSG}.`);
    }

    try { configureCloudinary(); } catch { return badRequest("cloudinary_not_configured", "Cloudinary credentials are not set. Add CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET to .env.local"); }

    const publicId = `${Date.now()}-${filename.replace(/\.[^.]+$/, "")}`;

    const result = await new Promise<{ secure_url: string; public_id: string; width?: number; height?: number; duration?: number; format?: string; bytes?: number }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_chunked_stream(
        { resource_type: "video", folder: "titan-os/masters", public_id: publicId, overwrite: false, chunk_size: 20_000_000 },
        (err, r) => (err ? reject(err) : resolve(r!)),
      );
      // Enforce the size cap even when Content-Length is absent (chunked
      // transfer encoding) by counting bytes as they stream through.
      let seenBytes = 0;
      const limiter = new Transform({
        transform(chunk: Buffer, _enc, cb) {
          seenBytes += chunk.length;
          if (seenBytes > SERVER_UPLOAD_MAX_BYTES) cb(new Error("payload_too_large"));
          else cb(null, chunk);
        },
      });
      pipeline(
        Readable.fromWeb(req.body as NodeWebReadableStream<Uint8Array>),
        limiter,
        uploadStream,
        (err) => { if (err) reject(err); },
      );
    });

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: wsId,
        filename,
        cloudinaryPublicId: result.public_id,
        publicUrl: result.secure_url,
        width: result.width ?? null,
        height: result.height ?? null,
        durationS: result.duration ?? null,
        format: result.format ?? null,
        sizeBytes: result.bytes ?? null,
        uploadedBy: userId ?? null,
      },
    });

    return NextResponse.json({ id: asset.id, filename: asset.filename, public_url: asset.publicUrl, width: asset.width, height: asset.height, duration_s: asset.durationS, format: asset.format, size_bytes: asset.sizeBytes }, { status: 201 });
  } catch (e) {
    if ((e as Error)?.message === "payload_too_large") {
      return apiError(413, "payload_too_large", `Upload exceeds the ${CAP_MB}MB server limit — ${TOO_LARGE_MSG}.`);
    }
    console.error("[media upload]", e);
    // Surface the real Cloudinary error so the UI shows something actionable
    // instead of a bare "Internal server error".
    const msg = (e as { message?: string })?.message ?? "Upload failed";
    return serverError(`Upload failed: ${msg}`);
  }
}
