import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, badRequest, conflict, serverError } from "@/lib/server/errors";
import { randomUUID } from "crypto";

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const { media_asset_id, posts, title } = await req.json() as { media_asset_id: string; title?: string; posts: { ig_account_id: string; caption: string; hashtags: string[]; scheduled_at: string }[] };
    if (!media_asset_id || !posts?.length) return badRequest("missing_fields", "media_asset_id and posts are required");

    const media = await db.mediaAsset.findFirst({ where: { id: media_asset_id, workspaceId: wsId } });
    if (!media) return badRequest("invalid_asset", "Media asset not found");

    const accountIds = [...new Set(posts.map((p) => p.ig_account_id))];
    const accounts = await db.igAccount.findMany({ where: { workspaceId: wsId, id: { in: accountIds } } });
    if (accounts.length !== accountIds.length) return badRequest("invalid_account", "One or more selected accounts are not connected");
    const disconnected = accounts.find((a) => a.status !== "CONNECTED");
    if (disconnected) return badRequest("account_needs_reauth", `@${disconnected.username} needs re-auth before scheduling`);

    const now = new Date();
    for (const p of posts) {
      if (new Date(p.scheduled_at) < now) return badRequest("scheduled_in_past", "Scheduled time must be in the future");
    }

    // Safety: min gap check
    const minGap = Number(process.env.SAFETY_MIN_GAP_MINUTES ?? 90) * 60 * 1000;
    const safetyEnabled = process.env.SAFETY_ENABLED !== "false";
    if (safetyEnabled) {
      for (const acctId of accountIds) {
        const acctPosts = posts.filter((p) => p.ig_account_id === acctId).map((p) => new Date(p.scheduled_at).getTime()).sort();
        for (let i = 1; i < acctPosts.length; i++) {
          if (acctPosts[i] - acctPosts[i - 1] < minGap) return conflict("safety_min_gap", `Two posts are too close together (min ${process.env.SAFETY_MIN_GAP_MINUTES ?? 90} min gap)`);
        }
      }
    }

    const campaign = await db.campaign.create({
      data: { workspaceId: wsId, mediaAssetId: media_asset_id, title: title ?? null, status: "APPROVED", createdBy: userId ?? null,
        scheduledPosts: { create: posts.map((p) => ({ workspaceId: wsId, igAccountId: p.ig_account_id, caption: p.caption, hashtags: p.hashtags ?? [], scheduledAt: new Date(p.scheduled_at), status: "SCHEDULED", idempotencyKey: randomUUID() })) },
      },
    });

    return NextResponse.json({ id: campaign.id }, { status: 201 });
  } catch (e) {
    console.error("[campaigns POST]", e);
    return serverError();
  }
}
