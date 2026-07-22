import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { decryptSecret } from "@/lib/server/crypto";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Queue the user's own recent reels for video analysis ("watch my reels").
// The analyzer re-fetches a fresh media_url per video at processing time, so
// we only need the media ids + which account's token to use.

const GRAPH_VERSION = process.env.INSTAGRAM_GRAPH_VERSION ?? "v23.0";
const GRAPH = `https://graph.instagram.com/${GRAPH_VERSION}`;
const MEDIA_LIMIT = 25;

export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const accounts = await db.igAccount.findMany({ where: { workspaceId: wsId }, orderBy: { createdAt: "asc" } });
    if (!accounts.length) return badRequest("no_accounts", "Connect at least one Instagram account first.");

    let enqueued = 0;
    let alreadyDone = 0;
    const warnings: string[] = [];

    for (const account of accounts) {
      let token: string;
      try { token = decryptSecret(account.accessTokenEnc); } catch {
        warnings.push(`@${account.username}: stored token unreadable - reconnect the account`);
        continue;
      }
      const url = `${GRAPH}/${account.igUserId}/media?fields=id,media_type,media_product_type,timestamp&limit=${MEDIA_LIMIT}&access_token=${token}`;
      const r = await fetch(url, { signal: AbortSignal.timeout(20000) });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        warnings.push(`@${account.username}: ${body?.error?.message ?? `Graph API ${r.status}`}`);
        continue;
      }

      const videos = ((body?.data ?? []) as { id: string; media_type?: string }[]).filter((m) => m.media_type === "VIDEO");
      for (const media of videos) {
        const existing = await db.videoAnalysis.findUnique({
          where: { uq_video_analysis_ws_igmedia: { workspaceId: wsId, igMediaId: media.id } },
          select: { id: true, status: true },
        });
        if (existing?.status === "DONE") { alreadyDone++; continue; }
        if (existing?.status === "PROCESSING" || existing?.status === "PENDING") continue;
        if (existing) {
          await db.videoAnalysis.update({
            where: { id: existing.id },
            data: { status: "PENDING", attempts: 0, error: null, igAccountId: account.id },
          });
        } else {
          await db.videoAnalysis.create({
            data: { workspaceId: wsId, source: "OWN", igMediaId: media.id, igAccountId: account.id },
          });
        }
        enqueued++;
      }
    }

    return NextResponse.json({
      enqueued,
      already_done: alreadyDone,
      accounts_checked: accounts.length,
      warnings,
    });
  } catch (e) {
    console.error("[analyze-own]", e);
    return serverError("Could not queue your reels for analysis - check server logs.");
  }
}
