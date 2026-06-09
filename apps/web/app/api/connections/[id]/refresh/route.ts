import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

const GRAPH = "https://graph.instagram.com";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const { id } = await params;
    const account = await db.igAccount.findFirst({ where: { id, workspaceId: wsId } });
    if (!account) return notFound("Connection not found");

    const currentToken = decryptSecret(account.accessTokenEnc);

    const res = await fetch(
      `${GRAPH}/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(currentToken)}`,
    );
    if (!res.ok) {
      const body = await res.text();
      console.error("[refresh token] Instagram API error", res.status, body);
      return NextResponse.json(
        { error: { code: "refresh_failed", message: "Instagram token refresh failed" } },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { access_token: string; expires_in: number };
    const expiresAt = new Date(Date.now() + data.expires_in * 1000);

    await db.igAccount.update({
      where: { id },
      data: {
        accessTokenEnc: encryptSecret(data.access_token),
        tokenExpiresAt: expiresAt,
        status: "CONNECTED",
        lastSyncedAt: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[connections refresh]", e);
    return serverError();
  }
}
