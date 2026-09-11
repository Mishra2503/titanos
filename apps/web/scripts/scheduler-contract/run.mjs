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
const instagramMedia = readFileSync(path.join(web, "lib/server/instagramMedia.ts"), "utf8");
const instagramTokens = readFileSync(path.join(web, "lib/server/instagramTokens.ts"), "utf8");
const connectionsPage = readFileSync(path.join(web, "app/(app)/connections/page.tsx"), "utf8");
const mediaRegister = readFileSync(path.join(web, "app/api/media/register/route.ts"), "utf8");

assert.match(route, /publishDuePosts\(\{ maxPosts: 1 \}\)/, "external tick must bound publishing work");
assert.doesNotMatch(route, /videoAnalyzer|analyzePendingVideos/, "publisher tick must not run video analysis");
assert.match(route, /x-cron-secret/, "external tick must require the cron secret");
assert.match(route, /jwtVerify/, "GitHub clock must use verified OIDC identity");
assert.match(route, /payload\.workflow_ref === GITHUB_WORKFLOW_REF/, "OIDC identity must be workflow-scoped");
assert.match(route, /export async function GET/, "scheduler must expose protected read-only diagnostics");
assert.match(route, /export async function PUT/, "scheduler must expose a protected non-publishing preparation check");
assert.match(route, /prepareInstagramMedia\(post\.campaign\.mediaAsset\)/, "preparation check must build the cached delivery copy");
assert.match(route, /prepared: true/, "preparation check must report a successful cache build");
const preparationHandler = route.match(/export async function PUT[\s\S]*?(?=\/\/ Authenticated publisher-only trigger)/)?.[0] ?? "";
assert.doesNotMatch(preparationHandler, /publishDuePosts|graphPost|media_publish/, "preparation check must never publish a post");
assert.match(route, /export async function PATCH/, "scheduler must expose protected non-publishing token maintenance");
assert.match(route, /const tokens = await maintainInstagramTokens\(\)/, "every publisher tick must maintain Instagram tokens first");
assert.doesNotMatch(route, /select:\s*\{[^}]*caption:/s, "diagnostics must not expose captions");
assert.match(publisher, /if \(running\) return/, "internal publisher ticks must not overlap");
assert.match(publisher, /void tick\(\);\s*setInterval/, "publisher must catch up immediately at startup");
assert.match(publisher, /SCHEDULER_MAX_LATE_MINUTES/, "publisher must bound how late a missed post can run");
assert.match(publisher, /Missed the.*publishing window[\s\S]*Retry manually/, "days-old posts must require a manual retry");
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
assert.match(instagramMedia, /"-threads", FFMPEG_THREADS/, "video encoding must be single-threaded on the free instance");
assert.match(instagramMedia, /"-filter_threads", FFMPEG_THREADS/, "video filters must be single-threaded on the free instance");
assert.match(instagramMedia, /decoder thread pool[\s\S]*?"-threads", FFMPEG_THREADS,\s*"-i", inputPath/, "video decoding must be single-threaded on the free instance");
assert.match(instagramMedia, /INSTAGRAM_DELIVERY_WIDTH_PX = 1080/, "oversized masters must use the standard 1080px Reel delivery width");
assert.match(instagramMedia, /"-preset", "ultrafast"/, "video preparation must use the lowest-memory x264 preset");
assert.match(instagramMedia, /"-tune", "zerolatency"/, "video preparation must avoid a buffered frame queue");
assert.doesNotMatch(instagramMedia, /"-preset", "slow"/, "video preparation must not use the CPU-heavy slow preset");
assert.match(instagramTokens, /REFRESH_WINDOW_MS = 7 \*/, "tokens must refresh seven days before expiry");
assert.match(instagramTokens, /status: "NEEDS_REAUTH"/, "expired tokens must be marked for OAuth reauthorization");
assert.match(instagramTokens, /grant_type.*ig_refresh_token/s, "token maintenance must use Instagram's refresh grant");
assert.match(connectionsPage, /a\.status === "NEEDS_REAUTH" \? "Reconnect" : "Refresh"/, "expired accounts must show a reconnect action");
assert.match(instagramMedia, /__titanInstagramMediaInFlight/, "delivery preparation must deduplicate work per asset");
assert.match(mediaRegister, /void prepareInstagramMedia\(asset\)/, "delivery preparation must start immediately after upload registration");

console.log("scheduler contract: authenticated minute clock, startup catch-up, and bounded video preparation passed");
