import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, badRequest, conflict, serverError } from "@/lib/server/errors";
import { createHash, randomUUID } from "crypto";
import { assessInstagramReelBasics } from "@/lib/instagram-reel-quality";

function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

async function idempotencyResult(workspaceId: string, prefix: string, expectedKeys: string[]) {
  const existing = await db.scheduledPost.findMany({
    where: { workspaceId, idempotencyKey: { startsWith: prefix } },
    select: { campaignId: true, idempotencyKey: true },
  });
  if (existing.length === 0) return null;

  const expected = new Set(expectedKeys);
  const campaigns = new Set(existing.map((post) => post.campaignId));
  const isExactReplay = existing.length === expectedKeys.length
    && campaigns.size === 1
    && existing.every((post) => expected.has(post.idempotencyKey));
  if (isExactReplay) {
    return NextResponse.json({ id: existing[0].campaignId, idempotent_replay: true });
  }
  return conflict("idempotency_conflict", "This idempotency_key was already used for a different request");
}

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const { media_asset_id, posts, title, idempotency_key } = await req.json() as {
      media_asset_id: string;
      title?: string;
      idempotency_key?: string;
      posts: { ig_account_id: string; caption: string; hashtags?: string[]; scheduled_at: string }[];
    };
    if (!media_asset_id || !posts?.length) return badRequest("missing_fields", "media_asset_id and posts are required");
    if (!Array.isArray(posts) || posts.length > 25) return badRequest("invalid_posts", "posts must contain between 1 and 25 entries");
    if (idempotency_key !== undefined && (typeof idempotency_key !== "string" || !idempotency_key.trim() || idempotency_key.length > 160)) {
      return badRequest("invalid_idempotency_key", "idempotency_key must be a non-empty string of at most 160 characters");
    }
    for (const post of posts) {
      if (!post || typeof post.ig_account_id !== "string" || !post.ig_account_id || typeof post.caption !== "string") {
        return badRequest("invalid_post", "Every post requires ig_account_id and caption strings");
      }
      if (post.hashtags !== undefined && (!Array.isArray(post.hashtags) || post.hashtags.some((tag) => typeof tag !== "string"))) {
        return badRequest("invalid_hashtags", "hashtags must be an array of strings");
      }
      const scheduledAt = new Date(post.scheduled_at);
      if (!post.scheduled_at || Number.isNaN(scheduledAt.getTime())) {
        return badRequest("invalid_scheduled_at", "scheduled_at must be a valid ISO 8601 datetime");
      }
    }

    const requestKey = idempotency_key?.trim();
    const requestNamespace = requestKey ? `${wsId}:${sha256(requestKey)}:` : null;
    const requestFingerprint = requestKey ? sha256(JSON.stringify({
      media_asset_id,
      title: title ?? null,
      posts: posts.map((post) => ({
        ig_account_id: post.ig_account_id,
        caption: post.caption,
        hashtags: post.hashtags ?? [],
        scheduled_at: new Date(post.scheduled_at).toISOString(),
      })),
    })) : null;
    const postKeys = posts.map((_, index) => requestNamespace && requestFingerprint
      ? `${requestNamespace}${requestFingerprint}:${index}`
      : randomUUID());
    if (requestKey) {
      const replay = await idempotencyResult(wsId, requestNamespace!, postKeys);
      if (replay) return replay;
    }

    const media = await db.mediaAsset.findFirst({ where: { id: media_asset_id, workspaceId: wsId } });
    if (!media) return badRequest("invalid_asset", "Media asset not found");
    const quality = assessInstagramReelBasics({
      filename: media.filename,
      sizeBytes: media.sizeBytes,
      durationS: media.durationS,
      width: media.width,
      height: media.height,
    });
    if (quality.level === "blocked") return badRequest("invalid_reel_media", quality.headline);

    const accountIds = [...new Set(posts.map((p) => p.ig_account_id))];
    const accounts = await db.igAccount.findMany({ where: { workspaceId: wsId, id: { in: accountIds } } });
    if (accounts.length !== accountIds.length) return badRequest("invalid_account", "One or more selected accounts are not connected");
    const disconnected = accounts.find((a) => a.status !== "CONNECTED");
    if (disconnected) return badRequest("account_needs_reauth", `@${disconnected.username} needs re-auth before scheduling`);

    const now = new Date();
    for (const p of posts) {
      if (new Date(p.scheduled_at) <= now) return badRequest("scheduled_in_past", "Scheduled time must be in the future");
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
        for (const at of acctPosts) {
          const existing = await db.scheduledPost.findFirst({
            where: {
              workspaceId: wsId,
              igAccountId: acctId,
              status: { in: ["SCHEDULED", "PROCESSING"] },
              scheduledAt: { gt: new Date(at - minGap), lt: new Date(at + minGap) },
            },
            select: { id: true },
          });
          if (existing) return conflict("safety_min_gap", `A scheduled post is already within the ${process.env.SAFETY_MIN_GAP_MINUTES ?? 90}-minute minimum gap`);
        }
      }
    }

    let campaign;
    try {
      campaign = await db.campaign.create({
        data: { workspaceId: wsId, mediaAssetId: media_asset_id, title: title ?? null, status: "APPROVED", createdBy: userId ?? null,
          scheduledPosts: { create: posts.map((p, index) => ({ workspaceId: wsId, igAccountId: p.ig_account_id, caption: p.caption, hashtags: p.hashtags ?? [], scheduledAt: new Date(p.scheduled_at), status: "SCHEDULED", idempotencyKey: postKeys[index] })) },
        },
      });
    } catch (error) {
      // A concurrent retry may win after our initial lookup. The unique
      // idempotency constraint makes that safe; re-read and return its result.
      if (requestNamespace && typeof error === "object" && error !== null && "code" in error && error.code === "P2002") {
        const replay = await idempotencyResult(wsId, requestNamespace, postKeys);
        if (replay) return replay;
      }
      throw error;
    }

    return NextResponse.json({ id: campaign.id }, { status: 201 });
  } catch (e) {
    console.error("[campaigns POST]", e);
    return serverError();
  }
}
