// MCP tool registry for Titan OS.
//
// Each tool is a THIN wrapper over an existing REST route (see internal-fetch.ts),
// so all validation, RBAC, safety (min-gap / future-time / account-connected), and
// the "Instagram Graph API only, never fabricate metrics" rails are enforced by the
// same code the web UI uses. Tools marked `write: true` require a token that
// `canWrite()` — the MCP route rejects them for read-only tokens / VIEWER users.

import type { TokenIdentity } from "@/lib/server/pat";
import { internalFetch, errorMessage } from "@/lib/server/mcp/internal-fetch";

// JSON Schema (draft-07-ish) — enough for MCP clients to render/validate inputs.
type JsonSchema = {
  type: "object";
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
};

export interface McpTool {
  name: string;
  description: string;
  inputSchema: JsonSchema;
  write?: boolean;
  handler: (identity: TokenIdentity, args: Record<string, unknown>, origin?: string) => Promise<unknown>;
}

const NO_ARGS: JsonSchema = { type: "object", properties: {}, additionalProperties: false };

// Call an internal route and throw a friendly error on failure.
async function call<T = unknown>(
  identity: TokenIdentity,
  path: string,
  init: { method?: string; body?: unknown; origin?: string } = {},
): Promise<T> {
  const r = await internalFetch<T>(identity, path, init);
  if (!r.ok) throw new Error(errorMessage(r));
  return r.data;
}

const enc = encodeURIComponent;

export const TOOLS: McpTool[] = [
  // ─────────────────────────── Scheduling & publishing ───────────────────────────
  {
    name: "list_connections",
    description:
      "List the Instagram accounts connected to this workspace (id, username, status, follower count). Use the returned account ids when scheduling posts.",
    inputSchema: NO_ARGS,
    handler: (id) => call(id, "/api/connections"),
  },
  {
    name: "list_media",
    description:
      "List uploaded media assets available for scheduling (id, thumbnail, type). Use a media asset id with schedule_posts.",
    inputSchema: NO_ARGS,
    handler: (id) => call(id, "/api/media"),
  },
  {
    name: "list_scheduled_posts",
    description:
      "List all scheduled/published posts for the workspace with status, caption, scheduled time, permalink and any error.",
    inputSchema: NO_ARGS,
    handler: (id) => call(id, "/api/schedule"),
  },
  {
    name: "schedule_posts",
    description:
      "Schedule one media asset to one or more connected Instagram accounts. Publishing happens automatically on the scheduler at the scheduled time — this does NOT publish immediately. Safety rails apply: times must be in the future and at least the workspace minimum-gap apart per account, or the call is rejected.",
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
    handler: (id, a) =>
      call(id, "/api/campaigns", {
        method: "POST",
        body: { media_asset_id: a.media_asset_id, title: a.title, posts: a.posts },
      }),
  },
  {
    name: "update_scheduled_post",
    description: "Edit a scheduled post's caption, hashtags, or scheduled time. Only works before it is published.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Scheduled post id from list_scheduled_posts." },
        caption: { type: "string" },
        hashtags: { type: "array", items: { type: "string" } },
        scheduled_at: { type: "string", description: "ISO 8601 datetime." },
      },
      required: ["id"],
    },
    write: true,
    handler: (id, a) =>
      call(id, `/api/schedule/${enc(String(a.id))}`, {
        method: "PATCH",
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
    handler: (id, a) => call(id, `/api/schedule/${enc(String(a.id))}/cancel`, { method: "POST" }),
  },
  {
    name: "retry_scheduled_post",
    description: "Retry a scheduled post that previously failed to publish.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Scheduled post id." } },
      required: ["id"],
    },
    write: true,
    handler: (id, a) => call(id, `/api/schedule/${enc(String(a.id))}/retry`, { method: "POST" }),
  },

  // ─────────────────────────────── Content board ─────────────────────────────────
  {
    name: "get_board",
    description: "Get the content board: all columns and their cards (ideas/drafts) in order.",
    inputSchema: NO_ARGS,
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
    handler: (id, a) =>
      call(id, "/api/board/cards", { method: "POST", body: { column_id: a.column_id, title: a.title, notes: a.notes } }),
  },
  {
    name: "update_card",
    description:
      "Update fields on a board card. Editable fields: title, notes, emoji, status, platforms, publish_date, hook, visual_hook, caption, hashtags, reference_url, raw_footage_url, cover_image_url.",
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
    handler: (id, a) => {
      const { id: cardId, ...fields } = a;
      return call(id, `/api/board/cards/${enc(String(cardId))}`, { method: "PATCH", body: fields });
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
    handler: async (id, a) => {
      await call(id, `/api/board/cards/${enc(String(a.id))}`, { method: "DELETE" });
      return { deleted: true, id: a.id };
    },
  },
  {
    name: "reorder_column",
    description:
      "Set the ordered list of card ids in a column. Moves cards into this column (a card id from another column is reassigned here) and orders them as given. Use this to move a card between columns.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        column_id: { type: "string", description: "Destination column id." },
        card_ids: { type: "array", items: { type: "string" }, description: "Final ordered list of card ids for the column." },
      },
      required: ["column_id", "card_ids"],
    },
    write: true,
    handler: async (id, a) => {
      await call(id, `/api/board/columns/${enc(String(a.column_id))}/reorder`, { method: "POST", body: { card_ids: a.card_ids } });
      return { reordered: true, column_id: a.column_id };
    },
  },
  {
    name: "run_card_ai",
    description:
      "Run Claude on a board card to generate content: 'hooks' (5 opening hooks), 'caption', 'hashtags', or 'refine' (tighten existing text). Returns the generated text.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        id: { type: "string", description: "Card id." },
        action: { type: "string", enum: ["hooks", "caption", "hashtags", "refine"] },
        instruction: { type: "string", description: "Optional extra instruction for the model." },
      },
      required: ["id", "action"],
    },
    write: true,
    handler: (id, a) =>
      call(id, `/api/board/cards/${enc(String(a.id))}/ai`, { method: "POST", body: { action: a.action, instruction: a.instruction } }),
  },

  // ─────────────────────────── Competitor intelligence ───────────────────────────
  {
    name: "list_competitors",
    description: "List tracked competitors with latest follower counts, engagement, and snapshot/post/report counts.",
    inputSchema: NO_ARGS,
    handler: (id) => call(id, "/api/competitors"),
  },
  {
    name: "get_competitor",
    description: "Get one competitor's detail including recent snapshots, posts, and reports.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    handler: (id, a) => call(id, `/api/competitors/${enc(String(a.id))}`),
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
    handler: (id, a) =>
      call(id, "/api/competitors", {
        method: "POST",
        body: { username: a.username, display_name: a.display_name, category: a.category, profile_url: a.profile_url, notes: a.notes },
      }),
  },
  {
    name: "sync_competitor",
    description: "Fetch the latest public profile snapshot and recent posts for a competitor from the Instagram Graph API.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    write: true,
    handler: (id, a) => call(id, `/api/competitors/${enc(String(a.id))}/sync`, { method: "POST" }),
  },
  {
    name: "analyze_competitor",
    description:
      "Run the reel-watching pipeline on a competitor's unanalyzed reels (transcribe + AI insights). Processes a batch per call; returns how many were analyzed and how many remain.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    write: true,
    handler: (id, a) => call(id, `/api/competitors/${enc(String(a.id))}/analyze`, { method: "POST" }),
  },
  {
    name: "generate_competitor_report",
    description: "Generate an AI strategic report for a single competitor from their snapshots and posts. Returns the report content.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: { id: { type: "string", description: "Competitor id." } },
      required: ["id"],
    },
    write: true,
    handler: (id, a) => call(id, `/api/competitors/${enc(String(a.id))}/report`, { method: "POST" }),
  },
  {
    name: "generate_competitors_overview",
    description: "Generate an AI cross-competitor landscape overview across all tracked competitors.",
    inputSchema: NO_ARGS,
    write: true,
    handler: (id) => call(id, "/api/competitors/report/overview", { method: "POST" }),
  },

  // ────────────────────────────── Insights & AI ──────────────────────────────────
  {
    name: "get_insights_summary",
    description:
      "Get the workspace insights summary per connected account (followers, reach, recent post metrics). Data comes only from the Instagram Graph API — never fabricate or extrapolate metrics beyond what this returns.",
    inputSchema: NO_ARGS,
    handler: (id) => call(id, "/api/insights/summary"),
  },
  {
    name: "generate_ai_strategy",
    description:
      "Generate an AI content strategy grounded in the workspace's real recent post performance. Optionally pass specific posts to focus on.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        posts: {
          type: "array",
          description: "Optional array of post objects to focus the strategy on. Omit to use the workspace's recent posts.",
          items: { type: "object" },
        },
      },
    },
    write: true,
    handler: (id, a) => call(id, "/api/ai/strategy", { method: "POST", body: { posts: a.posts } }),
  },
  {
    name: "generate_weekly_report",
    description:
      "Generate the weekly performance report across all connected accounts (this week vs last week), grounded in Instagram Graph API data.",
    inputSchema: NO_ARGS,
    write: true,
    handler: (id) => call(id, "/api/reports/weekly", { method: "POST" }),
  },
];

export const TOOL_MAP: Record<string, McpTool> = Object.fromEntries(TOOLS.map((t) => [t.name, t]));
