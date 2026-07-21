// OAuth 2.1 authorization server for the MCP endpoint.
//
// Lets external LLM connectors (Claude Cowork, ChatGPT, Perplexity, …) "Sign in"
// instead of pasting a token. The sign-in IS the existing Titan OS login; this
// module only issues/validates OAuth artifacts:
//   - access tokens  → stateless JWTs (HS256, same JWT_SECRET as the app), NOT stored
//   - auth codes      → random, single-use, ~60s, only sha256 stored (PKCE-bound)
//   - refresh tokens  → random, rotated, only sha256 stored
//   - clients         → registered dynamically (RFC 7591), public clients + PKCE
//
// Access tokens resolve to the same TokenIdentity shape as PATs, so /api/mcp and
// its RBAC (`canWrite`) treat OAuth and PAT auth identically.

import { SignJWT, jwtVerify } from "jose";
import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/server/db";
import type { TokenIdentity } from "@/lib/server/pat";

const ALG = "HS256";
const TOKEN_TYP = "mcp_at"; // marks a JWT as an MCP access token (vs the app's session JWTs)

export const SUPPORTED_SCOPES = ["mcp", "mcp:read"] as const;
export const DEFAULT_SCOPE = "mcp";

function getSecret() {
  return new TextEncoder().encode(process.env.JWT_SECRET ?? "change_me_jwt_secret_32_chars_min");
}
function sha256hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}
function accessTtlSec(): number {
  return Number(process.env.OAUTH_ACCESS_TTL_MIN ?? 60) * 60;
}
function refreshTtlMs(): number {
  return Number(process.env.OAUTH_REFRESH_TTL_DAYS ?? 30) * 24 * 60 * 60 * 1000;
}

export function issuer(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
}
/** The protected resource these tokens are scoped to (the MCP endpoint). */
export function resource(): string {
  return `${issuer()}/api/mcp`;
}

// ── Access tokens (stateless JWT) ─────────────────────────────────────────────

export async function issueAccessToken(claims: {
  userId: string;
  workspaceId: string;
  role: string;
  scope: string;
  clientId: string;
}): Promise<{ token: string; expiresIn: number }> {
  const expiresIn = accessTtlSec();
  const token = await new SignJWT({
    sub: claims.userId,
    ws: claims.workspaceId,
    role: claims.role,
    scope: claims.scope,
    typ: TOKEN_TYP,
    client_id: claims.clientId,
  })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setIssuer(issuer())
    .setAudience(resource())
    .setExpirationTime(`${expiresIn}s`)
    .sign(getSecret());
  return { token, expiresIn };
}

/** Map an OAuth scope to the PAT-style scopes array `canWrite()` understands. */
function scopeToScopes(scope: string): string[] {
  return /(^|\s)mcp:read(\s|$)/.test(scope) && !/(^|\s)mcp(\s|$)/.test(scope) ? ["read"] : [];
}

/** Verify an OAuth access-token Bearer string → TokenIdentity, or null. */
export async function verifyAccessToken(bearer: string | null | undefined): Promise<TokenIdentity | null> {
  if (!bearer) return null;
  const raw = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : bearer.trim();
  // PATs (tos_…) are handled by pat.ts; skip them here. (JWTs are base64url and
  // may legitimately contain "_", so we must NOT filter on that.)
  if (!raw || raw.startsWith("tos_")) return null;
  try {
    const { payload } = await jwtVerify(raw, getSecret(), {
      issuer: issuer(),
      audience: resource(),
    });
    if (payload.typ !== TOKEN_TYP) return null;
    const scope = typeof payload.scope === "string" ? payload.scope : DEFAULT_SCOPE;
    return {
      tokenId: `oauth:${payload.client_id ?? "unknown"}`,
      userId: String(payload.sub),
      workspaceId: String(payload.ws),
      role: String(payload.role),
      scopes: scopeToScopes(scope),
    };
  } catch {
    return null;
  }
}

// ── Consent ticket (tamper-proof binding of the consent form) ─────────────────
// The authorize GET signs the validated request into this ticket and embeds it as
// a hidden field. The POST verifies it and checks it belongs to the current
// session user — so hidden fields can't be tampered with and a cross-site forged
// POST can't succeed (it can't mint a valid ticket, and it's bound to `sub`).

export interface ConsentTicket {
  client_id: string;
  redirect_uri: string;
  code_challenge: string;
  scope: string;
  state?: string;
  sub: string; // the user who was shown the consent screen
}

export async function signConsentTicket(t: ConsentTicket): Promise<string> {
  return new SignJWT({ ...t, typ: "oauth_consent" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(getSecret());
}

export async function verifyConsentTicket(jwt: string): Promise<ConsentTicket | null> {
  try {
    const { payload } = await jwtVerify(jwt, getSecret());
    if (payload.typ !== "oauth_consent") return null;
    return {
      client_id: String(payload.client_id),
      redirect_uri: String(payload.redirect_uri),
      code_challenge: String(payload.code_challenge),
      scope: String(payload.scope),
      state: payload.state ? String(payload.state) : undefined,
      sub: String(payload.sub),
    };
  } catch {
    return null;
  }
}

// ── Clients (dynamic registration) ────────────────────────────────────────────

export async function createClient(input: {
  redirectUris: string[];
  clientName?: string | null;
  tokenEndpointAuthMethod?: string;
  grantTypes?: string[];
}): Promise<{ id: string; clientSecret: string | null; row: { clientName: string | null; redirectUris: string[]; tokenEndpointAuthMethod: string; grantTypes: string[]; createdAt: Date } }> {
  const method = input.tokenEndpointAuthMethod === "client_secret_post" ? "client_secret_post" : "none";
  let clientSecret: string | null = null;
  let clientSecretHash: string | null = null;
  if (method === "client_secret_post") {
    clientSecret = randomBytes(32).toString("base64url");
    clientSecretHash = sha256hex(clientSecret);
  }
  const row = await db.oAuthClient.create({
    data: {
      clientName: input.clientName ?? null,
      redirectUris: input.redirectUris,
      tokenEndpointAuthMethod: method,
      clientSecretHash,
      grantTypes: input.grantTypes ?? ["authorization_code", "refresh_token"],
    },
  });
  return { id: row.id, clientSecret, row };
}

export async function getClient(clientId: string) {
  if (!clientId) return null;
  return db.oAuthClient.findUnique({ where: { id: clientId } });
}

/** Exact-match redirect_uri against the client's registered set. */
export function redirectUriAllowed(client: { redirectUris: string[] }, uri: string): boolean {
  return !!uri && client.redirectUris.includes(uri);
}

// ── Authorization codes (single-use, PKCE-bound) ──────────────────────────────

export async function issueAuthCode(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
  role: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
}): Promise<string> {
  const code = randomBytes(32).toString("base64url");
  await db.oAuthAuthCode.create({
    data: {
      codeHash: sha256hex(code),
      clientId: input.clientId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      role: input.role,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      scope: input.scope,
      expiresAt: new Date(Date.now() + 60_000), // 60s
    },
  });
  return code;
}

/** Consume an auth code once. Returns its bound data or null if invalid/expired/used. */
export async function consumeAuthCode(code: string) {
  const row = await db.oAuthAuthCode.findUnique({ where: { codeHash: sha256hex(code) } });
  if (!row || row.usedAt || row.expiresAt.getTime() < Date.now()) return null;
  // Mark used; if another request already used it, updateMany count is 0 → reject (replay-safe).
  const marked = await db.oAuthAuthCode.updateMany({
    where: { id: row.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (marked.count !== 1) return null;
  return row;
}

/** PKCE S256: base64url(sha256(verifier)) must equal the stored challenge. */
export function verifyPkceS256(codeVerifier: string, codeChallenge: string): boolean {
  if (!codeVerifier || !codeChallenge) return false;
  const computed = createHash("sha256").update(codeVerifier).digest("base64url");
  const a = Buffer.from(computed);
  const b = Buffer.from(codeChallenge);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Refresh tokens (rotated, hashed) ──────────────────────────────────────────

export async function issueRefreshToken(input: {
  clientId: string;
  userId: string;
  workspaceId: string;
  role: string;
  scope: string;
}): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.oAuthRefreshToken.create({
    data: {
      tokenHash: sha256hex(token),
      clientId: input.clientId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      role: input.role,
      scope: input.scope,
      expiresAt: new Date(Date.now() + refreshTtlMs()),
    },
  });
  return token;
}

/** Validate a refresh token and rotate it (revoke old, issue new). Returns new token + claims. */
export async function rotateRefreshToken(token: string, clientId: string) {
  const row = await db.oAuthRefreshToken.findUnique({ where: { tokenHash: sha256hex(token) } });
  if (!row || row.revokedAt || row.expiresAt.getTime() < Date.now() || row.clientId !== clientId) return null;
  const revoked = await db.oAuthRefreshToken.updateMany({
    where: { id: row.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (revoked.count !== 1) return null; // already rotated → reject reuse
  const next = await issueRefreshToken({
    clientId: row.clientId,
    userId: row.userId,
    workspaceId: row.workspaceId,
    role: row.role,
    scope: row.scope,
  });
  return { refreshToken: next, claims: { userId: row.userId, workspaceId: row.workspaceId, role: row.role, scope: row.scope } };
}
