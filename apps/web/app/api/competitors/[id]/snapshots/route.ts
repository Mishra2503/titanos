import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const competitor = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!competitor) return notFound("Competitor not found");
    const body = await req.json();
    const snap = await db.competitorSnapshot.create({ data: { workspaceId: wsId, competitorId: id, capturedOn: body.captured_on ? new Date(body.captured_on) : new Date(), followersCount: body.followers_count ?? null, followingCount: body.following_count ?? null, postsCount: body.posts_count ?? null, avgLikes: body.avg_likes ?? null, avgComments: body.avg_comments ?? null, engagementRate: body.engagement_rate ?? null, note: body.note ?? null } });
    return NextResponse.json({ id: snap.id, captured_on: snap.capturedOn, followers_count: snap.followersCount, following_count: snap.followingCount, posts_count: snap.postsCount, avg_likes: snap.avgLikes, avg_comments: snap.avgComments, engagement_rate: snap.engagementRate, note: snap.note }, { status: 201 });
  } catch (e) {
    console.error("[snapshots POST]", e);
    return serverError();
  }
}
