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
const route = readFileSync(path.join(web, "app/api/schedule/tick/route.ts"), "utf8");
const worker = readFileSync(path.join(repo, "infra/cloudflare/titan-scheduler/src/index.js"), "utf8");
const wrangler = readFileSync(path.join(repo, "infra/cloudflare/titan-scheduler/wrangler.toml"), "utf8");
const githubClock = readFileSync(path.join(repo, ".github/workflows/titan-scheduler-clock.yml"), "utf8");

assert.match(route, /publishDuePosts\(\{ maxPosts: 1 \}\)/, "external tick must bound publishing work");
assert.doesNotMatch(route, /videoAnalyzer|analyzePendingVideos/, "publisher tick must not run video analysis");
assert.match(route, /x-cron-secret/, "external tick must require the cron secret");
assert.match(publisher, /if \(running\) return/, "internal publisher ticks must not overlap");
assert.match(publisher, /void tick\(\);\s*setInterval/, "publisher must catch up immediately at startup");
assert.match(worker, /"x-cron-secret": env\.TITAN_CRON_SECRET/, "Worker must authenticate to Titan");
assert.match(wrangler, /crons = \["\* \* \* \* \*"\]/, "Worker must run once per minute");
assert.match(githubClock, /cron: "2-57\/5 \* \* \* \*"/, "GitHub backstop must run every five minutes");
assert.match(githubClock, /secrets\.TITAN_CRON_SECRET/, "GitHub backstop must use an encrypted secret");

console.log("scheduler contract: publisher-only authenticated minute clock and startup catch-up passed");
