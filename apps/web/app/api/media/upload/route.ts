import { NextRequest, NextResponse } from "next/server";
import { Readable, Transform } from "node:stream";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { Upload } from "@aws-sdk/lib-storage";
import { db } from "@/lib/server/db";
import { getS3, s3Bucket, makeObjectKey, publicUrlForKey } from "@/lib/server/s3";
import { apiError, unauthorized, badRequest, serverError } from "@/lib/server/errors";
import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/upload-limits";

const CAP_MB = Math.round(SERVER_UPLOAD_MAX_BYTES / 1024 / 1024);
const TOO_LARGE_MSG = `the server upload fallback accepts at most ${CAP_MB}MB — larger files must upload directly to storage from the browser`;

// Server-side proxy fallback for when the browser can't reach the storage host
// directly (ad blocker / firewall / VPN). Streams the raw request body into the
// S3-compatible store without buffering the whole file. Capped at 90MB because
// Cloudflare kills larger bodies at the edge before they reach this route.
// No thumbnail on this path (the browser extractor never ran) — the library UI
// falls back to a placeholder.
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

    let s3;
    try {
      s3 = getS3();
    } catch {
      return badRequest("storage_not_configured", "Object storage is not configured. Set S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_PUBLIC_BASE_URL in the environment.");
    }

    const { videoKey } = makeObjectKey(filename);

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

    const upload = new Upload({
      client: s3,
      params: {
        Bucket: s3Bucket(),
        Key: videoKey,
        Body: Readable.fromWeb(req.body as NodeWebReadableStream<Uint8Array>).pipe(limiter),
        ContentType: req.headers.get("content-type") ?? "video/mp4",
      },
      partSize: 10 * 1024 * 1024,
      queueSize: 1,
    });
    await upload.done();

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: wsId,
        filename,
        storageKey: videoKey,
        publicUrl: publicUrlForKey(videoKey),
        thumbnailUrl: null,
        width: null,
        height: null,
        durationS: null,
        format: filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? null,
        sizeBytes: Number.isFinite(contentLength) ? contentLength : seenBytes || null,
        uploadedBy: userId ?? null,
      },
    });

    return NextResponse.json({ id: asset.id, filename: asset.filename, public_url: asset.publicUrl, thumbnail_url: asset.thumbnailUrl, width: asset.width, height: asset.height, duration_s: asset.durationS, format: asset.format, size_bytes: asset.sizeBytes }, { status: 201 });
  } catch (e) {
    if ((e as Error)?.message === "payload_too_large") {
      return apiError(413, "payload_too_large", `Upload exceeds the ${CAP_MB}MB server limit — ${TOO_LARGE_MSG}.`);
    }
    console.error("[media upload]", e);
    // Surface the real storage error so the UI shows something actionable
    // instead of a bare "Internal server error".
    const msg = (e as { message?: string })?.message ?? "Upload failed";
    return serverError(`Upload failed: ${msg}`);
  }
}
