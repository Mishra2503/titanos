import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { serializeScript } from "@/lib/server/scripts";

async function usernameFor(wsId: string, competitorId: string | null): Promise<string | null> {
  if (!competitorId) return null;
  const c = await db.competitor.findFirst({ where: { id: competitorId, workspaceId: wsId }, select: { username: true } });
  return c?.username ?? null;
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const s = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!s) return notFound("Script not found");
    return NextResponse.json(serializeScript({ ...s, competitorUsername: await usernameFor(wsId, s.competitorId) }));
  } catch (e) {
    console.error("[script GET]", e);
    return serverError();
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Script not found");
    const body = await req.json();
    const s = await db.script.update({
      where: { id },
      data: {
        ...(body.title !== undefined && { title: String(body.title) }),
        ...(body.body !== undefined && { body: String(body.body) }),
        ...(body.hook !== undefined && { hook: body.hook == null ? null : String(body.hook) }),
        ...(body.caption !== undefined && { caption: body.caption == null ? null : String(body.caption) }),
        ...(Array.isArray(body.hashtags) && { hashtags: body.hashtags.map(String) }),
      },
    });
    return NextResponse.json(serializeScript({ ...s, competitorUsername: await usernameFor(wsId, s.competitorId) }));
  } catch (e) {
    console.error("[script PATCH]", e);
    return serverError();
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const existing = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!existing) return notFound("Script not found");
    await db.script.delete({ where: { id } });
    return new NextResponse(null, { status: 204 });
  } catch (e) {
    console.error("[script DELETE]", e);
    return serverError();
  }
}
