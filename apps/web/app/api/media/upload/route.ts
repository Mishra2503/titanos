import { NextRequest, NextResponse } from "next/server";
import { Readable } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { db } from "@/lib/server/db";
import { v2 as cloudinary } from "cloudinary";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

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

    try { configureCloudinary(); } catch { return badRequest("cloudinary_not_configured", "Cloudinary credentials are not set. Add CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET to .env.local"); }

    const publicId = `${Date.now()}-${filename.replace(/\.[^.]+$/, "")}`;

    const result = await new Promise<{ secure_url: string; public_id: string; width?: number; height?: number; duration?: number; format?: string; bytes?: number }>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_chunked_stream(
        { resource_type: "video", folder: "titan-os/masters", public_id: publicId, overwrite: false, chunk_size: 20_000_000 },
        (err, r) => (err ? reject(err) : resolve(r!)),
      );
      Readable.fromWeb(req.body as NodeWebReadableStream<Uint8Array>)
        .on("error", reject)
        .pipe(uploadStream);
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
    console.error("[media upload]", e);
    // Surface the real Cloudinary error so the UI shows something actionable
    // instead of a bare "Internal server error".
    const msg = (e as { message?: string })?.message ?? "Upload failed";
    return serverError(`Upload failed: ${msg}`);
  }
}
