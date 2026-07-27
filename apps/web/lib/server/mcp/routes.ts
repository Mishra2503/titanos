// Static registry of the API route modules MCP tools are allowed to invoke.
//
// Why static imports rather than `import(path)`: webpack cannot resolve a
// template-literal import specifier, so a dynamic registry would fail to bundle.
// Listing every module by name also makes the connector's reachable surface
// explicit and auditable - a tool cannot reach a route that is not on this list.
//
// Keys are the literal Next.js route patterns; `[param]` segments are filled in
// by callRoute(). Every handler here still reads its identity from the
// x-user-id / x-workspace-id / x-user-role headers, exactly as it does when the
// browser calls it through middleware - so RBAC and safety rails are unchanged.

import type { NextRequest } from "next/server";

import * as connections from "@/app/api/connections/route";
import * as connectionRefresh from "@/app/api/connections/[id]/refresh/route";
import * as media from "@/app/api/media/route";
import * as schedule from "@/app/api/schedule/route";
import * as scheduleItem from "@/app/api/schedule/[id]/route";
import * as scheduleCancel from "@/app/api/schedule/[id]/cancel/route";
import * as scheduleRetry from "@/app/api/schedule/[id]/retry/route";
import * as campaigns from "@/app/api/campaigns/route";
import * as board from "@/app/api/board/route";
import * as boardCards from "@/app/api/board/cards/route";
import * as boardCard from "@/app/api/board/cards/[id]/route";
import * as boardCardAi from "@/app/api/board/cards/[id]/ai/route";
import * as boardCardAnalyze from "@/app/api/board/cards/[id]/analyze/route";
import * as boardCardScript from "@/app/api/board/cards/[id]/script/route";
import * as boardColumnReorder from "@/app/api/board/columns/[id]/reorder/route";
import * as competitors from "@/app/api/competitors/route";
import * as competitor from "@/app/api/competitors/[id]/route";
import * as competitorSync from "@/app/api/competitors/[id]/sync/route";
import * as competitorReport from "@/app/api/competitors/[id]/report/route";
import * as competitorWindow from "@/app/api/competitors/[id]/window-insights/route";
import * as competitorPostAnalyze from "@/app/api/competitors/[id]/posts/[postId]/analyze/route";
import * as competitorPostScript from "@/app/api/competitors/[id]/posts/[postId]/script/route";
import * as competitorPostBoard from "@/app/api/competitors/[id]/posts/[postId]/board/route";
import * as competitorsOverview from "@/app/api/competitors/report/overview/route";
import * as insightsSummary from "@/app/api/insights/summary/route";
import * as aiStrategy from "@/app/api/ai/strategy/route";
import * as reportsWeekly from "@/app/api/reports/weekly/route";
import * as reportsAnalyzeOwn from "@/app/api/reports/analyze-own/route";
import * as scripts from "@/app/api/scripts/route";
import * as script from "@/app/api/scripts/[id]/route";
import * as scriptRewrite from "@/app/api/scripts/[id]/rewrite/route";
import * as scriptRegenerate from "@/app/api/scripts/[id]/regenerate/route";
import * as scriptApprove from "@/app/api/scripts/[id]/approve/route";
import * as videosStatus from "@/app/api/videos/status/route";
import * as workspace from "@/app/api/workspace/route";
import * as safetyHealth from "@/app/api/safety/health/route";

// Route handlers declare their own `params` shape (`Promise<{ id: string }>`,
// `Promise<{ id: string; postId: string }>`, or no second argument at all), so
// no single signature is assignable to all of them under strictFunctionTypes.
// callRoute narrows to this shape at the one call site instead; the route keys
// carry the real contract, and a wrong param name throws there immediately.
export type RouteHandler = (
  req: NextRequest,
  ctx: { params: Promise<never> },
) => Promise<Response> | Response;

export type RouteModule = Partial<Record<"GET" | "POST" | "PATCH" | "DELETE", RouteHandler>>;

export const ROUTES = {
  "/api/connections": connections,
  "/api/connections/[id]/refresh": connectionRefresh,
  "/api/media": media,
  "/api/schedule": schedule,
  "/api/schedule/[id]": scheduleItem,
  "/api/schedule/[id]/cancel": scheduleCancel,
  "/api/schedule/[id]/retry": scheduleRetry,
  "/api/campaigns": campaigns,
  "/api/board": board,
  "/api/board/cards": boardCards,
  "/api/board/cards/[id]": boardCard,
  "/api/board/cards/[id]/ai": boardCardAi,
  "/api/board/cards/[id]/analyze": boardCardAnalyze,
  "/api/board/cards/[id]/script": boardCardScript,
  "/api/board/columns/[id]/reorder": boardColumnReorder,
  "/api/competitors": competitors,
  "/api/competitors/[id]": competitor,
  "/api/competitors/[id]/sync": competitorSync,
  "/api/competitors/[id]/report": competitorReport,
  "/api/competitors/[id]/window-insights": competitorWindow,
  "/api/competitors/[id]/posts/[postId]/analyze": competitorPostAnalyze,
  "/api/competitors/[id]/posts/[postId]/script": competitorPostScript,
  "/api/competitors/[id]/posts/[postId]/board": competitorPostBoard,
  "/api/competitors/report/overview": competitorsOverview,
  "/api/insights/summary": insightsSummary,
  "/api/ai/strategy": aiStrategy,
  "/api/reports/weekly": reportsWeekly,
  "/api/reports/analyze-own": reportsAnalyzeOwn,
  "/api/scripts": scripts,
  "/api/scripts/[id]": script,
  "/api/scripts/[id]/rewrite": scriptRewrite,
  "/api/scripts/[id]/regenerate": scriptRegenerate,
  "/api/scripts/[id]/approve": scriptApprove,
  "/api/videos/status": videosStatus,
  "/api/workspace": workspace,
  "/api/safety/health": safetyHealth,
} as const;

export type RouteKey = keyof typeof ROUTES;
