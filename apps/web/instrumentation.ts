// Next.js instrumentation hook — runs once when the server boots.
// Starts the background loops: scheduled-post publisher + video analyzer.
// NOTE: the dynamic imports MUST stay directly inside the
// `process.env.NEXT_RUNTIME === "nodejs"` condition — Next statically
// eliminates that branch from the Edge compile; any other shape pulls
// pg/node builtins into the Edge bundle and breaks the build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { assertEnv } = await import("@/lib/server/env");
    assertEnv();

    // Skip the publisher when explicitly disabled, or when DATABASE_URL is missing —
    // the latter keeps a misconfigured local boot clean instead of spamming ECONNREFUSED.
    if (process.env.ENABLE_PUBLISHER !== "false" && process.env.DATABASE_URL) {
      const { startPublisherLoop } = await import("@/lib/server/publisher");
      startPublisherLoop();
    }
    if (process.env.ENABLE_VIDEO_ANALYZER !== "false") {
      const { startVideoAnalyzerLoop } = await import("@/lib/server/videoAnalyzer");
      startVideoAnalyzerLoop();
    }

    // The external database clock survives Render sleep/restarts and wakes the
    // publisher endpoint once per minute. It is independent of ENABLE_PUBLISHER,
    // which can stay false on constrained free instances.
    if (process.env.ENABLE_EXTERNAL_SCHEDULER !== "false" && process.env.DATABASE_URL && process.env.CRON_SECRET) {
      const { startExternalSchedulerBootstrap } = await import("@/lib/server/externalScheduler");
      startExternalSchedulerBootstrap();
    }

    // MCP jobs run in-process, so a restart strands anything mid-flight.
    // Fail those rows now rather than leaving an LLM polling them forever.
    if (process.env.DATABASE_URL) {
      const { sweepStaleJobs } = await import("@/lib/server/mcp/jobs");
      void sweepStaleJobs();
    }
  }
}
