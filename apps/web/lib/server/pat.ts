// Personal Access Tokens (PAT) — machine-to-machine auth for the MCP endpoint.
//
// Token format: `tos_<id>_<secret>`
//   - <id>     the PersonalAccessToken row id (O(1) DB lookup, not secret)
//   - <secret> 32 random bytes, base64url — shown to the user exactly once
//
// Only sha256(<secret>) is persisted in `token_hash`. Verification is a
// constant-time compare, so a leaked hash cannot be replayed and there is no
// way to recover the plaintext. A token inherits its user's role; `scopes`
// may narrow it further (e.g. ["read"] makes an owner's token read-only).

import { createHash, randomBytes, timingSafeEqual } from "crypto";
import { db } from "@/lib/server/db";

export const TOKEN_PREFIX = "tos";

export interface TokenIdentity {
  tokenId: string;
  userId: string;
  workspaceId: string;
  role: string;
  scopes: string[];
}

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Create a new PAT. Returns the plaintext token ONCE — it is never stored and
 * cannot be retrieved again. Caller must be an authenticated user in `workspaceId`.
 */
export async function createToken(opts: {
  workspaceId: string;
  userId: string;
  name: string;
  scopes?: string[];
  expiresAt?: Date | null;
}): Promise<{ id: string; plaintext: string; name: string; scopes: string[]; expiresAt: Date | null; createdAt: Date }> {
  const secret = randomBytes(32).toString("base64url");
  const row = await db.personalAccessToken.create({
    data: {
      workspaceId: opts.workspaceId,
      userId: opts.userId,
      name: opts.name,
      tokenHash: sha256(secret),
      scopes: opts.scopes ?? [],
      expiresAt: opts.expiresAt ?? null,
    },
  });
  return {
    id: row.id,
    plaintext: `${TOKEN_PREFIX}_${row.id}_${secret}`,
    name: row.name,
    scopes: row.scopes,
    expiresAt: row.expiresAt,
    createdAt: row.createdAt,
  };
}

/**
 * Verify a Bearer token string. Returns the resolved identity or null.
 * Rejects revoked, expired, and malformed tokens. Bumps last_used_at on success.
 */
export async function verifyToken(bearer: string | null | undefined): Promise<TokenIdentity | null> {
  if (!bearer) return null;
  const raw = bearer.startsWith("Bearer ") ? bearer.slice(7).trim() : bearer.trim();
  const parts = raw.split("_");
  // `tos` + id + secret — id is a uuid (contains no underscores); secret is the rest.
  if (parts.length < 3 || parts[0] !== TOKEN_PREFIX) return null;
  const id = parts[1];
  const secret = parts.slice(2).join("_");
  if (!id || !secret) return null;

  const row = await db.personalAccessToken.findUnique({
    where: { id },
    include: { user: { select: { role: true, status: true } } },
  });
  if (!row || row.revokedAt) return null;
  if (row.expiresAt && row.expiresAt.getTime() < Date.now()) return null;
  if (row.user.status !== "ACTIVE") return null;

  // Constant-time compare of the sha256 hashes.
  const expected = Buffer.from(row.tokenHash, "hex");
  const actual = Buffer.from(sha256(secret), "hex");
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;

  // Fire-and-forget usage bump (do not block the request on it).
  db.personalAccessToken
    .update({ where: { id }, data: { lastUsedAt: new Date() } })
    .catch(() => {});

  return {
    tokenId: row.id,
    userId: row.userId,
    workspaceId: row.workspaceId,
    role: row.user.role,
    scopes: row.scopes,
  };
}

/**
 * True if the identity may perform write actions.
 * A token is read-only when its scopes include "read" but not "write",
 * or when the user's role is VIEWER.
 */
export function canWrite(identity: TokenIdentity): boolean {
  if (identity.role === "VIEWER") return false;
  const s = identity.scopes;
  if (s.length === 0) return true; // unscoped token inherits full role capability
  if (s.includes("write")) return true;
  if (s.includes("read") && !s.includes("write")) return false;
  return true;
}
