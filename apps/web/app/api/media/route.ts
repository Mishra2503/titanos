import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const assets = await db.mediaAsset.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { campaigns: true } } } });
    const uploaderIds = [...new Set(assets.map((a) => a.uploadedBy).filter(Boolean))] as string[];
    const uploaders = uploaderIds.length ? await db.user.findMany({ where: { id: { in: uploaderIds } }, select: { id: true, email: true } }) : [];
    const emailById = new Map(uploaders.map((u) => [u.id, u.email]));

    return NextResponse.json(assets.map((a) => ({
      id: a.id, filename: a.filename, public_url: a.publicUrl, thumbnail_url: null,
      width: a.width, height: a.height, duration_s: a.durationS, format: a.format,
      size_bytes: a.sizeBytes, created_at: a.createdAt,
      uploaded_by_email: a.uploadedBy ? emailById.get(a.uploadedBy) ?? null : null,
      in_use: a._count.campaigns > 0,
      usage: { campaigns: a._count.campaigns, scheduled_posts: 0, published_posts: 0 },
    })));
  } catch (e) {
    console.error("[media GET]", e);
    return serverError();
  }
}
