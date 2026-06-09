import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { verifyPassword, hashPassword } from "@/lib/server/auth";
import { badRequest, unauthorized, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const userId = req.headers.get("x-user-id");
    if (!userId) return unauthorized();

    const { current_password, new_password } = await req.json();
    if (!current_password || !new_password) return badRequest("missing_fields", "current_password and new_password are required");
    if (new_password.length < 8) return badRequest("weak_password", "New password must be at least 8 characters");

    const user = await db.user.findUnique({ where: { id: userId } });
    if (!user?.passwordHash) return unauthorized();
    if (!await verifyPassword(current_password, user.passwordHash)) return badRequest("invalid_password", "Current password is incorrect");
    if (await verifyPassword(new_password, user.passwordHash)) return badRequest("same_password", "New password must differ from current password");

    await db.user.update({ where: { id: userId }, data: { passwordHash: await hashPassword(new_password) } });
    return NextResponse.json({ message: "ok" });
  } catch (e) {
    console.error("[change-password]", e);
    return serverError();
  }
}
