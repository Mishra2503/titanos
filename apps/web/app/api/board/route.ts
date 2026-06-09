import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

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
      db.boardCard.findMany({ where: { workspaceId: wsId }, orderBy: { position: "asc" } }),
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
        cards: (cardsByColumn.get(col.id) ?? []).map(cardOut),
      })),
    });
  } catch (e) {
    console.error("[board GET]", e);
    return serverError();
  }
}

function cardOut(c: { id: string; columnId: string; title: string; notes: string | null; position: number; emoji: string | null; status: string | null; platforms: unknown; publishDate: string | null; hook: string | null; visualHook: string | null; caption: string | null; hashtags: unknown; referenceUrl: string | null; rawFootageUrl: string | null; coverImageUrl: string | null }) {
  return {
    id: c.id, column_id: c.columnId, title: c.title, notes: c.notes, position: c.position,
    emoji: c.emoji, status: c.status,
    platforms: (c.platforms as string[]) ?? [],
    publish_date: c.publishDate, hook: c.hook, visual_hook: c.visualHook,
    caption: c.caption, hashtags: (c.hashtags as string[]) ?? [],
    reference_url: c.referenceUrl, raw_footage_url: c.rawFootageUrl, cover_image_url: c.coverImageUrl,
  };
}
