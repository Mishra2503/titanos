import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { v2 as cloudinary } from "cloudinary";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const asset = await db.mediaAsset.findFirst({ where: { id, workspaceId: wsId } });
    if (!asset) return notFound("Media asset not found");

    if (asset.cloudinaryPublicId && process.env.CLOUDINARY_CLOUD_NAME) {
      cloudinary.config({ cloud_name: process.env.CLOUDINARY_CLOUD_NAME, api_key: process.env.CLOUDINARY_API_KEY, api_secret: process.env.CLOUDINARY_API_SECRET });
      await cloudinary.uploader.destroy(asset.cloudinaryPublicId, { resource_type: "video" }).catch(console.warn);
    }

    await db.mediaAsset.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[media DELETE]", e);
    return serverError();
  }
}
