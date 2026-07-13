// Next.js instrumentation hook — runs once when the server boots.
// Starts the background loops: scheduled-post publisher + video analyzer.
// NOTE: the dynamic imports MUST stay directly inside the
// `process.env.NEXT_RUNTIME === "nodejs"` condition — Next statically
// eliminates that branch from the Edge compile; any other shape pulls
// pg/node builtins into the Edge bundle and breaks the build.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.ENABLE_PUBLISHER !== "false") {
      const { startPublisherLoop } = await import("@/lib/server/publisher");
      startPublisherLoop();
    }
    if (process.env.ENABLE_VIDEO_ANALYZER !== "false") {
      const { startVideoAnalyzerLoop } = await import("@/lib/server/videoAnalyzer");
      startVideoAnalyzerLoop();
    }
  }
}
