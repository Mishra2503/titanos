import { NextRequest, NextResponse } from "next/server";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { db } from "@/lib/server/db";
import { getS3, s3Bucket, keyForPublicUrl } from "@/lib/server/s3";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const asset = await db.mediaAsset.findFirst({ where: { id, workspaceId: wsId } });
    if (!asset) return notFound("Media asset not found");

    // Best-effort object cleanup. Legacy rows point at res.cloudinary.com and
    // are skipped (DB delete only); storage errors never block the DB delete.
    if (asset.storageKey && !asset.publicUrl.startsWith("https://res.cloudinary.com/")) {
      try {
        const s3 = getS3();
        const bucket = s3Bucket();
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: asset.storageKey })).catch(console.warn);
        const thumbKey = asset.thumbnailUrl ? keyForPublicUrl(asset.thumbnailUrl) : null;
        if (thumbKey) await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: thumbKey })).catch(console.warn);
      } catch (e) {
        console.warn("[media DELETE] storage cleanup skipped:", (e as Error).message);
      }
    }

    await db.mediaAsset.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[media DELETE]", e);
    return serverError();
  }
}
