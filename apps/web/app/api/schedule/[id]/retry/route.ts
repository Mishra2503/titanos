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
    if (!["FAILED", "CANCELED"].includes(post.status)) return badRequest("not_retryable", `Only FAILED or CANCELED posts can be retried`);
    const scheduledAt = new Date(post.scheduledAt) < new Date() ? new Date() : new Date(post.scheduledAt);
    await db.scheduledPost.update({ where: { id }, data: { status: "SCHEDULED", attempts: 0, error: null, containerId: null, scheduledAt } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[retry]", e);
    return serverError();
  }
}
