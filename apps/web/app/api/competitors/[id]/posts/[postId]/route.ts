import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

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
