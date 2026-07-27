// Async jobs for long-running MCP tools.
//
// Report generation, per-reel deep analysis and script writing all call Claude
// (sometimes with live web search) and routinely take 30-120s. MCP clients give
// up well before that and surface the timeout as "the connector is broken", so
// those tools hand back a job id straight away and the model polls
// get_job_status. Work runs in-process next to the request that started it -
// the same single-instance model the publisher and video-analyzer loops already
// assume.

import { db } from "@/lib/server/db";
import type { TokenIdentity } from "@/lib/server/pat";

/** Jobs left RUNNING longer than this were killed by a restart, not still working. */
const STALE_AFTER_MS = 20 * 60 * 1000;

export interface JobView {
  job_id: string;
  tool: string;
  status: string;
  result?: unknown;
  error?: string;
  started_at?: string | null;
  finished_at?: string | null;
  note?: string;
}

/**
 * Create a job row and run `work` in the background. Returns immediately with a
 * pollable id. `work` is never awaited by the caller, so it must not throw
 * synchronously - failures are captured onto the row.
 */
export async function startJob(
  identity: TokenIdentity,
  tool: string,
  args: Record<string, unknown>,
  work: () => Promise<unknown>,
): Promise<JobView> {
  const job = await db.mcpJob.create({
    data: {
      workspaceId: identity.workspaceId,
      userId: identity.userId,
      tool,
      args: args as object,
      status: "RUNNING",
      startedAt: new Date(),
    },
  });

  // Deliberately not awaited: the tool call returns while this keeps running.
  void (async () => {
    try {
      const result = await work();
      await db.mcpJob.update({
        where: { id: job.id },
        data: {
          status: "DONE",
          finishedAt: new Date(),
          // Only set the Json column when there is a value: Prisma rejects a
          // plain `null` for an optional Json field (it wants JsonNull/DbNull),
          // and "no result" is already implied by leaving the column untouched.
          ...(result === null || result === undefined ? {} : { result: result as object }),
        },
      });
    } catch (e) {
      await db.mcpJob
        .update({
          where: { id: job.id },
          data: {
            status: "FAILED",
            error: e instanceof Error ? e.message : "Job failed",
            finishedAt: new Date(),
          },
        })
        .catch(() => {});
    }
  })();

  return {
    job_id: job.id,
    tool,
    status: "running",
    note: "Started. Poll get_job_status with this job_id until status is 'done' or 'failed'. Typically 30-120 seconds.",
  };
}

/** Read a job, scoped to the caller's workspace. */
export async function getJob(identity: TokenIdentity, jobId: string): Promise<JobView> {
  const job = await db.mcpJob.findFirst({
    where: { id: jobId, workspaceId: identity.workspaceId },
  });
  if (!job) throw new Error(`No job with id ${jobId} in this workspace.`);

  const stale =
    job.status === "RUNNING" && Date.now() - (job.startedAt ?? job.createdAt).getTime() > STALE_AFTER_MS;

  return {
    job_id: job.id,
    tool: job.tool,
    status: stale ? "failed" : job.status.toLowerCase(),
    ...(job.status === "DONE" ? { result: job.result } : {}),
    ...(job.error ? { error: job.error } : {}),
    ...(stale ? { error: "Job did not finish; the server most likely restarted. Run the tool again." } : {}),
    started_at: job.startedAt?.toISOString() ?? null,
    finished_at: job.finishedAt?.toISOString() ?? null,
    ...(job.status === "RUNNING" && !stale
      ? { note: "Still running. Poll again in about 15 seconds." }
      : {}),
  };
}

/** List recent jobs for the workspace (newest first). */
export async function listJobs(identity: TokenIdentity, limit = 10): Promise<JobView[]> {
  const jobs = await db.mcpJob.findMany({
    where: { workspaceId: identity.workspaceId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return jobs.map((j) => ({
    job_id: j.id,
    tool: j.tool,
    status: j.status.toLowerCase(),
    ...(j.error ? { error: j.error } : {}),
    started_at: j.startedAt?.toISOString() ?? null,
    finished_at: j.finishedAt?.toISOString() ?? null,
  }));
}

/**
 * On boot, fail any job still marked RUNNING - its process is gone. Called from
 * instrumentation.ts alongside the publisher and video-analyzer loops.
 */
export async function sweepStaleJobs(): Promise<void> {
  try {
    await db.mcpJob.updateMany({
      where: { status: { in: ["PENDING", "RUNNING"] } },
      data: {
        status: "FAILED",
        error: "Server restarted before this job finished. Run the tool again.",
        finishedAt: new Date(),
      },
    });
  } catch {
    // A sweep failure must never block boot.
  }
}
