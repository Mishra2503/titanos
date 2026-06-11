import { NextRequest, NextResponse } from "next/server";
import { getWorkspaceInsights } from "@/lib/server/insights";
import { unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const perAccount = await getWorkspaceInsights(wsId);

    const totalReach = perAccount.reduce((s, a) => s + (a.reach ?? 0), 0);
    const totalSaves = perAccount.reduce((s, a) => s + (a.saves ?? 0), 0);
    const totalShares = perAccount.reduce((s, a) => s + (a.shares ?? 0), 0);
    const hasData = perAccount.length > 0;

    return NextResponse.json({
      generated_at: new Date().toISOString(),
      range_days: 28,
      kpis: [
        { key: "reach", label: "Reach", value: hasData ? totalReach : null, unit: null, available: hasData, note: hasData ? "Across recent posts" : null },
        { key: "saves", label: "Saves", value: hasData ? totalSaves : null, unit: null, available: hasData, note: null },
        { key: "shares", label: "Shares", value: hasData ? totalShares : null, unit: null, available: hasData, note: null },
        { key: "dm_leads", label: "DM leads", value: null, unit: null, available: false, note: "Connect GoHighLevel to populate the lead funnel" },
        { key: "calls_booked", label: "Calls booked", value: null, unit: null, available: false, note: "Connect GoHighLevel to populate the lead funnel" },
      ],
      accounts: perAccount,
    });
  } catch (e) {
    console.error("[insights]", e);
    return serverError();
  }
}
