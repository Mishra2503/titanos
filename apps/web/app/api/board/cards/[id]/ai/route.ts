import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";

const SYSTEM = "You are a senior short-form content strategist embedded inside Aifluencee Content Hub, helping Instagram Business/Creator accounts produce on-brand, high-performing Reels and posts. You write tight, punchy, conversational copy. You never use em dashes. You never fabricate metrics. Your suggestions must be ready to paste into Instagram without further editing.";

type AiAction = "hooks" | "caption" | "hashtags" | "refine";

function buildPrompt(action: AiAction, card: { title: string; status: string | null; platforms: unknown; hook: string | null; visualHook: string | null; caption: string | null; hashtags: unknown; notes: string | null }, instruction?: string): string {
  const parts = [`TITLE: ${card.title}`];
  if (card.status) parts.push(`STATUS: ${card.status}`);
  const platforms = card.platforms as string[];
  if (platforms?.length) parts.push(`PLATFORMS: ${platforms.join(", ")}`);
  if (card.hook) parts.push(`CURRENT HOOK: ${card.hook}`);
  if (card.visualHook) parts.push(`VISUAL CONCEPT: ${card.visualHook}`);
  if (card.caption) parts.push(`CURRENT CAPTION:\n${card.caption}`);
  const hashtags = card.hashtags as string[];
  if (hashtags?.length) parts.push(`CURRENT HASHTAGS: ${hashtags.join(" ")}`);
  if (card.notes) parts.push(`NOTES: ${card.notes}`);
  const ctx = parts.join("\n");
  const extra = instruction ? `\nADDITIONAL INSTRUCTION: ${instruction}` : "";
  if (action === "hooks") return `${ctx}${extra}\n\nWrite 5 alternative opening hooks (the first spoken line of the reel) for this idea.\nEach hook MUST: be under 12 words, create immediate curiosity, and be different in pattern from the others (question, contrarian claim, stat, story, callout). Output as a plain numbered list, one hook per line, no commentary.`;
  if (action === "caption") return `${ctx}${extra}\n\nWrite the Instagram caption for this post. Structure: a strong first line that hooks (under 90 chars), 2-4 short body lines that deliver value, and a single comment-keyword CTA on the final line. Total under 220 words. Output ONLY the caption text, no labels or quotes.`;
  if (action === "hashtags") return `${ctx}${extra}\n\nSuggest 12-15 Instagram hashtags for this post. Mix: 3 broad (high volume), 6 niche (mid volume), 4 micro (low competition). Output as a single line, space-separated, each starting with #. Lowercase only.`;
  if (action === "refine") { const target = card.caption || card.hook || card.notes || card.title; return `${ctx}${extra}\n\nImprove the following text. Keep the meaning. Make it tighter, punchier, and more scroll-stopping. Output only the improved text, no commentary.\n\nTEXT:\n${target}`; }
  throw new Error("unknown action");
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const card = await db.boardCard.findFirst({ where: { id, workspaceId: wsId } });
    if (!card) return notFound("Card not found");

    const { action, instruction } = await req.json() as { action: AiAction; instruction?: string };
    if (!["hooks","caption","hashtags","refine"].includes(action)) return badRequest("unknown_action", "Unknown AI action");

    // runClaude routes to Anthropic by default, or the OpenAI-compatible test
    // provider (GitHub Models) when AI_PROVIDER=openai.
    const { text } = await runClaude({ system: SYSTEM, prompt: buildPrompt(action, card, instruction), maxTokens: 1024 });
    return NextResponse.json({ action, text });
  } catch (e) {
    console.error("[ai]", e);
    return aiErrorResponse(e) ?? serverError();
  }
}
