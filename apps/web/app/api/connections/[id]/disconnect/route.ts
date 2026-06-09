import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const { id } = await params;
    const account = await db.igAccount.findFirst({ where: { id, workspaceId: wsId } });
    if (!account) return notFound("Connection not found");

    await db.igAccount.delete({ where: { id } });

    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[connections disconnect]", e);
    return serverError();
  }
}
