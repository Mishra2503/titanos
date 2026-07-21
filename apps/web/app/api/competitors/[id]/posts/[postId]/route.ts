import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

// Tag a competitor reel: set manual tags and/or toggle the "used / don't reuse"
// marker (drives the Hide-used filter on the Competitors page).
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { postId } = await params;
    const post = await db.competitorPost.findFirst({ where: { id: postId, workspaceId: wsId } });
    if (!post) return notFound("Post not found");

    const body = (await req.json()) as { tags?: unknown; used?: unknown };
    const data: Record<string, unknown> = {};
    if ("tags" in body) {
      data.tags = Array.isArray(body.tags) ? body.tags.map((t) => String(t)).filter(Boolean).slice(0, 20) : [];
    }
    if ("used" in body) data.usedAt = body.used ? new Date() : null;

    const updated = await db.competitorPost.update({ where: { id: postId }, data });
    return NextResponse.json({ id: updated.id, tags: (updated.tags as string[]) ?? [], used: updated.usedAt != null });
  } catch (e) {
    console.error("[competitor post PATCH]", e);
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { postId } = await params;
    const post = await db.competitorPost.findFirst({ where: { id: postId, workspaceId: wsId } });
    if (!post) return notFound("Post not found");
    await db.competitorPost.delete({ where: { id: postId } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[competitor post DELETE]", e);
    return serverError();
  }
}
