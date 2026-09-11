import { db } from "@/lib/server/db";
import { decryptSecret, encryptSecret } from "@/lib/server/crypto";

const GRAPH = "https://graph.instagram.com";
const REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_REFRESHES_PER_TICK = 5;

type RefreshResponse = { access_token?: string; expires_in?: number; error?: { code?: number; message?: string } };

function requiresReauthorization(status: number, data: RefreshResponse): boolean {
  const message = data.error?.message?.toLowerCase() ?? "";
  return data.error?.code === 190
    || (status === 400 && (message.includes("expired") || message.includes("invalid") || message.includes("access token")));
}

export async function maintainInstagramTokens(): Promise<{
  expired: number;
  refreshed: number;
  reauthRequired: number;
  transientFailures: number;
}> {
  const now = new Date();
  const refreshBefore = new Date(now.getTime() + REFRESH_WINDOW_MS);

  // An expired long-lived token cannot be refreshed. Surface the required
  // one-time OAuth action clearly instead of repeatedly sending invalid calls.
  const expired = await db.igAccount.updateMany({
    where: {
      status: { not: "NEEDS_REAUTH" },
      tokenExpiresAt: { not: null, lte: now },
    },
    data: { status: "NEEDS_REAUTH" },
  });

  const accounts = await db.igAccount.findMany({
    where: {
      status: "CONNECTED",
      tokenExpiresAt: { gt: now, lte: refreshBefore },
    },
    orderBy: { tokenExpiresAt: "asc" },
    take: MAX_REFRESHES_PER_TICK,
    select: { id: true, accessTokenEnc: true },
  });

  let refreshed = 0;
  let reauthRequired = 0;
  let transientFailures = 0;
  for (const account of accounts) {
    try {
      const currentToken = decryptSecret(account.accessTokenEnc);
      const url = new URL(`${GRAPH}/refresh_access_token`);
      url.searchParams.set("grant_type", "ig_refresh_token");
      url.searchParams.set("access_token", currentToken);
      const response = await fetch(url, { signal: AbortSignal.timeout(30_000) });
      const data = await response.json().catch(() => ({})) as RefreshResponse;

      if (!response.ok || !data.access_token || !data.expires_in) {
        if (requiresReauthorization(response.status, data)) {
          await db.igAccount.update({ where: { id: account.id }, data: { status: "NEEDS_REAUTH" } });
          reauthRequired += 1;
        } else {
          transientFailures += 1;
        }
        console.warn(`[instagram-token] refresh failed for account ${account.id}: HTTP ${response.status}, code ${data.error?.code ?? "unknown"}`);
        continue;
      }

      await db.igAccount.update({
        where: { id: account.id },
        data: {
          accessTokenEnc: encryptSecret(data.access_token),
          tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
          status: "CONNECTED",
          lastSyncedAt: new Date(),
        },
      });
      refreshed += 1;
    } catch (error) {
      transientFailures += 1;
      console.warn(`[instagram-token] refresh failed for account ${account.id}:`, error instanceof Error ? error.message : error);
    }
  }

  return { expired: expired.count, refreshed, reauthRequired, transientFailures };
}
