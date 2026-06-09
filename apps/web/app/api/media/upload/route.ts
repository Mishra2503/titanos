import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const form = await req.formData();
    const file = form.get("file") as File | null;
    if (!file) return badRequest("missing_file", "file is required");

    try { configureCloudinary(); } catch { return badRequest("cloudinary_not_configured", "Cloudinary credentials are not set. Add CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET to .env.local"); }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const publicId = `${Date.now()}-${file.name.replace(/\.[^.]+$/, "")}`;

    const result = await new Promise<{ secure_url: string; public_id: string; width?: number; height?: number; duration?: number; format?: string; bytes?: number }>((resolve, reject) => {
      cloudinary.uploader.upload_stream({ resource_type: "video", folder: "titan-os/masters", public_id: publicId, overwrite: false }, (err, r) => err ? reject(err) : resolve(r!)).end(buffer);
    });

    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: wsId,
        filename: file.name,
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
    return serverError();
  }
}
