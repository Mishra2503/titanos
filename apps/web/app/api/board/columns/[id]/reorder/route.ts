import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const col = await db.boardColumn.findFirst({ where: { id, workspaceId: wsId } });
    if (!col) return notFound("Column not found");

    const { card_ids } = await req.json();
    await Promise.all(
      (card_ids as string[]).map((cardId: string, index: number) =>
        db.boardCard.updateMany({
          where: { id: cardId, workspaceId: wsId },
          data: { columnId: id, position: index },
        }),
      ),
    );
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[reorder]", e);
    return serverError();
  }
}
