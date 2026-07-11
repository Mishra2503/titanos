import path from "node:path";
import { defineConfig } from "prisma/config";

// Which URL migrations connect through.
//
// Supabase's *transaction* pooler (DATABASE_URL, port 6543, pgbouncer) is great
// for runtime queries but cannot run migrations (no advisory locks / prepared
// statements). Its *direct* host (db.<ref>.supabase.co:5432) can, but is
// IPv6-only — and Render has no IPv6 egress, so migrations there fail with
// P1001 "can't reach database server".
//
// The fix: the SAME pooler host serves *session* mode on port 5432 over IPv4,
// which supports migrations. We derive that from DATABASE_URL so migrations
// never depend on DIRECT_URL being set correctly (the drift that broke login).
// Falls back to DIRECT_URL, then DATABASE_URL, for non-Supabase / local setups.
function migrationUrl(): string | undefined {
  const pooled = process.env.DATABASE_URL;
  if (pooled && pooled.includes("pooler.supabase.com")) {
    try {
      const u = new URL(pooled);
      u.port = "5432"; // 6543 (transaction) -> 5432 (session)
      u.searchParams.delete("pgbouncer");
      u.searchParams.delete("connection_limit");
      u.searchParams.delete("pool_timeout");
      return u.toString();
    } catch {
      // malformed URL — fall through to the plain fallbacks below
    }
  }
  return process.env.DIRECT_URL ?? pooled;
}

export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma/schema.prisma"),
  datasource: {
    url: migrationUrl(),
  },
});
