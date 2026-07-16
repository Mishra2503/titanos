import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { serializeCard } from "@/lib/server/board";

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
    return NextResponse.json(serializeCard(card), { status: 201 });
  } catch (e) {
    console.error("[cards POST]", e);
    return serverError();
  }
}
