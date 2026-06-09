import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const { name, color = "slate" } = await req.json();
    const maxPos = await db.boardColumn.aggregate({ where: { workspaceId: wsId }, _max: { position: true } });
    const col = await db.boardColumn.create({
      data: { workspaceId: wsId, name, color, position: (maxPos._max.position ?? 0) + 1 },
    });
    return NextResponse.json({ id: col.id, name: col.name, color: col.color, position: col.position, cards: [] }, { status: 201 });
  } catch (e) {
    console.error("[board columns POST]", e);
    return serverError();
  }
}
