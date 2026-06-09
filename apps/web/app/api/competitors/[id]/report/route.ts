import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import Anthropic from "@anthropic-ai/sdk";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const c = await db.competitor.findFirst({ where: { id, workspaceId: wsId }, include: { snapshots: true, posts: true } });
    if (!c) return notFound("Competitor not found");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return badRequest("ai_not_configured", "Add ANTHROPIC_API_KEY to enable AI features");

    const prompt = `Analyse this Instagram competitor account for a creator brand operator:\n\nUsername: @${c.username}\nCategory: ${c.category ?? "unknown"}\nNotes: ${c.notes ?? "none"}\nSnapshots: ${c.snapshots.length}\nPosts tracked: ${c.posts.length}\n\nProvide a strategic analysis: what's working for them, growth trends, content strategy, and 3 actionable ideas for how to compete. Be specific and concise.`;

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({ model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7", max_tokens: 1500, messages: [{ role: "user", content: prompt }] });
    const content = msg.content.map((b) => ("text" in b ? b.text : "")).join("").trim();

    const report = await db.competitorReport.create({ data: { workspaceId: wsId, competitorId: id, title: `Analysis: @${c.username}`, content, model: msg.model, generatedAt: new Date(), createdBy: userId ?? null } });
    return NextResponse.json({ id: report.id, competitor_id: report.competitorId, title: report.title, content: report.content, model: report.model, generated_at: report.generatedAt }, { status: 201 });
  } catch (e) {
    console.error("[competitor report]", e);
    return serverError();
  }
}
