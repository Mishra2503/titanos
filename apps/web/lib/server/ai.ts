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
