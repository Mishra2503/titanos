import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const post = await db.scheduledPost.findFirst({ where: { id, workspaceId: wsId } });
    if (!post) return notFound("Scheduled post not found");
    if (!["SCHEDULED", "FAILED"].includes(post.status)) return badRequest("not_editable", `Cannot edit a post with status ${post.status}`);

    const { caption, hashtags, scheduled_at } = await req.json();
    if (scheduled_at && new Date(scheduled_at) < new Date()) return badRequest("scheduled_in_past", "Scheduled time must be in the future");

    const updated = await db.scheduledPost.update({ where: { id }, data: { ...(caption !== undefined && { caption }), ...(hashtags !== undefined && { hashtags }), ...(scheduled_at && { scheduledAt: new Date(scheduled_at) }) } });
    return NextResponse.json({ status: updated.status });
  } catch (e) {
    console.error("[schedule PATCH]", e);
    return serverError();
  }
}
