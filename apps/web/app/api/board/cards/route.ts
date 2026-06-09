import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { column_id, title, notes } = await req.json();
    const col = await db.boardColumn.findFirst({ where: { id: column_id, workspaceId: wsId } });
    if (!col) return notFound("Column not found");
    const maxPos = await db.boardCard.aggregate({ where: { columnId: column_id }, _max: { position: true } });
    const card = await db.boardCard.create({
      data: { workspaceId: wsId, columnId: column_id, title, notes, position: (maxPos._max.position ?? 0) + 1 },
    });
    return NextResponse.json(cardOut(card), { status: 201 });
  } catch (e) {
    console.error("[cards POST]", e);
    return serverError();
  }
}

function cardOut(c: { id: string; columnId: string; title: string; notes: string | null; position: number; emoji: string | null; status: string | null; platforms: unknown; publishDate: string | null; hook: string | null; visualHook: string | null; caption: string | null; hashtags: unknown; referenceUrl: string | null; rawFootageUrl: string | null; coverImageUrl: string | null }) {
  return {
    id: c.id, column_id: c.columnId, title: c.title, notes: c.notes, position: c.position,
    emoji: c.emoji, status: c.status, platforms: (c.platforms as string[]) ?? [],
    publish_date: c.publishDate, hook: c.hook, visual_hook: c.visualHook,
    caption: c.caption, hashtags: (c.hashtags as string[]) ?? [],
    reference_url: c.referenceUrl, raw_footage_url: c.rawFootageUrl, cover_image_url: c.coverImageUrl,
  };
}
