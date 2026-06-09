import path from "node:path";
import { defineConfig } from "prisma/config";
import { config } from "dotenv";

// Prisma CLI doesn't load .env.local automatically (Next.js does at runtime).
// Load it here so `prisma migrate dev` picks up DATABASE_URL / DIRECT_URL.
config({ path: path.join(import.meta.dirname, ".env.local") });

export default defineConfig({
  schema: path.join(import.meta.dirname, "prisma/schema.prisma"),
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
