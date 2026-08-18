const COMPETITOR = {
  id: "c1", username: "creatorone", display_name: "Creator One", category: "AI",
  profile_url: "https://instagram.com/creatorone", avatar_url: null, notes: null,
  snapshots: [{ at: "2026-08-01", followers: 51000 }],
  analytics: { median_views: 42000, outlier_metric: "views", posts_per_week: 4.2 },
  reports: [{ id: "r1", title: "August read", content: "Long body ".repeat(60), model: "claude", generated_at: "2026-08-10" }],
  posts: [
    { id: "p1", permalink: "https://instagram.com/reel/p1", post_type: "REEL", caption: "hook test reel",
      hashtags: ["#ai"], likes: 900, comments: 40, views: 120000, posted_on: "2026-08-09", posted_at: "2026-08-09T10:00:00Z",
      thumbnail_url: null, video_url: null, what_works: "Strong cold open", engagement: 940,
      outlier_multiple: 2.9, is_outlier: true,
      video_analysis: { status: "DONE", summary: "s", transcript: "t".repeat(50), hook_visual: "hv", hook_spoken: "hs", format: "talking head", why_it_works: "tension" },
      content_analysis: null, tags: [], used: false, scripted: false, board_card_id: null },
    { id: "p2", permalink: null, post_type: "REEL", caption: "quiet one", hashtags: [], likes: 10, comments: 1,
      views: 3000, posted_on: "2026-08-02", posted_at: "2026-08-02T10:00:00Z", thumbnail_url: null, video_url: null,
      what_works: null, engagement: 11, outlier_multiple: 0.1, is_outlier: false, video_analysis: null,
      content_analysis: null, tags: [], used: false, scripted: false, board_card_id: null },
  ],
};

const DATA = {
  "/api/connections": [{ id: "a1", ig_user_id: "9", username: "ours", account_type: "BUSINESS", status: "CONNECTED", followers_count: 8100, token_expires_at: null, last_synced_at: null, capacity: null }],
  "/api/media": [{ id: "m1", filename: "reel.mp4", public_url: "https://x/1.mp4", thumbnail_url: null, width: 1080, height: 1920, duration_s: 21, format: "mp4", size_bytes: 900, created_at: "2026-08-01", uploaded_by_email: null, in_use: false, usage: {} }],
  "/api/schedule": [{ id: "s1", status: "SCHEDULED", caption: "launch day", hashtags: ["#ai"], scheduled_at: "2026-08-20T09:00:00Z", published_at: null, permalink: null, error: null }],
  "/api/board": { columns: [{ id: "col1", name: "Ideas", color: "#fff", position: 0, cards: [{ id: "cd1", column_id: "col1", title: "Cold open test", notes: null, position: 0, emoji: null, status: "IDEA", platforms: [], publish_date: null, hook: null, visual_hook: null, caption: null, hashtags: [], reference_url: null, raw_footage_url: null, cover_image_url: null, scripted_at: null, tags: [], video_analysis: null }] }] },
  "/api/competitors": [{ id: "c1", username: "creatorone", display_name: "Creator One", category: "AI", profile_url: null, latest_followers: 51000, avg_engagement_rate: 0.02, follower_delta: 400, follower_delta_pct: 0.8, snapshot_count: 1, post_count: 2, report_count: 1 }],
  "/api/competitors/[id]": COMPETITOR,
  "/api/scripts": [{ id: "sc1", title: "Cold open", status: "DRAFT", competitor_username: "creatorone", hook: "Stop scrolling", body: "Body ".repeat(90), updated_at: "2026-08-15" }],
  "/api/scripts/[id]": { id: "sc1", competitor_id: "c1", competitor_post_id: "p1", competitor_username: "creatorone", title: "Cold open", status: "DRAFT", source_reel: null, research: null, hook: "Stop scrolling", body: "Body", caption: "cap", hashtags: [], model: "claude", board_card_id: null, created_at: "2026-08-15T00:00:00.000Z", updated_at: "2026-08-15T00:00:00.000Z" },
  "/api/workspace": { id: "w1", name: "Titan", plan: "PRO", member_count: 2, connection_count: 1, connection_limit: 10 },
  "/api/safety/health": { defaults: { enabled: true, daily_cap: 3, hourly_cap: 1, min_gap_minutes: 90, jitter_seconds: 90 }, accounts: [] },
  "/api/videos/status": { counts: { PENDING: 1, DONE: 8 }, recent_errors: [] },
  "/api/insights/summary": { generated_at: "2026-08-18T00:00:00.000Z", range_days: 28, kpis: [{ key: "reach", label: "Reach", value: 12000, unit: null, available: true, note: null }], accounts: [] },
  "/api/board/cards/[id]/ai": { action: "hooks", text: "1. Stop scrolling" },
  "/api/board/cards": { id: "cd2", column_id: "col1", title: "New idea", notes: null, position: 1, emoji: null, status: "IDEA", platforms: [], publish_date: null, hook: null, visual_hook: null, caption: null, hashtags: [], reference_url: null, raw_footage_url: null, cover_image_url: null, scripted_at: null, tags: [], video_analysis: null },
  "/api/campaigns": { id: "camp1" },
  "/api/competitors/[id]/posts/[postId]/board": { card: { id: "cd9", column_id: "col1", title: "From reel", notes: null, position: 2, emoji: null, status: "IDEA", platforms: [], publish_date: null, hook: null, visual_hook: null, caption: null, hashtags: [], reference_url: null, raw_footage_url: null, cover_image_url: null, scripted_at: null, tags: [], video_analysis: null }, card_id: "cd9", column_id: "col1", already: false },
  // Routes that legitimately answer 204 with no body.
  "/api/schedule/[id]/cancel": null,
  "/api/connections/[id]/refresh": { ok: true },
};

export async function call(_identity, key) {
  if (!(key in DATA)) throw new Error(`stub has no canned payload for ${key}`);
  return DATA[key];
}
export async function callRoute(i, key) { return { ok: true, status: 200, data: await call(i, key) }; }
export function errorMessage() { return "stub error"; }
