import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import Anthropic from "@anthropic-ai/sdk";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// AI content strategist: turns the workspace's real post metrics + tracked
// competitor data into a concrete weekly content plan for the AI niche.

const SYSTEM =
  "You are the head of strategy at a top short-form social media marketing agency specializing in the AI/tech niche on Instagram. You turn real performance data into ruthless, concrete content plans. You never use em dashes. You never fabricate metrics — only reference numbers that appear in the data. Format output in clean markdown with short sections and bullet points. Be specific and actionable, never generic.";

interface PostIn {
  caption: string | null; reach: number | null; views: number | null; likes: number | null;
  comments: number | null; shares: number | null; saved: number | null;
  engagement_rate: number | null; avg_watch_time_sec: number | null;
  media_product_type: string | null; timestamp: string | null; hashtags: string[];
}

function postLine(p: PostIn): string {
  const hook = (p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim().slice(0, 110) || "(no caption)";
  const bits = [
    p.reach != null ? `reach ${p.reach}` : null,
    p.views != null ? `views ${p.views}` : null,
    p.likes != null ? `likes ${p.likes}` : null,
    p.comments != null ? `comments ${p.comments}` : null,
    p.shares != null ? `shares ${p.shares}` : null,
    p.saved != null ? `saves ${p.saved}` : null,
    p.engagement_rate != null ? `er ${p.engagement_rate}%` : null,
    p.avg_watch_time_sec != null ? `watch ${p.avg_watch_time_sec}s` : null,
    p.media_product_type,
    p.timestamp ? p.timestamp.slice(0, 10) : null,
  ].filter(Boolean).join(", ");
  return `- "${hook}" [${bits}]`;
}

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return badRequest("ai_not_configured", "Add ANTHROPIC_API_KEY to enable AI features");

    const { posts } = (await req.json().catch(() => ({}))) as { posts?: PostIn[] };
    if (!posts?.length) return badRequest("no_posts", "No post data available yet. Connect an account with published posts first.");

    const sorted = [...posts].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
    const top = sorted.slice(0, 12);
    const bottom = sorted.slice(-6).reverse();

    // Competitor context from tracked data (best-effort)
    const competitors = await db.competitor.findMany({
      where: { workspaceId: wsId },
      include: {
        snapshots: { orderBy: { capturedOn: "desc" }, take: 1 },
        posts: { orderBy: [{ likes: { sort: "desc", nulls: "last" } }], take: 5 },
      },
      take: 8,
    });
    const compLines = competitors.map((c) => {
      const s = c.snapshots[0];
      const tops = c.posts
        .map((p) => `"${(p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim().slice(0, 90)}" (${p.likes ?? "?"} likes, ${p.comments ?? "?"} comments)`)
        .join("; ");
      return `- @${c.username}${s?.followersCount ? ` (${s.followersCount} followers, ${s.engagementRate ?? "?"}% er)` : ""}${tops ? ` — top posts: ${tops}` : ""}`;
    });

    const prompt = [
      "OUR RECENT POSTS, BEST PERFORMERS FIRST (28-day window):",
      ...top.map(postLine),
      "",
      "OUR WEAKEST RECENT POSTS:",
      ...bottom.map(postLine),
      "",
      compLines.length ? "TRACKED COMPETITORS:\n" + compLines.join("\n") : "TRACKED COMPETITORS: none yet",
      "",
      "Produce this week's content strategy with exactly these sections:",
      "1. **What the data says** — 3-4 blunt observations comparing winners vs losers (hooks, format, topics, watch time).",
      "2. **5 reel ideas for this week** — for each: working title, spoken hook (under 12 words), visual hook for the first 2 seconds, and why the data supports it.",
      "3. **Posting plan** — which days/times to post based on the timestamps in the data.",
      "4. **Steal from competitors** — 2-3 angles competitors are winning with that we can adapt (skip if no competitor data).",
      "5. **Distribution checklist** — 5 concrete actions to multiply reach beyond the feed (collabs, trial reels, cross-posting, comment strategy, SEO captions).",
    ].join("\n");

    const client = new Anthropic({ apiKey });
    const model = process.env.ANTHROPIC_MODEL ?? "claude-opus-4-8";
    const msg = await client.messages.create({
      model,
      max_tokens: 2048,
      system: SYSTEM,
      messages: [{ role: "user", content: prompt }],
    });
    const text = msg.content.map((b) => ("text" in b ? b.text : "")).join("").trim();

    return NextResponse.json({ text, generated_at: new Date().toISOString() });
  } catch (e) {
    console.error("[ai strategy]", e);
    return serverError();
  }
}
