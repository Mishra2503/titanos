// RFC 8414 — OAuth 2.0 Authorization Server Metadata.
// Served at /.well-known/oauth-authorization-server via a rewrite (next.config.mjs).
import { NextResponse } from "next/server";
import { issuer, SUPPORTED_SCOPES } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

export function GET() {
  const iss = issuer();
  return NextResponse.json(
    {
      issuer: iss,
      authorization_endpoint: `${iss}/api/oauth/authorize`,
      token_endpoint: `${iss}/api/oauth/token`,
      registration_endpoint: `${iss}/api/oauth/register`,
      scopes_supported: [...SUPPORTED_SCOPES],
      response_types_supported: ["code"],
      grant_types_supported: ["authorization_code", "refresh_token"],
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none", "client_secret_post"],
    },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
