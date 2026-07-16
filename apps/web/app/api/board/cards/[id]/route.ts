import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { serializeCard } from "@/lib/server/board";

const EDITABLE = ["title","notes","emoji","status","platforms","publish_date","hook","visual_hook","caption","hashtags","reference_url","raw_footage_url","cover_image_url","tags"] as const;
const DB_MAP: Record<string, string> = { publish_date: "publishDate", visual_hook: "visualHook", reference_url: "referenceUrl", raw_footage_url: "rawFootageUrl", cover_image_url: "coverImageUrl", column_id: "columnId" };

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.boardCard.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Card not found");
    const body = await req.json();
    const data: Record<string, unknown> = {};
    for (const key of EDITABLE) {
      if (key in body) data[DB_MAP[key] ?? key] = body[key];
    }
    const card = await db.boardCard.update({
      where: { id },
      data,
      include: { videoAnalysis: { select: { status: true, summary: true, analysis: true, transcript: true, analyzedAt: true, error: true } } },
    });
    return NextResponse.json(serializeCard(card));
  } catch (e) {
    console.error("[cards PATCH]", e);
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.boardCard.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Card not found");
    await db.boardCard.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[cards DELETE]", e);
    return serverError();
  }
}
