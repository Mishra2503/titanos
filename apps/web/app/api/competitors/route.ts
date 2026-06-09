import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const competitors = await db.competitor.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: "asc" }, include: { snapshots: { orderBy: { capturedOn: "asc" } }, _count: { select: { posts: true, reports: true } } } });
    return NextResponse.json(competitors.map((c) => {
      const snaps = c.snapshots;
      const latest = snaps[snaps.length - 1] ?? null;
      const prev = snaps[snaps.length - 2] ?? null;
      let delta = null, deltaPct = null;
      if (latest?.followersCount != null && prev?.followersCount != null) {
        delta = latest.followersCount - prev.followersCount;
        if (prev.followersCount) deltaPct = Math.round(delta / prev.followersCount * 1000) / 10;
      }
      return { id: c.id, username: c.username, display_name: c.displayName, category: c.category, profile_url: c.profileUrl, avatar_url: c.avatarUrl, latest_followers: latest?.followersCount ?? null, avg_engagement_rate: null, follower_delta: delta, follower_delta_pct: deltaPct, snapshot_count: snaps.length, post_count: c._count.posts, report_count: c._count.reports };
    }));
  } catch (e) {
    console.error("[competitors GET]", e);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const body = await req.json();
    const c = await db.competitor.create({ data: { workspaceId: wsId, username: body.username, displayName: body.display_name ?? null, category: body.category ?? null, profileUrl: body.profile_url ?? null, avatarUrl: body.avatar_url ?? null, notes: body.notes ?? null, createdBy: userId ?? null } });
    return NextResponse.json({ id: c.id, username: c.username, display_name: c.displayName, category: c.category, profile_url: c.profileUrl, avatar_url: c.avatarUrl, latest_followers: null, avg_engagement_rate: null, follower_delta: null, follower_delta_pct: null, snapshot_count: 0, post_count: 0, report_count: 0 }, { status: 201 });
  } catch (e) {
    console.error("[competitors POST]", e);
    return serverError();
  }
}
