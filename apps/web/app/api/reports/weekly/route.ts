import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceInsights } from "@/lib/server/insights";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Weekly performance report: per-account stats for the last 7 days computed
// from live Instagram data, plus an AI-written executive summary.

const SYSTEM =
  "You are the head of analytics at a short-form social media agency in the AI/tech niche. You write sharp weekly performance reports for the team. You never use em dashes. You never fabricate metrics — only reference numbers in the data. Output clean markdown with short sections.";

const WEEK_MS = 7 * 86400000;

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const accounts = await getWorkspaceInsights(wsId);
    if (!accounts.length) return badRequest("no_accounts", "Connect at least one Instagram account first.");

    const since = Date.now() - WEEK_MS;
    const prevSince = Date.now() - 2 * WEEK_MS;

    const perAccount = accounts.map((a) => {
      const week = a.recent_posts.filter((p) => p.timestamp && new Date(p.timestamp).getTime() >= since);
      const prevWeek = a.recent_posts.filter((p) => {
        if (!p.timestamp) return false;
        const t = new Date(p.timestamp).getTime();
        return t >= prevSince && t < since;
      });
      const sum = (posts: typeof week, key: "reach" | "views" | "likes" | "comments" | "shares" | "saved") =>
        posts.reduce((s, p) => s + (p[key] ?? 0), 0);
      const top = [...week].sort((x, y) => (y.reach ?? 0) - (x.reach ?? 0))[0] ?? null;
      return {
        account_id: a.account_id,
        username: a.username,
        followers: a.followers,
        error: a.error,
        posts_published: week.length,
        reach: sum(week, "reach"),
        views: sum(week, "views"),
        likes: sum(week, "likes"),
        comments: sum(week, "comments"),
        shares: sum(week, "shares"),
        saves: sum(week, "saved"),
        prev_reach: sum(prevWeek, "reach"),
        prev_posts: prevWeek.length,
        top_post: top
          ? { caption: top.caption, reach: top.reach, views: top.views, likes: top.likes, comments: top.comments, permalink: top.permalink, engagement_rate: top.engagement_rate, avg_watch_time_sec: top.avg_watch_time_sec }
          : null,
        posts: week.map((p) => ({
          caption: p.caption, timestamp: p.timestamp, permalink: p.permalink,
          reach: p.reach, views: p.views, likes: p.likes, comments: p.comments,
          shares: p.shares, saved: p.saved, engagement_rate: p.engagement_rate,
          avg_watch_time_sec: p.avg_watch_time_sec,
        })),
      };
    });

    const dataLines = perAccount.map((a) => {
      const head = `@${a.username} (${a.followers ?? "?"} followers): ${a.posts_published} posts this week, reach ${a.reach} (prev week ${a.prev_reach}), views ${a.views}, likes ${a.likes}, comments ${a.comments}, shares ${a.shares}, saves ${a.saves}`;
      const posts = a.posts
        .map((p) => `   - "${(p.caption ?? "(no caption)").replace(/\s+/g, " ").slice(0, 90)}" [${p.timestamp?.slice(0, 16).replace("T", " ")}] reach ${p.reach ?? "?"}, views ${p.views ?? "?"}, er ${p.engagement_rate ?? "?"}%${p.avg_watch_time_sec != null ? `, watch ${p.avg_watch_time_sec}s` : ""}`)
        .join("\n");
      return head + (posts ? "\n" + posts : "\n   - (no posts this week)");
    });

    const prompt = [
      "WEEKLY DATA FOR ALL ACCOUNTS (last 7 days, with prior week reach for comparison). The first account is the MAIN account; the rest are satellite/distribution accounts meant to funnel audience to the main one.",
      "",
      ...dataLines,
      "",
      "Write this week's report with exactly these sections:",
      "1. **Week in one paragraph** — the honest headline of the week across the network.",
      "2. **Account by account** — for each account: 2-3 sentences on performance vs last week, what their best post did right (quote its hook), and one fix for next week.",
      "3. **What's trending in our content** — patterns across the network: topics, hooks, formats that pulled reach this week.",
      "4. **Next week's focus** — 4 concrete priorities for the network, distribution-first (how the satellites feed the main account).",
    ].join("\n");

    const { text } = await runClaude({ system: SYSTEM, prompt, maxTokens: 3072 });

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      range_days: 7,
      accounts: perAccount,
      summary: text,
    });
  } catch (e) {
    console.error("[weekly report]", e);
    return aiErrorResponse(e) ?? serverError("Weekly report failed — check server logs.");
  }
}
