// Titan OS MCP endpoint - remote, Streamable-HTTP, Bearer-authenticated.
//
// Speaks MCP over JSON-RPC 2.0 (initialize / tools/list / tools/call / ping).
// Responses are returned as a single application/json body (the spec permits this
// in place of an SSE stream), which every current MCP client - Claude Code/Desktop,
// Claude & ChatGPT & Perplexity remote connectors, and the MCP Inspector - accepts.
//
// Auth: every request must carry `Authorization: Bearer …`, either a Personal
// Access Token (tos_…) or an OAuth access-token JWT. Both resolve to a real
// user+workspace+role, so tools run through the same RBAC/safety rails as the
// web app.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, canWrite, type TokenIdentity } from "@/lib/server/pat";
import { verifyAccessToken } from "@/lib/server/oauth";
import { publicOrigin } from "@/lib/server/mcp/origin";
import { TOOLS, TOOL_MAP } from "@/lib/server/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROTOCOL = "2025-06-18";
// Versions we can actually speak. Echoing back whatever the client asked for -
// which this route used to do - promises a dialect we may not implement.
const SUPPORTED_PROTOCOLS = new Set(["2025-06-18", "2025-03-26", "2024-11-05"]);

const SERVER_INFO = { name: "titan-os", version: "2.0.0" };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version, Last-Event-ID",
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

function toolDescriptors() {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
    ...(t.annotations ? { annotations: t.annotations } : {}),
  }));
}

function negotiateProtocol(requested: unknown): string {
  return typeof requested === "string" && SUPPORTED_PROTOCOLS.has(requested) ? requested : DEFAULT_PROTOCOL;
}

async function handleOne(req: RpcRequest, identity: TokenIdentity, origin: string): Promise<object | null> {
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
          "Analytics come only from the Instagram Graph API and stored scrapes - never invent metrics. " +
          "To find what is working for a competitor: list_competitors, then list_competitor_reels " +
          "(sort by outlier), then get_reel for the transcript and why it works. " +
          "Tools that call Claude return a job_id - poll get_job_status until it is done. " +
          "Scheduling honors per-account rate-limit safety.",
      });

    case "ping":
      return rpcResult(req.id, {});

    case "tools/list":
      return rpcResult(req.id, { tools: toolDescriptors() });

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
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      if (tool.write && !canWrite(identity)) {
        return rpcResult(req.id, {
          content: [
            {
              type: "text",
              text: "This token is read-only (or the user role is VIEWER); write actions are not permitted.",
            },
          ],
          isError: true,
        });
      }
      try {
        const out = await tool.handler(identity, args, origin);
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return rpcResult(req.id, { content: [{ type: "text", text }] });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Tool execution failed";
        console.error(`[mcp] tool ${name} failed:`, e);
        return rpcResult(req.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }

    default:
      // Notifications (notifications/initialized, notifications/cancelled, …) and
      // anything else id-less get silence; unknown requests get a proper error.
      return isNotification ? null : rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export async function POST(request: NextRequest) {
  const origin = publicOrigin(request);
  const authz = request.headers.get("authorization");
  // Accept either a Personal Access Token (tos_…) or an OAuth access-token JWT.
  const identity = (await verifyToken(authz)) ?? (await verifyAccessToken(authz));
  if (!identity) {
    // Point OAuth-capable clients (Cowork/ChatGPT/Perplexity) at our discovery doc.
    // This MUST be the public origin: `new URL(request.url).origin` resolves to
    // the internal bind address behind Render's proxy and sent every connector
    // chasing discovery to localhost.
    const resourceMeta = `${origin}/.well-known/oauth-protected-resource`;
    return new NextResponse(
      JSON.stringify(rpcError(null, -32001, "Unauthorized: missing or invalid Bearer token")),
      {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": `Bearer resource_metadata="${resourceMeta}"`,
          ...CORS,
        },
      },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return new NextResponse(JSON.stringify(rpcError(null, -32700, "Parse error")), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }

  const batch = Array.isArray(body) ? (body as RpcRequest[]) : [body as RpcRequest];
  const responses: object[] = [];
  for (const req of batch) {
    if (!req || typeof req !== "object" || typeof req.method !== "string") {
      responses.push(rpcError(null, -32600, "Invalid Request"));
      continue;
    }
    const r = await handleOne(req, identity, origin);
    if (r) responses.push(r);
  }

  // All-notification batch → 202 Accepted, no body (per JSON-RPC / MCP).
  if (responses.length === 0) {
    return new NextResponse(null, { status: 202, headers: { ...CORS } });
  }

  const payload = Array.isArray(body) ? responses : responses[0];
  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

// Some clients open a GET SSE stream for server→client messages. This server is
// stateless request/response; the spec says to answer 405 when no stream is offered.
export function GET() {
  return new NextResponse(
    JSON.stringify(rpcError(null, -32000, "SSE streaming not supported; use POST (Streamable HTTP JSON).")),
    {
      status: 405,
      headers: { "Content-Type": "application/json", Allow: "POST, DELETE, OPTIONS", ...CORS },
    },
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
