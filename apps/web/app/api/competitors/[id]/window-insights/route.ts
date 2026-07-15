import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { runClaude, aiErrorResponse, aiWebSearchAvailable } from "@/lib/server/ai";
import { generateScript, serializeScript, type ReelSeed } from "@/lib/server/scripts";

// Aggregate insight for a time window (last N days) of a competitor's reels:
//  - free local cadence stats (reel count, posts/week)
//  - on-demand AI trend read (topics + what works), one light web-search call
//  - optional: turn the chosen angle into a script (reuses the script generator)

const ALLOWED_DAYS = new Set([7, 28, 30, 60, 90]);

function s(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}
function strArr(v: unknown, cap = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => s(x)).filter((x): x is string => !!x).slice(0, cap);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const competitor = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!competitor) return notFound("Competitor not found");

    const body = await req.json().catch(() => ({}));
    const days = ALLOWED_DAYS.has(Number(body?.days)) ? Number(body.days) : 28;
    const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);

    const reels = await db.competitorPost.findMany({
      where: { competitorId: id, workspaceId: wsId, postedOn: { gte: cutoff } },
      orderBy: { postedOn: "desc" },
      include: { videoAnalysis: { select: { transcript: true } } },
    });

    // ── Free local cadence stats ─────────────────────────────────────────────
    const reelCount = reels.length;
    const postsPerWeek = Math.round((reelCount / days) * 7 * 10) / 10;

    // ── Mode 2: turn a chosen angle into a script (reuses the generator) ──────
    const angle = s(body?.angle);
    if (angle) {
      const seed: ReelSeed = {
        username: competitor.username,
        niche: competitor.category,
        caption: `Trending angle in @${competitor.username}'s niche over the last ${days} days: ${angle}`,
        hashtags: [],
        views: null, likes: null, comments: null,
        transcript: null, detectedHook: null, detectedFormat: null,
        angleFromAnalysis: angle,
      };
      const gen = await generateScript(seed);
      const script = await db.script.create({
        data: {
          workspaceId: wsId,
          competitorId: id,
          title: gen.title,
          status: "DRAFT",
          sourceReel: { trend: angle, window_days: days, username: competitor.username },
          research: gen.research as unknown as object,
          hook: gen.hook,
          body: gen.body,
          caption: gen.caption,
          hashtags: gen.hashtags,
          model: gen.model,
          createdBy: userId ?? null,
        },
      });
      return NextResponse.json({ script: serializeScript({ ...script, competitorUsername: competitor.username }) });
    }

    // ── Mode 1: AI trend read over the window ────────────────────────────────
    const canSearch = aiWebSearchAvailable();
    const lines = reels.slice(0, 30).map((r, i) => {
      const cap = (r.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 180) || "(no caption)";
      const tr = r.videoAnalysis?.transcript ? ` | transcript: ${r.videoAnalysis.transcript.replace(/\s+/g, " ").slice(0, 200)}` : "";
      return `${i + 1}. [${r.views ?? "?"} views] ${cap}${tr}`;
    });

    const system =
      "You are a short-form content strategist. You never use em dashes. You never fabricate numbers or sources. Reply with ONLY a minified JSON object, no markdown fences.";
    const prompt = [
      `COMPETITOR: @${competitor.username} (niche: ${competitor.category ?? "AI/tech"})`,
      `WINDOW: last ${days} days — ${reelCount} reels (${postsPerWeek}/week)`,
      "REELS (newest first):",
      ...(lines.length ? lines : ["(no reels in this window)"]),
      "",
      canSearch
        ? "TASK: Identify the topics/themes this creator is riding in this window and which are trending right now (use web search, 1-2 checks). Then say what's working (hooks, formats). Pick the single best angle WE should make a reel on next."
        : "TASK: From these reels, identify the topics/themes and which look strongest, what's working (hooks, formats), and pick the single best angle WE should make a reel on next. You have no web access; base it on the reels and your knowledge.",
      "",
      'Return ONLY this JSON: {"summary":"","topics":["",""],"what_works":["",""],"best_angle":""}',
    ].join("\n");

    const { text } = await runClaude({ system, prompt, maxTokens: 1400, webSearch: canSearch, maxSearches: 2 });
    let obj: Record<string, unknown> = {};
    const a = text.indexOf("{"); const b = text.lastIndexOf("}");
    if (a !== -1 && b > a) { try { obj = JSON.parse(text.slice(a, b + 1)); } catch { /* keep empty */ } }

    return NextResponse.json({
      window_days: days,
      reel_count: reelCount,
      posts_per_week: postsPerWeek,
      summary: s(obj.summary),
      topics: strArr(obj.topics),
      what_works: strArr(obj.what_works),
      best_angle: s(obj.best_angle),
      estimate: !canSearch,
    });
  } catch (e) {
    console.error("[window-insights]", e);
    return aiErrorResponse(e) ?? serverError(`Window insights failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
