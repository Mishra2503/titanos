#!/usr/bin/env node
// Offline regression checks for the external scheduled-publishing clock.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
const repo = path.resolve(web, "../..");

const publisher = readFileSync(path.join(web, "lib/server/publisher.ts"), "utf8");
const externalScheduler = readFileSync(path.join(web, "lib/server/externalScheduler.ts"), "utf8");
const instrumentation = readFileSync(path.join(web, "instrumentation.ts"), "utf8");
const route = readFileSync(path.join(web, "app/api/schedule/tick/route.ts"), "utf8");
const worker = readFileSync(path.join(repo, "infra/cloudflare/titan-scheduler/src/index.js"), "utf8");
const wrangler = readFileSync(path.join(repo, "infra/cloudflare/titan-scheduler/wrangler.toml"), "utf8");
const githubClock = readFileSync(path.join(repo, ".github/workflows/titan-scheduler-clock.yml"), "utf8");

assert.match(route, /publishDuePosts\(\{ maxPosts: 1 \}\)/, "external tick must bound publishing work");
assert.doesNotMatch(route, /videoAnalyzer|analyzePendingVideos/, "publisher tick must not run video analysis");
assert.match(route, /x-cron-secret/, "external tick must require the cron secret");
assert.match(route, /jwtVerify/, "GitHub clock must use verified OIDC identity");
assert.match(route, /payload\.workflow_ref === GITHUB_WORKFLOW_REF/, "OIDC identity must be workflow-scoped");
assert.match(route, /export async function GET/, "scheduler must expose protected read-only diagnostics");
assert.doesNotMatch(route, /select:\s*\{[^}]*caption:/s, "diagnostics must not expose captions");
assert.match(publisher, /if \(running\) return/, "internal publisher ticks must not overlap");
assert.match(publisher, /void tick\(\);\s*setInterval/, "publisher must catch up immediately at startup");
assert.match(worker, /"x-cron-secret": env\.TITAN_CRON_SECRET/, "Worker must authenticate to Titan");
assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/, "Worker must run once per minute");
assert.match(githubClock, /cron: "2,7,12,17,22,27,32,37,42,47,52,57 \* \* \* \*"/, "GitHub backstop must run every five minutes");
assert.match(githubClock, /id-token: write/, "GitHub backstop must request a short-lived OIDC identity");
assert.match(githubClock, /audience=titan-os-scheduler/, "GitHub OIDC audience must be Titan-specific");
assert.doesNotMatch(githubClock, /secrets\./, "GitHub clock must not require a copied long-lived secret");
assert.match(externalScheduler, /cron\.schedule/, "Supabase must own an external publisher clock");
assert.match(externalScheduler, /\* \* \* \* \*/, "Supabase clock must run every minute");
assert.match(externalScheduler, /net\.http_post/, "Supabase clock must wake Titan over HTTP");
assert.match(instrumentation, /startExternalSchedulerBootstrap/, "server boot must install the Supabase clock");

console.log("scheduler contract: publisher-only authenticated minute clock and startup catch-up passed");
