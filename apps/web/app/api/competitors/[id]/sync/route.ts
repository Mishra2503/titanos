import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";

// Pulls a competitor's public stats via the official Business Discovery API.
// Works for any Business/Creator account, using one of the workspace's own
// connected-account tokens. No scraping involved.

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const HASHTAG_RE = /#\w+/gu;
const MEDIA_LIMIT = 25;

interface BdMedia {
  id: string; caption?: string; like_count?: number; comments_count?: number;
  media_type?: string; media_product_type?: string; media_url?: string;
  thumbnail_url?: string; permalink?: string; timestamp?: string;
}

interface BdProfile {
  username: string; name?: string; biography?: string; website?: string;
  profile_picture_url?: string; followers_count?: number; follows_count?: number;
  media_count?: number; media?: { data?: BdMedia[] };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const competitor = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!competitor) return notFound("Competitor not found");

    const account = await db.igAccount.findFirst({
      where: { workspaceId: wsId, status: "CONNECTED" },
      orderBy: { createdAt: "asc" },
    });
    if (!account) return badRequest("no_connected_account", "Connect at least one Instagram account first — competitor data is fetched through the official API using your own connection.");

    let token: string;
    try { token = decryptSecret(account.accessTokenEnc); } catch {
      return badRequest("token_unreadable", "Stored Instagram token could not be read. Reconnect your account.");
    }

    const username = competitor.username.replace(/^@/, "").trim();
    const fields =
      `business_discovery.username(${username})` +
      `{username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,` +
      `media.limit(${MEDIA_LIMIT}){id,caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp}}`;

    const r = await fetch(
      `${GRAPH}/${account.igUserId}?fields=${encodeURIComponent(fields)}&access_token=${token}`,
      { signal: AbortSignal.timeout(20000) },
    );
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg: string = body?.error?.message ?? `Instagram API error ${r.status}`;
      const friendly = /cannot be found|does not exist|invalid user/i.test(msg)
        ? `@${username} was not found, or is not a Business/Creator account (Business Discovery only works for professional accounts).`
        : msg;
      return badRequest("business_discovery_failed", friendly);
    }

    const bd: BdProfile | undefined = body?.business_discovery;
    if (!bd) return badRequest("business_discovery_failed", `Instagram returned no data for @${username}. The account must be public and a Business/Creator account.`);

    const mediaItems: BdMedia[] = bd.media?.data ?? [];

    // ── Snapshot (today's stats) ─────────────────────────────────────────────
    const likeCounts = mediaItems.map((m) => m.like_count ?? 0);
    const commentCounts = mediaItems.map((m) => m.comments_count ?? 0);
    const n = mediaItems.length || 1;
    const avgLikes = Math.round(likeCounts.reduce((a, b) => a + b, 0) / n);
    const avgComments = Math.round(commentCounts.reduce((a, b) => a + b, 0) / n);
    const followers = bd.followers_count ?? null;
    const engagementRate =
      followers && followers > 0
        ? Math.round(((avgLikes + avgComments) / followers) * 10000) / 100
        : null;

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const existingSnap = await db.competitorSnapshot.findFirst({
      where: { competitorId: id, capturedOn: today },
    });
    const snapData = {
      followersCount: followers,
      followingCount: bd.follows_count ?? null,
      postsCount: bd.media_count ?? null,
      avgLikes,
      avgComments,
      engagementRate,
      note: "Auto-synced via Business Discovery API",
    };
    if (existingSnap) {
      await db.competitorSnapshot.update({ where: { id: existingSnap.id }, data: snapData });
    } else {
      await db.competitorSnapshot.create({
        data: { workspaceId: wsId, competitorId: id, capturedOn: today, ...snapData },
      });
    }

    // ── Upsert recent posts (matched by permalink) ───────────────────────────
    let imported = 0;
    for (const m of mediaItems) {
      if (!m.permalink) continue;
      const caption = m.caption ?? null;
      const postData = {
        postType: m.media_product_type === "REELS" ? "REEL" : (m.media_type ?? "POST"),
        caption,
        hashtags: caption ? (caption.match(HASHTAG_RE) ?? []) : [],
        likes: m.like_count ?? null,
        comments: m.comments_count ?? null,
        postedOn: m.timestamp ? new Date(m.timestamp) : null,
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
      };
      const existing = await db.competitorPost.findFirst({ where: { competitorId: id, permalink: m.permalink } });
      if (existing) {
        await db.competitorPost.update({ where: { id: existing.id }, data: postData });
      } else {
        await db.competitorPost.create({
          data: { workspaceId: wsId, competitorId: id, permalink: m.permalink, ...postData },
        });
        imported++;
      }
    }

    // ── Refresh profile metadata ─────────────────────────────────────────────
    await db.competitor.update({
      where: { id },
      data: {
        displayName: bd.name ?? competitor.displayName,
        avatarUrl: bd.profile_picture_url ?? competitor.avatarUrl,
        profileUrl: competitor.profileUrl ?? `https://www.instagram.com/${bd.username}/`,
      },
    });

    return NextResponse.json({
      synced: true,
      username: bd.username,
      followers_count: followers,
      posts_imported: imported,
    });
  } catch (e) {
    console.error("[competitor sync]", e);
    return serverError();
  }
}
