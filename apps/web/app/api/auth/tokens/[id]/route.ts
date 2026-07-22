import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

// Revoke a Personal Access Token (soft delete via revoked_at). Takes effect
// immediately - verifyToken() rejects any token with revoked_at set.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const userId = req.headers.get("x-user-id");
    const wsId = req.headers.get("x-workspace-id");
    if (!userId || !wsId) return unauthorized();
    const { id } = await params;

    const existing = await db.personalAccessToken.findFirst({
      where: { id, userId, workspaceId: wsId, revokedAt: null },
    });
    if (!existing) return notFound("Token not found");

    await db.personalAccessToken.update({ where: { id }, data: { revokedAt: new Date() } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[tokens DELETE]", e);
    return serverError();
  }
}
