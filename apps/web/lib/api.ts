"use client";

// All API calls go to our own Next.js API routes (same origin).
// No Bearer tokens — auth is via httpOnly cookies set by the server.
// Fixes: #3 (timeout), #6 (no localStorage), #7 (no Content-Type on GETs).

import { SERVER_UPLOAD_MAX_BYTES } from "@/lib/upload-limits";
import { extractVideoMetadata } from "@/lib/media-metadata";

const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function apiFetch<T>(path: string, init: RequestInit = {}, timeoutMs: number = TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const isBodyRequest = init.method && !["GET", "HEAD"].includes(init.method.toUpperCase());
  const headers = new Headers(init.headers);
  if (isBodyRequest && init.body && typeof init.body === "string") {
    headers.set("Content-Type", "application/json");
  }

  try {
    const resp = await fetch(path, { ...init, headers, signal: controller.signal, credentials: "same-origin" });
    if (resp.status === 204) return undefined as T;

    const body = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      const err = body?.error ?? { code: "unknown", message: resp.statusText };
      throw new ApiError(resp.status, err.code, err.message);
    }
    return body as T;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as Error).name === "AbortError") throw new ApiError(408, "timeout", "Request timed out — the server may be starting up. Please try again.");
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export { apiFetch };

export interface Me {
  id: string;
  email: string;
  role: "OWNER" | "EDITOR";
  status: string;
  workspace_id: string;
}

export const getMe = () => apiFetch<Me>("/api/auth/me");

export async function login(email: string, password: string): Promise<void> {
  await apiFetch<void>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
}

export async function logout(): Promise<void> {
  await apiFetch<void>("/api/auth/logout", { method: "POST" });
}

// === Settings: team, workspace, security =========================

export interface WorkspaceUser {
  id: string;
  email: string;
  role: "OWNER" | "EDITOR";
  status: "ACTIVE" | "INVITED" | "REVOKED";
  workspace_id: string;
}

export interface InviteResult {
  user: WorkspaceUser;
  invite_token: string;
}

export const listUsers = () => apiFetch<WorkspaceUser[]>("/api/auth/users");
export const inviteUser = (email: string, role: "OWNER" | "EDITOR" = "EDITOR") =>
  apiFetch<InviteResult>("/api/auth/invite", { method: "POST", body: JSON.stringify({ email, role }) });
export const revokeUser = (id: string) =>
  apiFetch<WorkspaceUser>(`/api/auth/users/${id}/revoke`, { method: "POST" });
export const changePassword = (current_password: string, new_password: string) =>
  apiFetch<void>("/api/auth/change-password", { method: "POST", body: JSON.stringify({ current_password, new_password }) });

export interface Workspace {
  id: string; name: string; plan: string; member_count: number; connection_count: number; connection_limit: number;
}
export const getWorkspace = () => apiFetch<Workspace>("/api/workspace");
export const updateWorkspace = (name: string) =>
  apiFetch<Workspace>("/api/workspace", { method: "PATCH", body: JSON.stringify({ name }) });

export interface SafetyDefaults {
  enabled: boolean; daily_cap: number; hourly_cap: number; min_gap_minutes: number; jitter_seconds: number;
}
export const getSafetyDefaults = () =>
  apiFetch<{ defaults: SafetyDefaults }>("/api/safety/health").then((r) => r.defaults);

export interface Kpi {
  key: string; label: string; value: number | null; unit: string | null; available: boolean; note: string | null;
}
export interface RecentPost {
  id: string; caption: string | null; permalink: string | null; thumbnail_url: string | null; timestamp: string | null;
  media_product_type: string | null; hashtags: string[]; reach: number | null; views: number | null;
  likes: number | null; comments: number | null; shares: number | null; saved: number | null;
  avg_watch_time_sec: number | null; total_watch_time_sec: number | null; engagement_rate: number | null;
}
export interface AccountInsights {
  account_id: string; username: string; followers: number | null; reach: number | null;
  profile_views: number | null; saves: number | null; shares: number | null; likes: number | null;
  comments: number | null; views?: number | null; engagement_rate: number | null; posts_analyzed: number;
  recent_posts: RecentPost[]; error?: string | null;
}
export interface InsightsSummary {
  generated_at: string; range_days: number; kpis: Kpi[]; accounts: AccountInsights[];
}
export const getInsightsSummary = () => apiFetch<InsightsSummary>("/api/insights/summary");

export interface BoardCard {
  id: string; column_id: string; title: string; notes: string | null; position: number; emoji: string | null;
  status: string | null; platforms: string[]; publish_date: string | null; hook: string | null;
  visual_hook: string | null; caption: string | null; hashtags: string[]; reference_url: string | null;
  raw_footage_url: string | null; cover_image_url: string | null;
  tags: string[]; scripted_at: string | null; video_analysis?: PostVideoAnalysis | null;
}
export type CardPatch = Partial<Omit<BoardCard, "id" | "column_id" | "position" | "scripted_at" | "video_analysis">>;
export type AiAction = "hooks" | "caption" | "hashtags" | "refine";
export interface AiOut { action: AiAction; text: string; }
export interface BoardColumn { id: string; name: string; color: string; position: number; cards: BoardCard[]; }

export const getBoard = () => apiFetch<{ columns: BoardColumn[] }>("/api/board");
export const createCard = (column_id: string, title: string, notes?: string) =>
  apiFetch<BoardCard>("/api/board/cards", { method: "POST", body: JSON.stringify({ column_id, title, notes }) });
export const updateCard = (id: string, body: CardPatch) =>
  apiFetch<BoardCard>(`/api/board/cards/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const cardAi = (id: string, action: AiAction, instruction?: string) =>
  apiFetch<AiOut>(`/api/board/cards/${id}/ai`, { method: "POST", body: JSON.stringify({ action, instruction }) });
export const deleteCard = (id: string) => apiFetch<void>(`/api/board/cards/${id}`, { method: "DELETE" });
// Watch the card's reference reel (frames + transcript + Claude vision). POST
// queues it; getCardAnalysis is polled until status is DONE. scriptCard turns
// the watched reel into a shoot-ready script written into the card.
export const analyzeCard = (id: string) =>
  apiFetch<PostVideoAnalysis | null>(`/api/board/cards/${id}/analyze`, { method: "POST" });
export const getCardAnalysis = (id: string) =>
  apiFetch<PostVideoAnalysis | null>(`/api/board/cards/${id}/analyze`);
export const scriptCard = (id: string) =>
  apiFetch<BoardCard>(`/api/board/cards/${id}/script`, { method: "POST" }, 240_000);
export const reorderColumn = (column_id: string, card_ids: string[]) =>
  apiFetch<void>(`/api/board/columns/${column_id}/reorder`, { method: "POST", body: JSON.stringify({ card_ids }) });
export const createColumn = (name: string, color = "slate") =>
  apiFetch<BoardColumn>("/api/board/columns", { method: "POST", body: JSON.stringify({ name, color }) });
export const updateColumn = (id: string, body: { name?: string; color?: string }) =>
  apiFetch<BoardColumn>(`/api/board/columns/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteColumn = (id: string) => apiFetch<void>(`/api/board/columns/${id}`, { method: "DELETE" });

export interface MediaAsset {
  id: string; filename: string; public_url: string; width: number | null; height: number | null;
  duration_s: number | null; format: string | null; size_bytes: number | null;
}
export type ScheduledPostStatus = "SCHEDULED" | "PROCESSING" | "PUBLISHED" | "FAILED" | "CANCELED";
export interface ScheduledPostRowIn {
  ig_account_id: string; caption: string; hashtags: string[]; scheduled_at: string;
}
export interface ScheduleListItem {
  id: string; campaign_id: string; ig_account_id: string; ig_username: string; caption: string;
  hashtags: string[]; scheduled_at: string; status: ScheduledPostStatus; permalink: string | null;
  error: string | null; attempts: number; thumbnail_url: string | null;
}

interface PresignResponse {
  video: { key: string; upload_url: string };
  thumbnail: { key: string; upload_url: string };
}

// One presigned PUT to the S3-compatible store, with upload progress.
function putWithProgress(url: string, body: Blob, contentType: string, onProgress?: (loadedBytes: number) => void): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new ApiError(xhr.status, "storage_upload_failed", `Storage rejected the upload (HTTP ${xhr.status})`));
    };
    // "network_error" is load-bearing: uploadMedia's server-fallback gate keys on it.
    xhr.onerror = () => reject(new ApiError(0, "network_error", "Network error while uploading to storage"));
    xhr.send(body);
  });
}

// Direct browser→storage upload via presigned PUT (fast path). A single PUT
// carries files up to ~5GB on R2/B2 — no chunking needed for reels — and the
// upload never touches our server, so Cloudflare's 100MB edge cap and Render's
// bandwidth don't apply. Metadata + poster thumbnail are extracted locally
// before upload since the store can't inspect media.
async function uploadMediaDirect(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
  const meta = await extractVideoMetadata(file); // never throws; nulls on failure

  const contentType = file.type || "video/mp4";
  const sig = await apiFetch<PresignResponse>("/api/media/sign", {
    method: "POST",
    body: JSON.stringify({ filename: file.name, content_type: contentType }),
  });

  await putWithProgress(sig.video.upload_url, file, contentType,
    (loaded) => onProgress?.(Math.round((loaded / file.size) * 100)));

  let thumbnailKey: string | undefined;
  if (meta.thumbnail) {
    try {
      await putWithProgress(sig.thumbnail.upload_url, meta.thumbnail, "image/jpeg");
      thumbnailKey = sig.thumbnail.key;
    } catch {
      // Thumbnail is a nice-to-have — never fail the upload over it.
    }
  }

  return apiFetch<MediaAsset>("/api/media/register", {
    method: "POST",
    body: JSON.stringify({
      filename: file.name,
      key: sig.video.key,
      thumbnail_key: thumbnailKey,
      width: meta.width ?? undefined,
      height: meta.height ?? undefined,
      duration: meta.durationS ?? undefined,
      format: file.name.match(/\.([^.]+)$/)?.[1]?.toLowerCase(),
      bytes: file.size,
    }),
  });
}

// Server-side proxy upload — fallback when the direct storage upload is blocked
// by the client's network (firewall, ad blocker, VPN, etc.).
//
// Sends the raw file as the request body (not multipart/form-data) so the server
// can stream it straight into the store instead of buffering + parsing a strict
// multipart frame — large reels were tripping the multipart parser's "Failed to
// parse body as FormData" error when the body arrived incomplete.
function uploadMediaServerSide(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
  return new Promise<MediaAsset>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api/media/upload?filename=${encodeURIComponent(file.name)}`);
    xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      type Body = MediaAsset & { error?: { code?: string; message?: string } };
      let body: Body;
      try { body = JSON.parse(xhr.responseText) as Body; } catch { body = {} as Body; }
      if (xhr.status >= 200 && xhr.status < 300) resolve(body);
      else reject(new ApiError(xhr.status, body?.error?.code ?? "upload_failed", body?.error?.message ?? `Upload failed (HTTP ${xhr.status})`));
    };
    xhr.onerror = () => reject(new ApiError(0, "upload_failed", "Upload failed — could not reach the server."));
    xhr.send(file);
  });
}

// Tries a direct browser→storage upload first (no server memory overhead).
// If that fails due to a network-level error (firewall / ad blocker / VPN
// blocking the storage host), retries via the server-side proxy route — but
// only for files small enough to survive the trip: Cloudflare kills bodies
// around 100MB at the edge before they ever reach our server, so proxying
// bigger files can only produce an opaque 502.
export async function uploadMedia(file: File, onProgress?: (pct: number) => void): Promise<MediaAsset> {
  try {
    return await uploadMediaDirect(file, onProgress);
  } catch (err) {
    if (!(err instanceof ApiError) || err.code !== "network_error") throw err;
    if (file.size > SERVER_UPLOAD_MAX_BYTES) {
      const mb = Math.round(file.size / 1024 / 1024);
      const capMb = Math.round(SERVER_UPLOAD_MAX_BYTES / 1024 / 1024);
      throw new ApiError(
        0,
        "direct_upload_blocked",
        `Direct upload to storage was blocked by your browser or network (ad blocker, firewall, or VPN?). ` +
          `This file (${mb}MB) is too large for the server fallback (max ${capMb}MB). ` +
          `Try disabling blocking extensions for this site or switching networks. [${err.message}]`,
      );
    }
    if (onProgress) onProgress(0);
    return await uploadMediaServerSide(file, onProgress);
  }
}

export interface MediaUsage { campaigns: number; scheduled_posts: number; published_posts: number; }
export interface LibraryAsset {
  id: string; filename: string; public_url: string; thumbnail_url: string | null; width: number | null;
  height: number | null; duration_s: number | null; format: string | null; size_bytes: number | null;
  created_at: string; uploaded_by_email: string | null; in_use: boolean; usage: MediaUsage;
}
export const listMedia = () => apiFetch<LibraryAsset[]>("/api/media");
export const deleteMedia = (id: string) => apiFetch<void>(`/api/media/${id}`, { method: "DELETE" });

export const createCampaign = (media_asset_id: string, posts: ScheduledPostRowIn[], title?: string) =>
  apiFetch<{ id: string }>("/api/campaigns", { method: "POST", body: JSON.stringify({ media_asset_id, posts, title }) });
export const getSchedule = () => apiFetch<ScheduleListItem[]>("/api/schedule");
export const cancelScheduledPost = (id: string) => apiFetch<void>(`/api/schedule/${id}/cancel`, { method: "POST" });
export const retryScheduledPost = (id: string) => apiFetch<void>(`/api/schedule/${id}/retry`, { method: "POST" });
export const updateScheduledPost = (id: string, body: { caption?: string; hashtags?: string[]; scheduled_at?: string }) =>
  apiFetch<{ status: string }>(`/api/schedule/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export interface CompetitorListItem {
  id: string; username: string; display_name: string | null; category: string | null; profile_url: string | null;
  avatar_url: string | null; latest_followers: number | null; avg_engagement_rate: number | null;
  follower_delta: number | null; follower_delta_pct: number | null; snapshot_count: number; post_count: number; report_count: number;
}
export interface CompetitorSnapshot { id: string; captured_on: string; followers_count: number | null; following_count: number | null; posts_count: number | null; avg_likes: number | null; avg_comments: number | null; engagement_rate: number | null; note: string | null; }
export interface PostVideoAnalysis { status: string; summary: string | null; transcript: string | null; hook_visual: string | null; hook_spoken: string | null; format: string | null; why_it_works: string | null; script?: string | null; cta?: string | null; analyzed_at?: string | null; error?: string | null; }
export interface ContentIdeaSource { title: string; url: string; }
export interface ContentIdea { idea: string; angle: string | null; suggested_hook: string | null; suggested_format: string | null; hot_score: number | null; hot_tag: string | null; trend_summary: string | null; sources: ContentIdeaSource[]; }
export interface ContentAnalysis { hook: string | null; body: string | null; cta: string | null; content_ideas: ContentIdea[]; estimate?: boolean; generated_at?: string | null; }
export interface CompetitorPost { id: string; permalink: string | null; post_type: string | null; caption: string | null; hashtags: string[]; likes: number | null; comments: number | null; views: number | null; posted_on: string | null; posted_at?: string | null; thumbnail_url: string | null; video_url?: string | null; what_works: string | null; engagement: number | null; outlier_multiple?: number | null; is_outlier?: boolean; video_analysis?: PostVideoAnalysis | null; content_analysis?: ContentAnalysis | null; tags?: string[]; used?: boolean; scripted?: boolean; board_card_id?: string | null; }
export interface HashtagStat { tag: string; count: number; avg_engagement: number | null; }
export interface CompetitorAnalytics { latest_followers: number | null; follower_delta: number | null; follower_delta_pct: number | null; growth_since: string | null; avg_engagement_rate: number | null; posts_per_week: number | null; content_mix: Record<string, number>; top_hashtags: HashtagStat[]; top_posts: CompetitorPost[]; median_views?: number | null; outlier_metric?: "views" | "engagement"; outliers?: CompetitorPost[]; }
export interface CompetitorReport { id: string; competitor_id: string | null; title: string; content: string; model: string | null; generated_at: string; }
export interface CompetitorDetail { id: string; username: string; display_name: string | null; category: string | null; profile_url: string | null; avatar_url: string | null; notes: string | null; snapshots: CompetitorSnapshot[]; posts: CompetitorPost[]; analytics: CompetitorAnalytics; reports: CompetitorReport[]; }
export interface CompetitorInput { username: string; display_name?: string | null; category?: string | null; profile_url?: string | null; notes?: string | null; }
export interface SnapshotInput { captured_on?: string | null; followers_count?: number | null; following_count?: number | null; posts_count?: number | null; avg_likes?: number | null; avg_comments?: number | null; engagement_rate?: number | null; note?: string | null; }
export interface PostInput { permalink?: string | null; post_type?: string | null; caption?: string | null; hashtags?: string[] | null; likes?: number | null; comments?: number | null; views?: number | null; posted_on?: string | null; thumbnail_url?: string | null; what_works?: string | null; }

export const listCompetitors = () => apiFetch<CompetitorListItem[]>("/api/competitors");
export const createCompetitor = (body: CompetitorInput) => apiFetch<CompetitorListItem>("/api/competitors", { method: "POST", body: JSON.stringify(body) });
export const getCompetitor = (id: string) => apiFetch<CompetitorDetail>(`/api/competitors/${id}`);
export const updateCompetitor = (id: string, body: Partial<CompetitorInput> & { avatar_url?: string | null }) => apiFetch<CompetitorDetail>(`/api/competitors/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteCompetitor = (id: string) => apiFetch<void>(`/api/competitors/${id}`, { method: "DELETE" });
export const addSnapshot = (id: string, body: SnapshotInput) => apiFetch<CompetitorSnapshot>(`/api/competitors/${id}/snapshots`, { method: "POST", body: JSON.stringify(body) });
export const deleteSnapshot = (id: string, snapshotId: string) => apiFetch<void>(`/api/competitors/${id}/snapshots/${snapshotId}`, { method: "DELETE" });
export const addCompetitorPost = (id: string, body: PostInput) => apiFetch<CompetitorPost>(`/api/competitors/${id}/posts`, { method: "POST", body: JSON.stringify(body) });
export const deleteCompetitorPost = (id: string, postId: string) => apiFetch<void>(`/api/competitors/${id}/posts/${postId}`, { method: "DELETE" });
export const analyzeReelIdea = (id: string, postId: string) => apiFetch<ContentAnalysis>(`/api/competitors/${id}/posts/${postId}/analyze`, { method: "POST" }, 180_000);
// Tag a competitor reel (manual tags + "used / don't reuse" toggle).
export const tagCompetitorPost = (id: string, postId: string, patch: { tags?: string[]; used?: boolean }) =>
  apiFetch<{ id: string; tags: string[]; used: boolean }>(`/api/competitors/${id}/posts/${postId}`, { method: "PATCH", body: JSON.stringify(patch) });

// === Competitor window insights (posting cadence + trend) =========
export interface WindowInsights { window_days: number; reel_count: number; posts_per_week: number; summary: string | null; topics: string[]; what_works: string[]; best_angle: string | null; estimate: boolean; }
export const getWindowInsights = (id: string, days: number) =>
  apiFetch<WindowInsights>(`/api/competitors/${id}/window-insights`, { method: "POST", body: JSON.stringify({ days }) }, 180_000);
export const scriptFromWindowTrend = (id: string, days: number, angle: string) =>
  apiFetch<{ script: Script }>(`/api/competitors/${id}/window-insights`, { method: "POST", body: JSON.stringify({ days, angle }) }, 240_000);
export const generateCompetitorReport = (id: string) => apiFetch<CompetitorReport>(`/api/competitors/${id}/report`, { method: "POST" }, 180_000);
export const generateOverviewReport = () => apiFetch<CompetitorReport>("/api/competitors/report/overview", { method: "POST" }, 120_000);

export interface CompetitorSyncResult {
  synced: true; username: string; followers_count: number | null; posts_imported: number;
  views_enriched?: number; videos_enqueued?: number; source?: "official+scraper" | "official" | "scraper"; warnings?: string[];
}
export const syncCompetitor = (id: string) =>
  apiFetch<CompetitorSyncResult>(`/api/competitors/${id}/sync`, { method: "POST" }, 180_000);

// === Scriptwriter ================================================
export interface ScriptResearch { angle: string | null; trend_note: string | null; similar_creators: string[]; hook_options: string[]; estimate: boolean; }
export interface Script {
  id: string; competitor_id: string | null; competitor_post_id: string | null; competitor_username: string | null;
  title: string; status: string; source_reel: unknown; research: ScriptResearch | null;
  hook: string | null; body: string; caption: string | null; hashtags: string[];
  model: string | null; board_card_id: string | null; created_at: string; updated_at: string;
}
export type ScriptPatch = Partial<Pick<Script, "title" | "body" | "hook" | "caption" | "hashtags">>;

export const generateScriptFromReel = (competitorId: string, postId: string) =>
  apiFetch<Script>(`/api/competitors/${competitorId}/posts/${postId}/script`, { method: "POST" }, 240_000);
export const listScripts = () => apiFetch<Script[]>("/api/scripts");
export const getScript = (id: string) => apiFetch<Script>(`/api/scripts/${id}`);
export const updateScript = (id: string, body: ScriptPatch) =>
  apiFetch<Script>(`/api/scripts/${id}`, { method: "PATCH", body: JSON.stringify(body) });
export const deleteScript = (id: string) => apiFetch<void>(`/api/scripts/${id}`, { method: "DELETE" });
export const rewriteScript = (id: string, instruction: string) =>
  apiFetch<Script>(`/api/scripts/${id}/rewrite`, { method: "POST", body: JSON.stringify({ instruction }) }, 240_000);
export const regenerateScript = (id: string) =>
  apiFetch<Script>(`/api/scripts/${id}/regenerate`, { method: "POST" }, 240_000);
export const approveScript = (id: string) =>
  apiFetch<{ script: Script; card_id: string; column_id: string }>(`/api/scripts/${id}/approve`, { method: "POST" });

// === Video analysis ("watch the reels") ==========================

export interface VideoStatusResult {
  counts: { PENDING: number; PROCESSING: number; DONE: number; FAILED: number; SKIPPED: number };
  recent_errors: { source: string; error: string | null; at: string }[];
}
export const getVideoStatus = () => apiFetch<VideoStatusResult>("/api/videos/status");
export const analyzeOwnReels = () =>
  apiFetch<{ enqueued: number; already_done: number; accounts_checked: number; warnings: string[] }>(
    "/api/reports/analyze-own", { method: "POST" }, 120_000);

// === AI content strategy =========================================

export interface StrategyPostIn {
  caption: string | null; reach: number | null; views: number | null; likes: number | null;
  comments: number | null; shares: number | null; saved: number | null;
  engagement_rate: number | null; avg_watch_time_sec: number | null;
  media_product_type: string | null; timestamp: string | null; hashtags: string[];
}
export const generateStrategy = (posts: StrategyPostIn[]) =>
  apiFetch<{ text: string; generated_at: string }>("/api/ai/strategy", {
    method: "POST",
    body: JSON.stringify({ posts }),
  }, 120_000);

// === Weekly report =================================================

export interface WeeklyReportPost {
  caption: string | null; timestamp: string | null; permalink: string | null;
  reach: number | null; views: number | null; likes: number | null; comments: number | null;
  shares: number | null; saved: number | null; engagement_rate: number | null;
  avg_watch_time_sec: number | null;
}
export interface WeeklyReportAccount {
  account_id: string; username: string; followers: number | null; error: string | null;
  posts_published: number; reach: number; views: number; likes: number; comments: number;
  shares: number; saves: number; prev_reach: number; prev_posts: number;
  top_post: WeeklyReportPost | null; posts: WeeklyReportPost[];
}
export interface WeeklyReport {
  generated_at: string; range_days: number; accounts: WeeklyReportAccount[]; summary: string;
}
export const getWeeklyReport = () =>
  apiFetch<WeeklyReport>("/api/reports/weekly", { method: "POST" }, 180_000);
