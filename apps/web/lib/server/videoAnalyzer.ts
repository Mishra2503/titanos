import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
import {
  analyzeVideo,
  transcribeVideoOnly,
  sweepOrphanTmpDirs,
  NotAVideoError,
  VideoUrlExpiredError,
} from "@/lib/server/videoAnalysis";
import { resolveInstagramVideoUrl } from "@/lib/server/instagram";

// Background queue worker for VideoAnalysis rows — same pattern as
// publisher.ts: atomic PENDING → PROCESSING claims, serial processing,
// bounded attempts, stale-row recovery. One video at a time keeps ffmpeg
// memory flat on the 512MB instance.

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const BATCH_SIZE = 2;
const MAX_ATTEMPTS = 3;
const STALE_PROCESSING_MS = 15 * 60 * 1000;

// ── Enqueue helpers ─────────────────────────────────────────────────────────

// Called after a competitor sync: queue every reel that has a video URL.
// DONE rows stay untouched (analyze once); FAILED rows get requeued with the
// fresh CDN URL a re-sync just brought (the cure for expired links).
export async function enqueueCompetitorVideoAnalyses(wsId: string, competitorId: string): Promise<number> {
  const reels = await db.competitorPost.findMany({
    where: { workspaceId: wsId, competitorId, postType: "REEL", videoUrl: { not: null } },
    select: { id: true, videoUrl: true, videoAnalysis: { select: { id: true, status: true } } },
  });

  let enqueued = 0;
  for (const reel of reels) {
    if (reel.videoAnalysis?.status === "DONE" || reel.videoAnalysis?.status === "PROCESSING") continue;
    if (reel.videoAnalysis) {
      await db.videoAnalysis.update({
        where: { id: reel.videoAnalysis.id },
        data: { videoUrl: reel.videoUrl, status: "PENDING", attempts: 0, error: null },
      });
    } else {
      await db.videoAnalysis.create({
        data: { workspaceId: wsId, source: "COMPETITOR", competitorPostId: reel.id, videoUrl: reel.videoUrl },
      });
    }
    enqueued++;
  }
  return enqueued;
}

// Called when the user hits "Analyze reel" on a Content Board card: (re)queue a
// BOARD-source VideoAnalysis for the card's reference reel. The worker resolves
// the reel URL to a fresh mp4 (Apify) and runs the FULL watch (frames + Groq +
// Claude vision), the same depth as OWN dashboard videos. Returns the row id.
export async function enqueueBoardCardAnalysis(wsId: string, cardId: string): Promise<string> {
  const existing = await db.videoAnalysis.findUnique({ where: { boardCardId: cardId } });
  if (existing) {
    if (existing.status === "PROCESSING") return existing.id; // a watch is already in flight
    const row = await db.videoAnalysis.update({
      where: { id: existing.id },
      data: { status: "PENDING", attempts: 0, error: null, videoUrl: null },
    });
    return row.id;
  }
  const row = await db.videoAnalysis.create({
    data: { workspaceId: wsId, source: "BOARD", boardCardId: cardId },
  });
  return row.id;
}

// ── Per-row processing ──────────────────────────────────────────────────────

async function graphGet(path: string, token: string) {
  const sep = path.includes("?") ? "&" : "?";
  const r = await fetch(`${GRAPH}${path}${sep}access_token=${token}`, { signal: AbortSignal.timeout(20000) });
  const json = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(json?.error?.message ?? `Graph API ${r.status}`);
  return json;
}

// OWN media_url is transient — always re-fetch a fresh one right before download.
async function freshOwnMediaUrl(row: { igMediaId: string | null; igAccountId: string | null }): Promise<string | null> {
  if (!row.igMediaId || !row.igAccountId) return null;
  const account = await db.igAccount.findUnique({ where: { id: row.igAccountId } });
  if (!account) throw new Error("Instagram account for this video was disconnected");
  const token = decryptSecret(account.accessTokenEnc);
  const media = await graphGet(`/${row.igMediaId}?fields=media_url,media_type`, token);
  if (media.media_type && media.media_type !== "VIDEO") throw new NotAVideoError(`Media is ${media.media_type}, not a video`);
  return media.media_url ?? null;
}

function metricsLineFor(post: { likes: number | null; comments: number | null; views: number | null } | null): string | null {
  if (!post) return null;
  const parts = [
    post.views != null && `views ${post.views}`,
    post.likes != null && `likes ${post.likes}`,
    post.comments != null && `comments ${post.comments}`,
  ].filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

async function analyzeOne(rowId: string): Promise<void> {
  const row = await db.videoAnalysis.findUnique({
    where: { id: rowId },
    include: {
      competitorPost: { select: { caption: true, likes: true, comments: true, views: true, videoUrl: true } },
      boardCard: { select: { referenceUrl: true } },
    },
  });
  if (!row || row.status !== "PROCESSING") return;

  try {
    let videoUrl: string | null;
    let caption: string | null = null;
    let metricsLine: string | null = null;

    if (row.source === "OWN") {
      videoUrl = await freshOwnMediaUrl(row);
      if (!videoUrl) {
        await db.videoAnalysis.update({
          where: { id: row.id },
          data: { status: "SKIPPED", error: "Instagram returned no media_url (often copyright-muted media)" },
        });
        return;
      }
    } else if (row.source === "BOARD") {
      // Resolve the card's reference reel URL to a fresh mp4 each attempt (the
      // CDN link is transient), pulling the caption along for the vision prompt.
      const refUrl = row.boardCard?.referenceUrl ?? null;
      if (!refUrl) {
        await db.videoAnalysis.update({
          where: { id: row.id },
          data: { status: "FAILED", error: "This card has no reference reel URL to analyze." },
        });
        return;
      }
      const resolved = await resolveInstagramVideoUrl(refUrl);
      videoUrl = resolved.videoUrl;
      caption = resolved.caption;
      if (!videoUrl) {
        await db.videoAnalysis.update({
          where: { id: row.id },
          data: { status: "SKIPPED", error: "That Instagram link isn't a video (image or carousel), so there's nothing to watch." },
        });
        return;
      }
    } else {
      videoUrl = row.videoUrl ?? row.competitorPost?.videoUrl ?? null;
      caption = row.competitorPost?.caption ?? null;
      metricsLine = metricsLineFor(row.competitorPost ?? null);
      if (!videoUrl) {
        await db.videoAnalysis.update({
          where: { id: row.id },
          data: { status: "FAILED", error: "No video URL stored — re-sync this competitor to refresh it" },
        });
        return;
      }
    }

    if (row.source === "COMPETITOR") {
      // Cheap path: Groq transcript only, no Claude vision (cost control at scale).
      const result = await transcribeVideoOnly({ videoUrl });
      await db.videoAnalysis.update({
        where: { id: row.id },
        data: {
          status: "DONE",
          transcript: result.transcript,
          durationS: result.durationS,
          model: null,
          analyzedAt: new Date(),
          error: null,
        },
      });
      console.log(`[video-analyzer] transcribed COMPETITOR video ${row.id} (${result.durationS}s)`);
    } else {
      // OWN dashboard videos + BOARD reference reels get the full vision analysis
      // (frames + Groq transcript + Claude vision → hook/format/script/why).
      const result = await analyzeVideo({ videoUrl, caption, metricsLine });
      await db.videoAnalysis.update({
        where: { id: row.id },
        data: {
          status: "DONE",
          transcript: result.transcript,
          analysis: result.analysis as object,
          summary: result.summary,
          durationS: result.durationS,
          model: result.model,
          analyzedAt: new Date(),
          error: null,
        },
      });
      console.log(`[video-analyzer] analyzed ${row.source} video ${row.id} (${result.durationS}s)`);
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    let data: { status: string; error: string };
    if (e instanceof NotAVideoError) {
      data = { status: "SKIPPED", error: message };
    } else if (e instanceof VideoUrlExpiredError) {
      data = { status: "FAILED", error: message }; // retries won't help; re-sync requeues
    } else if (row.attempts < MAX_ATTEMPTS) {
      data = { status: "PENDING", error: message }; // transient — retry next tick
    } else {
      data = { status: "FAILED", error: message };
    }
    await db.videoAnalysis.update({ where: { id: row.id }, data }).catch(() => {});
    console.error(`[video-analyzer] video ${row.id} (${row.source}):`, message);
  }
}

// ── Tick ────────────────────────────────────────────────────────────────────

export async function analyzePendingVideos(): Promise<{ claimed: number }> {
  const now = new Date();

  // Recover rows stuck in PROCESSING (e.g. server restarted mid-analysis)
  await db.videoAnalysis.updateMany({
    where: { status: "PROCESSING", processingStartedAt: { lt: new Date(now.getTime() - STALE_PROCESSING_MS) } },
    data: { status: "PENDING" },
  }).catch(() => {});

  await sweepOrphanTmpDirs();

  const pending = await db.videoAnalysis.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take: BATCH_SIZE,
    select: { id: true },
  });

  let claimed = 0;
  for (const { id } of pending) {
    // Atomic claim — only one worker transitions PENDING → PROCESSING
    const res = await db.videoAnalysis.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "PROCESSING", processingStartedAt: now, attempts: { increment: 1 } },
    });
    if (res.count === 1) {
      claimed++;
      await analyzeOne(id);
    }
  }
  return { claimed };
}

// Singleton interval guard — instrumentation can run more than once in dev.
const globalForAnalyzer = globalThis as unknown as { __titanVideoAnalyzerStarted?: boolean };

export function startVideoAnalyzerLoop(intervalMs = 90_000): void {
  if (globalForAnalyzer.__titanVideoAnalyzerStarted) return;
  globalForAnalyzer.__titanVideoAnalyzerStarted = true;
  console.log("[video-analyzer] loop started — watching for pending videos every", intervalMs / 1000, "s");
  let running = false;
  setInterval(async () => {
    if (running) return; // a batch can outlast the interval — never overlap
    running = true;
    try {
      await analyzePendingVideos();
    } catch (e) {
      console.error("[video-analyzer] tick failed", e);
    } finally {
      running = false;
    }
  }, intervalMs);
}
