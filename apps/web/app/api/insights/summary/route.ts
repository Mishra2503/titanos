import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
import { unauthorized, serverError } from "@/lib/server/errors";

// Tokens are issued via Instagram Login (instagram.com OAuth), so all data
// calls MUST go to graph.instagram.com — graph.facebook.com rejects them.
const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const MAX_MEDIA = 50;
const CAPTION_PREVIEW = 280;
const HASHTAG_RE = /#\w+/gu;
// Reel-specific metrics (only valid for media_product_type=REELS)
const REEL_METRICS = ["reach","likes","comments","shares","saved","total_interactions","views","ig_reels_avg_watch_time","ig_reels_video_view_total_time"];
// Basic metrics supported by all media types (photos, carousels, reels)
const BASIC_METRICS = ["reach","likes","comments","shares","saved","total_interactions","views"];

function metricsForType(mediaProductType: string | undefined | null): string[] {
  const t = (mediaProductType ?? "").toUpperCase();
  return t === "REELS" ? REEL_METRICS : BASIC_METRICS;
}

// Simple in-memory cache (TTL 10 min) — replaced by Redis in production
const cache = new Map<string, { ts: number; data: unknown }>();
const CACHE_TTL = 600_000;

function getCache(key: string) { const h = cache.get(key); return h && Date.now() - h.ts < CACHE_TTL ? h.data : null; }
function setCache(key: string, data: unknown) { cache.set(key, { ts: Date.now(), data }); }

async function graphGet(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${token}`, { signal: AbortSignal.timeout(15000) });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Graph API ${r.status}: ${body?.error?.message ?? "unknown error"}`);
  return body;
}

interface MediaItem {
  id: string; caption?: string; permalink?: string; thumbnail_url?: string; media_url?: string;
  timestamp?: string; media_product_type?: string; media_type?: string;
  like_count?: number; comments_count?: number;
}

async function buildAccountInsights(account: { id: string; igUserId: string; username: string; followersCount: number | null; accessTokenEnc: string }) {
  const cached = getCache(account.id);
  if (cached) return cached;

  let token: string;
  try { token = decryptSecret(account.accessTokenEnc); } catch {
    return { account_id: account.id, username: account.username, followers: account.followersCount, reach: 0, profile_views: null, saves: 0, shares: 0, likes: 0, comments: 0, engagement_rate: null, posts_analyzed: 0, recent_posts: [], error: "Stored token could not be read. Reconnect this account." };
  }

  const since = Math.floor((Date.now() - 28 * 86400000) / 1000);
  const until = Math.floor(Date.now() / 1000);
  const [profileRes, acctMetrics, mediaList] = await Promise.allSettled([
    graphGet(`/${account.igUserId}?fields=followers_count,media_count`, token),
    graphGet(`/${account.igUserId}/insights?metric=profile_views&period=day&metric_type=total_value&since=${since}&until=${until}`, token),
    graphGet(`/${account.igUserId}/media?fields=id,caption,permalink,thumbnail_url,media_url,timestamp,media_product_type,media_type,like_count,comments_count&limit=${MAX_MEDIA}`, token),
  ]);

  const liveFollowers: number | null = profileRes.status === "fulfilled" ? (profileRes.value?.followers_count ?? null) : null;
  if (liveFollowers != null && liveFollowers !== account.followersCount) {
    db.igAccount.update({ where: { id: account.id }, data: { followersCount: liveFollowers, lastSyncedAt: new Date() } }).catch(() => {});
  }

  const acctData = acctMetrics.status === "fulfilled" ? acctMetrics.value?.data?.[0] : null;
  const profileViews: number | null = acctData
    ? (acctData.total_value?.value ?? acctData.values?.reduce((s: number, v: { value: number }) => s + (v.value || 0), 0) ?? null)
    : null;

  const media: MediaItem[] = mediaList.status === "fulfilled" ? (mediaList.value?.data ?? []) : [];
  const mediaError = mediaList.status === "rejected" ? String((mediaList.reason as Error)?.message ?? mediaList.reason) : null;

  const postInsights = await Promise.allSettled(
    media.map((m) => {
      const metrics = metricsForType(m.media_product_type);
      return graphGet(`/${m.id}/insights?metric=${metrics.join(",")}`, token)
        .then((d) => {
          const vals: Record<string, number> = {};
          for (const item of d?.data ?? []) {
            vals[item.name] = item.values?.[0]?.value ?? item.total_value?.value ?? 0;
          }
          return { media: m, vals };
        })
        // Insights can fail per-post (e.g. posted before becoming a business
        // account). Fall back to the public like/comment counts so the post
        // still shows up instead of disappearing.
        .catch(() => ({ media: m, vals: { likes: m.like_count ?? 0, comments: m.comments_count ?? 0 } as Record<string, number> }));
    })
  );

  let saves = 0, shares = 0, likes = 0, comments = 0, views = 0, reachSum = 0, interSum = 0;
  const recentPosts = [];

  for (const r of postInsights) {
    if (r.status !== "fulfilled") continue;
    const { media: m, vals } = r.value;
    const postLikes = vals.likes ?? m.like_count ?? 0;
    const postComments = vals.comments ?? m.comments_count ?? 0;
    saves += vals.saved ?? 0; shares += vals.shares ?? 0;
    likes += postLikes; comments += postComments;
    views += vals.views ?? 0;
    const inter = vals.total_interactions ?? (postLikes + postComments + (vals.shares ?? 0) + (vals.saved ?? 0));
    const reach = vals.reach ?? 0;
    if (reach > 0) { reachSum += reach; interSum += inter; }
    const caption = m.caption ? m.caption.slice(0, CAPTION_PREVIEW) : null;
    recentPosts.push({
      id: m.id, caption, permalink: m.permalink ?? null,
      thumbnail_url: m.thumbnail_url ?? m.media_url ?? null,
      timestamp: m.timestamp ?? null, media_product_type: m.media_product_type ?? null,
      hashtags: caption ? (caption.match(HASHTAG_RE) ?? []) : [],
      reach: vals.reach ?? null, views: vals.views ?? null,
      likes: postLikes, comments: postComments,
      shares: vals.shares ?? null, saved: vals.saved ?? null,
      avg_watch_time_sec: vals.ig_reels_avg_watch_time ? Math.round(vals.ig_reels_avg_watch_time / 100) / 10 : null,
      total_watch_time_sec: vals.ig_reels_video_view_total_time ? Math.round(vals.ig_reels_video_view_total_time / 1000) : null,
      engagement_rate: reach > 0 ? Math.round((inter / reach) * 1000) / 10 : null,
    });
  }
  recentPosts.sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));

  const result = {
    account_id: account.id, username: account.username,
    followers: liveFollowers ?? account.followersCount, reach: reachSum,
    profile_views: profileViews, saves, shares, likes, comments, views,
    engagement_rate: reachSum > 0 ? Math.round((interSum / reachSum) * 1000) / 10 : null,
    posts_analyzed: media.length, recent_posts: recentPosts,
    error: media.length === 0 && mediaError ? `Instagram API error: ${mediaError}` : null,
  };
  // Don't cache hard failures — let the next request retry immediately.
  if (!result.error) setCache(account.id, result);
  return result;
}

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const accounts = await db.igAccount.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: "asc" } });
    type AccountResult = { account_id: string; username: string; followers: number | null; reach: number; profile_views: number | null; saves: number; shares: number; likes: number; comments: number; engagement_rate: number | null; posts_analyzed: number; recent_posts: unknown[]; error?: string | null };
    const perAccount = (await Promise.allSettled(accounts.map(buildAccountInsights)))
      .filter((r): r is PromiseFulfilledResult<AccountResult> => r.status === "fulfilled" && r.value != null)
      .map((r) => r.value);

    const totalReach = perAccount.reduce((s, a) => s + (a.reach ?? 0), 0);
    const totalSaves = perAccount.reduce((s, a) => s + (a.saves ?? 0), 0);
    const totalShares = perAccount.reduce((s, a) => s + (a.shares ?? 0), 0);
    const hasData = perAccount.length > 0;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      range_days: 28,
      kpis: [
        { key: "reach", label: "Reach", value: hasData ? totalReach : null, unit: null, available: hasData, note: hasData ? "Across recent posts" : null },
        { key: "saves", label: "Saves", value: hasData ? totalSaves : null, unit: null, available: hasData, note: null },
        { key: "shares", label: "Shares", value: hasData ? totalShares : null, unit: null, available: hasData, note: null },
        { key: "dm_leads", label: "DM leads", value: null, unit: null, available: false, note: "Connect GoHighLevel to populate the lead funnel" },
        { key: "calls_booked", label: "Calls booked", value: null, unit: null, available: false, note: "Connect GoHighLevel to populate the lead funnel" },
      ],
      accounts: perAccount,
    });
  } catch (e) {
    console.error("[insights]", e);
    return serverError();
  }
}
