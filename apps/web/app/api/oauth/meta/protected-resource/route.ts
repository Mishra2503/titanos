// RFC 9728 - OAuth 2.0 Protected Resource Metadata.
// Served at /.well-known/oauth-protected-resource via a rewrite (next.config.mjs).
// Tells MCP clients which authorization server guards the /api/mcp resource.
import { NextResponse } from "next/server";
import { issuer, resource, SUPPORTED_SCOPES } from "@/lib/server/oauth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "*" };

export function GET() {
  return NextResponse.json(
    {
      resource: resource(),
      authorization_servers: [issuer()],
      scopes_supported: [...SUPPORTED_SCOPES],
      bearer_methods_supported: ["header"],
    },
    { headers: CORS },
  );
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}
