// internalFetch - the bridge that lets MCP tools reuse the existing REST routes
// (and therefore all their validation, RBAC, and rate-limit-safety logic) without
// duplicating any of it.
//
// For a verified PAT identity we mint a short-lived access JWT and attach it as the
// `titan.access` cookie on a server-to-server request to our own route. The existing
// middleware converts that cookie into x-user-id / x-workspace-id / x-user-role
// headers, so the untouched handler runs exactly as it would for a logged-in user.

import { createAccessToken } from "@/lib/server/jwt";
import type { TokenIdentity } from "@/lib/server/pat";

const ACCESS_COOKIE = "titan.access";

function baseUrl(override?: string): string {
  const url = override ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  return url.replace(/\/$/, "");
}

export interface InternalResponse<T = unknown> {
  ok: boolean;
  status: number;
  data: T;
}

/**
 * Call an internal API route as the PAT's user. `path` must start with `/api/`.
 * Returns parsed JSON and status; never throws on HTTP errors (inspect `.ok`).
 */
export async function internalFetch<T = unknown>(
  identity: TokenIdentity,
  path: string,
  init: { method?: string; body?: unknown; origin?: string } = {},
): Promise<InternalResponse<T>> {
  // 5-minute token - long enough for one tool call, short enough to be disposable.
  const access = await createAccessToken({
    sub: identity.userId,
    ws: identity.workspaceId,
    role: identity.role,
  });

  const method = init.method ?? "GET";
  const headers: Record<string, string> = {
    Cookie: `${ACCESS_COOKIE}=${access}`,
  };
  let body: string | undefined;
  if (init.body !== undefined && method !== "GET" && method !== "HEAD") {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(init.body);
  }

  const res = await fetch(`${baseUrl(init.origin)}${path}`, { method, headers, body, cache: "no-store" });
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
  return `HTTP ${r.status}`;
}
