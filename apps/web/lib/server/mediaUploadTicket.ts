import { SignJWT, jwtVerify } from "jose";
import type { JWTPayload } from "jose";

interface MediaUploadTicket extends JWTPayload {
  typ: "media_upload_ticket";
  ws: string;
  uid: string;
  key: string;
  filename: string;
  contentType: string;
  bytes?: number;
}

function secret(): Uint8Array {
  return new TextEncoder().encode(process.env.JWT_SECRET ?? "change_me_jwt_secret_32_chars_min");
}

export async function signMediaUploadTicket(claims: Omit<MediaUploadTicket, keyof JWTPayload | "typ">): Promise<string> {
  return new SignJWT({ ...claims, typ: "media_upload_ticket" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(secret());
}

export async function verifyMediaUploadTicket(raw: string): Promise<MediaUploadTicket | null> {
  try {
    const { payload } = await jwtVerify(raw, secret(), { algorithms: ["HS256"] });
    return payload.typ === "media_upload_ticket" ? payload as MediaUploadTicket : null;
  } catch {
    return null;
  }
}
