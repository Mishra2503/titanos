import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { snapshotId } = await params;
    const snap = await db.competitorSnapshot.findFirst({ where: { id: snapshotId, workspaceId: wsId } });
    if (!snap) return notFound("Snapshot not found");
    await db.competitorSnapshot.delete({ where: { id: snapshotId } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[snapshot DELETE]", e);
    return serverError();
  }
}
