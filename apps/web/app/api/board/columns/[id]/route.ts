import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

async function ownedColumn(wsId: string, id: string) {
  const col = await db.boardColumn.findFirst({ where: { id, workspaceId: wsId } });
  if (!col) throw Object.assign(new Error("not_found"), { isNotFound: true });
  return col;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    await ownedColumn(wsId, id).catch(() => null).then((c) => { if (!c) throw new Error("not_found"); });
    const { name, color } = await req.json();
    const col = await db.boardColumn.update({ where: { id }, data: { ...(name && { name }), ...(color && { color }) } });
    return NextResponse.json({ id: col.id, name: col.name, color: col.color, position: col.position });
  } catch (e: unknown) {
    if ((e as Error).message === "not_found") return notFound("Column not found");
    console.error("[board columns PATCH]", e);
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const col = await db.boardColumn.findFirst({ where: { id, workspaceId: wsId } });
    if (!col) return notFound("Column not found");
    await db.boardColumn.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[board columns DELETE]", e);
    return serverError();
  }
}
