import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const accounts = await db.igAccount.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: "asc" } });
    return NextResponse.json(accounts.map((a) => ({
      id: a.id, ig_user_id: a.igUserId, username: a.username,
      account_type: a.accountType, status: a.status,
      followers_count: a.followersCount,
      token_expires_at: a.tokenExpiresAt,
      last_synced_at: a.lastSyncedAt,
      capacity: null,
    })));
  } catch (e) {
    console.error("[connections GET]", e);
    return serverError();
  }
}
