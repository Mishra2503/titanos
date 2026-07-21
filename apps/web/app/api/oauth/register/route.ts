// RFC 7591 — OAuth 2.0 Dynamic Client Registration.
// Connectors (Claude Cowork, ChatGPT, Perplexity, MCP Inspector) call this to
// self-register before the sign-in flow. Public clients (PKCE) are the norm;
// we also support client_secret_post if a client asks for it.
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

function err(status: number, error: string, desc: string) {
  return NextResponse.json({ error, error_description: desc }, { status, headers: CORS });
}

export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return err(400, "invalid_client_metadata", "Body must be JSON.");
  }

  const redirectUris = body.redirect_uris;
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every((u) => typeof u === "string" && /^https?:\/\//.test(u))) {
    return err(400, "invalid_redirect_uri", "redirect_uris must be a non-empty array of absolute http(s) URLs.");
  }

  const created = await createClient({
    redirectUris: redirectUris as string[],
    clientName: typeof body.client_name === "string" ? body.client_name : null,
    tokenEndpointAuthMethod: typeof body.token_endpoint_auth_method === "string" ? body.token_endpoint_auth_method : "none",
    grantTypes: Array.isArray(body.grant_types) ? (body.grant_types as string[]) : undefined,
  });

  return NextResponse.json(
    {
      client_id: created.id,
      ...(created.clientSecret ? { client_secret: created.clientSecret } : {}),
      client_id_issued_at: Math.floor(created.row.createdAt.getTime() / 1000),
      client_name: created.row.clientName ?? undefined,
      redirect_uris: created.row.redirectUris,
      grant_types: created.row.grantTypes,
      response_types: ["code"],
      token_endpoint_auth_method: created.row.tokenEndpointAuthMethod,
    },
    { status: 201, headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
