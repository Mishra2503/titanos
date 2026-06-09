import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, forbidden, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const [ws, memberCount, connectionCount] = await Promise.all([
      db.workspace.findUnique({ where: { id: wsId } }),
      db.user.count({ where: { workspaceId: wsId, status: { not: "REVOKED" } } }),
      db.igAccount.count({ where: { workspaceId: wsId } }),
    ]);
    if (!ws) return notFound("Workspace not found");

    return NextResponse.json({
      id: ws.id, name: ws.name, plan: ws.plan,
      member_count: memberCount,
      connection_count: connectionCount,
      connection_limit: Number(process.env.MAX_CONNECTIONS_PER_WORKSPACE ?? 10),
    });
  } catch (e) {
    console.error("[workspace GET]", e);
    return serverError();
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const role = req.headers.get("x-user-role");
    if (!wsId) return unauthorized();
    if (role !== "OWNER") return forbidden();

    const { name } = await req.json();
    if (!name?.trim()) return NextResponse.json({ error: { code: "missing_name", message: "name is required" } }, { status: 400 });

    const ws = await db.workspace.update({ where: { id: wsId }, data: { name: name.trim() } });
    return NextResponse.json({ id: ws.id, name: ws.name, plan: ws.plan });
  } catch (e) {
    console.error("[workspace PATCH]", e);
    return serverError();
  }
}
