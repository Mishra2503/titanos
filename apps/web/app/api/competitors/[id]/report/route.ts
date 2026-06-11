import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

// Deep competitor intelligence: tracked data (followers, posts, hooks,
// captions, hashtags, posting times) + live web market research → a concrete
// counter-strategy.

const SYSTEM =
  "You are a competitive intelligence analyst at a short-form social media agency in the AI/tech niche. You dissect competitor Instagram accounts and produce concrete counter-strategies. You never use em dashes. You never fabricate metrics — only cite numbers present in the data or found via web search (and say where they came from). Output clean markdown with short sections.";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const c = await db.competitor.findFirst({
      where: { id, workspaceId: wsId },
      include: {
        snapshots: { orderBy: { capturedOn: "desc" }, take: 10 },
        posts: { orderBy: [{ postedOn: { sort: "desc", nulls: "last" } }], take: 25 },
      },
    });
    if (!c) return notFound("Competitor not found");

    const snapLines = c.snapshots.map((s) =>
      `- ${s.capturedOn.toISOString().slice(0, 10)}: ${s.followersCount ?? "?"} followers, avg ${s.avgLikes ?? "?"} likes / ${s.avgComments ?? "?"} comments, er ${s.engagementRate ?? "?"}%`,
    );
    const postLines = c.posts.map((p) => {
      const caption = (p.caption ?? "").replace(/\s+/g, " ").trim().slice(0, 160) || "(no caption)";
      const tags = ((p.hashtags as string[]) ?? []).slice(0, 8).join(" ");
      const when = p.postedOn ? p.postedOn.toISOString().slice(0, 16).replace("T", " ") : "undated";
      return `- [${when}] "${caption}" | likes ${p.likes ?? "?"}, comments ${p.comments ?? "?"}${p.views != null ? `, views ${p.views}` : ""} | ${p.postType ?? "POST"}${tags ? ` | tags: ${tags}` : ""}`;
    });

    const prompt = [
      `COMPETITOR: @${c.username}${c.displayName ? ` (${c.displayName})` : ""}`,
      `Niche/category: ${c.category ?? "AI/tech"}`,
      `Operator notes: ${c.notes ?? "none"}`,
      "",
      "FOLLOWER SNAPSHOTS (newest first):",
      ...(snapLines.length ? snapLines : ["- none yet (sync to populate)"]),
      "",
      "RECENT POSTS WITH CAPTIONS, ENGAGEMENT, AND POSTING TIMES (newest first):",
      ...(postLines.length ? postLines : ["- none yet (sync to populate)"]),
      "",
      "TASK: Produce a deep competitive intelligence report. First, use web search (2-4 focused searches) to research this creator and the topics their top posts cover: are other AI-niche creators making the same content? Which formats of this topic are going viral right now? Then write exactly these sections:",
      "1. **Account snapshot** — growth trajectory, engagement health, posting cadence (compute from the timestamps), and best posting times you can infer.",
      "2. **What's working for them** — their top posts, the exact hooks (quote the opening line of the caption), the keywords/hashtags they ride, and why these are landing.",
      "3. **Market research** — what you found via web search: other creators making similar content, formats getting outsized views on this topic this month, and whitespace nobody is covering.",
      "4. **Hook bank** — 6 hook formulas extracted from their winners, rewritten so we can use them (under 12 words each).",
      "5. **Counter-strategy** — 5 concrete moves to outgrow them, including which of their topics to hit with better execution and which gaps to own.",
    ].join("\n");

    const { text, model } = await runClaude({
      system: SYSTEM,
      prompt,
      maxTokens: 4096,
      webSearch: true,
      maxSearches: 5,
    });

    const report = await db.competitorReport.create({
      data: { workspaceId: wsId, competitorId: id, title: `Deep analysis: @${c.username}`, content: text, model, generatedAt: new Date(), createdBy: userId ?? null },
    });
    return NextResponse.json({ id: report.id, competitor_id: report.competitorId, title: report.title, content: report.content, model: report.model, generated_at: report.generatedAt }, { status: 201 });
  } catch (e) {
    console.error("[competitor report]", e);
    return aiErrorResponse(e) ?? serverError("Report generation failed — check server logs.");
  }
}
