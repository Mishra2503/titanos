import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { forbidden, notFound, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const role = req.headers.get("x-user-role");
    const wsId = req.headers.get("x-workspace-id");
    if (role !== "OWNER") return forbidden();

    const { id } = await params;
    const user = await db.user.findFirst({ where: { id, workspaceId: wsId! } });
    if (!user) return notFound("User not found");

    const updated = await db.user.update({
      where: { id },
      data: { status: "REVOKED", inviteTokenHash: null },
    });

    return NextResponse.json({ id: updated.id, email: updated.email, role: updated.role, status: updated.status, workspace_id: updated.workspaceId });
  } catch (e) {
    console.error("[revoke]", e);
    return serverError();
  }
}
