import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { formatAnalysisForReport } from "@/lib/server/videoAnalysis";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

// Deep competitor intelligence: tracked data (followers, posts, hooks,
// captions, hashtags, posting times) + live web market research → a concrete
// counter-strategy.

const SYSTEM =
  "You are a competitive intelligence analyst at a short-form social media agency in the AI/tech niche. You dissect competitor Instagram accounts and produce concrete counter-strategies. You never use em dashes. You never fabricate metrics — only cite numbers present in the data or found via web search (and say where they came from). CRITICAL: for accounts we do not own, Instagram does not expose private insights (reach, saves, shares, watch-time, retention) — never state or estimate those; only public likes, comments, and scraped view counts exist. Output clean markdown with short sections.";

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function analysisField(va: { analysis: unknown } | null, key: string): string | null {
  if (!va?.analysis || typeof va.analysis !== "object") return null;
  const v = (va.analysis as Record<string, unknown>)[key];
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const c = await db.competitor.findFirst({
      where: { id, workspaceId: wsId },
      include: {
        snapshots: { orderBy: { capturedOn: "desc" }, take: 10 },
        posts: {
          orderBy: [{ postedOn: { sort: "desc", nulls: "last" } }],
          take: 50,
          include: { videoAnalysis: { select: { status: true, summary: true, analysis: true } } },
        },
      },
    });
    if (!c) return notFound("Competitor not found");

    const snapLines = c.snapshots.map((s) =>
      `- ${s.capturedOn.toISOString().slice(0, 10)}: ${s.followersCount ?? "?"} followers, avg ${s.avgLikes ?? "?"} likes / ${s.avgComments ?? "?"} comments, er ${s.engagementRate ?? "?"}%`,
    );
    let watchedCount = 0;
    const postLines = c.posts.map((p) => {
      const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || "(no caption)";
      const tags = ((p.hashtags as string[]) ?? []).slice(0, 8).join(" ");
      const when = p.postedOn ? p.postedOn.toISOString().slice(0, 16).replace("T", " ") : "undated";
      const line = `- [${when}] "${caption}" | likes ${p.likes ?? "?"}, comments ${p.comments ?? "?"}${p.views != null ? `, views ${p.views}` : ""} | ${p.postType ?? "POST"}${tags ? ` | tags: ${tags}` : ""}`;
      const watched = p.videoAnalysis?.status === "DONE" ? formatAnalysisForReport(p.videoAnalysis) : null;
      if (watched) { watchedCount++; return `${line}\n  · watched: ${watched}`; }
      return line;
    });

    // ── Format mix (from watched videos) ─────────────────────────────────────
    const formatCounts = new Map<string, number>();
    for (const p of c.posts) {
      const fmt = p.videoAnalysis?.status === "DONE" ? analysisField(p.videoAnalysis, "format") : null;
      if (fmt) formatCounts.set(fmt, (formatCounts.get(fmt) ?? 0) + 1);
    }
    const formatLines = [...formatCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([fmt, n]) => `- ${fmt}: ${n} reel${n === 1 ? "" : "s"}`);

    // ── Outliers (videos beating the account's own median by >=2x) ───────────
    const viewVals = c.posts.map((p) => p.views ?? 0).filter((v) => v > 0);
    const engVals = c.posts.map((p) => (p.likes ?? 0) + (p.comments ?? 0)).filter((v) => v > 0);
    const useViews = viewVals.length >= 3;
    const baseline = useViews ? median(viewVals) : median(engVals);
    const metricName = useViews ? "views" : "engagement";
    const outlierLines = c.posts
      .map((p) => {
        const metric = useViews ? p.views ?? 0 : (p.likes ?? 0) + (p.comments ?? 0);
        const mult = baseline > 0 && metric > 0 ? Math.round((metric / baseline) * 10) / 10 : 0;
        return { p, metric, mult };
      })
      .filter((x) => x.mult >= 2)
      .sort((a, b) => b.mult - a.mult)
      .slice(0, 8)
      .map(({ p, metric, mult }) => {
        const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 100) || "(no caption)";
        const why = p.videoAnalysis?.status === "DONE" ? analysisField(p.videoAnalysis, "whyItWorks") : null;
        const hook = p.videoAnalysis?.status === "DONE" ? (analysisField(p.videoAnalysis, "hookSpoken") ?? analysisField(p.videoAnalysis, "hookVisual")) : null;
        return `- ${mult}x median (${metric} ${metricName}) "${caption}"${hook ? ` | hook: ${hook}` : ""}${why ? ` | why: ${why}` : ""}`;
      });

    const prompt = [
      `COMPETITOR: @${c.username}${c.displayName ? ` (${c.displayName})` : ""}`,
      `Niche/category: ${c.category ?? "AI/tech"}`,
      `Operator notes: ${c.notes ?? "none"}`,
      "",
      "FOLLOWER SNAPSHOTS (newest first):",
      ...(snapLines.length ? snapLines : ["- none yet (sync to populate)"]),
      "",
      formatLines.length ? "FORMAT MIX (from reels the server actually watched):" : "FORMAT MIX: no reels watched yet",
      ...formatLines,
      "",
      outlierLines.length
        ? `OUTLIER REELS (beat this account's median ${metricName} by 2x or more — these are their proven winners):`
        : "OUTLIER REELS: not enough data yet to compute outliers",
      ...outlierLines,
      "",
      "ALL RECENT POSTS WITH CAPTIONS, PUBLIC ENGAGEMENT, AND POSTING TIMES (newest first):",
      ...(watchedCount > 0
        ? [
            `NOTE: ${watchedCount} of these reels were actually WATCHED by the server (video frames + audio transcript analyzed). Their '· watched:' lines describe the real visual hook, spoken hook, format, pacing, and CTA — treat those as ground truth, far more reliable than inferring from captions.`,
          ]
        : []),
      ...(postLines.length ? postLines : ["- none yet (sync to populate)"]),
      "",
      "TASK: Produce a deep competitive-intelligence and content-strategy report so we can overtake this creator and become the #1 AI creator. First, use web search (2-4 focused searches) to research this creator and the topics their outlier reels cover: are other AI-niche creators making the same content, and which formats of this topic are going viral right now? Then write exactly these sections:",
      "1. **Niche & positioning** — what exact sub-niche and angle they own, who their audience is, growth trajectory and posting cadence (compute cadence from the timestamps).",
      "2. **Content & format mix** — the formats they lean on (use the FORMAT MIX above from watched reels), which formats correlate with their outliers, and their typical structure/length/editing style.",
      "3. **Winning content & outliers** — walk through the OUTLIER REELS: what each one is, and WHY it outperformed (cite the watched visual/spoken hook and why-it-works). Only reference public likes/comments and scraped views; do NOT invent reach, saves, or watch-time.",
      "4. **Hook bank** — 8 hook formulas pulled from their outliers (prioritize the watched reels' real visual+spoken hooks), rewritten so we can use them (under 12 words each).",
      "5. **Engagement patterns** — what topics, hooks, and formats correlate with their highest public engagement and views, and the whitespace they are NOT covering.",
      "6. **Our counter-strategy & scripting playbook** — 6 concrete moves to overtake them: which of their winning topics to hit with better execution, which gaps to own, and 3 ready-to-shoot reel concepts for us (each with a spoken hook under 12 words, a first-2-seconds visual hook, and the format to use).",
    ].join("\n");

    const { text, model } = await runClaude({
      system: SYSTEM,
      prompt,
      maxTokens: 5120,
      webSearch: true,
      maxSearches: 3,
    });

    const report = await db.competitorReport.create({
      data: { workspaceId: wsId, competitorId: id, title: `Deep analysis: @${c.username}`, content: text, model, generatedAt: new Date(), createdBy: userId ?? null },
    });
    return NextResponse.json({ id: report.id, competitor_id: report.competitorId, title: report.title, content: report.content, model: report.model, generated_at: report.generatedAt }, { status: 201 });
  } catch (e) {
    console.error("[competitor report]", e);
    return aiErrorResponse(e) ?? serverError("Report generation failed — check server logs.");
  }
}
