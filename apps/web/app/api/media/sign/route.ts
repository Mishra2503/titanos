import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3, s3Bucket, makeObjectKey } from "@/lib/server/s3";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";
import { INSTAGRAM_REEL_MAX_BYTES } from "@/lib/instagram-reel-quality";
import { signMediaUploadTicket } from "@/lib/server/mediaUploadTicket";

// Issues short-lived presigned PUT URLs so the browser uploads the video (and
// its thumbnail) straight to the S3-compatible store. This avoids proxying
// hundreds of MB through the Next server (Cloudflare kills >100MB bodies at
// the edge) and keeps bandwidth costs at zero on R2.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId || !userId) return unauthorized();

    let s3;
    try {
      s3 = getS3();
    } catch {
      return badRequest("storage_not_configured", "Object storage is not configured. Set S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_PUBLIC_BASE_URL in the environment.");
    }

    const { filename, content_type, bytes } = (await req.json().catch(() => ({}))) as { filename?: string; content_type?: string; bytes?: number };
    if (bytes !== undefined && (!Number.isSafeInteger(bytes) || bytes <= 0)) {
      return badRequest("invalid_size", "bytes must be a positive integer");
    }
    if (bytes !== undefined && bytes > INSTAGRAM_REEL_MAX_BYTES) {
      return badRequest("file_too_large", "video exceeds Instagram's 1GB reel limit");
    }
    const { videoKey, thumbKey } = makeObjectKey(filename ?? "reel.mp4");
    const bucket = s3Bucket();
    const uploadToken = await signMediaUploadTicket({
      ws: wsId,
      uid: userId,
      key: videoKey,
      filename: filename ?? "reel.mp4",
      contentType: content_type || "video/mp4",
      ...(bytes !== undefined ? { bytes } : {}),
    });

    const [videoUrl, thumbUrl] = await Promise.all([
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: videoKey, ContentType: content_type || "video/mp4" }), { expiresIn: 3600 }),
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: thumbKey, ContentType: "image/jpeg" }), { expiresIn: 3600 }),
    ]);

    return NextResponse.json({
      upload_token: uploadToken,
      video: { key: videoKey, upload_url: videoUrl },
      thumbnail: { key: thumbKey, upload_url: thumbUrl },
    });
  } catch (e) {
    console.error("[media sign]", e);
    return serverError();
  }
}
