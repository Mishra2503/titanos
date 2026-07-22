import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

function toDateStr(d: Date | null | undefined): string | null {
  if (!d) return null;
  return d.toISOString().split("T")[0];
}

// Compact video-analysis view for the UI badge/tooltip.
function videoAnalysisOut(va: { status: string; summary: string | null; analysis: unknown; transcript: string | null } | null) {
  if (!va) return null;
  const a = (va.analysis ?? {}) as Record<string, unknown>;
  return {
    status: va.status,
    summary: va.summary,
    transcript: va.transcript,
    hook_visual: typeof a.hookVisual === "string" ? a.hookVisual : null,
    hook_spoken: typeof a.hookSpoken === "string" ? a.hookSpoken : null,
    format: typeof a.format === "string" ? a.format : null,
    why_it_works: typeof a.whyItWorks === "string" ? a.whyItWorks : null,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const c = await db.competitor.findFirst({
      where: { id, workspaceId: wsId },
      include: {
        snapshots: { orderBy: { capturedOn: "asc" } },
        posts: {
          orderBy: [{ postedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
          include: { videoAnalysis: { select: { status: true, summary: true, analysis: true, transcript: true } } },
        },
        reports: { orderBy: { generatedAt: "desc" } },
      },
    });
    if (!c) return notFound("Competitor not found");

    // Which reels already became scripts / board cards - powers the per-reel
    // "Scripted" / "On board" tags so the same reel isn't reworked twice.
    const postIds = c.posts.map((p) => p.id);
    const scripts = postIds.length
      ? await db.script.findMany({
          where: { workspaceId: wsId, competitorPostId: { in: postIds } },
          select: { competitorPostId: true, boardCardId: true },
        })
      : [];
    const scriptByPost = new Map<string, { board_card_id: string | null }>();
    for (const s of scripts) {
      if (!s.competitorPostId) continue;
      const prev = scriptByPost.get(s.competitorPostId);
      // Keep a board_card_id if any script for this reel reached the board.
      scriptByPost.set(s.competitorPostId, { board_card_id: prev?.board_card_id ?? s.boardCardId ?? null });
    }

    // ── Compute analytics from stored data ───────────────────────────────────
    const snaps = c.snapshots;
    const latestSnap = snaps[snaps.length - 1] ?? null;
    const prevSnap = snaps.length >= 2 ? snaps[snaps.length - 2] : null;
    const oldestSnap = snaps[0] ?? null;

    const latest_followers = latestSnap?.followersCount ?? null;
    let follower_delta: number | null = null;
    let follower_delta_pct: number | null = null;
    let growth_since: string | null = null;
    if (latestSnap?.followersCount != null && prevSnap?.followersCount != null) {
      follower_delta = latestSnap.followersCount - prevSnap.followersCount;
      if (prevSnap.followersCount > 0) {
        follower_delta_pct = Math.round((follower_delta / prevSnap.followersCount) * 1000) / 10;
      }
      growth_since = toDateStr(oldestSnap?.capturedOn);
    }

    const engRates = snaps.map((s) => s.engagementRate).filter((v): v is number => v != null);
    const avg_engagement_rate =
      engRates.length > 0
        ? Math.round((engRates.reduce((a, b) => a + b, 0) / engRates.length) * 10) / 10
        : null;

    // Posts per week: derived from posts that have a posted_on date
    const datedPosts = c.posts.filter((p) => p.postedOn != null);
    let posts_per_week: number | null = null;
    if (datedPosts.length >= 2) {
      const times = datedPosts.map((p) => p.postedOn!.getTime()).sort((a, b) => a - b);
      const spanMs = times[times.length - 1] - times[0];
      const spanWeeks = spanMs / (7 * 24 * 3600 * 1000);
      if (spanWeeks > 0) posts_per_week = Math.round((datedPosts.length / spanWeeks) * 10) / 10;
    }

    // Content mix (count by post type)
    const content_mix: Record<string, number> = {};
    for (const p of c.posts) {
      const k = p.postType ?? "POST";
      content_mix[k] = (content_mix[k] ?? 0) + 1;
    }

    // ── Outlier detection ────────────────────────────────────────────────────
    // A video is an "outlier" when it beats the account's own median by >=2x.
    // Uses views where the scraper provided them, else engagement (likes+comments).
    // Pure math on public/scraped numbers - never fabricated.
    const median = (nums: number[]): number => {
      if (nums.length === 0) return 0;
      const s = [...nums].sort((a, b) => a - b);
      const mid = Math.floor(s.length / 2);
      return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
    };
    const viewVals = c.posts.map((p) => p.views ?? 0).filter((v) => v > 0);
    const engVals = c.posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0)).filter((v) => v > 0);
    const useViews = viewVals.length >= 3; // need enough signal for a meaningful median
    const median_views = useViews ? median(viewVals) : null;
    const baseline = useViews ? median_views! : median(engVals);
    const outlierMultiple = (p: (typeof c.posts)[number]): number | null => {
      if (baseline <= 0) return null;
      const metric = useViews ? p.views ?? 0 : (p.likes ?? 0) + (p.comments ?? 0);
      if (metric <= 0) return null;
      return Math.round((metric / baseline) * 10) / 10;
    };

    // Top hashtags (by usage count, with avg engagement)
    const tagMap = new Map<string, { count: number; engs: number[] }>();
    for (const p of c.posts) {
      const tags = (p.hashtags as string[]) ?? [];
      const eng = (p.likes ?? 0) + (p.comments ?? 0);
      for (const tag of tags) {
        const entry = tagMap.get(tag) ?? { count: 0, engs: [] };
        entry.count++;
        if (eng > 0) entry.engs.push(eng);
        tagMap.set(tag, entry);
      }
    }
    const top_hashtags = [...tagMap.entries()]
      .map(([tag, { count, engs }]) => ({
        tag,
        count,
        avg_engagement:
          engs.length > 0 ? Math.round(engs.reduce((a, b) => a + b, 0) / engs.length) : null,
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Top posts: rank by views when the scraper provided them, otherwise by
    // engagement (likes + comments).
    const top_posts = [...c.posts]
      .map((p) => ({ p, eng: (p.likes ?? 0) + (p.comments ?? 0), score: (p.views ?? 0) > 0 ? p.views! : (p.likes ?? 0) + (p.comments ?? 0) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
      .map(({ p, eng }) => {
        const mult = outlierMultiple(p);
        return {
          id: p.id,
          permalink: p.permalink,
          post_type: p.postType,
          caption: p.caption,
          hashtags: (p.hashtags as string[]) ?? [],
          likes: p.likes,
          comments: p.comments,
          views: p.views,
          posted_on: toDateStr(p.postedOn),
          thumbnail_url: p.thumbnailUrl,
          what_works: p.whatWorks,
          engagement: eng || null,
          outlier_multiple: mult,
          is_outlier: mult != null && mult >= 2,
          video_analysis: videoAnalysisOut(p.videoAnalysis),
        };
      });

    const posts = c.posts.map((p) => {
      const mult = outlierMultiple(p);
      return {
        id: p.id,
        permalink: p.permalink,
        post_type: p.postType,
        caption: p.caption,
        hashtags: (p.hashtags as string[]) ?? [],
        likes: p.likes,
        comments: p.comments,
        views: p.views,
        posted_on: toDateStr(p.postedOn),
        posted_at: p.postedOn ? p.postedOn.toISOString() : null,
        thumbnail_url: p.thumbnailUrl,
        video_url: p.videoUrl,
        what_works: p.whatWorks,
        engagement: (p.likes ?? 0) + (p.comments ?? 0) || null,
        outlier_multiple: mult,
        is_outlier: mult != null && mult >= 2,
        video_analysis: videoAnalysisOut(p.videoAnalysis),
        content_analysis: p.contentAnalysis ?? null,
        tags: (p.tags as string[]) ?? [],
        used: p.usedAt != null,
        scripted: scriptByPost.has(p.id),
        board_card_id: p.boardCardId ?? scriptByPost.get(p.id)?.board_card_id ?? null,
      };
    });

    // Top outliers (videos most above the account's median), best first.
    const outliers = [...posts]
      .filter((p) => p.is_outlier)
      .sort((a, b) => (b.outlier_multiple ?? 0) - (a.outlier_multiple ?? 0))
      .slice(0, 8);

    return NextResponse.json({
      id: c.id,
      username: c.username,
      display_name: c.displayName,
      category: c.category,
      profile_url: c.profileUrl,
      avatar_url: c.avatarUrl,
      notes: c.notes,
      snapshots: c.snapshots.map((s) => ({
        id: s.id,
        captured_on: toDateStr(s.capturedOn),
        followers_count: s.followersCount,
        following_count: s.followingCount,
        posts_count: s.postsCount,
        avg_likes: s.avgLikes,
        avg_comments: s.avgComments,
        engagement_rate: s.engagementRate,
        note: s.note,
      })),
      posts,
      analytics: {
        latest_followers,
        follower_delta,
        follower_delta_pct,
        growth_since,
        avg_engagement_rate,
        posts_per_week,
        content_mix,
        top_hashtags,
        top_posts,
        median_views,
        outlier_metric: useViews ? "views" : "engagement",
        outliers,
      },
      reports: c.reports.map((r) => ({
        id: r.id,
        competitor_id: r.competitorId,
        title: r.title,
        content: r.content,
        model: r.model,
        generated_at: r.generatedAt,
      })),
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
