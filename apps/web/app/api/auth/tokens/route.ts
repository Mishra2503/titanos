import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { badRequest, unauthorized, serverError } from "@/lib/server/errors";
import { createToken } from "@/lib/server/pat";

// Personal Access Tokens for the MCP connector. Each user manages their own
// tokens (a token grants exactly that user's powers). Cookie-authenticated via
// middleware - the plaintext secret is returned once, on create, and never again.

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    const wsId = req.headers.get("x-workspace-id");
    if (!userId || !wsId) return unauthorized();

    const tokens = await db.personalAccessToken.findMany({
      where: { userId, workspaceId: wsId, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json(
      tokens.map((t) => ({
        id: t.id,
        name: t.name,
        scopes: t.scopes,
        last_used_at: t.lastUsedAt,
        expires_at: t.expiresAt,
        created_at: t.createdAt,
      })),
    );
  } catch (e) {
    console.error("[tokens GET]", e);
    return serverError();
  }
}

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    const wsId = req.headers.get("x-workspace-id");
    if (!userId || !wsId) return unauthorized();

    const body = (await req.json().catch(() => ({}))) as {
      name?: string;
      scopes?: string[];
      expires_in_days?: number;
    };
    const name = body.name?.trim();
    if (!name) return badRequest("missing_name", "A token name is required.");

    const scopes = Array.isArray(body.scopes) ? body.scopes.filter((s) => s === "read" || s === "write") : [];
    const days = Number(body.expires_in_days ?? process.env.PAT_DEFAULT_TTL_DAYS ?? 0);
    const expiresAt = days > 0 ? new Date(Date.now() + days * 24 * 60 * 60 * 1000) : null;

    const token = await createToken({ workspaceId: wsId, userId, name, scopes, expiresAt });

    // `token` (plaintext) is returned ONCE here and is never retrievable again.
    return NextResponse.json(
      {
        id: token.id,
        name: token.name,
        scopes: token.scopes,
        expires_at: token.expiresAt,
        created_at: token.createdAt,
        token: token.plaintext,
      },
      { status: 201 },
    );
  } catch (e) {
    console.error("[tokens POST]", e);
    return serverError();
  }
}
