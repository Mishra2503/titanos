import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse, aiWebSearchAvailable } from "@/lib/server/ai";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

// Deep, on-demand research for a single competitor reel:
//   1. dissect the reel (hook / body / CTA) from its caption + AI watch data,
//   2. derive the best content idea(s) for us,
//   3. use live web search across social, blogs and articles to judge how hot /
//      trending each idea is right now, returning a 0-100 score + tag + sources.
// Never fabricates numbers — only what's in the data or found via search.

const SYSTEM_SEARCH =
  "You are a viral short-form content strategist for an AI/tech Instagram brand. You dissect a competitor reel and turn it into a high-potential content idea for us, then judge how hot the topic is right now using web search. You never use em dashes. You never fabricate metrics or sources; every source must be a real URL you found via search. Reply with ONLY a single minified JSON object, no markdown fences.";
const SYSTEM_ESTIMATE =
  "You are a viral short-form content strategist for an AI/tech Instagram brand. You dissect a competitor reel and turn it into a high-potential content idea for us, then give your best judgement of how hot the topic is. You have NO web access, so base hotness on your own knowledge and clearly treat it as an estimate. You never use em dashes. You never fabricate sources or cite URLs you cannot verify: always return an empty sources array. Reply with ONLY a single minified JSON object, no markdown fences.";

interface Src { title: string; url: string }
interface Idea {
  idea: string; angle: string | null; suggested_hook: string | null; suggested_format: string | null;
  hot_score: number | null; hot_tag: string | null; trend_summary: string | null; sources: Src[];
}
interface Analysis { hook: string | null; body: string | null; cta: string | null; content_ideas: Idea[]; estimate: boolean; generated_at: string }

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}
function num(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : null;
}
function sources(v: unknown): Src[] {
  if (!Array.isArray(v)) return [];
  return v
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>;
      const url = s(o.url);
      if (!url) return null;
      return { title: s(o.title) ?? url, url };
    })
    .filter((x): x is Src => x != null)
    .slice(0, 6);
}

function parseAnalysis(raw: string, canSearch: boolean): Analysis {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let obj: Record<string, unknown> = {};
  if (start !== -1 && end > start) {
    try { obj = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { /* keep empty */ }
  }
  const rawIdeas = Array.isArray(obj.content_ideas) ? obj.content_ideas : [];
  const content_ideas: Idea[] = rawIdeas.slice(0, 4).map((raw) => {
    const o = (raw ?? {}) as Record<string, unknown>;
    return {
      idea: s(o.idea) ?? "Untitled idea",
      angle: s(o.angle),
      suggested_hook: s(o.suggested_hook ?? o.hook),
      suggested_format: s(o.suggested_format ?? o.format),
      hot_score: num(o.hot_score),
      hot_tag: s(o.hot_tag),
      trend_summary: s(o.trend_summary ?? o.why_hot),
      // Without live web search we cannot cite real sources — never surface
      // invented URLs.
      sources: canSearch ? sources(o.sources) : [],
    };
  });
  return {
    hook: s(obj.hook),
    body: s(obj.body),
    cta: s(obj.cta),
    content_ideas,
    estimate: !canSearch,
    generated_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id, postId } = await params;

    const post = await db.competitorPost.findFirst({
      where: { id: postId, competitorId: id, workspaceId: wsId },
      include: { videoAnalysis: true, competitor: { select: { username: true, category: true } } },
    });
    if (!post) return notFound("Reel not found");

    // Outlier context: this reel's views vs the competitor's median reel views.
    const siblings = await db.competitorPost.findMany({
      where: { competitorId: id, views: { gt: 0 } },
      select: { views: true },
    });
    const views = siblings.map((p) => p.views as number).sort((a, b) => a - b);
    const median = views.length ? views[Math.floor(views.length / 2)] : null;
    const outlier = median && post.views ? Math.round((post.views / median) * 10) / 10 : null;

    const va = post.videoAnalysis;
    const vaFields = (va?.analysis ?? {}) as Record<string, unknown>;
    const hashtags = ((post.hashtags as string[]) ?? []).join(" ");
    const canSearch = aiWebSearchAvailable();

    const trendStep = canSearch
      ? "3. For EACH idea, run web search across Instagram, TikTok, YouTube, X, blogs and news to judge how hot/trending that topic is RIGHT NOW. Give hot_score 0-100, a hot_tag (one of '🔥 Hot', 'Rising', 'Steady', 'Niche'), a one-sentence trend_summary citing what you found, a suggested_hook (under 12 words) and suggested_format. Include 1-3 real source URLs per idea."
      : "3. For EACH idea, give your best-judgement hot_score 0-100 and hot_tag (one of '🔥 Hot', 'Rising', 'Steady', 'Niche') based on your own knowledge of what performs in this niche, a one-sentence trend_summary written as an estimate, a suggested_hook (under 12 words) and suggested_format. You have no web access: return an empty sources array and do NOT invent URLs.";

    const prompt = [
      `COMPETITOR: @${post.competitor.username} (niche: ${post.competitor.category ?? "AI/tech"})`,
      `REEL METRICS: views ${post.views ?? "?"}, likes ${post.likes ?? "?"}, comments ${post.comments ?? "?"}${outlier ? `, outlier ${outlier}x vs their median` : ""}`,
      `CAPTION: ${(post.caption ?? "(none)").slice(0, 1000)}`,
      `HASHTAGS: ${hashtags || "(none)"}`,
      va?.transcript ? `TRANSCRIPT (spoken words in the reel):\n${va.transcript.slice(0, 4000)}` : "TRANSCRIPT: (not available)",
      va?.summary ? `WATCH SUMMARY: ${va.summary}` : "",
      vaFields.hook_spoken || vaFields.hook_visual ? `DETECTED HOOK: ${s(vaFields.hook_spoken) ?? s(vaFields.hook_visual)}` : "",
      vaFields.format ? `DETECTED FORMAT: ${s(vaFields.format)}` : "",
      "",
      "TASK:",
      "1. Dissect this reel into: hook (the first line / first 3 seconds), body (how the middle delivers), cta (the ask at the end).",
      "2. Derive 2-3 content ideas WE could make inspired by this reel — each a distinct angle, not a copy.",
      trendStep,
      "",
      'Return ONLY this JSON: {"hook":"","body":"","cta":"","content_ideas":[{"idea":"","angle":"","suggested_hook":"","suggested_format":"","hot_score":0,"hot_tag":"","trend_summary":"","sources":[{"title":"","url":""}]}]}',
    ].filter(Boolean).join("\n");

    const { text } = await runClaude({
      system: canSearch ? SYSTEM_SEARCH : SYSTEM_ESTIMATE,
      prompt,
      maxTokens: 3000,
      webSearch: canSearch,
      maxSearches: 2,
    });
    const analysis = parseAnalysis(text, canSearch);

    await db.competitorPost.update({
      where: { id: postId },
      data: { contentAnalysis: analysis as unknown as object, contentAnalyzedAt: new Date() },
    });

    return NextResponse.json(analysis);
  } catch (e) {
    console.error("[competitor reel analyze]", e);
    return aiErrorResponse(e) ?? serverError(`Analysis failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
