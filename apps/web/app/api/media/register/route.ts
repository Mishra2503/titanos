import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Records a media asset after the browser finished a direct Cloudinary upload.
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const body = (await req.json().catch(() => null)) as {
      filename?: string; public_id?: string; secure_url?: string;
      width?: number; height?: number; duration?: number; format?: string; bytes?: number;
    } | null;
    if (!body?.public_id || !body?.secure_url) {
      return badRequest("missing_fields", "public_id and secure_url are required");
    }
    if (!/^https:\/\/res\.cloudinary\.com\//.test(body.secure_url)) {
      return badRequest("invalid_url", "secure_url must be a Cloudinary URL");
    }

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: wsId,
        filename: body.filename ?? body.public_id,
        cloudinaryPublicId: body.public_id,
        publicUrl: body.secure_url,
        width: body.width ?? null,
        height: body.height ?? null,
        durationS: body.duration ?? null,
        format: body.format ?? null,
        sizeBytes: body.bytes ?? null,
        uploadedBy: userId ?? null,
      },
    });

    return NextResponse.json({ id: asset.id, filename: asset.filename, public_url: asset.publicUrl, width: asset.width, height: asset.height, duration_s: asset.durationS, format: asset.format, size_bytes: asset.sizeBytes }, { status: 201 });
  } catch (e) {
    console.error("[media register]", e);
    return serverError();
  }
}
