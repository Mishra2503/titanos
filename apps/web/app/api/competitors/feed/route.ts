import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { serverError, unauthorized } from "@/lib/server/errors";

function toDateStr(date: Date | null | undefined): string | null {
  return date ? date.toISOString() : null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]
    : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function videoAnalysisOut(
  analysis: { status: string; summary: string | null; analysis: unknown; transcript: string | null } | null,
) {
  if (!analysis) return null;
  const payload = (analysis.analysis ?? {}) as Record<string, unknown>;
  return {
    status: analysis.status,
    summary: analysis.summary,
    transcript: analysis.transcript,
    hook_visual: typeof payload.hookVisual === "string" ? payload.hookVisual : null,
    hook_spoken: typeof payload.hookSpoken === "string" ? payload.hookSpoken : null,
    format: typeof payload.format === "string" ? payload.format : null,
    why_it_works: typeof payload.whyItWorks === "string" ? payload.whyItWorks : null,
  };
}

/**
 * Cross-competitor Reel feed used by the Winner Radar.
 *
 * A winner is measured against that creator's own median, not against a larger
 * account. Views are preferred when at least three view counts exist; otherwise
 * public likes + comments are used. This keeps the comparison honest while
 * making strong posts from smaller creators visible.
 */
export async function GET(req: NextRequest) {
  try {
    const workspaceId = req.headers.get("x-workspace-id");
    if (!workspaceId) return unauthorized();

    const rows = await db.competitorPost.findMany({
      where: { workspaceId },
      orderBy: [{ postedOn: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
      take: 500,
      include: {
        competitor: {
          select: {
            id: true,
            username: true,
            displayName: true,
            category: true,
            avatarUrl: true,
          },
        },
        videoAnalysis: {
          select: { status: true, summary: true, analysis: true, transcript: true },
        },
      },
    });

    const postsByCompetitor = new Map<string, typeof rows>();
    for (const row of rows) {
      const group = postsByCompetitor.get(row.competitorId) ?? [];
      group.push(row);
      postsByCompetitor.set(row.competitorId, group);
    }

    const baselines = new Map<string, { metric: "views" | "engagement"; value: number }>();
    for (const [competitorId, posts] of postsByCompetitor) {
      const views = posts.map((post) => post.views ?? 0).filter((value) => value > 0);
      const engagement = posts
        .map((post) => (post.likes ?? 0) + (post.comments ?? 0))
        .filter((value) => value > 0);
      const useViews = views.length >= 3;
      baselines.set(competitorId, {
        metric: useViews ? "views" : "engagement",
        value: median(useViews ? views : engagement),
      });
    }

    const postIds = rows.map((row) => row.id);
    const scripts = postIds.length
      ? await db.script.findMany({
          where: { workspaceId, competitorPostId: { in: postIds } },
          select: { competitorPostId: true, boardCardId: true },
        })
      : [];
    const scriptByPost = new Map<string, { boardCardId: string | null }>();
    for (const script of scripts) {
      if (!script.competitorPostId) continue;
      const existing = scriptByPost.get(script.competitorPostId);
      scriptByPost.set(script.competitorPostId, {
        boardCardId: existing?.boardCardId ?? script.boardCardId ?? null,
      });
    }

    const posts = rows.map((row) => {
      const baseline = baselines.get(row.competitorId);
      const engagement = (row.likes ?? 0) + (row.comments ?? 0);
      const score = baseline?.metric === "views" ? row.views ?? 0 : engagement;
      const multiple = baseline && baseline.value > 0 && score > 0
        ? Math.round((score / baseline.value) * 10) / 10
        : null;
      const script = scriptByPost.get(row.id);

      return {
        id: row.id,
        competitor_id: row.competitor.id,
        competitor_username: row.competitor.username,
        competitor_display_name: row.competitor.displayName,
        competitor_category: row.competitor.category,
        competitor_avatar_url: row.competitor.avatarUrl,
        permalink: row.permalink,
        post_type: row.postType,
        caption: row.caption,
        hashtags: (row.hashtags as string[]) ?? [],
        likes: row.likes,
        comments: row.comments,
        views: row.views,
        posted_on: toDateStr(row.postedOn),
        posted_at: toDateStr(row.postedOn),
        thumbnail_url: row.thumbnailUrl,
        video_url: row.videoUrl,
        what_works: row.whatWorks,
        engagement: engagement || null,
        outlier_metric: baseline?.metric ?? "engagement",
        outlier_multiple: multiple,
        is_outlier: multiple != null && multiple >= 2,
        video_analysis: videoAnalysisOut(row.videoAnalysis),
        content_analysis: row.contentAnalysis ?? null,
        tags: (row.tags as string[]) ?? [],
        used: row.usedAt != null,
        scripted: scriptByPost.has(row.id),
        board_card_id: row.boardCardId ?? script?.boardCardId ?? null,
      };
    });

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      posts,
      totals: {
        posts: posts.length,
        winners: posts.filter((post) => post.is_outlier).length,
        watched: posts.filter((post) => post.video_analysis?.status === "DONE").length,
        competitors: postsByCompetitor.size,
      },
    });
  } catch (error) {
    console.error("[competitor feed GET]", error);
    return serverError();
  }
}
