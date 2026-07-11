import { NextRequest, NextResponse } from "next/server";
import { PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { getS3, s3Bucket, makeObjectKey } from "@/lib/server/s3";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Issues short-lived presigned PUT URLs so the browser uploads the video (and
// its thumbnail) straight to the S3-compatible store. This avoids proxying
// hundreds of MB through the Next server (Cloudflare kills >100MB bodies at
// the edge) and keeps bandwidth costs at zero on R2.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    let s3;
    try {
      s3 = getS3();
    } catch {
      return badRequest("storage_not_configured", "Object storage is not configured. Set S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, S3_BUCKET and S3_PUBLIC_BASE_URL in the environment.");
    }

    const { filename, content_type } = (await req.json().catch(() => ({}))) as { filename?: string; content_type?: string };
    const { videoKey, thumbKey } = makeObjectKey(filename ?? "reel.mp4");
    const bucket = s3Bucket();

    const [videoUrl, thumbUrl] = await Promise.all([
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: videoKey, ContentType: content_type || "video/mp4" }), { expiresIn: 3600 }),
      getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: thumbKey, ContentType: "image/jpeg" }), { expiresIn: 3600 }),
    ]);

    return NextResponse.json({
      video: { key: videoKey, upload_url: videoUrl },
      thumbnail: { key: thumbKey, upload_url: thumbUrl },
    });
  } catch (e) {
    console.error("[media sign]", e);
    return serverError();
  }
}
