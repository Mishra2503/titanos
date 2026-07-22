// OAuth 2.1 token endpoint.
//   grant_type=authorization_code - exchange a PKCE-bound code for tokens
//   grant_type=refresh_token       - rotate a refresh token for a fresh access token
// Returns { access_token (JWT), token_type, expires_in, refresh_token, scope }.

import { NextRequest, NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import {
  getClient,
  consumeAuthCode,
  verifyPkceS256,
  issueAccessToken,
  issueRefreshToken,
  rotateRefreshToken,
} from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function err(error: string, desc?: string, status = 400) {
  return NextResponse.json({ error, ...(desc ? { error_description: desc } : {}) }, { status, headers: CORS });
}
function ok(body: Record<string, unknown>) {
  return NextResponse.json(body, {
    headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" },
  });
}

async function readParams(req: NextRequest): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") ?? "";
  if (ct.includes("application/json")) {
    const j = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, String(v ?? "")]));
  }
  const form = await req.formData();
  const out: Record<string, string> = {};
  for (const [k, v] of form.entries()) out[k] = String(v);
  return out;
}

// Confidential clients (token_endpoint_auth_method=client_secret_post) must present
// the secret; public clients (PKCE) must not require one.
function clientSecretValid(client: { tokenEndpointAuthMethod: string; clientSecretHash: string | null }, provided: string | undefined): boolean {
  if (client.tokenEndpointAuthMethod !== "client_secret_post") return true;
  if (!client.clientSecretHash || !provided) return false;
  const a = Buffer.from(client.clientSecretHash, "hex");
  const b = Buffer.from(createHash("sha256").update(provided).digest("hex"), "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const p = await readParams(req);
  const grantType = p.grant_type;
  const clientId = p.client_id;

  const client = await getClient(clientId);
  if (!client) return err("invalid_client", "Unknown client_id.", 401);
  if (!clientSecretValid(client, p.client_secret)) return err("invalid_client", "Bad client credentials.", 401);

  if (grantType === "authorization_code") {
    const { code, redirect_uri, code_verifier } = p;
    if (!code || !redirect_uri || !code_verifier) return err("invalid_request", "Missing code, redirect_uri, or code_verifier.");

    const row = await consumeAuthCode(code);
    if (!row) return err("invalid_grant", "Authorization code is invalid, expired, or already used.");
    if (row.clientId !== clientId) return err("invalid_grant", "Code was issued to a different client.");
    if (row.redirectUri !== redirect_uri) return err("invalid_grant", "redirect_uri mismatch.");
    if (!verifyPkceS256(code_verifier, row.codeChallenge)) return err("invalid_grant", "PKCE verification failed.");

    const [{ token: access, expiresIn }, refresh] = await Promise.all([
      issueAccessToken({ userId: row.userId, workspaceId: row.workspaceId, role: row.role, scope: row.scope, clientId }),
      issueRefreshToken({ clientId, userId: row.userId, workspaceId: row.workspaceId, role: row.role, scope: row.scope }),
    ]);
    return ok({ access_token: access, token_type: "Bearer", expires_in: expiresIn, refresh_token: refresh, scope: row.scope });
  }

  if (grantType === "refresh_token") {
    if (!p.refresh_token) return err("invalid_request", "Missing refresh_token.");
    const rotated = await rotateRefreshToken(p.refresh_token, clientId);
    if (!rotated) return err("invalid_grant", "Refresh token is invalid, expired, or revoked.");
    const { userId, workspaceId, role, scope } = rotated.claims;
    const { token: access, expiresIn } = await issueAccessToken({ userId, workspaceId, role, scope, clientId });
    return ok({ access_token: access, token_type: "Bearer", expires_in: expiresIn, refresh_token: rotated.refreshToken, scope });
  }

  return err("unsupported_grant_type", `Unsupported grant_type: ${grantType}`);
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
