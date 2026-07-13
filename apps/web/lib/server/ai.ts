import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";

// Shared Claude helper for all AI routes. Centralizes:
// - model selection
// - optional server-side web search (real market research)
// - pause_turn continuation (server tools can pause long loops)
// - typed error mapping so the UI shows the real reason, never a bare 500

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";

export class AiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ── Provider selection ────────────────────────────────────────────────────
// Default is Anthropic. Set AI_PROVIDER=openai (local .env.local only) to route
// every AI call through an OpenAI-compatible endpoint — e.g. GitHub Models for
// free local testing. GitHub Models is rate-limited and dev-only; keep prod on
// Anthropic. On this path Anthropic's server-side web_search is unavailable.
export function aiProvider(): "anthropic" | "openai" {
  return (process.env.AI_PROVIDER ?? "anthropic").toLowerCase() === "openai" ? "openai" : "anthropic";
}

export function openAIConfig() {
  return {
    apiKey: process.env.OPENAI_API_KEY,
    baseUrl: (process.env.OPENAI_BASE_URL ?? "https://models.github.ai/inference").replace(/\/$/, ""),
    model: process.env.OPENAI_MODEL ?? "openai/gpt-5",
  };
}

type OpenAIMessage = { role: "system" | "user" | "assistant"; content: unknown };

// One OpenAI-compatible /chat/completions call. Used for both text prompts and
// vision (image_url content blocks). Errors are mapped to AiError so the UI
// shows the real reason.
export async function openAIChat(messages: OpenAIMessage[], maxTokens: number): Promise<{ text: string; model: string }> {
  const { apiKey, baseUrl, model } = openAIConfig();
  if (!apiKey) {
    throw new AiError(400, "ai_not_configured", "Add OPENAI_API_KEY (your GitHub Models token) to .env.local to use the OpenAI test provider.");
  }
  let res: Response;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      // GPT-5 and other reasoning models require max_completion_tokens (not
      // max_tokens) and consume part of it as reasoning, so keep headroom.
      body: JSON.stringify({ model, messages, max_completion_tokens: Math.max(maxTokens, 4096) }),
      signal: AbortSignal.timeout(180_000),
    });
  } catch (e) {
    throw new AiError(502, "ai_failed", `AI request failed to reach ${baseUrl}: ${(e as Error).message}`);
  }
  const json = (await res.json().catch(() => ({}))) as {
    error?: { message?: string }; model?: string; choices?: { message?: { content?: string } }[];
  };
  if (!res.ok) {
    const friendly =
      res.status === 401 ? "The OPENAI_API_KEY (GitHub Models token) is invalid or is missing the 'models' permission."
      : res.status === 429 ? "GitHub Models rate limit hit — wait a bit and try again (it is heavily throttled)."
      : json?.error?.message ?? `AI request failed (HTTP ${res.status})`;
    throw new AiError(res.status === 401 ? 401 : 502, "ai_failed", friendly);
  }
  const text = (json?.choices?.[0]?.message?.content ?? "").trim();
  if (!text) throw new AiError(502, "ai_empty", "The AI returned an empty response — GPT-5 reasoning may have used the whole token budget; try again.");
  return { text, model: json?.model ?? model };
}

export function aiErrorResponse(e: unknown): NextResponse | null {
  if (e instanceof AiError) {
    return NextResponse.json({ error: { code: e.code, message: e.message } }, { status: e.status });
  }
  if (e instanceof Anthropic.APIError) {
    const status = typeof e.status === "number" ? e.status : 502;
    const friendly =
      status === 401 ? "The ANTHROPIC_API_KEY on the server is invalid. Update it in your Render environment."
      : status === 429 ? "AI rate limit hit — wait a minute and try again."
      : status === 400 && /credit|billing/i.test(e.message) ? "Anthropic account has insufficient credit. Top up at console.anthropic.com."
      : `AI request failed: ${e.message}`;
    return NextResponse.json({ error: { code: "ai_failed", message: friendly } }, { status: 502 });
  }
  return null;
}

export async function runClaude(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  webSearch?: boolean;
  maxSearches?: number;
}): Promise<{ text: string; model: string }> {
  // OpenAI-compatible test provider (e.g. GitHub Models). Web search is not
  // available on this path, so it is silently ignored.
  if (aiProvider() === "openai") {
    return openAIChat(
      [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      opts.maxTokens ?? 4096,
    );
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiError(400, "ai_not_configured", "Add ANTHROPIC_API_KEY to the server environment to enable AI features.");
  }

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const tools = opts.webSearch
    ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: opts.maxSearches ?? 6 }]
    : undefined;

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  let response = await client.messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
    ...(tools ? { tools } : {}),
  });

  // Server-side tools can pause long loops — resume up to 5 times.
  for (let i = 0; i < 5 && response.stop_reason === "pause_turn"; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await client.messages.create({
      model: MODEL,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages,
      ...(tools ? { tools } : {}),
    });
  }

  const text = response.content
    .map((b) => (b.type === "text" ? b.text : ""))
    .join("")
    .trim();
  if (!text) throw new AiError(502, "ai_empty", "The AI returned an empty response — try again.");
  return { text, model: response.model };
}
