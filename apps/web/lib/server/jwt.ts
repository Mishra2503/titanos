// Edge-compatible JWT helpers - no native modules, safe for middleware.
import { SignJWT, jwtVerify } from "jose";
import { NextRequest } from "next/server";

const ACCESS_COOKIE = "titan.access";
const REFRESH_COOKIE = "titan.refresh";

function getSecret() {
  return new TextEncoder().encode(
    process.env.JWT_SECRET ?? "change_me_jwt_secret_32_chars_min",
  );
}

const ALG = "HS256";

export interface JwtPayload {
  sub: string;
  ws: string;
  role: string;
  type: "access" | "refresh";
  jti: string;
}

export async function createAccessToken(payload: Omit<JwtPayload, "type" | "jti">) {
  const ttl = Number(process.env.ACCESS_TOKEN_TTL_MINUTES ?? 30);
  return new SignJWT({ ...payload, type: "access" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${ttl}m`)
    .setJti(crypto.randomUUID())
    .sign(getSecret());
}

export async function createRefreshToken(payload: Omit<JwtPayload, "type" | "jti">) {
  const ttl = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);
  return new SignJWT({ ...payload, type: "refresh" })
    .setProtectedHeader({ alg: ALG })
    .setIssuedAt()
    .setExpirationTime(`${ttl}d`)
    .setJti(crypto.randomUUID())
    .sign(getSecret());
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export function getSessionFromRequest(req: NextRequest): Promise<JwtPayload | null> {
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return Promise.resolve(null);
  return verifyToken(token);
}

export function getRefreshTokenFromRequest(req: NextRequest): string | null {
  return req.cookies.get(REFRESH_COOKIE)?.value ?? null;
}
