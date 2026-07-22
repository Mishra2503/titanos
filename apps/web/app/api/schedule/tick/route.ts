import { NextRequest, NextResponse } from "next/server";
import { publishDuePosts } from "@/lib/server/publisher";
import { analyzePendingVideos } from "@/lib/server/videoAnalyzer";
import { unauthorized, serverError } from "@/lib/server/errors";

// Manual/external trigger for the background work (publisher + video
// analyzer). Useful for debugging and as a backstop for external cron
// services (send x-cron-secret: $CRON_SECRET). Note: analyzing videos can
// take minutes - cron callers should fire-and-forget.
export async function POST(req: NextRequest) {
  try {
    // This path is public in the middleware, so headers like x-workspace-id
    // could be client-spoofed - only the cron secret counts here.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) return unauthorized();

    const publisher = await publishDuePosts();
    const analyzer = await analyzePendingVideos().catch((e) => {
      console.error("[schedule tick] analyzer failed", e);
      return { claimed: 0 };
    });
    return NextResponse.json({ ok: true, ...publisher, publisher, analyzer });
  } catch (e) {
    console.error("[schedule tick]", e);
    return serverError();
  }
}
