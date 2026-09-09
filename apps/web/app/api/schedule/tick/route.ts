import { NextRequest, NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/server/publisher";
import { unauthorized, serverError } from "@/lib/server/errors";

// Authenticated publisher-only trigger for an external scheduler. Keep this
// endpoint independent from video analysis so a slow analysis job cannot block
// the clock that wakes Render and publishes due posts.
export async function POST(req: NextRequest) {
  try {
    // This path is public in the middleware, so headers like x-workspace-id
    // could be client-spoofed - only the cron secret counts here.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return unauthorized();

    // One Reel can spend several minutes processing at Meta. Limit request-led
    // work to one post; the next minute tick safely claims the next due row.
    const publisher = await publishDuePosts({ maxPosts: 1 });
    return NextResponse.json(
      { ok: true, ...publisher, publisher },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[schedule tick]", e);
    return serverError();
  }
}
