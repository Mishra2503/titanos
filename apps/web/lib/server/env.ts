// Boot-time environment validation. Surfaces a mis-named or missing required var
// as one explicit log line at startup, instead of an opaque ECONNREFUSED 60s later
// when the publisher loop first touches the DB.
//
// NOTE: variable names are UNDERSCORED (DATABASE_URL, JWT_SECRET, FERNET_KEY) —
// matching what the code actually reads. A common mistake is dropping the
// underscores in .env.local, which leaves every var undefined at runtime.

const REQUIRED = ["DATABASE_URL", "JWT_SECRET", "FERNET_KEY"] as const;

function safeHost(url?: string): string {
  if (!url) return "(unset)";
  try {
    return new URL(url).host;
  } catch {
    return "(unparseable)";
  }
}

export function assertEnv(): void {
  const missing = REQUIRED.filter((k) => !process.env[k]);
  if (missing.length) {
    console.error(
      `[env] Missing required vars: ${missing.join(", ")}. ` +
        `Check apps/web/.env.local — names are UNDERSCORED (DATABASE_URL, not DATABASEURL).`,
    );
  }
  console.log(
    `[env] DATABASE_URL host: ${safeHost(process.env.DATABASE_URL)} | ` +
      `publisher: ${process.env.ENABLE_PUBLISHER !== "false"}`,
  );
}
