/**
 * POST /api/auth/register
 * Bootstrap endpoint — creates the first OWNER and workspace.
 * Fails if any workspace already exists (one-time setup only).
 */
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { hashPassword, createAccessToken, createRefreshToken, setAuthCookies } from "@/lib/server/auth";
import { badRequest, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const { email, password, workspace_name } = await req.json();

    if (!email || !password) return badRequest("missing_fields", "email and password are required");
    if (password.length < 8) return badRequest("weak_password", "Password must be at least 8 characters");

    const existing = await db.workspace.findFirst();
    if (existing) return badRequest("already_setup", "This instance is already set up. Use the invite flow to add users.");

    const workspace = await db.workspace.create({
      data: { name: workspace_name?.trim() || "Titan OS" },
    });

    const user = await db.user.create({
      data: {
        workspaceId: workspace.id,
        email: email.toLowerCase().trim(),
        passwordHash: await hashPassword(password),
        role: "OWNER",
        status: "ACTIVE",
      },
    });

    const tokenPayload = { sub: user.id, ws: workspace.id, role: user.role };
    const [access, refresh] = await Promise.all([
      createAccessToken(tokenPayload),
      createRefreshToken(tokenPayload),
    ]);

    await setAuthCookies(access, refresh);
    return NextResponse.json({ id: user.id, email: user.email, role: user.role, workspace_id: workspace.id }, { status: 201 });
  } catch (e) {
    console.error("[register]", e);
    return serverError();
  }
}
