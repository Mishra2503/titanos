import { NextRequest, NextResponse } from "next/server";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    if (!req.headers.get("x-workspace-id")) return unauthorized();
    return NextResponse.json({
      defaults: {
        enabled: process.env.SAFETY_ENABLED !== "false",
        daily_cap: Number(process.env.SAFETY_DAILY_CAP ?? 3),
        hourly_cap: Number(process.env.SAFETY_HOURLY_CAP ?? 1),
        min_gap_minutes: Number(process.env.SAFETY_MIN_GAP_MINUTES ?? 90),
        jitter_seconds: Number(process.env.SAFETY_JITTER_SECONDS ?? 90),
      },
      accounts: [],
    });
  } catch (e) {
    console.error("[safety]", e);
    return serverError();
  }
}
