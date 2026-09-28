import { NextRequest, NextResponse } from "next/server";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    if (!req.headers.get("x-workspace-id")) return unauthorized();
    return NextResponse.json({
      publishing: {
        enabled: process.env.ENABLE_PUBLISHER !== "false",
        external_scheduler_enabled: process.env.ENABLE_EXTERNAL_SCHEDULER !== "false",
        note: process.env.ENABLE_PUBLISHER === "false"
          ? "Scheduling is available, but automatic Instagram publishing is disabled by the server kill switch."
          : "Automatic publishing is enabled. Connected accounts still need valid Instagram tokens.",
      },
      defaults: {
        enabled: process.env.SAFETY_ENABLED !== "false",
        daily_cap: Number(process.env.SAFETY_DAILY_CAP ?? 3),
        hourly_cap: Number(process.env.SAFETY_HOURLY_CAP ?? 1),
        min_gap_minutes: Number(process.env.SAFETY_MIN_GAP_MINUTES ?? 90),
        jitter_seconds: Number(process.env.SAFETY_JITTER_SECONDS ?? 90),
      },
      enforcement: {
        minimum_gap: "enforced_on_create_and_reschedule",
        daily_cap: "advisory_only",
        hourly_cap: "advisory_only",
        jitter: "advisory_only",
      },
      accounts: [],
    });
  } catch (e) {
    console.error("[safety]", e);
    return serverError();
  }
}
