import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { aiErrorResponse } from "@/lib/server/ai";
import { rewriteScriptBody, serializeScript } from "@/lib/server/scripts";

// Instruction-driven rewrite of the current script body.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const script = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!script) return notFound("Script not found");

    const body = await req.json().catch(() => ({}));
    const instruction = typeof body?.instruction === "string" ? body.instruction : "";

    const { body: newBody, model } = await rewriteScriptBody(script.body, instruction);
    const updated = await db.script.update({ where: { id }, data: { body: newBody, model } });

    const c = script.competitorId
      ? await db.competitor.findFirst({ where: { id: script.competitorId, workspaceId: wsId }, select: { username: true } })
      : null;
    return NextResponse.json(serializeScript({ ...updated, competitorUsername: c?.username ?? null }));
  } catch (e) {
    console.error("[script rewrite]", e);
    return aiErrorResponse(e) ?? serverError(`Rewrite failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
