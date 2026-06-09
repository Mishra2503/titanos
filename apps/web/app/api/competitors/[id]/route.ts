import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const c = await db.competitor.findFirst({ where: { id, workspaceId: wsId }, include: { snapshots: { orderBy: { capturedOn: "asc" } }, posts: { orderBy: { postedOn: "desc" } }, reports: { orderBy: { generatedAt: "desc" } } } });
    if (!c) return notFound("Competitor not found");
    return NextResponse.json({
      id: c.id, username: c.username, display_name: c.displayName, category: c.category, profile_url: c.profileUrl, avatar_url: c.avatarUrl, notes: c.notes,
      snapshots: c.snapshots.map((s) => ({ id: s.id, captured_on: s.capturedOn, followers_count: s.followersCount, following_count: s.followingCount, posts_count: s.postsCount, avg_likes: s.avgLikes, avg_comments: s.avgComments, engagement_rate: s.engagementRate, note: s.note })),
      posts: c.posts.map((p) => ({ id: p.id, permalink: p.permalink, post_type: p.postType, caption: p.caption, hashtags: (p.hashtags as string[]) ?? [], likes: p.likes, comments: p.comments, views: p.views, posted_on: p.postedOn, thumbnail_url: p.thumbnailUrl, what_works: p.whatWorks, engagement: (p.likes ?? 0) + (p.comments ?? 0) || null })),
      analytics: { latest_followers: null, follower_delta: null, follower_delta_pct: null, growth_since: null, avg_engagement_rate: null, posts_per_week: null, content_mix: {}, top_hashtags: [], top_posts: [] },
      reports: c.reports.map((r) => ({ id: r.id, competitor_id: r.competitorId, title: r.title, content: r.content, model: r.model, generated_at: r.generatedAt })),
    });
  } catch (e) {
    console.error("[competitor GET]", e);
    return serverError();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Competitor not found");
    const body = await req.json();
    const c = await db.competitor.update({ where: { id }, data: { ...(body.username && { username: body.username }), ...(body.display_name !== undefined && { displayName: body.display_name }), ...(body.category !== undefined && { category: body.category }), ...(body.profile_url !== undefined && { profileUrl: body.profile_url }), ...(body.avatar_url !== undefined && { avatarUrl: body.avatar_url }), ...(body.notes !== undefined && { notes: body.notes }) } });
    return NextResponse.json({ id: c.id, username: c.username });
  } catch (e) {
    console.error("[competitor PATCH]", e);
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Competitor not found");
    await db.competitor.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[competitor DELETE]", e);
    return serverError();
  }
}
