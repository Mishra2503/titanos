import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { createHash, randomBytes } from "crypto";
import { forbidden, badRequest, conflict, serverError } from "@/lib/server/errors";

function hashInvite(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export async function POST(req: NextRequest) {
  try {
    const role = req.headers.get("x-user-role");
    const wsId = req.headers.get("x-workspace-id");
    if (role !== "OWNER") return forbidden("Only owners can invite users");

    const { email, role: inviteRole = "EDITOR" } = await req.json();
    if (!email) return badRequest("missing_fields", "email is required");

    const normalised = email.toLowerCase().trim();
    const existing = await db.user.findFirst({
      where: { workspaceId: wsId!, email: normalised },
    });
    if (existing && existing.status !== "REVOKED") {
      return conflict("user_exists", "A user with that email already exists");
    }

    const rawToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const user = existing
      ? await db.user.update({
          where: { id: existing.id },
          data: {
            role: inviteRole,
            status: "INVITED",
            passwordHash: null,
            inviteTokenHash: hashInvite(rawToken),
            inviteExpiresAt: expiresAt,
          },
        })
      : await db.user.create({
          data: {
            workspaceId: wsId!,
            email: normalised,
            role: inviteRole,
            status: "INVITED",
            inviteTokenHash: hashInvite(rawToken),
            inviteExpiresAt: expiresAt,
          },
        });

    return NextResponse.json(
      { user: { id: user.id, email: user.email, role: user.role, status: user.status, workspace_id: user.workspaceId }, invite_token: rawToken },
      { status: 201 },
    );
  } catch (e) {
    console.error("[invite]", e);
    return serverError();
  }
}
