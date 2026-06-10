import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";

// Publishes due ScheduledPosts via the official Instagram content-publishing
// API (Instagram Login tokens → graph.instagram.com).
// Flow per post: create media container → wait for processing → publish.

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const BATCH_SIZE = 5;
const MAX_ATTEMPTS = 3;
const CONTAINER_POLL_MS = 10_000;
const CONTAINER_POLL_TRIES = 24; // up to ~4 min of video processing
const STALE_PROCESSING_MS = 30 * 60 * 1000;

async function graphPost(path: string, params: Record<string, string>, token: string) {
  const body = new URLSearchParams({ ...params, access_token: token });
  const r = await fetch(`${GRAPH}${path}`, { method: "POST", body, signal: AbortSignal.timeout(30000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
  return json;
}

async function graphGet(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${token}`, { signal: AbortSignal.timeout(30000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
  return json;
}

function buildCaption(caption: string, hashtags: unknown): string {
  const tags = (Array.isArray(hashtags) ? (hashtags as string[]) : []).filter((t) => !caption.includes(t));
  return tags.length ? `${caption}\n\n${tags.join(" ")}` : caption;
}

async function publishOne(postId: string): Promise<void> {
  const post = await db.scheduledPost.findUnique({
    where: { id: postId },
    include: { igAccount: true, campaign: { include: { mediaAsset: true } } },
  });
  if (!post || post.status !== "PROCESSING") return;

  try {
    const token = decryptSecret(post.igAccount.accessTokenEnc);
    const igUserId = post.igAccount.igUserId;
    const videoUrl = post.campaign.mediaAsset.publicUrl;
    const caption = buildCaption(post.caption, post.hashtags);

    // 1. Container (reuse one from a previous failed publish attempt if present)
    let containerId = post.containerId;
    if (!containerId) {
      const container = await graphPost(`/${igUserId}/media`, {
        media_type: "REELS",
        video_url: videoUrl,
        caption,
      }, token);
      containerId = container.id as string;
      await db.scheduledPost.update({ where: { id: post.id }, data: { containerId } });
    }

    // 2. Wait until Instagram finishes processing the video
    let status = "IN_PROGRESS";
    for (let i = 0; i < CONTAINER_POLL_TRIES; i++) {
      const s = await graphGet(`/${containerId}?fields=status_code`, token);
      status = s.status_code ?? "IN_PROGRESS";
      if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") break;
      await new Promise((r) => setTimeout(r, CONTAINER_POLL_MS));
    }
    if (status !== "FINISHED") {
      throw new Error(status === "IN_PROGRESS" ? "Video is still processing on Instagram — will retry" : `Instagram could not process the video (status ${status})`);
    }

    // 3. Publish
    const published = await graphPost(`/${igUserId}/media_publish`, { creation_id: containerId }, token);
    const mediaId = published.id as string;

    let permalink: string | null = null;
    try { permalink = (await graphGet(`/${mediaId}?fields=permalink`, token)).permalink ?? null; } catch { /* permalink is cosmetic */ }

    await db.scheduledPost.update({
      where: { id: post.id },
      data: { status: "PUBLISHED", publishedMediaId: mediaId, permalink, publishedAt: new Date(), error: null },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const stillProcessing = message.includes("still processing");
    const retryable = (stillProcessing || post.attempts < MAX_ATTEMPTS) && post.attempts < MAX_ATTEMPTS + 2;
    await db.scheduledPost.update({
      where: { id: post.id },
      data: retryable
        ? { status: "SCHEDULED", error: message, scheduledAt: new Date(Date.now() + 2 * 60 * 1000) }
        : { status: "FAILED", error: message },
    }).catch(() => {});
    console.error(`[publisher] post ${post.id} (@${post.igAccount.username}):`, message);
  }
}

export async function publishDuePosts(): Promise<{ claimed: number }> {
  const now = new Date();

  // Recover posts stuck in PROCESSING (e.g. server restarted mid-publish)
  await db.scheduledPost.updateMany({
    where: { status: "PROCESSING", processingStartedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
    data: { status: "SCHEDULED" },
  }).catch(() => {});

  const due = await db.scheduledPost.findMany({
    where: { status: "SCHEDULED", scheduledAt: { lte: now } },
    orderBy: { scheduledAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  let claimed = 0;
  for (const { id } of due) {
    // Atomic claim — only one worker transitions SCHEDULED → PROCESSING
    const res = await db.scheduledPost.updateMany({
      where: { id, status: "SCHEDULED" },
      data: { status: "PROCESSING", processingStartedAt: now, attempts: { increment: 1 } },
    });
    if (res.count === 1) {
      claimed++;
      await publishOne(id);
    }
  }
  return { claimed };
}

// Singleton interval guard — instrumentation can run more than once in dev.
const globalForPublisher = globalThis as unknown as { __titanPublisherStarted?: boolean };

export function startPublisherLoop(intervalMs = 60_000): void {
  if (globalForPublisher.__titanPublisherStarted) return;
  globalForPublisher.__titanPublisherStarted = true;
  console.log("[publisher] loop started — checking for due posts every", intervalMs / 1000, "s");
  setInterval(() => {
    publishDuePosts().catch((e) => console.error("[publisher] tick failed", e));
  }, intervalMs);
}
