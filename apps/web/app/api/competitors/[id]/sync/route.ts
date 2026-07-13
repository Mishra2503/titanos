import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";
import { enqueueCompetitorVideoAnalyses } from "@/lib/server/videoAnalyzer";

// Competitor sync, two sources merged:
//  1. Official Business Discovery API (followers, captions, likes/comments,
//     timestamps) — needs the Meta app to have Advanced Access.
//  2. Apify Instagram scrapers (adds REEL VIEW COUNTS, and acts as a full
//     fallback when Business Discovery is blocked). Token: APIFY_TOKEN.

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const HASHTAG_RE = /#\w+/gu;
const MEDIA_LIMIT = 50;
const REEL_LIMIT = 50;
const BD_MAX_PAGES = 2; // bounded follow-up pages if the first returns a cursor

// ── Source types ────────────────────────────────────────────────────────────

interface BdMedia {
  id: string; caption?: string; like_count?: number; comments_count?: number;
  media_type?: string; media_product_type?: string; media_url?: string;
  thumbnail_url?: string; permalink?: string; timestamp?: string;
}

interface BdProfile {
  username: string; name?: string; biography?: string; website?: string;
  profile_picture_url?: string; followers_count?: number; follows_count?: number;
  media_count?: number; media?: { data?: BdMedia[]; paging?: { cursors?: { after?: string } } };
}

interface ApifyReel {
  shortCode?: string; url?: string; caption?: string;
  commentsCount?: number; likesCount?: number;
  videoViewCount?: number; videoPlayCount?: number;
  timestamp?: string; displayUrl?: string; type?: string;
  videoUrl?: string; // direct .mp4 CDN link (transient) — feeds video analysis
}

interface ApifyProfile {
  username?: string; fullName?: string; followersCount?: number;
  followsCount?: number; postsCount?: number; profilePicUrl?: string;
}

interface MergedPost {
  shortcode: string;
  permalink: string;
  caption: string | null;
  likes: number | null;
  comments: number | null;
  views: number | null;
  postedOn: Date | null;
  thumbnailUrl: string | null;
  videoUrl: string | null;
  postType: string;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function shortcodeOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

async function runApify<T>(actor: string, input: unknown, token: string): Promise<T[]> {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=110`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(125_000),
    },
  );
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(`Apify: ${msg}`);
  }
  return Array.isArray(body) ? (body as T[]) : [];
}

async function fetchBusinessDiscoveryPage(igUserId: string, token: string, username: string, after: string | null): Promise<BdProfile> {
  const mediaArgs = after ? `media.limit(${MEDIA_LIMIT}).after(${after})` : `media.limit(${MEDIA_LIMIT})`;
  const fields =
    `business_discovery.username(${username})` +
    `{username,name,biography,website,profile_picture_url,followers_count,follows_count,media_count,` +
    `${mediaArgs}{id,caption,like_count,comments_count,media_type,media_product_type,media_url,thumbnail_url,permalink,timestamp}}`;
  const r = await fetch(
    `${GRAPH}/${igUserId}?fields=${encodeURIComponent(fields)}&access_token=${token}`,
    { signal: AbortSignal.timeout(20000) },
  );
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body?.error?.message ?? `Instagram API error ${r.status}`);
  if (!body?.business_discovery) throw new Error("Instagram returned no data (account must be a public professional account).");
  return body.business_discovery as BdProfile;
}

async function fetchBusinessDiscovery(wsId: string, username: string): Promise<BdProfile> {
  const account = await db.igAccount.findFirst({
    where: { workspaceId: wsId, status: "CONNECTED" },
    orderBy: { createdAt: "asc" },
  });
  if (!account) throw new Error("No connected Instagram account to query through.");
  const token = decryptSecret(account.accessTokenEnc);

  // First page carries the profile fields; follow-up pages only add media so we
  // reach ~50 reels when limit(50) alone returns fewer (bounded to avoid loops).
  const profile = await fetchBusinessDiscoveryPage(account.igUserId, token, username, null);
  const media: BdMedia[] = [...(profile.media?.data ?? [])];
  let after = profile.media?.paging?.cursors?.after ?? null;
  for (let page = 1; page < BD_MAX_PAGES && after && media.length < MEDIA_LIMIT; page++) {
    try {
      const next = await fetchBusinessDiscoveryPage(account.igUserId, token, username, after);
      const batch = next.media?.data ?? [];
      if (batch.length === 0) break;
      media.push(...batch);
      after = next.media?.paging?.cursors?.after ?? null;
    } catch {
      break; // paging is best-effort; keep whatever we already have
    }
  }
  return { ...profile, media: { data: media } };
}

// ── Route ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const competitor = await db.competitor.findFirst({ where: { id, workspaceId: wsId } });
    if (!competitor) return notFound("Competitor not found");

    const username = competitor.username.replace(/^@/, "").trim();
    const apifyToken =
      process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? process.env.APIFY_KEY ?? null;

    // Fire both sources in parallel; merge whatever succeeds.
    const [bdRes, reelsRes] = await Promise.allSettled([
      fetchBusinessDiscovery(wsId, username),
      apifyToken
        ? runApify<ApifyReel>("apify~instagram-reel-scraper", { username: [username], resultsLimit: REEL_LIMIT }, apifyToken)
        : Promise.reject(new Error("APIFY_TOKEN is not set in the server environment.")),
    ]);

    const bd = bdRes.status === "fulfilled" ? bdRes.value : null;
    const reels = reelsRes.status === "fulfilled" ? reelsRes.value : [];
    const bdError = bdRes.status === "rejected" ? String((bdRes.reason as Error)?.message ?? bdRes.reason) : null;
    const apifyError = reelsRes.status === "rejected" ? String((reelsRes.reason as Error)?.message ?? reelsRes.reason) : null;

    if (!bd && reels.length === 0) {
      return badRequest(
        "sync_failed",
        `Both data sources failed. Official API: ${bdError ?? "?"} | Scraper: ${apifyError ?? "?"} — if the scraper message mentions a missing token, add APIFY_TOKEN in Render.`,
      );
    }

    // If Business Discovery failed, get follower counts from the profile scraper.
    let apifyProfile: ApifyProfile | null = null;
    if (!bd && apifyToken) {
      try {
        const profiles = await runApify<ApifyProfile>("apify~instagram-profile-scraper", { usernames: [username] }, apifyToken);
        apifyProfile = profiles[0] ?? null;
      } catch { /* followers stay null; posts still sync */ }
    }

    // ── Merge posts by shortcode (BD base + Apify views) ─────────────────────
    const merged = new Map<string, MergedPost>();

    for (const m of bd?.media?.data ?? []) {
      const sc = shortcodeOf(m.permalink) ?? m.id;
      merged.set(sc, {
        shortcode: sc,
        permalink: m.permalink ?? `https://www.instagram.com/p/${sc}/`,
        caption: m.caption ?? null,
        likes: m.like_count ?? null,
        comments: m.comments_count ?? null,
        views: null,
        postedOn: m.timestamp ? new Date(m.timestamp) : null,
        thumbnailUrl: m.thumbnail_url ?? m.media_url ?? null,
        // For videos, BD's media_url IS the mp4 (thumbnail_url is the image)
        videoUrl: m.media_product_type === "REELS" || m.media_type === "VIDEO" ? (m.media_url ?? null) : null,
        postType: m.media_product_type === "REELS" ? "REEL" : (m.media_type ?? "POST"),
      });
    }

    let viewsEnriched = 0;
    for (const r of reels) {
      const sc = r.shortCode ?? shortcodeOf(r.url);
      if (!sc) continue;
      const views = r.videoPlayCount ?? r.videoViewCount ?? null;
      const existing = merged.get(sc);
      if (existing) {
        if (views != null) { existing.views = views; viewsEnriched++; }
        existing.likes = existing.likes ?? r.likesCount ?? null;
        existing.comments = existing.comments ?? r.commentsCount ?? null;
        existing.thumbnailUrl = existing.thumbnailUrl ?? r.displayUrl ?? null;
        existing.videoUrl = existing.videoUrl ?? r.videoUrl ?? null;
      } else {
        if (views != null) viewsEnriched++;
        merged.set(sc, {
          shortcode: sc,
          permalink: r.url ?? `https://www.instagram.com/reel/${sc}/`,
          caption: r.caption ?? null,
          likes: r.likesCount ?? null,
          comments: r.commentsCount ?? null,
          views,
          postedOn: r.timestamp ? new Date(r.timestamp) : null,
          thumbnailUrl: r.displayUrl ?? null,
          videoUrl: r.videoUrl ?? null,
          postType: "REEL",
        });
      }
    }

    const posts = [...merged.values()];

    // ── Snapshot (today's stats) ─────────────────────────────────────────────
    const followers = bd?.followers_count ?? apifyProfile?.followersCount ?? null;
    const following = bd?.follows_count ?? apifyProfile?.followsCount ?? null;
    const postsCount = bd?.media_count ?? apifyProfile?.postsCount ?? null;
    const n = posts.length || 1;
    const avgLikes = Math.round(posts.reduce((s, p) => s + (p.likes ?? 0), 0) / n);
    const avgComments = Math.round(posts.reduce((s, p) => s + (p.comments ?? 0), 0) / n);
    const engagementRate =
      followers && followers > 0
        ? Math.round(((avgLikes + avgComments) / followers) * 10000) / 100
        : null;

    const today = new Date(); today.setUTCHours(0, 0, 0, 0);
    const snapData = {
      followersCount: followers,
      followingCount: following,
      postsCount,
      avgLikes,
      avgComments,
      engagementRate,
      note: bd ? (viewsEnriched > 0 ? "Official API + view counts via scraper" : "Official Business Discovery API") : "Scraper (official API unavailable)",
    };
    const existingSnap = await db.competitorSnapshot.findFirst({ where: { competitorId: id, capturedOn: today } });
    if (existingSnap) {
      await db.competitorSnapshot.update({ where: { id: existingSnap.id }, data: snapData });
    } else {
      await db.competitorSnapshot.create({ data: { workspaceId: wsId, competitorId: id, capturedOn: today, ...snapData } });
    }

    // ── Upsert posts (matched by shortcode of stored permalink) ─────────────
    const stored = await db.competitorPost.findMany({ where: { competitorId: id }, select: { id: true, permalink: true } });
    const storedBySc = new Map(stored.map((p) => [shortcodeOf(p.permalink) ?? p.permalink ?? p.id, p.id]));

    let imported = 0;
    for (const p of posts) {
      const data = {
        postType: p.postType,
        caption: p.caption,
        hashtags: p.caption ? (p.caption.match(HASHTAG_RE) ?? []) : [],
        likes: p.likes,
        comments: p.comments,
        views: p.views,
        postedOn: p.postedOn,
        thumbnailUrl: p.thumbnailUrl,
      };
      const existingId = storedBySc.get(p.shortcode);
      if (existingId) {
        // Never wipe a stored video URL with null — a fresh one only helps.
        await db.competitorPost.update({ where: { id: existingId }, data: { ...data, videoUrl: p.videoUrl ?? undefined } });
      } else {
        await db.competitorPost.create({ data: { workspaceId: wsId, competitorId: id, permalink: p.permalink, videoUrl: p.videoUrl, ...data } });
        imported++;
      }
    }

    // ── Queue "watch the reel" analyses (frames + transcript → AI) ──────────
    let videosEnqueued = 0;
    try {
      videosEnqueued = await enqueueCompetitorVideoAnalyses(wsId, id);
    } catch (e) {
      console.error("[competitor sync] video enqueue failed", e);
    }

    // ── Refresh profile metadata ─────────────────────────────────────────────
    await db.competitor.update({
      where: { id },
      data: {
        displayName: bd?.name ?? apifyProfile?.fullName ?? competitor.displayName,
        avatarUrl: bd?.profile_picture_url ?? apifyProfile?.profilePicUrl ?? competitor.avatarUrl,
        profileUrl: competitor.profileUrl ?? `https://www.instagram.com/${username}/`,
      },
    });

    return NextResponse.json({
      synced: true,
      username,
      followers_count: followers,
      posts_imported: imported,
      views_enriched: viewsEnriched,
      videos_enqueued: videosEnqueued,
      source: bd && viewsEnriched > 0 ? "official+scraper" : bd ? "official" : "scraper",
      warnings: [bdError && `Official API: ${bdError}`, apifyError && `Scraper: ${apifyError}`].filter(Boolean),
    });
  } catch (e) {
    console.error("[competitor sync]", e);
    return serverError(`Sync failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
