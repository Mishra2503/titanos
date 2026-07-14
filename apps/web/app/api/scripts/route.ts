import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";
import { serializeScript } from "@/lib/server/scripts";

// List all scripts in the workspace (newest first) for the Scriptwriter tab.
export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const scripts = await db.script.findMany({
      where: { workspaceId: wsId },
      orderBy: { updatedAt: "desc" },
    });

    // Attach competitor usernames (competitorId is a plain ref, not a relation).
    const ids = [...new Set(scripts.map((s) => s.competitorId).filter((v): v is string => !!v))];
    const comps = ids.length
      ? await db.competitor.findMany({ where: { id: { in: ids }, workspaceId: wsId }, select: { id: true, username: true } })
      : [];
    const nameById = new Map(comps.map((c) => [c.id, c.username]));

    return NextResponse.json(
      scripts.map((s) => serializeScript({ ...s, competitorUsername: s.competitorId ? nameById.get(s.competitorId) ?? null : null })),
    );
  } catch (e) {
    console.error("[scripts list]", e);
    return serverError();
  }
}
