import type { Script } from "@prisma/client";
import { runClaude, aiWebSearchAvailable } from "./ai";

// Script generation for the Scriptwriter tab. A reel's dissection + (optional)
// live trend research is turned into a shoot-ready short-form script. Web
// research only runs on the Anthropic API; on Bedrock it degrades to a clearly
// labelled AI estimate with no invented sources.

export interface ScriptResearch {
  angle: string | null;
  trend_note: string | null;
  similar_creators: string[];
  hook_options: string[];
  estimate: boolean;
}
export interface GeneratedScript {
  title: string;
  hook: string | null;
  body: string;
  caption: string | null;
  hashtags: string[];
  research: ScriptResearch;
  model: string | null;
}

export interface ReelSeed {
  username: string;
  niche: string | null;
  caption: string | null;
  hashtags: string[];
  views: number | null;
  likes: number | null;
  comments: number | null;
  transcript: string | null;
  detectedHook: string | null;
  detectedFormat: string | null;
  angleFromAnalysis: string | null; // best content idea from a prior Analyze pass
}

const SYSTEM =
  "You are a top short-form creator who writes reel scripts the way real people actually talk to camera - punchy, specific, and human. VOICE RULES: sound like a real person, never like a brand or an AI. Use short spoken sentences, contractions, and everyday words. Be concrete (real names, numbers, specifics) instead of vague hype. NEVER use AI/marketing clichés such as 'in today's video', 'let's dive in', 'game-changer', 'unlock', 'in this fast-paced world', 'revolutionize', 'the truth is', 'buckle up', or rhetorical 'ever wondered'. No em dashes. No emoji spam. Write for the ear, not the page. You never fabricate sources or cite URLs you cannot verify. Reply with ONLY a single minified JSON object, no markdown fences.";

function str(v: unknown): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t || null;
}
function strArr(v: unknown, cap = 12): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => str(x)).filter((x): x is string => !!x).slice(0, cap);
}

function parse(raw: string, estimate: boolean, model: string | null): GeneratedScript {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  let o: Record<string, unknown> = {};
  if (start !== -1 && end > start) {
    try { o = JSON.parse(raw.slice(start, end + 1)) as Record<string, unknown>; } catch { /* keep empty */ }
  }
  const r = (o.research ?? {}) as Record<string, unknown>;
  const hashtags = strArr(o.hashtags, 15).map((h) => (h.startsWith("#") ? h : `#${h}`));
  return {
    title: str(o.title) ?? "Untitled script",
    hook: str(o.hook),
    body: str(o.body ?? o.script) ?? "",
    caption: str(o.caption),
    hashtags,
    research: {
      angle: str(r.angle),
      trend_note: str(r.trend_note),
      similar_creators: strArr(r.similar_creators, 8),
      hook_options: strArr(r.hook_options, 8),
      estimate,
    },
    model,
  };
}

function seedLines(seed: ReelSeed): string[] {
  return [
    `SOURCE REEL from @${seed.username} (niche: ${seed.niche ?? "AI/tech"})`,
    `Metrics: views ${seed.views ?? "?"}, likes ${seed.likes ?? "?"}, comments ${seed.comments ?? "?"}`,
    seed.angleFromAnalysis ? `Chosen angle to build on: ${seed.angleFromAnalysis}` : "",
    `Caption: ${(seed.caption ?? "(none)").slice(0, 800)}`,
    `Hashtags: ${seed.hashtags.join(" ") || "(none)"}`,
    seed.detectedHook ? `Their hook: ${seed.detectedHook}` : "",
    seed.detectedFormat ? `Their format: ${seed.detectedFormat}` : "",
    seed.transcript ? `Their transcript:\n${seed.transcript.slice(0, 3500)}` : "",
  ].filter(Boolean);
}

const OUT_SHAPE =
  'Return ONLY this JSON: {"title":"","hook":"","body":"","caption":"","hashtags":["",""],"research":{"angle":"","trend_note":"","similar_creators":["",""],"hook_options":["",""]}}';

function researchStep(canSearch: boolean): string {
  return canSearch
    ? "First, use web search across Instagram, TikTok, YouTube, X, blogs and news to research this topic and find creators making similar reels and how the format is trending right now. Put a factual trend_note and a list of similar_creators you actually found."
    : "You have NO web access. Fill research.trend_note as your best-judgement ESTIMATE (say it is an estimate), and similar_creators from your own knowledge (types/handles you are confident exist); never invent URLs.";
}

const BODY_SPEC =
  "The body is a complete, shoot-ready script the creator reads aloud. Put labelled sections on their own lines: HOOK (0-2s), then 3-6 BODY beats, then CTA. Write the exact spoken lines in a natural talking voice (contractions, short sentences, no corporate phrasing), plus brief [on-screen text] and [b-roll] cues in brackets. Keep it under 40 seconds of speech. The CTA should feel earned, not salesy.";

export async function generateScript(seed: ReelSeed): Promise<GeneratedScript> {
  const canSearch = aiWebSearchAvailable();
  const prompt = [
    ...seedLines(seed),
    "",
    "TASK: Create ONE original short-form reel script FOR US inspired by the source reel (a distinct angle, not a copy).",
    researchStep(canSearch),
    BODY_SPEC,
    "Also write: a punchy title, the single best hook line (under 12 words), a ready-to-post caption, and 8-12 relevant hashtags. In research.hook_options give 4 alternative hooks.",
    "",
    OUT_SHAPE,
  ].join("\n");
  const { text, model, searched } = await runClaude({ system: SYSTEM, prompt, maxTokens: 3500, webSearch: canSearch, maxSearches: 2 });
  return parse(text, !searched, model);
}

export async function regenerateScript(seed: ReelSeed, previousBody: string): Promise<GeneratedScript> {
  const canSearch = aiWebSearchAvailable();
  const prompt = [
    ...seedLines(seed),
    "",
    "PREVIOUS SCRIPT (make something clearly different but in the same winning content strategy and niche):",
    previousBody.slice(0, 3000),
    "",
    "TASK: Write a FRESH reel script with a new angle and hook but the same proven strategy. Do not repeat the previous script's structure or hook.",
    researchStep(canSearch),
    BODY_SPEC,
    "Also write: title, best hook (under 12 words), caption, 8-12 hashtags, and 4 alternative hooks in research.hook_options.",
    "",
    OUT_SHAPE,
  ].join("\n");
  const { text, model, searched } = await runClaude({ system: SYSTEM, prompt, maxTokens: 3500, webSearch: canSearch, maxSearches: 2 });
  return parse(text, !searched, model);
}

// Instruction-driven rewrite of an existing script. Returns the new body text
// (no web search - this is an edit, not research).
export async function rewriteScriptBody(currentBody: string, instruction: string): Promise<{ body: string; model: string | null }> {
  const system =
    "You are a short-form video script editor. Rewrite the given reel script following the user's instruction, keeping it shoot-ready with HOOK / BODY beats / CTA and [on-screen] cues. Keep it in a natural talking-to-camera voice: short spoken sentences, contractions, concrete specifics, and NO AI/marketing clichés ('let's dive in', 'game-changer', 'in today's video', 'buckle up'). You never use em dashes. Return ONLY the rewritten script text, no preamble, no markdown fences.";
  const prompt = [
    "CURRENT SCRIPT:",
    currentBody,
    "",
    `INSTRUCTION: ${instruction || "Tighten it, sharpen the hook, and make the CTA stronger."}`,
    "",
    "Return the full rewritten script now.",
  ].join("\n");
  const { text, model } = await runClaude({ system, prompt, maxTokens: 3000 });
  return { body: text, model };
}

// ── Serialization (Prisma row → client shape) ───────────────────────────────
export function serializeScript(s: Script & { competitorUsername?: string | null }) {
  return {
    id: s.id,
    competitor_id: s.competitorId,
    competitor_post_id: s.competitorPostId,
    competitor_username: s.competitorUsername ?? null,
    title: s.title,
    status: s.status,
    source_reel: s.sourceReel ?? null,
    research: (s.research ?? null) as ScriptResearch | null,
    hook: s.hook,
    body: s.body,
    caption: s.caption,
    hashtags: (s.hashtags as string[]) ?? [],
    model: s.model,
    board_card_id: s.boardCardId,
    created_at: s.createdAt.toISOString(),
    updated_at: s.updatedAt.toISOString(),
  };
}
