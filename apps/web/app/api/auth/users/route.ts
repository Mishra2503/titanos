import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { forbidden, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const role = req.headers.get("x-user-role");
    const wsId = req.headers.get("x-workspace-id");
    if (role !== "OWNER") return forbidden();

    const users = await db.user.findMany({
      where: { workspaceId: wsId! },
      orderBy: { createdAt: "asc" },
    });

    return NextResponse.json(
      users.map((u) => ({ id: u.id, email: u.email, role: u.role, status: u.status, workspace_id: u.workspaceId })),
    );
  } catch (e) {
    console.error("[users]", e);
    return serverError();
  }
}
