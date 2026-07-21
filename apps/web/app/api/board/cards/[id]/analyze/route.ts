import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, badRequest, serverError } from "@/lib/server/errors";
import { enqueueBoardCardAnalysis } from "@/lib/server/videoAnalyzer";
import { videoAnalysisOut } from "@/lib/server/videoAnalysis";

// "Analyze reel" for a Content Board card. POST queues the watch (frames + Groq
// transcript + Claude vision on the card's reference reel); GET is polled by the
// card modal until the row is DONE. The heavy work runs in the background queue
// (lib/server/videoAnalyzer.ts), so the request returns immediately.

const SELECT = { status: true, summary: true, analysis: true, transcript: true, analyzedAt: true, error: true } as const;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const card = await db.boardCard.findFirst({ where: { id, workspaceId: wsId } });
    if (!card) return notFound("Card not found");
    if (!card.referenceUrl?.trim()) {
      return badRequest("no_reference_url", "Add a Reference reel URL to this card first, then Analyze it.");
    }

    const rowId = await enqueueBoardCardAnalysis(wsId, id);
    const row = await db.videoAnalysis.findUnique({ where: { id: rowId }, select: SELECT });
    return NextResponse.json(videoAnalysisOut(row));
  } catch (e) {
    console.error("[card analyze POST]", e);
    return serverError();
  }
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const card = await db.boardCard.findFirst({ where: { id, workspaceId: wsId }, select: { id: true } });
    if (!card) return notFound("Card not found");

    const row = await db.videoAnalysis.findUnique({ where: { boardCardId: id }, select: SELECT });
    return NextResponse.json(videoAnalysisOut(row));
  } catch (e) {
    console.error("[card analyze GET]", e);
    return serverError();
  }
}
