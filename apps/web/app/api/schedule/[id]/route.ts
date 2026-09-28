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
    if (caption !== undefined && typeof caption !== "string") return badRequest("invalid_caption", "caption must be a string");
    if (hashtags !== undefined && (!Array.isArray(hashtags) || hashtags.some((tag) => typeof tag !== "string"))) {
      return badRequest("invalid_hashtags", "hashtags must be an array of strings");
    }
    let scheduledAt: Date | undefined;
    if (scheduled_at !== undefined) {
      if (typeof scheduled_at !== "string") return badRequest("invalid_scheduled_at", "scheduled_at must be an ISO 8601 string");
      scheduledAt = new Date(scheduled_at);
      if (Number.isNaN(scheduledAt.getTime())) return badRequest("invalid_scheduled_at", "scheduled_at must be a valid ISO 8601 datetime");
      if (scheduledAt <= new Date()) return badRequest("scheduled_in_past", "Scheduled time must be in the future");
      if (process.env.SAFETY_ENABLED !== "false") {
        const minGap = Number(process.env.SAFETY_MIN_GAP_MINUTES ?? 90) * 60 * 1000;
        const nearby = await db.scheduledPost.findFirst({
          where: {
            id: { not: id },
            workspaceId: wsId,
            igAccountId: post.igAccountId,
            status: { in: ["SCHEDULED", "PROCESSING"] },
            scheduledAt: { gt: new Date(scheduledAt.getTime() - minGap), lt: new Date(scheduledAt.getTime() + minGap) },
          },
          select: { id: true },
        });
        if (nearby) return badRequest("safety_min_gap", `Another scheduled post is within the ${process.env.SAFETY_MIN_GAP_MINUTES ?? 90}-minute minimum gap`);
      }
    }

    const updated = await db.scheduledPost.update({ where: { id }, data: { ...(caption !== undefined && { caption }), ...(hashtags !== undefined && { hashtags }), ...(scheduledAt && { scheduledAt }) } });
    return NextResponse.json({ status: updated.status });
  } catch (e) {
    console.error("[schedule PATCH]", e);
    return serverError();
  }
}
