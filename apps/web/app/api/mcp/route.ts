// Titan OS MCP endpoint - remote, Streamable-HTTP, Bearer-authenticated.
//
// Speaks MCP over JSON-RPC 2.0 (initialize / tools/list / tools/call / ping).
//
// Three things here exist because a real client broke without them:
//
//   1. TYPED RESULTS. Every tool declares an `outputSchema`, and every
//      successful call returns `structuredContent` - the actual object - next
//      to the text block. Without it a client hands the model a JSON string to
//      read as prose, and the model fills in the gaps by guessing. That is how
//      fields that do not exist in Titan OS end up in an answer.
//
//   2. TRANSPORT NEGOTIATION. Most clients send
//      `Accept: application/json, text/event-stream` and take either. A few
//      send only `text/event-stream` and choke on a JSON body. We read Accept
//      and answer in the dialect that was asked for.
//
//   3. TOOL PROFILES. Some editor clients refuse a server past ~40 tools. Add
//      `?tools=core` to the endpoint URL for the trimmed set that fits.
//
// Auth: every request must carry `Authorization: Bearer …`, either a Personal
// Access Token (tos_…) or an OAuth access-token JWT. Both resolve to a real
// user+workspace+role, so tools run through the same RBAC/safety rails as the
// web app.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, canWrite, type TokenIdentity } from "@/lib/server/pat";
import { verifyAccessToken } from "@/lib/server/oauth";
import { publicOrigin } from "@/lib/server/mcp/origin";
import { TOOL_MAP, toolsForProfile, type McpTool } from "@/lib/server/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROTOCOL = "2025-06-18";
// Versions we can actually speak. Echoing back whatever the client asked for -
// which this route used to do - promises a dialect we may not implement.
const SUPPORTED_PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

const SERVER_INFO = { name: "titan-os", title: "Titan OS", version: "3.0.0" };

/**
 * Ceiling on a single tool call. Clients give up somewhere between 30 and 60
 * seconds and report the timeout as a broken connector, with no clue which tool
 * stalled. Failing first, with the tool's name in the message, turns a dead
 * connection into a recoverable error the model can act on. Anything genuinely
 * slow goes through startJob() and returns in milliseconds anyway.
 */
const TOOL_TIMEOUT_MS = Number(process.env.MCP_TOOL_TIMEOUT_MS ?? 25_000);

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID, X-Titan-Tools",
  "Access-Control-Expose-Headers": "Mcp-Session-Id, MCP-Protocol-Version, WWW-Authenticate",
  "Access-Control-Max-Age": "86400",
};

interface RpcRequest {
  jsonrpc: "2.0";
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: RpcRequest["id"], result: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, result };
}
function rpcError(id: RpcRequest["id"], code: number, message: string, data?: unknown) {
  return { jsonrpc: "2.0" as const, id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

function toolDescriptors(tools: McpTool[]) {
  return tools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: t.inputSchema,
    outputSchema: t.outputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
}

function negotiateProtocol(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
}

/** Which slice of the toolset this request asked for (`?tools=core`, or the header). */
function requestedProfile(request: NextRequest): string | null {
  return request.nextUrl.searchParams.get("tools") ?? request.headers.get("x-titan-tools");
}

/**
 * structuredContent must be a JSON object - the spec forbids a bare array, a
 * string, or null at the root. Handlers are written to return objects, but a
 * REST route can always answer 204 or hand back a list, and a client that gets
 * the wrong root type rejects the whole call. Normalise instead of trusting.
 */
function asStructured(value: unknown): Record<string, unknown> {
  if (Array.isArray(value)) return { count: value.length, items: value };
  if (value && typeof value === "object") return value as Record<string, unknown>;
  if (value === null || value === undefined) return { ok: true };
  return { result: value };
}

/** Run a tool, but never let it hold the connection past the client's patience. */
async function runTool(
  tool: McpTool,
  identity: TokenIdentity,
  args: Record<string, unknown>,
  origin: string,
): Promise<unknown> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      tool.handler(identity, args, origin),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `${tool.name} did not finish within ${Math.round(TOOL_TIMEOUT_MS / 1000)}s. ` +
                  `Narrow the request (a smaller limit, one competitor at a time) and try again.`,
              ),
            ),
          TOOL_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function handleOne(
  req: RpcRequest,
  identity: TokenIdentity,
  origin: string,
  profile: string | null,
): Promise<object | null> {
  // A JSON-RPC notification has no id and never gets a response.
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion: negotiateProtocol(req.params?.protocolVersion),
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Titan OS: multi-account Instagram content ops and competitor intelligence. " +
          "Every number comes from the Instagram Graph API or a stored scrape. If a metric is null it was not " +
          "captured - say so, never estimate it, and never fill it in from general knowledge. " +
          "Tool results arrive as structured JSON; answer only from the fields you were given. " +
          "To find what is working for a competitor: list_competitors, then list_competitor_reels " +
          "(sort by outlier), then get_reel for the transcript and why it works. " +
          "Tools that call Claude return a job_id - poll get_job_status every ~15s until it is done. " +
          "Scheduling honors per-account rate-limit safety; check get_safety_health before bulk scheduling.",
      });

    case "ping":
      return rpcResult(req.id, {});

    case "tools/list":
      return rpcResult(req.id, { tools: toolDescriptors(toolsForProfile(profile)) });

    // This server exposes tools only. Clients probe these regardless of the
    // advertised capabilities, and some treat a -32601 here as a fatal handshake
    // failure and drop the connection - so answer with an empty list instead.
    case "resources/list":
      return rpcResult(req.id, { resources: [] });
    case "resources/templates/list":
      return rpcResult(req.id, { resourceTemplates: [] });
    case "prompts/list":
      return rpcResult(req.id, { prompts: [] });
    case "completion/complete":
      return rpcResult(req.id, { completion: { values: [], total: 0, hasMore: false } });
    case "logging/setLevel":
      return rpcResult(req.id, {});

    case "tools/call": {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const tool = name ? TOOL_MAP[name] : undefined;

      if (!tool) {
        // A wrong tool name is the model's mistake, not a protocol fault. Return
        // it as a tool error with the closest matches, so the model can correct
        // itself; a -32602 makes most clients abandon the turn instead.
        const near = Object.keys(TOOL_MAP)
          .filter((n) => name && (n.includes(name) || name.includes(n)))
          .slice(0, 5);
        return toolError(
          req.id,
          `No tool named "${name}".` + (near.length ? ` Did you mean: ${near.join(", ")}?` : " Call tools/list."),
        );
      }

      if (tool.write && !canWrite(identity)) {
        return toolError(
          req.id,
          "This token is read-only (or the user role is VIEWER); write actions are not permitted.",
        );
      }

      try {
        const out = await runTool(tool, identity, args, origin);
        const structured = asStructured(out);
        return rpcResult(req.id, {
          // Text first for older clients that only read content[]; the same data
          // typed for anything that understands outputSchema.
          content: [{ type: "text", text: JSON.stringify(structured, null, 2) }],
          structuredContent: structured,
        });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Tool execution failed";
        console.error(`[mcp] tool ${name} failed:`, e);
        return toolError(req.id, message);
      }
    }

    default:
      // Notifications (notifications/initialized, notifications/cancelled, …) and
      // anything else id-less get silence; unknown requests get a proper error.
      return isNotification ? null : rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

/**
 * A failure inside a tool is a successful RPC carrying isError, not an RPC
 * error. The distinction matters: the first is something the model can read and
 * recover from, the second is a protocol fault most clients treat as fatal.
 */
function toolError(id: RpcRequest["id"], message: string) {
  return rpcResult(id, { content: [{ type: "text", text: message }], isError: true });
}

// ── Transport ────────────────────────────────────────────────────────────────

/** True when the client asked for an event stream and will not take plain JSON. */
function prefersEventStream(request: NextRequest): boolean {
  const accept = (request.headers.get("accept") ?? "").toLowerCase();
  if (!accept.includes("text/event-stream")) return false;
  return !accept.includes("application/json") && !accept.includes("*/*");
}

/** One JSON-RPC payload, framed as a single SSE message, then end of stream. */
function sseResponse(payload: unknown, extra: Record<string, string>): NextResponse {
  const body = `event: message\ndata: ${JSON.stringify(payload)}\n\n`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Render and most proxies buffer by default, which holds the frame back
      // until the connection closes and reads to the client as a hang.
      "X-Accel-Buffering": "no",
      ...extra,
      ...CORS,
    },
  });
}

function jsonResponse(payload: unknown, status: number, extra: Record<string, string> = {}): NextResponse {
  return new NextResponse(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json", ...extra, ...CORS },
  });
}

export async function POST(request: NextRequest) {
  const origin = publicOrigin(request);
  const profile = requestedProfile(request);
  const authz = request.headers.get("authorization");
  // Accept either a Personal Access Token (tos_…) or an OAuth access-token JWT.
  const identity = (await verifyToken(authz)) ?? (await verifyAccessToken(authz));

  if (!identity) {
    // Point OAuth-capable clients (Cowork/ChatGPT/Perplexity) at our discovery doc.
    // This MUST be the public origin: `new URL(request.url).origin` resolves to
    // the internal bind address behind Render's proxy and sent every connector
    // chasing discovery to localhost.
    const resourceMeta = `${origin}/.well-known/oauth-protected-resource`;
    return jsonResponse(
      rpcError(null, -32001, "Unauthorized: missing or invalid Bearer token"),
      401,
      { "WWW-Authenticate": `Bearer resource_metadata="${resourceMeta}"` },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(rpcError(null, -32700, "Parse error"), 400);
  }

  const batch = Array.isArray(body) ? (body as RpcRequest[]) : [body as RpcRequest];
  const responses: object[] = [];
  for (const req of batch) {
    if (!req || typeof req !== "object" || typeof req.method !== "string") {
      responses.push(rpcError(null, -32600, "Invalid Request"));
      continue;
    }
    const r = await handleOne(req, identity, origin, profile);
    if (r) responses.push(r);
  }

  // Echo the negotiated version so the client can confirm we agreed, and keep
  // it consistent across the session.
  const negotiated = negotiateProtocol(
    request.headers.get("mcp-protocol-version") ??
      (batch[0]?.method === "initialize" ? batch[0]?.params?.protocolVersion : undefined),
  );
  const versionHeader = { "MCP-Protocol-Version": negotiated };

  // All-notification batch → 202 Accepted, no body (per JSON-RPC / MCP).
  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers: { ...versionHeader, ...CORS } });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return prefersEventStream(request)
    ? sseResponse(payload, versionHeader)
    : jsonResponse(payload, 200, versionHeader);
}

// Some clients open a GET SSE stream for server→client messages. This server is
// stateless request/response; the spec says to answer 405 when no stream is
// offered, and a client that sees it falls back to plain POST.
export function GET() {
  return jsonResponse(
    rpcError(null, -32000, "SSE streaming not supported; use POST (Streamable HTTP JSON)."),
    405,
    { Allow: "POST, DELETE, OPTIONS" },
  );
}

// Session teardown. We hold no session state, so acknowledge and move on -
// returning an error here makes some clients report a failed disconnect.
export function DELETE() {
  return new NextResponse(null, { status: 204, headers: { ...CORS } });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS } });
}
