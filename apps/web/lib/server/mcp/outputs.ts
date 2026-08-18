// One output schema per MCP tool, keyed by tool name.
//
// Kept out of tools.ts on purpose: the tool table is already long, and this map
// is the part an MCP client reads to decide how to hand our data to the model.
// Every entry here has a matching `outputSchema: OUT.<name>` in tools.ts, and
// the shape it describes is what that tool's handler actually returns - the
// contract is only worth anything if it is true.
//
// The one hard rule from the spec: a root schema is always an object. Tools that
// used to hand back a bare array now wrap it as `{ count, <plural key> }`, both
// because a bare array is illegal as structuredContent and because the count
// tells the model straight away whether it is looking at everything or a page.

import {
  ACK,
  BOARD_CARD,
  BOARD_COLUMN,
  COMPETITOR_ROW,
  CONNECTION,
  JOB_STARTED,
  JOB_VIEW,
  MEDIA_ASSET,
  REEL_SUMMARY,
  SCHEDULED_POST,
  SCRIPT,
  SCRIPT_SUMMARY,
  arr,
  bool,
  listOf,
  nnum,
  nstr,
  nullable,
  num,
  obj,
  passthrough,
  passthroughRef,
  str,
  strs,
  type Schema,
} from "@/lib/server/mcp/schemas";

const ANALYTICS = passthroughRef(
  "Computed analytics for this competitor: follower growth, posts per week, content mix, top hashtags, median views, outlier reels. Every number is derived from stored snapshots and scrapes.",
);

export const OUT: Record<string, Schema> = {
  // ── Scheduling & publishing ──────────────────────────────────────────────
  list_connections: listOf("connections", CONNECTION, "Instagram accounts connected to this workspace."),

  refresh_connection: obj({
    ok: bool("True when the token and profile were refreshed."),
    id: str("Connection id that was refreshed."),
  }),

  list_media: listOf("media", MEDIA_ASSET, "Uploaded assets available for scheduling."),

  list_scheduled_posts: obj(
    {
      count: num("Total scheduled and published posts in the workspace."),
      posts: arr(SCHEDULED_POST, "The slice returned, newest first."),
    },
    { required: ["count", "posts"] },
  ),

  schedule_posts: obj(
    {
      id: str("Campaign id grouping the posts that were scheduled."),
      scheduled: num("How many posts were created."),
    },
    { description: "Nothing has published yet. The scheduler publishes each post at its own time." },
  ),

  update_scheduled_post: SCHEDULED_POST,

  cancel_scheduled_post: ACK("The post was cancelled and will not publish."),

  retry_scheduled_post: ACK("The failed post was queued for another publish attempt."),

  // ── Content board ────────────────────────────────────────────────────────
  get_board: obj(
    { columns: arr(BOARD_COLUMN, "Board columns in display order, each with its cards.") },
    { required: ["columns"] },
  ),

  create_card: BOARD_CARD,

  update_card: BOARD_CARD,

  delete_card: obj({ deleted: bool(), id: str("Id of the card that was removed.") }, { required: ["deleted", "id"] }),

  reorder_column: obj(
    { reordered: bool(), column_id: str("Column whose order was set.") },
    { required: ["reordered", "column_id"] },
  ),

  run_card_ai: obj(
    {
      action: str("Which action ran: hooks, caption, hashtags, or refine."),
      text: str("The generated text. This is the whole result - there is no separate field to fetch."),
    },
    { required: ["action", "text"] },
  ),

  get_card_analysis: passthrough("The stored AI analysis for this card, or an empty result when none has been run."),

  analyze_card: JOB_STARTED,
  generate_card_script: JOB_STARTED,

  // ── Competitor intelligence ──────────────────────────────────────────────
  list_competitors: listOf("competitors", COMPETITOR_ROW, "Competitors tracked in this workspace."),

  get_competitor: obj({
    id: str(),
    username: str("Instagram handle, without the @."),
    display_name: nstr(),
    category: nstr(),
    profile_url: nstr(),
    notes: nstr(),
    analytics: ANALYTICS,
    counts: obj({
      reels: num("Reels stored for this competitor."),
      snapshots: num(),
      reports: num(),
      analyzed_reels: num("Reels the video analyzer has finished watching."),
    }),
    next_steps: str("Which tool to call next to go deeper."),
  }),

  get_competitor_analytics: obj({
    competitor_id: str(),
    username: str(),
    analytics: ANALYTICS,
  }),

  list_competitor_reels: obj({
    competitor_id: str(),
    username: str(),
    outlier_metric: nstr("Which metric outlier_multiple is measured against, usually views."),
    median_views: nnum("This account's own median. Outliers are measured against it, not against other accounts."),
    total_reels: num("Reels stored for this competitor before filtering."),
    returned: num("How many are in this response."),
    reels: arr(REEL_SUMMARY, "Reels in the requested sort order."),
  }),

  get_reel: obj({
    competitor: obj({ id: str(), username: str() }),
    reel_id: str(),
    permalink: nstr(),
    post_type: nstr(),
    posted_on: nstr(),
    metrics: obj(
      {
        views: nnum(),
        likes: nnum(),
        comments: nnum(),
        engagement: nnum(),
        outlier_multiple: nnum(),
        is_outlier: bool(),
      },
      { description: "Real stored numbers. Null means not captured, never zero by default." },
    ),
    caption: nstr("Full caption."),
    hashtags: strs(),
    what_works: nstr(),
    ai_watch: nullable(obj(
      {
        status: str("DONE, PENDING, FAILED, or NONE."),
        summary: nstr(),
        hook_spoken: nstr("The first line said out loud."),
        hook_visual: nstr("What is on screen in the first seconds."),
        format: nstr(),
        why_it_works: nstr(),
        transcript: nstr("Full transcript, truncated past 12000 characters."),
        note: nstr("Present when the reel has not been analyzed yet."),
      },
      { description: "What the video analyzer found after watching the reel. status NONE means it has not run." },
    )),
    deep_analysis: passthroughRef("Hook/body/CTA breakdown from analyze_reel, when it has been run."),
    tags: strs(),
    scripted: bool(),
    board_card_id: nstr(),
  }),

  list_competitor_snapshots: obj({
    competitor_id: str(),
    username: str(),
    snapshots: arr(
      passthrough("One follower/engagement reading with its timestamp."),
      "Newest first.",
    ),
  }),

  list_competitor_reports: obj({
    competitor_id: str(),
    username: str(),
    reports: arr(
      obj({
        report_id: str("Pass this to get_competitor_report."),
        title: nstr(),
        model: nstr("Model that wrote it."),
        generated_at: nstr("ISO 8601."),
        preview: nstr("First 300 characters only."),
      }),
      "Stored reports, without their bodies.",
    ),
  }),

  get_competitor_report: obj({
    competitor_id: str(),
    username: str(),
    id: str("Report id."),
    title: nstr(),
    content: str("The full report text."),
    model: nstr(),
    generated_at: nstr("ISO 8601."),
  }),

  add_competitor: COMPETITOR_ROW,

  sync_competitor: JOB_STARTED,
  analyze_reel: JOB_STARTED,
  get_competitor_window_insights: JOB_STARTED,

  send_reel_to_board: obj({
    card_id: str("The board card that now represents this reel."),
    column_id: str(),
    already: bool("True when the reel was already on the board and nothing new was created."),
    card: nullable(BOARD_CARD),
  }),

  generate_competitor_report: JOB_STARTED,
  generate_competitors_overview: JOB_STARTED,

  // ── Scripts ──────────────────────────────────────────────────────────────
  list_scripts: obj(
    { count: num(), scripts: arr(SCRIPT_SUMMARY, "Newest first.") },
    { required: ["count", "scripts"] },
  ),

  get_script: SCRIPT,

  update_script: SCRIPT,

  generate_script_from_reel: JOB_STARTED,
  rewrite_script: JOB_STARTED,
  regenerate_script: JOB_STARTED,

  approve_script: obj({
    script: nullable(SCRIPT),
    card_id: str("Board card created for it."),
    column_id: str(),
  }),

  // ── Our own performance ──────────────────────────────────────────────────
  get_insights_summary: obj({
    generated_at: str("ISO 8601."),
    range_days: num("Window these numbers cover."),
    kpis: arr(
      obj({
        key: str(),
        label: str(),
        value: nnum("Null when the metric is not available. Do NOT substitute a guess."),
        unit: nstr(),
        available: bool("False means Instagram did not return this metric, not that it is zero."),
        note: nstr("Why it is unavailable, when it is."),
      }),
      "Headline metrics straight from the Instagram Graph API.",
    ),
    accounts: arr(passthrough("Per-account insight rows."), "One entry per connected account."),
  }),

  analyze_own_content: JOB_STARTED,
  generate_ai_strategy: JOB_STARTED,
  generate_weekly_report: JOB_STARTED,

  get_video_analysis_status: obj({
    counts: passthroughRef("Queue depth by status: PENDING, PROCESSING, DONE, FAILED."),
    recent_errors: arr(
      obj({ source: nstr(), error: nstr(), at: nstr("ISO 8601.") }),
      "Most recent analyzer failures.",
    ),
  }),

  get_workspace: obj({
    id: str(),
    name: str(),
    plan: nstr(),
    member_count: nnum(),
    connection_count: nnum(),
    connection_limit: nnum(),
  }),

  get_safety_health: obj({
    defaults: obj({
      enabled: bool(),
      daily_cap: num("Max posts per account per day."),
      hourly_cap: num(),
      min_gap_minutes: num("Minimum spacing between posts on one account."),
      jitter_seconds: num(),
    }),
    accounts: arr(passthrough("Per-account rate-limit state."), "Check before bulk scheduling."),
  }),

  // ── Jobs ─────────────────────────────────────────────────────────────────
  get_job_status: JOB_VIEW,

  list_jobs: obj({ count: num(), jobs: arr(JOB_VIEW, "Newest first.") }, { required: ["count", "jobs"] }),

  // ── Generic search/fetch (ChatGPT and Perplexity connector contract) ──────
  // These two shapes are fixed by those clients. Renaming a field here breaks
  // deep research on both, so they stay exactly as specified.
  search: obj(
    {
      results: arr(
        obj(
          {
            id: str("Prefixed id. Pass it straight to fetch."),
            title: str("Human-readable label for the match."),
            url: str("Where a person can see this item."),
          },
          { required: ["id", "title", "url"] },
        ),
        "Matches across scheduled posts, board cards, competitors, reels, and scripts.",
      ),
    },
    { required: ["results"] },
  ),

  fetch: obj(
    {
      id: str("The same prefixed id that was requested."),
      title: str(),
      text: str("Full content of the item, as JSON text."),
      url: str(),
      metadata: passthroughRef("Item type and any extra context."),
    },
    { required: ["id", "title", "text", "url"] },
  ),
};
