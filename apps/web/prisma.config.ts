import path from "node:path";
import { defineConfig } from "prisma/config";

// DIRECT_URL (port 5432, no pgbouncer) is preferred for migrations.
// Falls back to DATABASE_URL (pooler, port 6543) if DIRECT_URL is not set.
// On Render, both are injected as env vars. Locally, Next.js loads .env.local.
export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma/schema.prisma"),
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
