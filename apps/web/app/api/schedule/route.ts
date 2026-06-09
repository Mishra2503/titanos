import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const posts = await db.scheduledPost.findMany({ where: { workspaceId: wsId }, orderBy: { scheduledAt: "desc" }, include: { igAccount: { select: { username: true } }, campaign: { select: { mediaAssetId: true, mediaAsset: { select: { publicUrl: true } } } } } });

    return NextResponse.json(posts.map((p) => ({
      id: p.id, campaign_id: p.campaignId, ig_account_id: p.igAccountId,
      ig_username: p.igAccount.username, caption: p.caption,
      hashtags: (p.hashtags as string[]) ?? [], scheduled_at: p.scheduledAt,
      status: p.status, permalink: p.permalink, error: p.error, attempts: p.attempts,
      thumbnail_url: p.campaign.mediaAsset?.publicUrl ?? null,
    })));
  } catch (e) {
    console.error("[schedule GET]", e);
    return serverError();
  }
}
