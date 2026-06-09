import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    const wsId = req.headers.get("x-workspace-id");
    const role = req.headers.get("x-user-role");
    if (!userId || !wsId) return unauthorized();

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user || user.status !== "ACTIVE") return notFound("User not found");

    return NextResponse.json({
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
      workspace_id: user.workspaceId,
    });
  } catch (e) {
    console.error("[me]", e);
    return serverError();
  }
}
