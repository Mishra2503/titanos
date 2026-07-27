// callRoute - the bridge that lets MCP tools reuse the existing REST route
// handlers (and therefore all their validation, RBAC, and rate-limit-safety
// logic) without duplicating any of it.
//
// This replaces the original internal-fetch.ts, which made a real HTTP request
// to the app's own public URL for every tool call. That cost a full round trip
// out through the proxy and back, and it made the whole tool layer dependent on
// correctly knowing that public URL - which is precisely what broke in
// production (see origin.ts). We now invoke the handler in-process and set the
// x-user-id / x-workspace-id / x-user-role headers that middleware.ts would
// otherwise inject, so the handler runs exactly as it does for a logged-in user.

import { NextRequest } from "next/server";
import { ROUTES, type RouteKey, type RouteModule } from "@/lib/server/mcp/routes";
import { configuredOrigin } from "@/lib/server/mcp/origin";
import type { TokenIdentity } from "@/lib/server/pat";

export interface InternalResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

export interface CallOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  /** Values for the `[param]` segments of the route key. */
  params?: Record<string, string>;
  body?: unknown;
  /** Public origin, used only to build a realistic request URL. */
  origin?: string;
}

/** Substitute `[param]` segments in a route key with concrete values. */
function fillPath(key: string, params: Record<string, string> = {}): string {
  return key.replace(/\[([^\]]+)\]/g, (_, name: string) => {
    const value = params[name];
    if (value === undefined) throw new Error(`Missing route parameter "${name}" for ${key}`);
    return encodeURIComponent(value);
  });
}

/**
 * Invoke an internal route handler as the token's user. Never throws on an HTTP
 * error status - inspect `.ok`. Throws only for programming errors (unknown
 * route, unsupported method, missing param).
 */
export async function callRoute<T = unknown>(
  identity: TokenIdentity,
  key: RouteKey,
  options: CallOptions = {},
): Promise<InternalResponse<T>> {
  const mod = ROUTES[key] as unknown as RouteModule;
  const method = options.method ?? "GET";
  const handler = mod[method] as
    | ((req: NextRequest, ctx: { params: Promise<Record<string, string>> }) => Promise<Response> | Response)
    | undefined;
  if (!handler) throw new Error(`Route ${key} does not support ${method}`);

  const origin = options.origin ?? configuredOrigin();
  const url = `${origin}${fillPath(key, options.params)}`;

  const headers = new Headers({
    // What middleware.ts would have set from a session cookie.
    "x-user-id": identity.userId,
    "x-workspace-id": identity.workspaceId,
    "x-user-role": identity.role,
    // Marks the call as originating from the MCP connector, for log tracing.
    "x-titan-mcp": identity.tokenId,
  });

  let payload: string | undefined;
  if (options.body !== undefined && method !== "GET") {
    headers.set("content-type", "application/json");
    payload = JSON.stringify(options.body);
  }

  const req = new NextRequest(url, { method, headers, body: payload });

  const res = await handler(req, { params: Promise.resolve(options.params ?? {}) });

  let data: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }
  return { ok: res.ok, status: res.status, data: data as T };
}

/** Extract a human-readable message from a Titan OS `{ error: { code, message } }` body. */
export function errorMessage(r: InternalResponse): string {
  const d = r.data as { error?: { code?: string; message?: string } } | null;
  if (d && d.error) return `${d.error.code ?? "error"}: ${d.error.message ?? "request failed"}`;
  if (typeof r.data === "string" && r.data.trim()) return `HTTP ${r.status}: ${r.data.slice(0, 200)}`;
  return `HTTP ${r.status}`;
}

/** callRoute, but throws a friendly Error when the handler returns a failure status. */
export async function call<T = unknown>(
  identity: TokenIdentity,
  key: RouteKey,
  options: CallOptions = {},
): Promise<T> {
  const r = await callRoute<T>(identity, key, options);
  if (!r.ok) throw new Error(errorMessage(r));
  return r.data;
}
