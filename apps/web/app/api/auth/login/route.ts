import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { verifyPassword, createAccessToken, createRefreshToken, setAuthCookies } from "@/lib/server/auth";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();

    const user = await db.user.findFirst({
      where: { email: email?.toLowerCase()?.trim() },
    });

    // Always run verifyPassword to prevent timing-based user enumeration
    const hashToCheck = user?.passwordHash ?? "$argon2id$v=19$m=65536,t=2,p=1$placeholder";
    const valid = user?.passwordHash ? await verifyPassword(password ?? "", hashToCheck) : false;

    if (!valid || !user || user.status !== "ACTIVE") {
      return unauthorized("Invalid email or password");
    }

    const tokenPayload = { sub: user.id, ws: user.workspaceId, role: user.role };
    const [access, refresh] = await Promise.all([
      createAccessToken(tokenPayload),
      createRefreshToken(tokenPayload),
    ]);

    await setAuthCookies(access, refresh);
    return NextResponse.json({ message: "ok" });
  } catch (e) {
    console.error("[login]", e);
    return serverError();
  }
}
