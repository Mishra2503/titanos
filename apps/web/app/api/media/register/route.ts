import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { KEY_RE, publicUrlForKey } from "@/lib/server/s3";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Records a media asset after the browser finished a direct presigned upload
// to the S3-compatible store. Clients send object KEYS (validated against the
// key shape we mint in /api/media/sign) - public URLs are built server-side so
// arbitrary URLs can't be registered.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const body = (await req.json().catch(() => null)) as {
      filename?: string; key?: string; thumbnail_key?: string;
      width?: number; height?: number; duration?: number; format?: string; bytes?: number;
    } | null;
    if (!body?.key) return badRequest("missing_fields", "key is required");
    if (!KEY_RE.test(body.key)) return badRequest("invalid_key", "key is not a valid media object key");
    if (body.thumbnail_key && !KEY_RE.test(body.thumbnail_key)) {
      return badRequest("invalid_key", "thumbnail_key is not a valid media object key");
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
        sizeBytes: body.bytes ?? null,
        uploadedBy: userId ?? null,
      },
    });

    return NextResponse.json({ id: asset.id, filename: asset.filename, public_url: asset.publicUrl, thumbnail_url: asset.thumbnailUrl, width: asset.width, height: asset.height, duration_s: asset.durationS, format: asset.format, size_bytes: asset.sizeBytes }, { status: 201 });
  } catch (e) {
    console.error("[media register]", e);
    return serverError();
  }
}
