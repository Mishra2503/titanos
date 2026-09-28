import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { KEY_RE, getS3, publicUrlForKey, s3Bucket } from "@/lib/server/s3";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";
import { prepareInstagramMedia } from "@/lib/server/instagramMedia";
import { DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { INSTAGRAM_REEL_MAX_BYTES } from "@/lib/instagram-reel-quality";
import { verifyMediaUploadTicket } from "@/lib/server/mediaUploadTicket";

// Records a media asset after the browser finished a direct presigned upload
// to the S3-compatible store. Clients send object KEYS (validated against the
// key shape we mint in /api/media/sign) - public URLs are built server-side so
// arbitrary URLs can't be registered.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId || !userId) return unauthorized();

    const body = (await req.json().catch(() => null)) as {
      filename?: string; key?: string; thumbnail_key?: string;
      width?: number; height?: number; duration?: number; format?: string; bytes?: number; upload_token?: string;
    } | null;
    if (!body?.key) return badRequest("missing_fields", "key is required");
    if (!KEY_RE.test(body.key)) return badRequest("invalid_key", "key is not a valid media object key");
    if (body.thumbnail_key && !KEY_RE.test(body.thumbnail_key)) {
      return badRequest("invalid_key", "thumbnail_key is not a valid media object key");
    }

    // MCP upload completion must prove this key was minted for the same user
    // and workspace. Browser/multipart callers remain backward-compatible.
    if (req.headers.get("x-titan-mcp")) {
      if (!body.upload_token) return unauthorized("Missing media upload ticket");
      const ticket = await verifyMediaUploadTicket(body.upload_token);
      if (!ticket || ticket.ws !== wsId || ticket.uid !== userId || ticket.key !== body.key) {
        return unauthorized("Invalid or expired media upload ticket");
      }
      if (ticket.bytes !== undefined && body.bytes !== ticket.bytes) {
        return badRequest("size_mismatch", "Upload size does not match the signed upload ticket.");
      }
    }

    let uploaded;
    try {
      uploaded = await getS3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: body.key }));
    } catch {
      return badRequest("upload_not_found", "The uploaded video was not found. Upload it before registering it.");
    }
    const actualBytes = Number(uploaded.ContentLength);
    if (!Number.isSafeInteger(actualBytes) || actualBytes <= 0) {
      return badRequest("empty_upload", "The uploaded video is empty or its size could not be verified.");
    }
    if (actualBytes > INSTAGRAM_REEL_MAX_BYTES) {
      await getS3().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: body.key })).catch(() => {});
      return badRequest("file_too_large", "video exceeds Instagram's 1GB reel limit");
    }
    const contentType = String(uploaded.ContentType ?? "").toLowerCase();
    if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream") {
      await getS3().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: body.key })).catch(() => {});
      return badRequest("invalid_media_type", `Uploaded object has unsupported content type ${contentType}`);
    }
    if (body.bytes !== undefined && body.bytes !== actualBytes) {
      return badRequest("size_mismatch", `Expected ${body.bytes} bytes but storage contains ${actualBytes}.`);
    }

    const existing = await db.mediaAsset.findFirst({ where: { workspaceId: wsId, storageKey: body.key } });
    if (existing) {
      return NextResponse.json({ id: existing.id, filename: existing.filename, public_url: existing.publicUrl, thumbnail_url: existing.thumbnailUrl, width: existing.width, height: existing.height, duration_s: existing.durationS, format: existing.format, size_bytes: existing.sizeBytes });
    }

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: wsId,
        filename: body.filename ?? body.key.split("/").pop() ?? body.key,
        storageKey: body.key,
        publicUrl: publicUrlForKey(body.key),
        thumbnailUrl: body.thumbnail_key ? publicUrlForKey(body.thumbnail_key) : null,
        width: body.width ?? null,
        height: body.height ?? null,
        durationS: body.duration ?? null,
        format: body.format ?? null,
        sizeBytes: actualBytes,
        uploadedBy: userId,
      },
    });

    // Start the expensive delivery preparation while the user is still editing
    // the schedule. The minute clock keeps the free service awake, and the
    // publisher later reuses the deterministic cached copy.
    void prepareInstagramMedia(asset).catch((error) => {
      console.error(`[media register] Instagram preparation failed for ${asset.id}:`, error instanceof Error ? error.message : error);
    });

    return NextResponse.json({ id: asset.id, filename: asset.filename, public_url: asset.publicUrl, thumbnail_url: asset.thumbnailUrl, width: asset.width, height: asset.height, duration_s: asset.durationS, format: asset.format, size_bytes: asset.sizeBytes }, { status: 201 });
  } catch (e) {
    console.error("[media register]", e);
    return serverError();
  }
}
