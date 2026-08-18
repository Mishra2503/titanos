// Output schemas for every Titan OS MCP tool.
//
// Why this file exists: MCP 2025-06-18 lets a tool declare `outputSchema`
// alongside `inputSchema`. When it does, the server must return the result as
// `structuredContent` - a real JSON object the client hands the model as DATA,
// not as a text blob the model has to re-parse out of prose. Without it, every
// client (ChatGPT flags this explicitly, Claude and Perplexity just degrade
// quietly) reads our results as free text and fills the gaps by guessing, which
// is how fields that do not exist in Titan OS end up in an answer.
//
// Two rules these schemas follow, both learned from strict clients:
//   1. The root is ALWAYS `type: "object"`. The spec forbids a bare array as
//      structuredContent, so array-returning tools are wrapped ({count, items}).
//   2. `additionalProperties` stays TRUE and `required` stays minimal. A schema
//      that over-promises turns a harmless extra field into a hard validation
//      failure on the client, which surfaces to the user as "the connector is
//      broken". Describe the shape; do not police it.
//
// Nullable fields use JSON Schema union types (`["string", "null"]`) because
// almost every Instagram metric is genuinely absent until a sync has run, and
// claiming otherwise makes validators reject honest data.

export type Schema = Record<string, unknown>;

// ── Primitive builders ────────────────────────────────────────────────────────

export const str = (description?: string): Schema => ({ type: "string", ...(description ? { description } : {}) });
export const num = (description?: string): Schema => ({ type: "number", ...(description ? { description } : {}) });
export const bool = (description?: string): Schema => ({ type: "boolean", ...(description ? { description } : {}) });

/** A string that is legitimately absent until some pipeline has filled it in. */
export const nstr = (description?: string): Schema => ({
  type: ["string", "null"],
  ...(description ? { description } : {}),
});
export const nnum = (description?: string): Schema => ({
  type: ["number", "null"],
  ...(description ? { description } : {}),
});

export const arr = (items: Schema, description?: string): Schema => ({
  type: "array",
  items,
  ...(description ? { description } : {}),
});

export const strs = (description?: string): Schema => arr({ type: "string" }, description);

/**
 * An object schema. Open by default - see rule 2 above. Pass `required` only
 * for fields the handler provably always sets.
 */
export const obj = (properties: Record<string, Schema>, opts: { required?: string[]; description?: string } = {}): Schema => ({
  type: "object",
  properties,
  additionalProperties: true,
  ...(opts.required?.length ? { required: opts.required } : {}),
  ...(opts.description ? { description: opts.description } : {}),
});

/**
 * A payload we deliberately pass through from an existing REST route whose
 * shape is owned elsewhere. Still an object, still self-describing, but it does
 * not pretend to enumerate fields it does not control.
 *
 * Only legal as the ROOT of an outputSchema, where MCP requires type "object".
 * For a nested field use passthroughRef, which also admits null.
 */
export const passthrough = (description: string): Schema => ({
  type: "object",
  description,
  additionalProperties: true,
  properties: {},
});

/**
 * Widen a schema to admit null.
 *
 * Every nested object in this file goes through here, and it is the single most
 * load-bearing line in the module. A reel that has not been watched yet has
 * `video_analysis: null`; a script written from scratch has `source_reel: null`.
 * Declaring those as plain objects makes a validating client reject the entire
 * tool result over a field that is honestly empty - which reads to the user as
 * a random, intermittent connector failure.
 */
export const nullable = (schema: Schema): Schema => {
  const t = schema.type;
  const types = Array.isArray(t) ? t : t === undefined ? [] : [t];
  return { ...schema, type: types.includes("null") ? types : [...types, "null"] };
};

/**
 * The nested form of passthrough: same open shape, but may legitimately be
 * null. Use this for any object-valued FIELD; `passthrough` is only correct at
 * the root of an outputSchema, where MCP requires a bare "object".
 */
export const passthroughRef = (description: string): Schema => nullable(passthrough(description));

/** `{ count, <key>: [...] }` - the wrapper every list tool returns. */
export const listOf = (key: string, item: Schema, description: string): Schema =>
  obj(
    {
      count: num("Number of items returned."),
      [key]: arr(item, description),
    },
    { required: ["count", key] },
  );

// ── Shared record shapes ──────────────────────────────────────────────────────

export const CONNECTION = obj({
  id: str("Connection id. Pass this as ig_account_id when scheduling."),
  ig_user_id: nstr("Instagram's own numeric user id."),
  username: nstr("Instagram handle, without the @."),
  account_type: nstr("BUSINESS or CREATOR."),
  status: nstr("CONNECTED, EXPIRED, or ERROR."),
  followers_count: nnum(),
  token_expires_at: nstr("ISO 8601. Refresh before this passes."),
  last_synced_at: nstr("ISO 8601."),
});

export const MEDIA_ASSET = obj({
  id: str("Media asset id. Pass this as media_asset_id when scheduling."),
  filename: nstr(),
  public_url: nstr(),
  thumbnail_url: nstr(),
  width: nnum(),
  height: nnum(),
  duration_s: nnum("Video length in seconds."),
  format: nstr(),
  size_bytes: nnum(),
  created_at: nstr("ISO 8601."),
  in_use: bool("True when this asset is already attached to a campaign."),
});

export const SCHEDULED_POST = obj({
  id: str("Scheduled post id."),
  status: nstr("SCHEDULED, PUBLISHING, PUBLISHED, FAILED, or CANCELLED."),
  caption: nstr(),
  hashtags: strs(),
  scheduled_at: nstr("ISO 8601, in the workspace timezone."),
  published_at: nstr("ISO 8601. Null until it actually publishes."),
  permalink: nstr("Live Instagram URL. Only present once published."),
  error: nstr("Failure reason. Null unless status is FAILED."),
});

export const BOARD_CARD = obj({
  id: str("Card id."),
  column_id: nstr("Column this card sits in."),
  title: nstr(),
  notes: nstr(),
  position: nnum("Order within its column."),
  emoji: nstr(),
  status: nstr(),
  platforms: strs("Where this is meant to publish."),
  publish_date: nstr("Planned publish date, if set."),
  hook: nstr("The opening line of the reel."),
  visual_hook: nstr("What is on screen in the first seconds."),
  caption: nstr(),
  hashtags: strs(),
  reference_url: nstr("Source reel or inspiration."),
  raw_footage_url: nstr(),
  cover_image_url: nstr(),
  scripted_at: nstr("ISO 8601. Set once a script exists for this card."),
  tags: strs(),
  video_analysis: nullable(obj(
    {
      status: nstr("DONE, PENDING, FAILED, or NONE."),
      summary: nstr(),
      transcript: nstr(),
      hook_visual: nstr(),
      hook_spoken: nstr(),
      format: nstr(),
      why_it_works: nstr(),
    },
    { description: "Present when this card came from a reel that has been watched. Null otherwise." },
  )),
});

/** One script in full, as the scripts API serialises it. */
export const SCRIPT = obj(
  {
    id: str("Script id."),
    competitor_id: nstr("Source competitor, when the script came from a reel."),
    competitor_post_id: nstr("Source reel."),
    competitor_username: nstr(),
    title: nstr(),
    status: nstr("DRAFT, APPROVED, or similar."),
    source_reel: passthroughRef("The reel this was written from, when there is one."),
    research: passthroughRef("Live research gathered while writing, when the tool used it."),
    hook: nstr("The opening line."),
    body: nstr("The full script text."),
    caption: nstr(),
    hashtags: strs(),
    model: nstr("Model that wrote it."),
    board_card_id: nstr("Set once approved and pushed to the board."),
    created_at: nstr("ISO 8601."),
    updated_at: nstr("ISO 8601."),
  },
  { required: ["id"] },
);

export const BOARD_COLUMN = obj({
  id: str("Column id. Pass this as column_id to create_card."),
  name: nstr(),
  color: nstr(),
  position: nnum(),
  cards: arr(BOARD_CARD, "Cards in this column, in board order."),
});

export const COMPETITOR_ROW = obj({
  id: str("Competitor id."),
  username: str("Instagram handle, without the @."),
  display_name: nstr(),
  category: nstr(),
  profile_url: nstr(),
  latest_followers: nnum("Follower count at the most recent snapshot."),
  avg_engagement_rate: nnum(),
  follower_delta: nnum("Change since the previous snapshot."),
  snapshot_count: nnum(),
  post_count: nnum("Reels stored for this competitor."),
  report_count: nnum(),
});

export const REEL_SUMMARY = obj({
  reel_id: str("Pass this to get_reel or analyze_reel."),
  permalink: nstr("Public Instagram URL."),
  post_type: nstr("REEL, IMAGE, or CAROUSEL."),
  posted_on: nstr("Date the competitor published it."),
  views: nnum("Real view count from the stored scrape. Never estimated."),
  likes: nnum(),
  comments: nnum(),
  engagement: nnum("Likes plus comments, as stored."),
  outlier_multiple: nnum("How many times this reel beat the account's own median."),
  is_outlier: bool("True when outlier_multiple is 2 or more."),
  caption: nstr("Truncated. Call get_reel for the full text."),
  hashtags: strs(),
  what_works: nstr("Short stored verdict."),
  why_it_works: nstr("From the AI watch pass, if it has run."),
  format: nstr("Reel format the AI identified, e.g. talking head, b-roll voiceover."),
  analysis_status: str("DONE, PENDING, FAILED, or NONE."),
  has_transcript: bool(),
  scripted: bool("True when a script has already been written from this reel."),
  board_card_id: nstr("Set once this reel has been sent to the content board."),
});

export const SCRIPT_SUMMARY = obj({
  script_id: str("Pass this to get_script."),
  title: nstr(),
  status: nstr("DRAFT, APPROVED, or similar."),
  competitor_username: nstr("Source competitor, when the script came from a reel."),
  hook: nstr(),
  updated_at: nstr("ISO 8601."),
  body_preview: nstr("Truncated. Call get_script for the full text."),
});

// ── Jobs ──────────────────────────────────────────────────────────────────────

export const JOB_STARTED = obj(
  {
    job_id: str("Pass this to get_job_status."),
    tool: str("The tool that started this work."),
    status: str("Always 'running' at this point."),
    note: str("How to poll for the result."),
  },
  { required: ["job_id", "status"] },
);

export const JOB_VIEW = obj(
  {
    job_id: str(),
    tool: str(),
    status: str("running, done, or failed."),
    result: passthroughRef("The tool's full result. Present only once status is 'done'."),
    error: nstr("Present only when status is 'failed'."),
    started_at: nstr("ISO 8601."),
    finished_at: nstr("ISO 8601."),
    note: nstr("Polling guidance while still running."),
  },
  { required: ["job_id", "status"] },
);

// ── Generic acknowledgements ──────────────────────────────────────────────────

export const ACK = (what: string): Schema =>
  obj({ ok: bool("True when the action completed."), id: nstr("Id of the affected record."), detail: nstr() }, { description: what });
