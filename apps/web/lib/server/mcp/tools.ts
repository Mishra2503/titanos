// MCP tool registry for Titan OS.
//
// Each tool is a THIN wrapper over an existing REST route handler (see
// internal-call.ts), so all validation, RBAC, safety (min-gap / future-time /
// account-connected), and the "Instagram Graph API only, never fabricate
// metrics" rails are enforced by the same code the web UI uses. Tools marked
// `write: true` require a token that `canWrite()` - the MCP route rejects them
// for read-only tokens and VIEWER users.
//
// Two rules learned the hard way, worth keeping:
//   1. Never return a raw route payload. GET /api/competitors/[id] carries every
//      snapshot, every reel with its full transcript, and every report body -
//      six figures of tokens. Clients silently truncate it and the model then
//      answers from a fragment. Project down to what the tool promises, and give
//      the model a narrower tool to drill in with.
//   2. Anything that calls Claude goes through startJob(). Clients time out at
//      30-60s; these calls take 30-120s.

import type { TokenIdentity } from "@/lib/server/pat";
import { call } from "@/lib/server/mcp/internal-call";
import { startJob, getJob, listJobs } from "@/lib/server/mcp/jobs";
import { configuredOrigin } from "@/lib/server/mcp/origin";

// JSON Schema (draft-07-ish) - enough for MCP clients to render/validate inputs.
type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

/** MCP tool annotations - let clients auto-approve safe reads instead of prompting on everything. */
export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  write?: boolean;
  annotations?: ToolAnnotations;
  handler: (identity: TokenIdentity, args: Record<string, unknown>, origin?: string) => Promise<unknown>;
}

const NO_ARGS: JsonSchema = { type: "object", properties: {}, additionalProperties: false };
const READ: ToolAnnotations = { readOnlyHint: true, idempotentHint: true, openWorldHint: false };
const WRITE: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, openWorldHint: false };
const DESTRUCTIVE: ToolAnnotations = { readOnlyHint: false, destructiveHint: true, openWorldHint: false };

const str = (v: unknown): string => String(v ?? "");
const int = (v: unknown, dflt: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.floor(n) : dflt;
};
const clampLimit = (v: unknown, dflt = 20, max = 100): number =>
  Math.min(Math.max(int(v, dflt), 1), max);

/** Cap a long free-text field so one reel cannot swallow the model's context. */
function trim(text: string | null | undefined, max: number, hint: string): string | null {
  if (!text) return null;
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… [truncated, ${hint}]`;
}

// ── Shapes returned by GET /api/competitors/[id] ──────────────────────────────

interface VideoAnalysisOut {
  status: string;
  summary: string | null;
  transcript: string | null;
  hook_visual: string | null;
  hook_spoken: string | null;
  format: string | null;
  why_it_works: string | null;
}

interface ReelRow {
  id: string;
  permalink: string | null;
  post_type: string | null;
  caption: string | null;
  hashtags: string[];
  likes: number | null;
  comments: number | null;
  views: number | null;
  posted_on: string | null;
  posted_at: string | null;
  thumbnail_url: string | null;
  video_url: string | null;
  what_works: string | null;
  engagement: number | null;
  outlier_multiple: number | null;
  is_outlier: boolean;
  video_analysis: VideoAnalysisOut | null;
  content_analysis: unknown;
  tags: string[];
  used: boolean;
  scripted: boolean;
  board_card_id: string | null;
}

interface CompetitorDetail {
  id: string;
  username: string;
  display_name: string | null;
  category: string | null;
  profile_url: string | null;
  avatar_url: string | null;
  notes: string | null;
  snapshots: Array<Record<string, unknown>>;
  posts: ReelRow[];
  analytics: Record<string, unknown>;
  reports: Array<{ id: string; title: string; content: string; model: string | null; generated_at: string }>;
}

function competitorDetail(identity: TokenIdentity, id: string): Promise<CompetitorDetail> {
  return call<CompetitorDetail>(identity, "/api/competitors/[id]", { params: { id } });
}

/** The compact per-reel row used by list views: metrics and verdict, no transcript. */
function reelSummary(r: ReelRow) {
  return {
    reel_id: r.id,
    permalink: r.permalink,
    post_type: r.post_type,
    posted_on: r.posted_on,
    views: r.views,
    likes: r.likes,
    comments: r.comments,
    engagement: r.engagement,
    outlier_multiple: r.outlier_multiple,
    is_outlier: r.is_outlier,
    caption: trim(r.caption, 220, "call get_reel for the full caption"),
    hashtags: r.hashtags?.slice(0, 12) ?? [],
    what_works: r.what_works,
    why_it_works: r.video_analysis?.why_it_works ?? null,
    format: r.video_analysis?.format ?? null,
    analysis_status: r.video_analysis?.status ?? "NONE",
    has_transcript: !!r.video_analysis?.transcript,
    scripted: r.scripted,
    board_card_id: r.board_card_id,
  };
}

function sortReels(rows: ReelRow[], sort: string): ReelRow[] {
  const metric = (r: ReelRow) => (r.views ?? 0) || (r.engagement ?? 0);
  const copy = [...rows];
  switch (sort) {
    case "outlier":
      return copy.sort((a, b) => (b.outlier_multiple ?? 0) - (a.outlier_multiple ?? 0));
    case "engagement":
      return copy.sort((a, b) => (b.engagement ?? 0) - (a.engagement ?? 0));
    case "recent":
      return copy.sort((a, b) => str(b.posted_at).localeCompare(str(a.posted_at)));
    case "views":
    default:
      return copy.sort((a, b) => metric(b) - metric(a));
  }
}

export const TOOLS: McpTool[] = [
  // ─────────────────────────── Scheduling & publishing ───────────────────────────
  {
    name: "list_connections",
    description:
      "List the Instagram accounts connected to this workspace (id, username, status, follower count). Use these ids when scheduling.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/connections"),
  },
  {
    name: "refresh_connection",
    description: "Refresh an Instagram account's access token and profile data.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Connection id from list_connections." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) => call(id, "/api/connections/[id]/refresh", { method: "POST", params: { id: str(a.id) } }),
  },
  {
    name: "list_media",
    description: "List uploaded media assets available for scheduling (id, thumbnail, type).",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/media"),
  },
  {
    name: "list_scheduled_posts",
    description:
      "List scheduled and published posts with status, caption, scheduled time, permalink and any error.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "number", description: "Max rows to return (default 20)." } },
    },
    annotations: READ,
    handler: async (id, a) => {
      const posts = await call<Array<Record<string, unknown>>>(id, "/api/schedule");
      return { count: posts?.length ?? 0, posts: (posts ?? []).slice(0, clampLimit(a.limit)) };
    },
  },
  {
    name: "schedule_posts",
    description:
      "Schedule one media asset to one or more connected accounts. Publishing happens on the scheduler at the given time; this does NOT publish immediately. Times must be in the future and at least the workspace minimum-gap apart per account.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        media_asset_id: { type: "string", description: "Id from list_media." },
        title: { type: "string", description: "Optional campaign title." },
        posts: {
          type: "array",
          description: "One entry per target account.",
          items: {
            type: "object",
            additionalProperties: false,
            properties: {
              ig_account_id: { type: "string", description: "Id from list_connections." },
              caption: { type: "string" },
              hashtags: { type: "array", items: { type: "string" } },
              scheduled_at: { type: "string", description: "ISO 8601 datetime, must be in the future." },
            },
            required: ["ig_account_id", "caption", "scheduled_at"],
          },
        },
      },
      required: ["media_asset_id", "posts"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/campaigns", {
        method: "POST",
        body: { media_asset_id: a.media_asset_id, title: a.title, posts: a.posts },
      }),
  },
  {
    name: "update_scheduled_post",
    description: "Edit a scheduled post's caption, hashtags, or time. Only works before it publishes.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Scheduled post id." },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        scheduled_at: { type: "string", description: "ISO 8601 datetime." },
      },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/schedule/[id]", {
        method: "PATCH",
        params: { id: str(a.id) },
        body: { caption: a.caption, hashtags: a.hashtags, scheduled_at: a.scheduled_at },
      }),
  },
  {
    name: "cancel_scheduled_post",
    description: "Cancel a scheduled post so it will not be published.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Scheduled post id." } },
      required: ["id"],
    },
    write: true,
    annotations: DESTRUCTIVE,
    handler: (id, a) => call(id, "/api/schedule/[id]/cancel", { method: "POST", params: { id: str(a.id) } }),
  },
  {
    name: "retry_scheduled_post",
    description: "Retry a scheduled post that failed to publish.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Scheduled post id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) => call(id, "/api/schedule/[id]/retry", { method: "POST", params: { id: str(a.id) } }),
  },

  // ─────────────────────────────── Content board ─────────────────────────────────
  {
    name: "get_board",
    description: "Get the content board: all columns and their cards (ideas/drafts) in order.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/board"),
  },
  {
    name: "create_card",
    description: "Create a new card (content idea) in a board column.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        column_id: { type: "string", description: "Target column id from get_board." },
        title: { type: "string" },
        notes: { type: "string" },
      },
      required: ["column_id", "title"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/board/cards", { method: "POST", body: { column_id: a.column_id, title: a.title, notes: a.notes } }),
  },
  {
    name: "update_card",
    description:
      "Update a board card. Fields: title, notes, emoji, status, platforms, publish_date, hook, visual_hook, caption, hashtags, reference_url, raw_footage_url, cover_image_url.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        id: { type: "string", description: "Card id." },
        title: { type: "string" },
        notes: { type: "string" },
        status: { type: "string" },
        hook: { type: "string" },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) => {
      const { id: cardId, ...fields } = a;
      return call(id, "/api/board/cards/[id]", { method: "PATCH", params: { id: str(cardId) }, body: fields });
    },
  },
  {
    name: "delete_card",
    description: "Delete a board card permanently.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Card id." } },
      required: ["id"],
    },
    write: true,
    annotations: DESTRUCTIVE,
    handler: async (id, a) => {
      await call(id, "/api/board/cards/[id]", { method: "DELETE", params: { id: str(a.id) } });
      return { deleted: true, id: a.id };
    },
  },
  {
    name: "reorder_column",
    description:
      "Set the ordered card ids for a column. A card id from another column is moved here, so use this to move cards between columns.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        column_id: { type: "string", description: "Destination column id." },
        card_ids: { type: "array", items: { type: "string" }, description: "Final ordered card ids." },
      },
      required: ["column_id", "card_ids"],
    },
    write: true,
    annotations: WRITE,
    handler: async (id, a) => {
      await call(id, "/api/board/columns/[id]/reorder", {
        method: "POST",
        params: { id: str(a.column_id) },
        body: { card_ids: a.card_ids },
      });
      return { reordered: true, column_id: a.column_id };
    },
  },
  {
    name: "run_card_ai",
    description:
      "Run Claude on a board card: 'hooks' (5 opening hooks), 'caption', 'hashtags', or 'refine'. Returns the generated text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Card id." },
        action: { type: "string", enum: ["hooks", "caption", "hashtags", "refine"] },
        instruction: { type: "string", description: "Optional extra instruction." },
      },
      required: ["id", "action"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/board/cards/[id]/ai", {
        method: "POST",
        params: { id: str(a.id) },
        body: { action: a.action, instruction: a.instruction },
      }),
  },
  {
    name: "get_card_analysis",
    description: "Get the stored AI analysis for a board card, if one has been run.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Card id." } },
      required: ["id"],
    },
    annotations: READ,
    handler: (id, a) => call(id, "/api/board/cards/[id]/analyze", { params: { id: str(a.id) } }),
  },
  {
    name: "analyze_card",
    description: "Start AI analysis of a board card's idea. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Card id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "analyze_card", a, () =>
        call(identity, "/api/board/cards/[id]/analyze", { method: "POST", params: { id: str(a.id) } }),
      ),
  },
  {
    name: "generate_card_script",
    description:
      "Write a full script for a board card. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Card id." },
        instruction: { type: "string", description: "Optional direction for the script." },
      },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_card_script", a, () =>
        call(identity, "/api/board/cards/[id]/script", {
          method: "POST",
          params: { id: str(a.id) },
          body: { instruction: a.instruction },
        }),
      ),
  },

  // ─────────────────────────── Competitor intelligence ───────────────────────────
  {
    name: "list_competitors",
    description: "List tracked competitors with follower counts, engagement, and snapshot/post/report counts.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/competitors"),
  },
  {
    name: "get_competitor",
    description:
      "Competitor overview: profile, computed analytics (growth, posting cadence, content mix, top hashtags, top reels, outliers) and counts. Compact by design - use list_competitor_reels and get_reel to drill into individual reels.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.id));
      return {
        id: c.id,
        username: c.username,
        display_name: c.display_name,
        category: c.category,
        profile_url: c.profile_url,
        notes: c.notes,
        analytics: c.analytics,
        counts: {
          reels: c.posts?.length ?? 0,
          snapshots: c.snapshots?.length ?? 0,
          reports: c.reports?.length ?? 0,
          analyzed_reels: (c.posts ?? []).filter((p) => p.video_analysis?.status === "DONE").length,
        },
        next_steps: "list_competitor_reels for the reel list, get_reel for one reel's transcript and why it works, list_competitor_reports for stored reports.",
      };
    },
  },
  {
    name: "get_competitor_analytics",
    description:
      "Just the computed analytics for a competitor: follower growth, posts per week, content mix, top hashtags, median views, and the outlier reels that beat their own median.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.id));
      return { competitor_id: c.id, username: c.username, analytics: c.analytics };
    },
  },
  {
    name: "list_competitor_reels",
    description:
      "List a competitor's reels with their real metrics and outlier multiple - this answers WHAT is working. Sort by views, engagement, outlier, or recent. Use only_outliers to see just the reels that beat the account's own median by 2x or more.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Competitor id." },
        sort: { type: "string", enum: ["views", "engagement", "outlier", "recent"], description: "Default views." },
        limit: { type: "number", description: "Max reels (default 20, max 100)." },
        only_outliers: { type: "boolean", description: "Only reels with is_outlier true." },
        only_analyzed: { type: "boolean", description: "Only reels the AI has already watched." },
      },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.id));
      let rows = c.posts ?? [];
      if (a.only_outliers) rows = rows.filter((r) => r.is_outlier);
      if (a.only_analyzed) rows = rows.filter((r) => r.video_analysis?.status === "DONE");
      const sorted = sortReels(rows, str(a.sort) || "views");
      return {
        competitor_id: c.id,
        username: c.username,
        outlier_metric: (c.analytics as { outlier_metric?: string })?.outlier_metric ?? null,
        median_views: (c.analytics as { median_views?: number })?.median_views ?? null,
        total_reels: c.posts?.length ?? 0,
        returned: Math.min(sorted.length, clampLimit(a.limit)),
        reels: sorted.slice(0, clampLimit(a.limit)).map(reelSummary),
      };
    },
  },
  {
    name: "get_reel",
    description:
      "Everything known about one competitor reel - metrics, caption, hashtags, the AI's watch data (spoken and visual hook, format, why it works), the transcript, and any deep content analysis. This answers HOW and WHY a reel is working.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        competitor_id: { type: "string", description: "Competitor id." },
        reel_id: { type: "string", description: "Reel id from list_competitor_reels." },
        include_transcript: { type: "boolean", description: "Include the full transcript (default true)." },
      },
      required: ["competitor_id", "reel_id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.competitor_id));
      const r = (c.posts ?? []).find((p) => p.id === str(a.reel_id));
      if (!r) throw new Error(`No reel ${str(a.reel_id)} on competitor @${c.username}.`);
      const wantTranscript = a.include_transcript !== false;
      const va = r.video_analysis;
      return {
        competitor: { id: c.id, username: c.username },
        reel_id: r.id,
        permalink: r.permalink,
        post_type: r.post_type,
        posted_on: r.posted_on,
        metrics: {
          views: r.views,
          likes: r.likes,
          comments: r.comments,
          engagement: r.engagement,
          outlier_multiple: r.outlier_multiple,
          is_outlier: r.is_outlier,
        },
        caption: r.caption,
        hashtags: r.hashtags ?? [],
        what_works: r.what_works,
        ai_watch: va
          ? {
              status: va.status,
              summary: va.summary,
              hook_spoken: va.hook_spoken,
              hook_visual: va.hook_visual,
              format: va.format,
              why_it_works: va.why_it_works,
              transcript: wantTranscript ? trim(va.transcript, 12000, "transcript continues") : undefined,
            }
          : { status: "NONE", note: "Not analyzed yet. sync_competitor queues reels for the video analyzer." },
        deep_analysis: r.content_analysis ?? null,
        tags: r.tags ?? [],
        scripted: r.scripted,
        board_card_id: r.board_card_id,
      };
    },
  },
  {
    name: "list_competitor_snapshots",
    description: "Follower and engagement history for a competitor over time (newest first).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Competitor id." },
        limit: { type: "number", description: "Max snapshots (default 30)." },
      },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.id));
      const snaps = [...(c.snapshots ?? [])].reverse().slice(0, clampLimit(a.limit, 30));
      return { competitor_id: c.id, username: c.username, snapshots: snaps };
    },
  },
  {
    name: "list_competitor_reports",
    description: "List stored AI reports for a competitor (id, title, date) without their bodies.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.id));
      return {
        competitor_id: c.id,
        username: c.username,
        reports: (c.reports ?? []).map((r) => ({
          report_id: r.id,
          title: r.title,
          model: r.model,
          generated_at: r.generated_at,
          preview: trim(r.content, 300, "call get_competitor_report for the full text"),
        })),
      };
    },
  },
  {
    name: "get_competitor_report",
    description: "Read one stored competitor report in full.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        competitor_id: { type: "string", description: "Competitor id." },
        report_id: { type: "string", description: "Report id from list_competitor_reports." },
      },
      required: ["competitor_id", "report_id"],
    },
    annotations: READ,
    handler: async (identity, a) => {
      const c = await competitorDetail(identity, str(a.competitor_id));
      const r = (c.reports ?? []).find((x) => x.id === str(a.report_id));
      if (!r) throw new Error(`No report ${str(a.report_id)} for @${c.username}.`);
      return { competitor_id: c.id, username: c.username, ...r };
    },
  },
  {
    name: "add_competitor",
    description: "Start tracking a competitor by Instagram username.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        username: { type: "string", description: "Instagram handle without the @." },
        display_name: { type: "string" },
        category: { type: "string" },
        profile_url: { type: "string" },
        notes: { type: "string" },
      },
      required: ["username"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/competitors", {
        method: "POST",
        body: {
          username: a.username,
          display_name: a.display_name,
          category: a.category,
          profile_url: a.profile_url,
          notes: a.notes,
        },
      }),
  },
  {
    name: "sync_competitor",
    description:
      "Pull the latest public profile snapshot and recent reels for a competitor, and queue new reels for the video analyzer. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "sync_competitor", a, () =>
        call(identity, "/api/competitors/[id]/sync", { method: "POST", params: { id: str(a.id) } }),
      ),
  },
  {
    name: "analyze_reel",
    description:
      "Deep-research one competitor reel: break it into hook, body and CTA, derive content ideas for us, and score how hot each topic is right now using live web search. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        competitor_id: { type: "string", description: "Competitor id." },
        reel_id: { type: "string", description: "Reel id from list_competitor_reels." },
      },
      required: ["competitor_id", "reel_id"],
    },
    write: true,
    annotations: { ...WRITE, openWorldHint: true },
    handler: (identity, a) =>
      startJob(identity, "analyze_reel", a, () =>
        call(identity, "/api/competitors/[id]/posts/[postId]/analyze", {
          method: "POST",
          params: { id: str(a.competitor_id), postId: str(a.reel_id) },
        }),
      ),
  },
  {
    name: "get_competitor_window_insights",
    description:
      "Performance insights for a competitor over a recent time window. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Competitor id." },
        days: { type: "number", description: "Window length in days (default 28)." },
      },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "get_competitor_window_insights", a, () =>
        call(identity, "/api/competitors/[id]/window-insights", {
          method: "POST",
          params: { id: str(a.id) },
          body: { days: a.days },
        }),
      ),
  },
  {
    name: "send_reel_to_board",
    description: "Turn a competitor reel into a card on our content board.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        competitor_id: { type: "string", description: "Competitor id." },
        reel_id: { type: "string", description: "Reel id." },
      },
      required: ["competitor_id", "reel_id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) =>
      call(id, "/api/competitors/[id]/posts/[postId]/board", {
        method: "POST",
        params: { id: str(a.competitor_id), postId: str(a.reel_id) },
      }),
  },
  {
    name: "generate_competitor_report",
    description:
      "Generate an AI strategic report for one competitor from their snapshots and reels. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_competitor_report", a, () =>
        call(identity, "/api/competitors/[id]/report", { method: "POST", params: { id: str(a.id) } }),
      ),
  },
  {
    name: "generate_competitors_overview",
    description:
      "Generate an AI landscape overview across all tracked competitors. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: NO_ARGS,
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_competitors_overview", a, () =>
        call(identity, "/api/competitors/report/overview", { method: "POST" }),
      ),
  },

  // ───────────────────────────────── Scripts ─────────────────────────────────────
  {
    name: "list_scripts",
    description: "List scripts in the workspace, newest first, with status and source reel.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "number", description: "Max scripts (default 20)." } },
    },
    annotations: READ,
    handler: async (id, a) => {
      const rows = await call<Array<Record<string, unknown>>>(id, "/api/scripts");
      return {
        count: rows?.length ?? 0,
        scripts: (rows ?? []).slice(0, clampLimit(a.limit)).map((s) => ({
          script_id: s.id,
          title: s.title,
          status: s.status,
          competitor_username: s.competitor_username ?? null,
          hook: s.hook ?? null,
          updated_at: s.updated_at ?? null,
          body_preview: trim(typeof s.body === "string" ? s.body : null, 300, "call get_script for the full text"),
        })),
      };
    },
  },
  {
    name: "get_script",
    description: "Read one script in full: hook, body, caption, hashtags, research and source reel.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Script id." } },
      required: ["id"],
    },
    annotations: READ,
    handler: (id, a) => call(id, "/api/scripts/[id]", { params: { id: str(a.id) } }),
  },
  {
    name: "update_script",
    description: "Edit a script directly: title, hook, body, caption, hashtags.",
    inputSchema: {
      type: "object",
      additionalProperties: true,
      properties: {
        id: { type: "string", description: "Script id." },
        title: { type: "string" },
        hook: { type: "string" },
        body: { type: "string", description: "Full script text." },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
      },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) => {
      const { id: scriptId, ...fields } = a;
      return call(id, "/api/scripts/[id]", { method: "PATCH", params: { id: str(scriptId) }, body: fields });
    },
  },
  {
    name: "generate_script_from_reel",
    description:
      "Write an original script for us based on a competitor reel that is working. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        competitor_id: { type: "string", description: "Competitor id." },
        reel_id: { type: "string", description: "Reel id from list_competitor_reels." },
      },
      required: ["competitor_id", "reel_id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_script_from_reel", a, () =>
        call(identity, "/api/competitors/[id]/posts/[postId]/script", {
          method: "POST",
          params: { id: str(a.competitor_id), postId: str(a.reel_id) },
        }),
      ),
  },
  {
    name: "rewrite_script",
    description:
      "Refine an existing script against a specific instruction, for example 'tighten the hook' or 'make the first three seconds punchier'. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Script id." },
        instruction: { type: "string", description: "What to change." },
      },
      required: ["id", "instruction"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "rewrite_script", a, () =>
        call(identity, "/api/scripts/[id]/rewrite", {
          method: "POST",
          params: { id: str(a.id) },
          body: { instruction: a.instruction },
        }),
      ),
  },
  {
    name: "regenerate_script",
    description:
      "Regenerate a script from scratch from its source reel. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Script id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "regenerate_script", a, () =>
        call(identity, "/api/scripts/[id]/regenerate", { method: "POST", params: { id: str(a.id) } }),
      ),
  },
  {
    name: "approve_script",
    description: "Approve a script and push it to the content board.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Script id." } },
      required: ["id"],
    },
    write: true,
    annotations: WRITE,
    handler: (id, a) => call(id, "/api/scripts/[id]/approve", { method: "POST", params: { id: str(a.id) } }),
  },

  // ────────────────────────── Our own performance & AI ───────────────────────────
  {
    name: "get_insights_summary",
    description:
      "Insights per connected account (followers, reach, recent post metrics). Data comes only from the Instagram Graph API - never extrapolate beyond what this returns.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/insights/summary"),
  },
  {
    name: "analyze_own_content",
    description:
      "Analyze our own recent reels: which ones worked and why, grounded in real Graph API metrics. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: NO_ARGS,
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "analyze_own_content", a, () => call(identity, "/api/reports/analyze-own", { method: "POST" })),
  },
  {
    name: "generate_ai_strategy",
    description:
      "Generate a content strategy grounded in the workspace's real recent performance. Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        posts: {
          type: "array",
          description: "Optional posts to focus on. Omit to use recent posts.",
          items: { type: "object" },
        },
      },
    },
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_ai_strategy", a, () =>
        call(identity, "/api/ai/strategy", { method: "POST", body: { posts: a.posts } }),
      ),
  },
  {
    name: "generate_weekly_report",
    description:
      "Generate the weekly performance report across all connected accounts (this week vs last). Long-running: returns a job_id to poll with get_job_status.",
    inputSchema: NO_ARGS,
    write: true,
    annotations: WRITE,
    handler: (identity, a) =>
      startJob(identity, "generate_weekly_report", a, () => call(identity, "/api/reports/weekly", { method: "POST" })),
  },
  {
    name: "get_video_analysis_status",
    description:
      "Status of the reel-watching queue (how many pending, processing, done, failed) plus recent errors. Use this when reels are missing transcripts or why_it_works.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/videos/status"),
  },
  {
    name: "get_workspace",
    description: "Workspace settings: timezone, per-account minimum gap between posts, plan.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/workspace"),
  },
  {
    name: "get_safety_health",
    description: "Rate-limit safety state per connected account - check before bulk scheduling.",
    inputSchema: NO_ARGS,
    annotations: READ,
    handler: (id) => call(id, "/api/safety/health"),
  },

  // ─────────────────────────────────── Jobs ──────────────────────────────────────
  {
    name: "get_job_status",
    description:
      "Check a long-running job started by another tool. Returns status and, once done, the full result. Poll about every 15 seconds.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { job_id: { type: "string", description: "job_id returned by the tool that started the work." } },
      required: ["job_id"],
    },
    annotations: READ,
    handler: (identity, a) => getJob(identity, str(a.job_id)),
  },
  {
    name: "list_jobs",
    description: "List recent long-running jobs for this workspace and their status.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { limit: { type: "number", description: "Max jobs (default 10)." } },
    },
    annotations: READ,
    handler: (identity, a) => listJobs(identity, clampLimit(a.limit, 10, 50)),
  },

  // ── Generic search/fetch (ChatGPT / Perplexity connector compatibility) ─────────
  {
    name: "search",
    description:
      "Search across Titan OS scheduled posts, board cards, competitors, reels and scripts by keyword. Returns items with an id you can pass to `fetch`.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "Keywords to match." } },
      required: ["query"],
    },
    annotations: READ,
    handler: async (identity, a, origin) => {
      const base = origin ?? configuredOrigin();
      const q = str(a.query).toLowerCase().trim();
      const results: { id: string; title: string; url: string }[] = [];
      const add = (id: string, title: string, url: string) => results.push({ id, title, url });
      const hit = (haystack: string) => !q || haystack.toLowerCase().includes(q);

      const [posts, board, comps, scripts] = await Promise.all([
        call<Array<Record<string, unknown>>>(identity, "/api/schedule").catch(() => []),
        call<{ columns?: Array<{ cards?: Array<Record<string, unknown>> }> }>(identity, "/api/board").catch(() => ({
          columns: [],
        })),
        call<Array<Record<string, unknown>>>(identity, "/api/competitors").catch(() => []),
        call<Array<Record<string, unknown>>>(identity, "/api/scripts").catch(() => []),
      ]);

      for (const p of posts ?? []) {
        const cap = str(p.caption);
        if (hit(cap)) {
          add(`scheduled:${p.id}`, `Scheduled post: ${cap.slice(0, 60) || "(no caption)"}`, str(p.permalink) || `${base}/schedule`);
        }
      }
      for (const col of board?.columns ?? []) {
        for (const c of col.cards ?? []) {
          if (hit(`${str(c.title)} ${str(c.notes)}`)) {
            add(`card:${c.id}`, `Board card: ${str(c.title) || "(untitled)"}`, `${base}/board?card=${str(c.id)}`);
          }
        }
      }
      for (const c of comps ?? []) {
        if (hit(`${str(c.username)} ${str(c.display_name)} ${str(c.category)}`)) {
          add(`competitor:${c.id}`, `Competitor: @${str(c.username)}`, str(c.profile_url) || `${base}/competitors/${str(c.id)}`);
        }
      }
      for (const s of scripts ?? []) {
        if (hit(`${str(s.title)} ${str(s.hook)} ${str(s.body)}`)) {
          add(`script:${s.id}`, `Script: ${str(s.title) || "(untitled)"}`, `${base}/scripts/${str(s.id)}`);
        }
      }

      // Reel-level matches, only when the query is specific enough to be worth
      // the extra per-competitor reads.
      if (q.length >= 3) {
        for (const c of (comps ?? []).slice(0, 8)) {
          const detail = await competitorDetail(identity, str(c.id)).catch(() => null);
          if (!detail) continue;
          for (const r of detail.posts ?? []) {
            if (hit(`${str(r.caption)} ${str(r.what_works)} ${str(r.video_analysis?.why_it_works)}`)) {
              add(
                `reel:${detail.id}:${r.id}`,
                `Reel by @${detail.username}${r.is_outlier ? ` (${r.outlier_multiple}x outlier)` : ""}: ${str(r.caption).slice(0, 50)}`,
                str(r.permalink) || `${base}/competitors/${detail.id}`,
              );
            }
            if (results.length >= 40) break;
          }
          if (results.length >= 40) break;
        }
      }

      return { results: results.slice(0, 25) };
    },
  },
  {
    name: "fetch",
    description:
      "Fetch the full content of one item returned by `search`, by its prefixed id (scheduled: / card: / competitor: / reel: / script:).",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Prefixed id from search results." } },
      required: ["id"],
    },
    annotations: READ,
    handler: async (identity, a, origin) => {
      const base = origin ?? configuredOrigin();
      const raw = str(a.id);
      const [kind, ...rest] = raw.split(":");

      if (kind === "scheduled") {
        const posts = await call<Array<Record<string, unknown>>>(identity, "/api/schedule");
        const p = (posts ?? []).find((x) => str(x.id) === rest[0]);
        if (!p) throw new Error("Scheduled post not found");
        return { id: raw, title: "Scheduled post", text: JSON.stringify(p, null, 2), url: str(p.permalink) || `${base}/schedule` };
      }
      if (kind === "card") {
        const board = await call<{ columns?: Array<{ cards?: Array<Record<string, unknown>> }> }>(identity, "/api/board");
        for (const col of board?.columns ?? []) {
          const c = (col.cards ?? []).find((x) => str(x.id) === rest[0]);
          if (c) return { id: raw, title: str(c.title) || "Card", text: JSON.stringify(c, null, 2), url: `${base}/board?card=${rest[0]}` };
        }
        throw new Error("Board card not found");
      }
      if (kind === "competitor") {
        const c = await competitorDetail(identity, rest[0]);
        const text = JSON.stringify(
          { id: c.id, username: c.username, display_name: c.display_name, analytics: c.analytics, reel_count: c.posts?.length ?? 0 },
          null,
          2,
        );
        return { id: raw, title: `Competitor @${c.username}`, text, url: c.profile_url || `${base}/competitors/${c.id}` };
      }
      if (kind === "reel") {
        const [competitorId, reelId] = rest;
        const c = await competitorDetail(identity, competitorId);
        const r = (c.posts ?? []).find((p) => p.id === reelId);
        if (!r) throw new Error("Reel not found");
        return {
          id: raw,
          title: `Reel by @${c.username}`,
          text: JSON.stringify(
            {
              metrics: { views: r.views, likes: r.likes, comments: r.comments, outlier_multiple: r.outlier_multiple, is_outlier: r.is_outlier },
              caption: r.caption,
              hashtags: r.hashtags,
              what_works: r.what_works,
              ai_watch: r.video_analysis,
              deep_analysis: r.content_analysis,
            },
            null,
            2,
          ),
          url: r.permalink || `${base}/competitors/${c.id}`,
        };
      }
      if (kind === "script") {
        const s = await call<Record<string, unknown>>(identity, "/api/scripts/[id]", { params: { id: rest[0] } });
        return { id: raw, title: `Script: ${str(s.title)}`, text: JSON.stringify(s, null, 2), url: `${base}/scripts/${rest[0]}` };
      }
      throw new Error(`Unknown id prefix: ${kind}. Expected scheduled:, card:, competitor:, reel: or script:.`);
    },
  },
];

export const TOOL_MAP: Record<string, McpTool> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
