import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { runClaude, aiErrorResponse } from "@/lib/server/ai";
import { formatAnalysisForReport } from "@/lib/server/videoAnalysis";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const competitors = await db.competitor.findMany({ where: { workspaceId: wsId }, include: { snapshots: { orderBy: { capturedOn: "desc" }, take: 1 } } });
    if (!competitors.length) return badRequest("no_competitors", "Add at least one competitor first");

    // Top watched reels per competitor (the server downloaded and analyzed the
    // actual videos) — gives the strategist real hooks/formats, not just counts.
    const analyses = await db.videoAnalysis.findMany({
      where: { workspaceId: wsId, source: "COMPETITOR", status: "DONE", competitorPost: { competitorId: { in: competitors.map((c) => c.id) } } },
      include: { competitorPost: { select: { competitorId: true, views: true } } },
    });
    const byCompetitor = new Map<string, string[]>();
    for (const a of analyses.sort((x, y) => (y.competitorPost?.views ?? 0) - (x.competitorPost?.views ?? 0))) {
      const cid = a.competitorPost?.competitorId;
      const line = formatAnalysisForReport(a);
      if (!cid || !line) continue;
      const arr = byCompetitor.get(cid) ?? [];
      if (arr.length < 3) { arr.push(line); byCompetitor.set(cid, arr); }
    }

    const list = competitors.map((c) => {
      const head = `- @${c.username} (${c.category ?? "?"}): ${c.snapshots[0]?.followersCount ?? "?"} followers`;
      const watched = byCompetitor.get(c.id);
      return watched?.length ? `${head}\n${watched.map((w) => `    · watched reel: ${w}`).join("\n")}` : head;
    }).join("\n");
    const watchedNote = analyses.length
      ? "\n\nLines marked 'watched reel' come from the server downloading and analyzing the actual videos (frames + audio) — treat those hooks/formats as ground truth."
      : "";
    const prompt = `You are analysing the competitive landscape for an Instagram creator brand in the AI/tech niche. Here are the tracked competitors:\n\n${list}${watchedNote}\n\nProvide a cross-competitor strategic overview: market positioning, who is winning and why, key content patterns (use the watched reels' real hooks and formats where available), and the top 3 opportunities for differentiation. Be direct and actionable. Use clean markdown, no em dashes.`;

    const { text, model } = await runClaude({ system: "You are a sharp competitive strategist for a short-form social media agency.", prompt, maxTokens: 2048 });

    const report = await db.competitorReport.create({ data: { workspaceId: wsId, competitorId: null, title: "Competitor Landscape Overview", content: text, model, generatedAt: new Date(), createdBy: userId ?? null } });
    return NextResponse.json({ id: report.id, competitor_id: null, title: report.title, content: report.content, model: report.model, generated_at: report.generatedAt }, { status: 201 });
  } catch (e) {
    console.error("[overview report]", e);
    return aiErrorResponse(e) ?? serverError("Report generation failed — check server logs.");
  }
}
