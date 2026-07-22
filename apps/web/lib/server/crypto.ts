/**
 * Fernet-compatible encryption for Instagram tokens at rest.
 * Compatible with Python's cryptography.fernet - same key, same ciphertext format.
 *
 * Fernet spec: https://github.com/fernet/spec/blob/master/Spec.md
 * Token = base64url(0x80 | ts[8] | iv[16] | ciphertext | hmac[32])
 * Encryption: AES-128-CBC, PKCS7 padding
 * Signing: HMAC-SHA256 over (version + ts + iv + ciphertext)
 */
import { createCipheriv, createDecipheriv, createHmac, randomBytes, timingSafeEqual } from "crypto";

function getKeyBytes(): Buffer {
  const key = process.env.FERNET_KEY;
  if (!key) throw new Error("FERNET_KEY is not configured");
  return Buffer.from(key.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function encryptSecret(plaintext: string): string {
  const keyBytes = getKeyBytes();
  const signingKey = keyBytes.subarray(0, 16);
  const encryptionKey = keyBytes.subarray(16, 32);

  const iv = randomBytes(16);
  const ts = Buffer.alloc(8);
  const now = Math.floor(Date.now() / 1000);
  ts.writeUInt32BE(0, 0);
  ts.writeUInt32BE(now, 4);

  // PKCS7 pad plaintext
  const data = Buffer.from(plaintext, "utf8");
  const padLen = 16 - (data.length % 16);
  const padded = Buffer.concat([data, Buffer.alloc(padLen, padLen)]);

  const cipher = createCipheriv("aes-128-cbc", encryptionKey, iv);
  cipher.setAutoPadding(false);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);

  const version = Buffer.from([0x80]);
  const preHmac = Buffer.concat([version, ts, iv, ciphertext]);
  const hmac = createHmac("sha256", signingKey).update(preHmac).digest();

  const token = Buffer.concat([preHmac, hmac]);
  return token.toString("base64url");
}

export function decryptSecret(token: string): string {
  const keyBytes = getKeyBytes();
  const signingKey = keyBytes.subarray(0, 16);
  const encryptionKey = keyBytes.subarray(16, 32);

  const raw = Buffer.from(token.replace(/-/g, "+").replace(/_/g, "/"), "base64");
  if (raw.length < 57) throw new Error("Invalid Fernet token");
  if (raw[0] !== 0x80) throw new Error("Invalid Fernet version");

  const preHmac = raw.subarray(0, raw.length - 32);
  const storedHmac = raw.subarray(raw.length - 32);
  const expectedHmac = createHmac("sha256", signingKey).update(preHmac).digest();

  if (!timingSafeEqual(storedHmac, expectedHmac)) {
    throw new Error("Fernet HMAC verification failed");
  }

  const iv = raw.subarray(9, 25);
  const ciphertext = raw.subarray(25, raw.length - 32);

  const decipher = createDecipheriv("aes-128-cbc", encryptionKey, iv);
  decipher.setAutoPadding(false);
  const padded = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  const padLen = padded[padded.length - 1];
  return padded.subarray(0, padded.length - padLen).toString("utf8");
}
