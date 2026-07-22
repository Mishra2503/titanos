// OAuth 2.1 authorization endpoint.
//   GET  - validate the request, require a Titan OS session (bounce to /login if
//          not), then render a consent screen.
//   POST - on approve, mint a single-use, PKCE-bound auth code and redirect back
//          to the client's redirect_uri with ?code=…&state=…
//
// Identity comes from the existing Titan OS session cookie, so "sign in" reuses
// the normal login. The consent form is bound to the session user via a signed
// ticket (see signConsentTicket) to prevent tampering / cross-site forgery.

import { NextRequest, NextResponse } from "next/server";
import { getSessionFromRequest } from "@/lib/server/jwt";
import {
  getClient,
  redirectUriAllowed,
  issueAuthCode,
  signConsentTicket,
  verifyConsentTicket,
  DEFAULT_SCOPE,
  SUPPORTED_SCOPES,
} from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function htmlError(message: string, status = 400) {
  return new NextResponse(
    `<!doctype html><meta charset="utf-8"><title>Authorization error</title>` +
      `<div style="font-family:system-ui;max-width:32rem;margin:12vh auto;padding:0 1.5rem;color:#e5e7eb;background:#0b0b0f">` +
      `<h1 style="font-size:1.1rem">Couldn't authorize this app</h1><p style="color:#9ca3af">${esc(message)}</p></div>`,
    { status, headers: { "Content-Type": "text/html; charset=utf-8" } },
  );
}

function normalizeScope(raw: string | null): string | null {
  const req = (raw ?? DEFAULT_SCOPE).trim() || DEFAULT_SCOPE;
  const parts = req.split(/\s+/);
  if (!parts.every((p) => (SUPPORTED_SCOPES as readonly string[]).includes(p))) return null;
  return parts.join(" ");
}

function redirectWithError(redirectUri: string, error: string, state: string | null) {
  const u = new URL(redirectUri);
  u.searchParams.set("error", error);
  if (state) u.searchParams.set("state", state);
  return NextResponse.redirect(u.toString(), { status: 302 });
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const responseType = p.get("response_type");
  const clientId = p.get("client_id") ?? "";
  const redirectUri = p.get("redirect_uri") ?? "";
  const codeChallenge = p.get("code_challenge") ?? "";
  const codeChallengeMethod = p.get("code_challenge_method") ?? "";
  const state = p.get("state");
  const scope = normalizeScope(p.get("scope"));

  // Client + redirect_uri must be valid BEFORE we ever redirect back (open-redirect safety).
  const client = await getClient(clientId);
  if (!client) return htmlError("Unknown client_id. Try removing and re-adding the connector.");
  if (!redirectUriAllowed(client, redirectUri)) return htmlError("redirect_uri does not match this client's registration.");

  // From here, parameter errors can be reported back to the client.
  if (responseType !== "code") return redirectWithError(redirectUri, "unsupported_response_type", state);
  if (!codeChallenge || codeChallengeMethod !== "S256") return redirectWithError(redirectUri, "invalid_request", state);
  if (scope === null) return redirectWithError(redirectUri, "invalid_scope", state);

  // Require a logged-in Titan OS user; if absent, bounce through login and back.
  const session = await getSessionFromRequest(req);
  if (!session) {
    const login = new URL("/login", req.nextUrl.origin);
    login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(login.toString(), { status: 302 });
  }

  const ticket = await signConsentTicket({
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: codeChallenge,
    scope,
    state: state ?? undefined,
    sub: session.sub,
  });

  const appName = client.clientName ? esc(client.clientName) : "An application";
  const readOnly = scope === "mcp:read";
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ${appName}</title></head>
<body style="margin:0;background:#0b0b0f;color:#e5e7eb;font-family:system-ui,-apple-system,sans-serif">
<div style="max-width:26rem;margin:10vh auto;padding:2rem;border:1px solid #26262e;border-radius:16px;background:#131318">
  <h1 style="font-size:1.15rem;margin:0 0 .25rem">Connect to Titan OS</h1>
  <p style="color:#9ca3af;font-size:.9rem;margin:0 0 1.25rem"><b style="color:#e5e7eb">${appName}</b> wants to access your Titan OS workspace.</p>
  <ul style="color:#c9c9d1;font-size:.85rem;line-height:1.5;padding-left:1.1rem;margin:0 0 1.25rem">
    <li>Read your scheduled posts, board, competitors and insights</li>
    <li>${readOnly ? "Read-only - cannot make changes" : "Create/edit content and run AI actions (limited by your role)"}</li>
  </ul>
  <form method="POST" action="/api/oauth/authorize" style="display:flex;gap:.6rem">
    <input type="hidden" name="ticket" value="${esc(ticket)}"/>
    <button name="decision" value="deny" style="flex:1;padding:.7rem;border-radius:10px;border:1px solid #3a3a44;background:transparent;color:#c9c9d1;font-size:.9rem;cursor:pointer">Deny</button>
    <button name="decision" value="approve" style="flex:1;padding:.7rem;border-radius:10px;border:0;background:#c6f24e;color:#0b0b0f;font-weight:600;font-size:.9rem;cursor:pointer">Approve</button>
  </form>
</div></body></html>`;
  return new NextResponse(page, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function POST(req: NextRequest) {
  const session = await getSessionFromRequest(req);
  if (!session) return htmlError("Your session expired. Please start the connection again.", 401);

  const form = await req.formData();
  const decision = String(form.get("decision") ?? "");
  const ticketStr = String(form.get("ticket") ?? "");

  const ticket = await verifyConsentTicket(ticketStr);
  if (!ticket) return htmlError("This authorization form expired. Please start again.");
  // The consent must belong to the currently logged-in user.
  if (ticket.sub !== session.sub) return htmlError("Session mismatch. Please start the connection again.", 401);

  const client = await getClient(ticket.client_id);
  if (!client || !redirectUriAllowed(client, ticket.redirect_uri)) return htmlError("Client validation failed.");

  if (decision !== "approve") return redirectWithError(ticket.redirect_uri, "access_denied", ticket.state ?? null);

  const code = await issueAuthCode({
    clientId: ticket.client_id,
    userId: session.sub,
    workspaceId: session.ws,
    role: session.role,
    redirectUri: ticket.redirect_uri,
    codeChallenge: ticket.code_challenge,
    scope: ticket.scope,
  });

  const u = new URL(ticket.redirect_uri);
  u.searchParams.set("code", code);
  if (ticket.state) u.searchParams.set("state", ticket.state);
  return NextResponse.redirect(u.toString(), { status: 302 });
}
