// Titan OS MCP endpoint — remote, Streamable-HTTP, Bearer-authenticated.
//
// Speaks MCP over JSON-RPC 2.0 (initialize / tools/list / tools/call / ping).
// Responses are returned as a single application/json body (the spec permits this
// in place of an SSE stream), which every current MCP client — Claude Code/Desktop,
// Claude & ChatGPT remote connectors, and the MCP Inspector — accepts.
//
// Auth: every request must carry `Authorization: Bearer tos_...`. The token is
// verified by lib/server/pat.ts and resolves to a real user+workspace+role, so
// tools run through the same RBAC/safety rails as the web app.

import { NextRequest, NextResponse } from "next/server";
import { verifyToken, canWrite, type TokenIdentity } from "@/lib/server/pat";
import { TOOLS, TOOL_MAP } from "@/lib/server/mcp/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_PROTOCOL = "2025-06-18";
const SERVER_INFO = { name: "titan-os", version: "1.0.0" };

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, Mcp-Session-Id, MCP-Protocol-Version",
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
  return TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
}

async function handleOne(req: RpcRequest, identity: TokenIdentity, origin: string): Promise<object | null> {
  switch (req.method) {
    case "initialize":
      return rpcResult(req.id, {
        protocolVersion:
          (req.params?.protocolVersion as string | undefined) ?? DEFAULT_PROTOCOL,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions:
          "Titan OS: multi-account Instagram content ops. Analytics come only from the Instagram Graph API — never invent metrics. Scheduling honors per-account rate-limit safety.",
      });

    case "notifications/initialized":
    case "notifications/cancelled":
      return null; // notification — no response

    case "ping":
      return rpcResult(req.id, {});

    case "tools/list":
      return rpcResult(req.id, { tools: toolDescriptors() });

    case "tools/call": {
      const name = req.params?.name as string | undefined;
      const args = (req.params?.arguments as Record<string, unknown> | undefined) ?? {};
      const tool = name ? TOOL_MAP[name] : undefined;
      if (!tool) return rpcError(req.id, -32602, `Unknown tool: ${name}`);
      if (tool.write && !canWrite(identity)) {
        return rpcResult(req.id, {
          content: [{ type: "text", text: "This token is read-only (or the user role is VIEWER); write actions are not permitted." }],
          isError: true,
        });
      }
      try {
        const out = await tool.handler(identity, args, origin);
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return rpcResult(req.id, { content: [{ type: "text", text }] });
      } catch (e) {
        const message = e instanceof Error ? e.message : "Tool execution failed";
        return rpcResult(req.id, { content: [{ type: "text", text: message }], isError: true });
      }
    }

    default:
      // Unknown method: error for requests, silence for notifications.
      return req.id === undefined || req.id === null ? null : rpcError(req.id, -32601, `Method not found: ${req.method}`);
  }
}

export async function POST(request: NextRequest) {
  const identity = await verifyToken(request.headers.get("authorization"));
  if (!identity) {
    return new NextResponse(JSON.stringify(rpcError(null, -32001, "Unauthorized: missing or invalid Bearer token")), {
      status: 401,
      headers: { "Content-Type": "application/json", "WWW-Authenticate": "Bearer", ...CORS },
    });
  }

  const origin = new URL(request.url).origin;

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
// stateless request/response, so advertise that GET streaming is unsupported.
export function GET() {
  return new NextResponse(JSON.stringify(rpcError(null, -32000, "SSE streaming not supported; use POST (Streamable HTTP JSON).")), {
    status: 405,
    headers: { "Content-Type": "application/json", Allow: "POST, OPTIONS", ...CORS },
  });
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: { ...CORS } });
}
