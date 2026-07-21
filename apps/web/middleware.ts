import { NextRequest, NextResponse } from "next/server";
import {
  getSessionFromRequest,
  getRefreshTokenFromRequest,
  verifyToken,
  createAccessToken,
} from "@/lib/server/jwt";

// /api/mcp self-authenticates via Bearer PAT (see app/api/mcp/route.ts), so the
// cookie middleware must not intercept it.
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/register", "/api/auth/refresh", "/api/healthz", "/api/schedule/tick", "/api/mcp"];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname.startsWith(p)) ||
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon")
  ) {
    return NextResponse.next();
  }

  const session = await getSessionFromRequest(req);
  if (session) {
    // NextResponse.next().headers.set(...) only touches the response the browser
    // sees — it never reaches the Route Handler's req.headers. Forwarding headers
    // to downstream handlers requires the `request` option below.
    const requestHeaders = new Headers(req.headers);
    requestHeaders.set("x-user-id", session.sub);
    requestHeaders.set("x-workspace-id", session.ws);
    requestHeaders.set("x-user-role", session.role);
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  const refreshToken = getRefreshTokenFromRequest(req);
  if (refreshToken) {
    const refreshPayload = await verifyToken(refreshToken);
    if (refreshPayload && refreshPayload.type === "refresh") {
      const newAccess = await createAccessToken({
        sub: refreshPayload.sub,
        ws: refreshPayload.ws,
        role: refreshPayload.role,
      });
      const isProd = process.env.NODE_ENV === "production";
      const ttl = Number(process.env.ACCESS_TOKEN_TTL_MINUTES ?? 30);

      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: { code: "token_refreshed", message: "Token refreshed" } },
          { status: 401 },
        );
      }

      const requestHeaders = new Headers(req.headers);
      requestHeaders.set("x-user-id", refreshPayload.sub);
      requestHeaders.set("x-workspace-id", refreshPayload.ws);
      requestHeaders.set("x-user-role", refreshPayload.role);
      const res = NextResponse.next({ request: { headers: requestHeaders } });
      res.cookies.set("titan.access", newAccess, {
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        path: "/",
        maxAge: ttl * 60,
      });
      return res;
    }
  }

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: { code: "unauthorized", message: "Unauthorized" } }, { status: 401 });
  }
  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
