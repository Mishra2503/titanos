import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { serializeScript } from "@/lib/server/scripts";

// Approve a script → drop it onto the Content Board's "Ideas" column as a
// ready-to-shoot card (title + full script + hook + caption + hashtags), and
// mark the script APPROVED.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const script = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!script) return notFound("Script not found");

    // Find (or create) the "Ideas" column.
    let column = await db.boardColumn.findFirst({
      where: { workspaceId: wsId, name: { equals: "Ideas", mode: "insensitive" } },
    });
    if (!column) {
      const minPos = await db.boardColumn.aggregate({ where: { workspaceId: wsId }, _min: { position: true } });
      column = await db.boardColumn.create({
        data: { workspaceId: wsId, name: "Ideas", color: "slate", position: (minPos._min.position ?? 0) - 1 },
      });
    }

    const snap = (script.sourceReel ?? {}) as { permalink?: string | null };
    const maxPos = await db.boardCard.aggregate({ where: { columnId: column.id }, _max: { position: true } });
    const card = await db.boardCard.create({
      data: {
        workspaceId: wsId,
        columnId: column.id,
        title: script.title,
        notes: script.body,
        hook: script.hook,
        caption: script.caption,
        hashtags: (script.hashtags as string[]) ?? [],
        status: "Idea",
        referenceUrl: snap.permalink ?? null,
        position: (maxPos._max.position ?? 0) + 1,
      },
    });

    const updated = await db.script.update({
      where: { id },
      data: { status: "APPROVED", boardCardId: card.id },
    });

    const c = script.competitorId
      ? await db.competitor.findFirst({ where: { id: script.competitorId, workspaceId: wsId }, select: { username: true } })
      : null;
    return NextResponse.json({
      script: serializeScript({ ...updated, competitorUsername: c?.username ?? null }),
      card_id: card.id,
      column_id: column.id,
    });
  } catch (e) {
    console.error("[script approve]", e);
    return serverError(`Approve failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
