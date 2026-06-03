"use client";

import { clearTokens, getAccessToken, getRefreshToken, setTokens } from "./auth";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function rawFetch(path: string, init: RequestInit, token: string | null): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return fetch(`${API_BASE}${path}`, { ...init, headers });
}

async function tryRefresh(): Promise<string | null> {
  const refresh = getRefreshToken();
  if (!refresh) return null;
  const resp = await rawFetch(
    "/api/auth/refresh",
    { method: "POST", body: JSON.stringify({ refresh_token: refresh }) },
    null,
  );
  if (!resp.ok) {
    clearTokens();
    return null;
  }
  const data = await resp.json();
  setTokens(data.access_token, data.refresh_token);
  return data.access_token as string;
}

/** Authenticated JSON fetch against our own backend. Auto-refreshes once on 401. */
export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  let token = getAccessToken();
  let resp = await rawFetch(path, init, token);

  if (resp.status === 401 && getRefreshToken()) {
    token = await tryRefresh();
    if (token) resp = await rawFetch(path, init, token);
  }

  if (resp.status === 204) return undefined as T;

  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error ?? { code: "unknown", message: resp.statusText };
    throw new ApiError(resp.status, err.code, err.message);
  }
  return body as T;
}

export async function login(email: string, password: string): Promise<void> {
  const resp = await rawFetch(
    "/api/auth/login",
    { method: "POST", body: JSON.stringify({ email, password }) },
    null,
  );
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error ?? { code: "unknown", message: "Login failed" };
    throw new ApiError(resp.status, err.code, err.message);
  }
  setTokens(body.access_token, body.refresh_token);
}

export interface Me {
  id: string;
  email: string;
  role: "OWNER" | "EDITOR";
  status: string;
  workspace_id: string;
}

export const getMe = () => apiFetch<Me>("/api/auth/me");

// === Settings: team, workspace, security =========================

export interface WorkspaceUser {
  id: string;
  email: string;
  role: "OWNER" | "EDITOR";
  status: "ACTIVE" | "INVITED" | "REVOKED";
  workspace_id: string;
}

export const listUsers = () => apiFetch<WorkspaceUser[]>("/api/auth/users");

export interface InviteResult {
  user: WorkspaceUser;
  invite_token: string;
}

export const inviteUser = (email: string, role: "OWNER" | "EDITOR" = "EDITOR") =>
  apiFetch<InviteResult>("/api/auth/invite", {
    method: "POST",
    body: JSON.stringify({ email, role }),
  });

export const revokeUser = (id: string) =>
  apiFetch<WorkspaceUser>(`/api/auth/users/${id}/revoke`, { method: "POST" });

export const changePassword = (current_password: string, new_password: string) =>
  apiFetch<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password, new_password }),
  });

export interface Workspace {
  id: string;
  name: string;
  plan: string;
  member_count: number;
  connection_count: number;
  connection_limit: number;
}

export const getWorkspace = () => apiFetch<Workspace>("/api/workspace");

export const updateWorkspace = (name: string) =>
  apiFetch<Workspace>("/api/workspace", {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });

export interface SafetyDefaults {
  enabled: boolean;
  daily_cap: number;
  hourly_cap: number;
  min_gap_minutes: number;
  jitter_seconds: number;
}

export const getSafetyDefaults = () =>
  apiFetch<{ defaults: SafetyDefaults }>("/api/safety/health").then((r) => r.defaults);

export interface Kpi {
  key: string;
  label: string;
  value: number | null;
  unit: string | null;
  available: boolean;
  note: string | null;
}

export interface RecentPost {
  id: string;
  caption: string | null;
  permalink: string | null;
  thumbnail_url: string | null;
  timestamp: string | null;
  media_product_type: string | null;
  hashtags: string[];
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  shares: number | null;
  saved: number | null;
  avg_watch_time_sec: number | null;
  total_watch_time_sec: number | null;
  engagement_rate: number | null;
}

export interface AccountInsights {
  account_id: string;
  username: string;
  followers: number | null;
  reach: number | null;
  profile_views: number | null;
  saves: number | null;
  shares: number | null;
  likes: number | null;
  comments: number | null;
  engagement_rate: number | null;
  posts_analyzed: number;
  recent_posts: RecentPost[];
}

export interface InsightsSummary {
  generated_at: string;
  range_days: number;
  kpis: Kpi[];
  accounts: AccountInsights[];
}

export const getInsightsSummary = () =>
  apiFetch<InsightsSummary>("/api/insights/summary");

export interface BoardCard {
  id: string;
  column_id: string;
  title: string;
  notes: string | null;
  position: number;
  emoji: string | null;
  status: string | null;
  platforms: string[];
  publish_date: string | null;
  hook: string | null;
  visual_hook: string | null;
  caption: string | null;
  hashtags: string[];
  reference_url: string | null;
  raw_footage_url: string | null;
  cover_image_url: string | null;
}

export type CardPatch = Partial<Omit<BoardCard, "id" | "column_id" | "position">>;

export type AiAction = "hooks" | "caption" | "hashtags" | "refine";

export interface AiOut {
  action: AiAction;
  text: string;
}

export interface BoardColumn {
  id: string;
  name: string;
  color: string;
  position: number;
  cards: BoardCard[];
}

export const getBoard = () => apiFetch<{ columns: BoardColumn[] }>("/api/board");

export const createCard = (column_id: string, title: string, notes?: string) =>
  apiFetch<BoardCard>("/api/board/cards", {
    method: "POST",
    body: JSON.stringify({ column_id, title, notes }),
  });

export const updateCard = (id: string, body: CardPatch) =>
  apiFetch<BoardCard>(`/api/board/cards/${id}`, { method: "PATCH", body: JSON.stringify(body) });

export const cardAi = (id: string, action: AiAction, instruction?: string) =>
  apiFetch<AiOut>(`/api/board/cards/${id}/ai`, {
    method: "POST",
    body: JSON.stringify({ action, instruction }),
  });

export const deleteCard = (id: string) =>
  apiFetch<void>(`/api/board/cards/${id}`, { method: "DELETE" });

export const reorderColumn = (column_id: string, card_ids: string[]) =>
  apiFetch<void>(`/api/board/columns/${column_id}/reorder`, {
    method: "POST",
    body: JSON.stringify({ card_ids }),
  });

export const createColumn = (name: string, color = "slate") =>
  apiFetch<BoardColumn>("/api/board/columns", {
    method: "POST",
    body: JSON.stringify({ name, color }),
  });

export const updateColumn = (id: string, body: { name?: string; color?: string }) =>
  apiFetch<BoardColumn>(`/api/board/columns/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteColumn = (id: string) =>
  apiFetch<void>(`/api/board/columns/${id}`, { method: "DELETE" });

// === Post & Schedule ==============================================

export interface MediaAsset {
  id: string;
  filename: string;
  public_url: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  format: string | null;
  size_bytes: number | null;
}

export type ScheduledPostStatus =
  | "SCHEDULED"
  | "PROCESSING"
  | "PUBLISHED"
  | "FAILED"
  | "CANCELED";

export interface ScheduledPostRowIn {
  ig_account_id: string;
  caption: string;
  hashtags: string[];
  scheduled_at: string; // ISO
}

export interface ScheduleListItem {
  id: string;
  campaign_id: string;
  ig_account_id: string;
  ig_username: string;
  caption: string;
  hashtags: string[];
  scheduled_at: string;
  status: ScheduledPostStatus;
  permalink: string | null;
  error: string | null;
  attempts: number;
  thumbnail_url: string | null;
}

export async function uploadMedia(file: File): Promise<MediaAsset> {
  const token = (await import("./auth")).getAccessToken();
  const fd = new FormData();
  fd.append("file", file);
  const resp = await fetch(`${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/api/media/upload`, {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: fd,
  });
  const body = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const err = body?.error ?? { code: "unknown", message: "Upload failed" };
    throw new ApiError(resp.status, err.code, err.message);
  }
  return body as MediaAsset;
}

// === Content Library =============================================

export interface MediaUsage {
  campaigns: number;
  scheduled_posts: number;
  published_posts: number;
}

export interface LibraryAsset {
  id: string;
  filename: string;
  public_url: string;
  thumbnail_url: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  format: string | null;
  size_bytes: number | null;
  created_at: string;
  uploaded_by_email: string | null;
  in_use: boolean;
  usage: MediaUsage;
}

export const listMedia = () => apiFetch<LibraryAsset[]>("/api/media");

// === Competitors =================================================

export interface CompetitorListItem {
  id: string;
  username: string;
  display_name: string | null;
  category: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  latest_followers: number | null;
  avg_engagement_rate: number | null;
  follower_delta: number | null;
  follower_delta_pct: number | null;
  snapshot_count: number;
  post_count: number;
  report_count: number;
}

export interface CompetitorSnapshot {
  id: string;
  captured_on: string;
  followers_count: number | null;
  following_count: number | null;
  posts_count: number | null;
  avg_likes: number | null;
  avg_comments: number | null;
  engagement_rate: number | null;
  note: string | null;
}

export interface CompetitorPost {
  id: string;
  permalink: string | null;
  post_type: string | null;
  caption: string | null;
  hashtags: string[];
  likes: number | null;
  comments: number | null;
  views: number | null;
  posted_on: string | null;
  thumbnail_url: string | null;
  what_works: string | null;
  engagement: number | null;
}

export interface HashtagStat {
  tag: string;
  count: number;
  avg_engagement: number | null;
}

export interface CompetitorAnalytics {
  latest_followers: number | null;
  follower_delta: number | null;
  follower_delta_pct: number | null;
  growth_since: string | null;
  avg_engagement_rate: number | null;
  posts_per_week: number | null;
  content_mix: Record<string, number>;
  top_hashtags: HashtagStat[];
  top_posts: CompetitorPost[];
}

export interface CompetitorReport {
  id: string;
  competitor_id: string | null;
  title: string;
  content: string;
  model: string | null;
  generated_at: string;
}

export interface CompetitorDetail {
  id: string;
  username: string;
  display_name: string | null;
  category: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  notes: string | null;
  snapshots: CompetitorSnapshot[];
  posts: CompetitorPost[];
  analytics: CompetitorAnalytics;
  reports: CompetitorReport[];
}

export interface CompetitorInput {
  username: string;
  display_name?: string | null;
  category?: string | null;
  profile_url?: string | null;
  notes?: string | null;
}

export interface SnapshotInput {
  captured_on?: string | null;
  followers_count?: number | null;
  following_count?: number | null;
  posts_count?: number | null;
  avg_likes?: number | null;
  avg_comments?: number | null;
  engagement_rate?: number | null;
  note?: string | null;
}

export interface PostInput {
  permalink?: string | null;
  post_type?: string | null;
  caption?: string | null;
  hashtags?: string[] | null;
  likes?: number | null;
  comments?: number | null;
  views?: number | null;
  posted_on?: string | null;
  thumbnail_url?: string | null;
  what_works?: string | null;
}

export const listCompetitors = () => apiFetch<CompetitorListItem[]>("/api/competitors");

export const createCompetitor = (body: CompetitorInput) =>
  apiFetch<CompetitorListItem>("/api/competitors", {
    method: "POST",
    body: JSON.stringify(body),
  });

export const getCompetitor = (id: string) =>
  apiFetch<CompetitorDetail>(`/api/competitors/${id}`);

export const updateCompetitor = (id: string, body: Partial<CompetitorInput> & { avatar_url?: string | null }) =>
  apiFetch<CompetitorDetail>(`/api/competitors/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });

export const deleteCompetitor = (id: string) =>
  apiFetch<void>(`/api/competitors/${id}`, { method: "DELETE" });

export const addSnapshot = (id: string, body: SnapshotInput) =>
  apiFetch<CompetitorSnapshot>(`/api/competitors/${id}/snapshots`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteSnapshot = (id: string, snapshotId: string) =>
  apiFetch<void>(`/api/competitors/${id}/snapshots/${snapshotId}`, { method: "DELETE" });

export const addCompetitorPost = (id: string, body: PostInput) =>
  apiFetch<CompetitorPost>(`/api/competitors/${id}/posts`, {
    method: "POST",
    body: JSON.stringify(body),
  });

export const deleteCompetitorPost = (id: string, postId: string) =>
  apiFetch<void>(`/api/competitors/${id}/posts/${postId}`, { method: "DELETE" });

export const generateCompetitorReport = (id: string) =>
  apiFetch<CompetitorReport>(`/api/competitors/${id}/report`, { method: "POST" });

export const generateOverviewReport = () =>
  apiFetch<CompetitorReport>("/api/competitors/report/overview", { method: "POST" });

export const deleteMedia = (id: string) =>
  apiFetch<void>(`/api/media/${id}`, { method: "DELETE" });

export const createCampaign = (media_asset_id: string, posts: ScheduledPostRowIn[], title?: string) =>
  apiFetch<{ id: string }>("/api/campaigns", {
    method: "POST",
    body: JSON.stringify({ media_asset_id, posts, title }),
  });

export const getSchedule = () => apiFetch<ScheduleListItem[]>("/api/schedule");

export const cancelScheduledPost = (id: string) =>
  apiFetch<void>(`/api/schedule/${id}/cancel`, { method: "POST" });

export const retryScheduledPost = (id: string) =>
  apiFetch<void>(`/api/schedule/${id}/retry`, { method: "POST" });

export const updateScheduledPost = (
  id: string,
  body: { caption?: string; hashtags?: string[]; scheduled_at?: string },
) =>
  apiFetch<{ status: string }>(`/api/schedule/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
