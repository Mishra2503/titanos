import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

// Video-analysis queue status for the workspace - powers the small status
// strip on the reports/competitors pages.
export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const [groups, recentErrors] = await Promise.all([
      db.videoAnalysis.groupBy({ by: ["status"], where: { workspaceId: wsId }, _count: { _all: true } }),
      db.videoAnalysis.findMany({
        where: { workspaceId: wsId, status: "FAILED", error: { not: null } },
        orderBy: { updatedAt: "desc" },
        take: 5,
        select: { source: true, error: true, updatedAt: true },
      }),
    ]);

    const counts: Record<string, number> = { PENDING: 0, PROCESSING: 0, DONE: 0, FAILED: 0, SKIPPED: 0 };
    for (const g of groups) counts[g.status] = g._count._all;

    return NextResponse.json({
      counts,
      recent_errors: recentErrors.map((e) => ({ source: e.source, error: e.error, at: e.updatedAt })),
    });
  } catch (e) {
    console.error("[videos status]", e);
    return serverError();
  }
}
