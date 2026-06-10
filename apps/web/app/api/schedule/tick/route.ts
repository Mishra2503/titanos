import { NextRequest, NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/server/publisher";
import { unauthorized, serverError } from "@/lib/server/errors";

// Manual/external trigger for the publisher. Useful for debugging and as a
// backstop for external cron services (send x-cron-secret: $CRON_SECRET).
export async function POST(req: NextRequest) {
  try {
    // This path is public in the middleware, so headers like x-workspace-id
    // could be client-spoofed — only the cron secret counts here.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return unauthorized();

    const result = await publishDuePosts();
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    console.error("[schedule tick]", e);
    return serverError();
  }
}
