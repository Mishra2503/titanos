import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import Anthropic from "@anthropic-ai/sdk";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();

    const competitors = await db.competitor.findMany({ where: { workspaceId: wsId }, include: { snapshots: { orderBy: { capturedOn: "desc" }, take: 1 } } });
    if (!competitors.length) return badRequest("no_competitors", "Add at least one competitor first");

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return badRequest("ai_not_configured", "Add ANTHROPIC_API_KEY to enable AI features");

    const list = competitors.map((c) => `- @${c.username} (${c.category ?? "?"}): ${c.snapshots[0]?.followersCount ?? "?"} followers`).join("\n");
    const prompt = `You are analysing the competitive landscape for an Instagram creator brand. Here are the tracked competitors:\n\n${list}\n\nProvide a cross-competitor strategic overview: market positioning, who is winning and why, key content patterns, and the top 3 opportunities for differentiation. Be direct and actionable.`;

    const client = new Anthropic({ apiKey });
    const msg = await client.messages.create({ model: process.env.ANTHROPIC_MODEL ?? "claude-opus-4-7", max_tokens: 1800, messages: [{ role: "user", content: prompt }] });
    const content = msg.content.map((b) => ("text" in b ? b.text : "")).join("").trim();

    const report = await db.competitorReport.create({ data: { workspaceId: wsId, competitorId: null, title: "Competitor Landscape Overview", content, model: msg.model, generatedAt: new Date(), createdBy: userId ?? null } });
    return NextResponse.json({ id: report.id, competitor_id: null, title: report.title, content: report.content, model: report.model, generated_at: report.generatedAt }, { status: 201 });
  } catch (e) {
    console.error("[overview report]", e);
    return serverError();
  }
}
