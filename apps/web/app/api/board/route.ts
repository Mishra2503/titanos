import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";
import { serializeCard } from "@/lib/server/board";

const DEFAULT_COLUMNS = [
  { name: "Ideas", color: "slate" },
  { name: "In progress", color: "amber" },
  { name: "Editing", color: "rose" },
  { name: "Ready to post", color: "emerald" },
  { name: "Scheduled", color: "sky" },
];

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    // Seed default columns on first open
    const count = await db.boardColumn.count({ where: { workspaceId: wsId } });
    if (count === 0) {
      await db.boardColumn.createMany({
        data: DEFAULT_COLUMNS.map((c, i) => ({ workspaceId: wsId, ...c, position: i })),
      });
    }

    const [columns, cards] = await Promise.all([
      db.boardColumn.findMany({ where: { workspaceId: wsId }, orderBy: { position: "asc" } }),
      db.boardCard.findMany({
        where: { workspaceId: wsId },
        orderBy: { position: "asc" },
        include: { videoAnalysis: { select: { status: true, summary: true, analysis: true, transcript: true, analyzedAt: true, error: true } } },
      }),
    ]);

    const cardsByColumn = new Map<string, typeof cards>();
    for (const card of cards) {
      const arr = cardsByColumn.get(card.columnId) ?? [];
      arr.push(card);
      cardsByColumn.set(card.columnId, arr);
    }

    return NextResponse.json({
      columns: columns.map((col) => ({
        id: col.id, name: col.name, color: col.color, position: col.position,
        cards: (cardsByColumn.get(col.id) ?? []).map(serializeCard),
      })),
    });
  } catch (e) {
    console.error("[board GET]", e);
    return serverError();
  }
}
