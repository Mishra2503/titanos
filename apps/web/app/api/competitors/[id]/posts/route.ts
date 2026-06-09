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
    const hashtags: string[] = (body.hashtags ?? []).map((t: string) => (t.startsWith("#") ? t.toLowerCase() : "#" + t.toLowerCase()));
    const post = await db.competitorPost.create({ data: { workspaceId: wsId, competitorId: id, permalink: body.permalink ?? null, postType: body.post_type ?? null, caption: body.caption ?? null, hashtags, likes: body.likes ?? null, comments: body.comments ?? null, views: body.views ?? null, postedOn: body.posted_on ? new Date(body.posted_on) : null, thumbnailUrl: body.thumbnail_url ?? null, whatWorks: body.what_works ?? null } });
    return NextResponse.json({ id: post.id, permalink: post.permalink, post_type: post.postType, caption: post.caption, hashtags: post.hashtags, likes: post.likes, comments: post.comments, views: post.views, posted_on: post.postedOn, thumbnail_url: post.thumbnailUrl, what_works: post.whatWorks, engagement: (post.likes ?? 0) + (post.comments ?? 0) || null }, { status: 201 });
  } catch (e) {
    console.error("[competitor posts POST]", e);
    return serverError();
  }
}
