import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { formatAnalysisForReport } from "@/lib/server/videoAnalysis";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// AI content strategist: real post metrics + tracked competitors + live web
// research → a concrete weekly distribution-first content plan.

const SYSTEM =
  "You are the head of strategy at a top short-form social media marketing agency specializing in the AI/tech niche on Instagram. You turn real performance data into ruthless, concrete content plans. You never use em dashes. You never fabricate metrics - only reference numbers that appear in the data. Format output in clean markdown with short sections and bullet points. Be specific and actionable, never generic. When you use web search, cite what you found briefly (creator names, formats, trends) instead of vague claims.";

interface PostIn {
  caption: string | null; reach: number | null; views: number | null; likes: number | null;
  comments: number | null; shares: number | null; saved: number | null;
  engagement_rate: number | null; avg_watch_time_sec: number | null;
  media_product_type: string | null; timestamp: string | null; hashtags: string[];
}

function postLine(p: PostIn): string {
  const hook = (p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim().slice(0, 110) || "(no caption)";
  const bits = [
    p.reach != null ? `reach ${p.reach}` : null,
    p.views != null ? `views ${p.views}` : null,
    p.likes != null ? `likes ${p.likes}` : null,
    p.comments != null ? `comments ${p.comments}` : null,
    p.shares != null ? `shares ${p.shares}` : null,
    p.saved != null ? `saves ${p.saved}` : null,
    p.engagement_rate != null ? `er ${p.engagement_rate}%` : null,
    p.avg_watch_time_sec != null ? `watch ${p.avg_watch_time_sec}s` : null,
    p.media_product_type,
    p.timestamp ? p.timestamp.slice(0, 16).replace("T", " ") : null,
  ].filter(Boolean).join(", ");
  return `- "${hook}" [${bits}]`;
}

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const { posts } = (await req.json().catch(() => ({}))) as { posts?: PostIn[] };
    if (!posts?.length) return badRequest("no_posts", "No post data available yet. Connect an account with published posts first.");

    const sorted = [...posts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
    const top = sorted.slice(0, 12);
    const bottom = sorted.slice(-6).reverse();

    // Our accounts (distribution context: satellites funnel into the main account)
    const accounts = await db.igAccount.findMany({
      where: { workspaceId: wsId },
      orderBy: { followersCount: "desc" },
      select: { username: true, followersCount: true },
    });
    const accountLines = accounts.map((a, i) =>
      `- @${a.username} (${a.followersCount ?? "?"} followers)${i === 0 ? " ← MAIN account" : " (satellite/distribution account)"}`,
    );

    // Competitor context from tracked data (best-effort)
    const competitors = await db.competitor.findMany({
      where: { workspaceId: wsId },
      include: {
        snapshots: { orderBy: { capturedOn: "desc" }, take: 1 },
        posts: { orderBy: [{ likes: { sort: "desc", nulls: "last" } }], take: 5 },
      },
      take: 8,
    });
    const compLines = competitors.map((c) => {
      const s = c.snapshots[0];
      const tops = c.posts
        .map((p) => `"${(p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim().slice(0, 90)}" (${p.likes ?? "?"} likes, ${p.comments ?? "?"} comments${p.postedOn ? `, posted ${p.postedOn.toISOString().slice(0, 10)}` : ""})`)
        .join("; ");
      return `- @${c.username}${s?.followersCount ? ` (${s.followersCount} followers, ${s.engagementRate ?? "?"}% er)` : ""}${tops ? ` - top posts: ${tops}` : ""}`;
    });

    // Watched-reel intelligence: the server downloaded and analyzed the actual
    // videos (frames + audio) - real hooks/formats/pacing for ours and theirs.
    const [ownWatched, compWatched] = await Promise.all([
      db.videoAnalysis.findMany({
        where: { workspaceId: wsId, source: "OWN", status: "DONE" },
        orderBy: { analyzedAt: "desc" },
        take: 12,
        select: { summary: true, analysis: true },
      }),
      db.videoAnalysis.findMany({
        where: { workspaceId: wsId, source: "COMPETITOR", status: "DONE" },
        include: { competitorPost: { select: { views: true, competitor: { select: { username: true } } } } },
      }),
    ]);
    const ownWatchedLines = ownWatched.map((a) => formatAnalysisForReport(a)).filter(Boolean).map((l) => `- ${l}`);
    const compWatchedLines = compWatched
      .sort((x, y) => (y.competitorPost?.views ?? 0) - (x.competitorPost?.views ?? 0))
      .slice(0, 5)
      .map((a) => {
        const line = formatAnalysisForReport(a);
        return line ? `- @${a.competitorPost?.competitor?.username ?? "?"}: ${line}` : null;
      })
      .filter(Boolean) as string[];
    const watchedBlock = ownWatchedLines.length || compWatchedLines.length
      ? [
          "WHAT THE ANALYZED REELS ACTUALLY LOOK LIKE (the server watched these videos - frames + audio transcript; treat hooks/formats/pacing below as ground truth):",
          ...(ownWatchedLines.length ? ["Our reels:", ...ownWatchedLines] : []),
          ...(compWatchedLines.length ? ["Competitor reels (by views):", ...compWatchedLines] : []),
          "",
        ]
      : [];

    const prompt = [
      "OUR ACCOUNT NETWORK (distribution model: satellite accounts exist to push reach toward the MAIN account):",
      ...(accountLines.length ? accountLines : ["- (no accounts connected)"]),
      "",
      ...watchedBlock,
      "OUR RECENT POSTS, BEST PERFORMERS FIRST (28-day window):",
      ...top.map(postLine),
      "",
      "OUR WEAKEST RECENT POSTS:",
      ...bottom.map(postLine),
      "",
      compLines.length ? "TRACKED COMPETITORS:\n" + compLines.join("\n") : "TRACKED COMPETITORS: none yet",
      "",
      "First, use web search (2-4 focused searches) to check what is currently trending in AI-niche Instagram reels and short-form content this week: formats, hooks, topics, and which AI creators are blowing up. Then produce this week's strategy with exactly these sections:",
      "1. **What the data says** - 3-4 blunt observations comparing winners vs losers (hooks, format, topics, watch time; use the watched-reel analysis where available instead of guessing from captions).",
      "2. **What's trending right now** - 3-4 findings from your web research relevant to our niche, with the source creator/format named.",
      "3. **5 reel ideas for this week** - for each: working title, spoken hook (under 12 words), visual hook for the first 2 seconds, and why the data or trend supports it (reference watched-reel hooks/formats that already proved out).",
      "4. **Posting plan** - which days/times to post based on the timestamps in the data and AI-niche best practices.",
      "5. **Steal from competitors** - 2-3 angles competitors are winning with that we can adapt (skip if no competitor data).",
      "6. **Distribution checklist** - 6 concrete actions to multiply reach across the satellite network and funnel followers to the MAIN account (cross-posting cadence, comment pods between own accounts, collab posts, trial reels, CTA patterns pointing to the main account, SEO captions).",
    ].join("\n");

    const { text } = await runClaude({
      system: SYSTEM,
      prompt,
      maxTokens: 4096,
      webSearch: true,
      maxSearches: 5,
    });

    return NextResponse.json({ text, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("[ai strategy]", e);
    return aiErrorResponse(e) ?? serverError("Strategy generation failed - check server logs.");
  }
}
