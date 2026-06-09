// Node.js API-route auth helpers (not for middleware — use lib/server/jwt.ts there).
import { cookies } from "next/headers";
import { hash, verify } from "@node-rs/argon2";

// Re-export JWT helpers so API routes only need one import.
export type { JwtPayload } from "./jwt";
export {
  createAccessToken,
  createRefreshToken,
  verifyToken,
  getSessionFromRequest,
  getRefreshTokenFromRequest,
} from "./jwt";

const ACCESS_COOKIE = "titan.access";
const REFRESH_COOKIE = "titan.refresh";

export async function setAuthCookies(accessToken: string, refreshToken: string) {
  const jar = await cookies();
  const isProd = process.env.NODE_ENV === "production";
  const accessTtl = Number(process.env.ACCESS_TOKEN_TTL_MINUTES ?? 30);
  const refreshTtl = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);

  jar.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: accessTtl * 60,
  });
  jar.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: isProd,
    sameSite: "lax",
    path: "/",
    maxAge: refreshTtl * 24 * 60 * 60,
  });
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

export async function getSession() {
  const { verifyToken } = await import("./jwt");
  const jar = await cookies();
  const token = jar.get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  return verifyToken(token);
}

export async function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export async function verifyPassword(password: string, hashStr: string): Promise<boolean> {
  try {
    return await verify(hashStr, password);
  } catch {
    return false;
  }
}
