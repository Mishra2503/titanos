import Anthropic from "@anthropic-ai/sdk";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";
import { NextResponse } from "next/server";

// Shared Claude helper for all AI routes. Centralizes:
// - provider selection (Anthropic API | AWS Bedrock | OpenAI-compatible test)
// - optional server-side web search (Anthropic API only)
// - pause_turn continuation (server tools can pause long loops)
// - typed error mapping so the UI shows the real reason, never a bare 500

const MODEL = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
// When set (e.g. "us.anthropic.claude-sonnet-4-5-20250929-v1:0"), Claude is
// routed through AWS Bedrock using the standard AWS credential chain
// (AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY / AWS_REGION). Bedrock does NOT
// support Anthropic's hosted web_search tool.
const BEDROCK_MODEL = process.env.BEDROCK_MODEL;

// A minimal structural view of the client so the Anthropic and Bedrock SDKs
// (API-compatible but distinct classes) can share one code path.
interface ClaudeLike {
  messages: { create(body: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> };
}

function useBedrock(): boolean {
  return !!BEDROCK_MODEL && aiProvider() !== "openai";
}

// Anthropic's hosted web_search server tool is only available on the direct
// Anthropic API — not on Bedrock and not on the OpenAI-compatible test path.
export function aiWebSearchAvailable(): boolean {
  return aiProvider() === "anthropic" && !useBedrock() && !!process.env.ANTHROPIC_API_KEY;
}

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
    // Billing/credit is not a gateway problem — surface it as 402 so the client
    // can show a clear "add credit" message instead of a scary 502.
    if (status === 400 && /credit|billing/i.test(e.message)) {
      return NextResponse.json(
        { error: { code: "ai_billing", message: "Anthropic account has insufficient credit. Top up at console.anthropic.com, or switch Titan OS to AWS Bedrock (set BEDROCK_MODEL + AWS credentials in Render)." } },
        { status: 402 },
      );
    }
    const friendly =
      status === 401 ? "The ANTHROPIC_API_KEY on the server is invalid. Update it in your Render environment."
      : status === 429 ? "AI rate limit hit — wait a minute and try again."
      : `AI request failed: ${e.message}`;
    return NextResponse.json({ error: { code: "ai_failed", message: friendly } }, { status: 502 });
  }
  // AWS Bedrock / credential errors (thrown by the Bedrock SDK or AWS credential
  // chain) are not Anthropic.APIError instances — map the common ones by shape.
  const err = e as { name?: string; message?: string; status?: number };
  const msg = err?.message ?? "";
  if (err?.name?.includes("Credential") || /security token|credential|Unable to locate credentials|Resolved credential|bearer|api key/i.test(msg)) {
    return NextResponse.json(
      { error: { code: "ai_bedrock_auth", message: "AWS Bedrock credentials are missing or invalid. Set AWS_BEARER_TOKEN_BEDROCK (a Bedrock API key) and AWS_REGION in Render — or AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY instead." } },
      { status: 402 },
    );
  }
  if (/AccessDenied|don't have access|not authorized|model access/i.test(msg)) {
    return NextResponse.json(
      { error: { code: "ai_bedrock_access", message: `Bedrock denied the request: ${msg}. Enable access to this Claude model in the AWS Bedrock console and check the IAM permissions.` } },
      { status: 403 },
    );
  }
  if (typeof err?.status === "number" && err.status >= 400) {
    return NextResponse.json({ error: { code: "ai_failed", message: `AI request failed: ${msg || `HTTP ${err.status}`}` } }, { status: 502 });
  }
  return null;
}

export async function runClaude(opts: {
  system: string;
  prompt: string;
  maxTokens?: number;
  webSearch?: boolean;
  maxSearches?: number;
}): Promise<{ text: string; model: string; searched: boolean }> {
  // OpenAI-compatible test provider (e.g. GitHub Models). Web search is not
  // available on this path, so it is silently ignored.
  if (aiProvider() === "openai") {
    const r = await openAIChat(
      [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      opts.maxTokens ?? 4096,
    );
    return { ...r, searched: false };
  }

  const bedrock = useBedrock();
  let client: ClaudeLike;
  let model: string;
  if (bedrock) {
    // AWS credentials come from the standard chain (env vars in Render).
    client = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION ?? process.env.BEDROCK_AWS_REGION ?? "us-east-1",
    }) as unknown as ClaudeLike;
    model = BEDROCK_MODEL!;
  } else {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new AiError(400, "ai_not_configured", "No AI provider configured. Set BEDROCK_MODEL (+ AWS credentials) or ANTHROPIC_API_KEY in the server environment.");
    }
    client = new Anthropic({ apiKey, maxRetries: 2 });
    model = MODEL;
  }

  // Web search runs only on the Anthropic API (not Bedrock).
  const searched = !!opts.webSearch && !bedrock;
  const tools = searched
    ? [{ type: "web_search_20260209" as const, name: "web_search" as const, max_uses: opts.maxSearches ?? 6 }]
    : undefined;

  let messages: Anthropic.MessageParam[] = [{ role: "user", content: opts.prompt }];
  let response = await client.messages.create({
    model,
    max_tokens: opts.maxTokens ?? 4096,
    system: opts.system,
    messages,
    ...(tools ? { tools } : {}),
  });

  // Server-side tools can pause long loops — resume up to 5 times. Only the
  // Anthropic-API path uses tools, so `response.content` exists here.
  for (let i = 0; i < 5 && response?.stop_reason === "pause_turn"; i++) {
    messages = [...messages, { role: "assistant", content: response.content }];
    response = await client.messages.create({
      model,
      max_tokens: opts.maxTokens ?? 4096,
      system: opts.system,
      messages,
      ...(tools ? { tools } : {}),
    });
  }

  const text = extractText(response);
  if (!text) {
    // Bedrock (and gateways) can return a message in a shape we don't expect.
    // Surface the real shape instead of a raw "reading 'map'" crash.
    const raw = (() => { try { return JSON.stringify(response); } catch { return String(response); } })();
    console.error("[runClaude] no text extracted from response:", raw?.slice(0, 2000));
    throw new AiError(502, "ai_bad_response", `The AI response could not be read. Raw start: ${raw?.slice(0, 200)}`);
  }
  return { text, model: response?.model ?? model, searched };
}

// The text/content blocks of a message, tolerant of the Anthropic Message shape
// (`content: [...]`) and the AWS Bedrock Converse shape (`output.message.content`).
function contentBlocks(response: unknown): { type: string; text?: string }[] {
  const r = response as { content?: unknown; output?: { message?: { content?: unknown } } } | null;
  const fromContent = r?.content;
  if (Array.isArray(fromContent)) return fromContent as { type: string; text?: string }[];
  const fromConverse = r?.output?.message?.content;
  if (Array.isArray(fromConverse)) return fromConverse as { type: string; text?: string }[];
  return [];
}

function extractText(response: unknown): string {
  return contentBlocks(response)
    .map((b) => (typeof b?.text === "string" ? b.text : ""))
    .join("")
    .trim();
}
