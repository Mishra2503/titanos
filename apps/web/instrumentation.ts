// Next.js instrumentation hook — runs once when the server boots.
// Starts the background loop that publishes due scheduled posts.
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/server/env");
  assertEnv();

  // Skip the publisher when explicitly disabled, or when DATABASE_URL is missing —
  // the latter keeps a misconfigured local boot clean instead of spamming ECONNREFUSED.
  if (process.env.ENABLE_PUBLISHER !== "false" && process.env.DATABASE_URL) {
    const { startPublisherLoop } = await import("@/lib/server/publisher");
    startPublisherLoop();
  }
}
