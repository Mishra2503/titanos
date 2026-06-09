import { NextRequest, NextResponse } from "next/server";
import { verifyToken, createAccessToken, createRefreshToken, setAuthCookies } from "@/lib/server/auth";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function POST(req: NextRequest) {
  try {
    // Support both cookie-based and body-based refresh for compatibility
    const refreshCookie = req.cookies.get("titan.refresh")?.value;
    let refreshToken = refreshCookie;
    if (!refreshToken) {
      const body = await req.json().catch(() => ({}));
      refreshToken = body.refresh_token;
    }
    if (!refreshToken) return unauthorized("No refresh token");

    const payload = await verifyToken(refreshToken);
    if (!payload || payload.type !== "refresh") return unauthorized("Invalid refresh token");

    const tokenPayload = { sub: payload.sub, ws: payload.ws, role: payload.role };
    const [access, refresh] = await Promise.all([
      createAccessToken(tokenPayload),
      createRefreshToken(tokenPayload),
    ]);

    await setAuthCookies(access, refresh);
    return NextResponse.json({ message: "ok" });
  } catch (e) {
    console.error("[refresh]", e);
    return serverError();
  }
}
