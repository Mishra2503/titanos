// Next.js instrumentation hook — runs once when the server boots.
// Starts the background loop that publishes due scheduled posts.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.ENABLE_PUBLISHER !== "false") {
    const { startPublisherLoop } = await import("@/lib/server/publisher");
    startPublisherLoop();
  }
}
