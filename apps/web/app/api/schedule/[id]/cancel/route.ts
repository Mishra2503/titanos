import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const post = await db.scheduledPost.findFirst({ where: { id, workspaceId: wsId } });
    if (!post) return notFound("Scheduled post not found");
    if (!["SCHEDULED", "FAILED"].includes(post.status)) return badRequest("not_cancelable", `Cannot cancel a post with status ${post.status}`);
    await db.scheduledPost.update({ where: { id }, data: { status: "CANCELED" } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[cancel]", e);
    return serverError();
  }
}
