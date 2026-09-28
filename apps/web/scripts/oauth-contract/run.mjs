#!/usr/bin/env node
// Offline regression test for the OAuth login redirect behind a reverse proxy.
// Render presents the app to Next.js as https://localhost:10000; that internal
// address must never be sent to an MCP client or browser.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");
let work;

function request(url, headers = {}) {
  return { url, nextUrl: new URL(url), headers: new Headers(headers) };
}

try {
  work = mkdtempSync(path.join(tmpdir(), "titan-oauth-contract-"));
  execFileSync(process.execPath, [path.join(here, "transpile.cjs"), web, work], { stdio: "inherit" });
  for (const file of ["stub-jwt.js", "stub-next.js", "stub-oauth.js"]) {
    cpSync(path.join(here, file), path.join(work, file));
  }
  writeFileSync(path.join(work, "package.json"), JSON.stringify({ type: "module" }));

  const { GET } = await import(pathToFileURL(path.join(work, "authorize.js")).href);

  process.env.NEXT_PUBLIC_APP_URL = "https://titanos-dwh6.onrender.com/";
  const query = new URLSearchParams({
    response_type: "code",
    client_id: "client-1",
    redirect_uri: "https://client.example/callback",
    code_challenge: "challenge",
    code_challenge_method: "S256",
    state: "state-1",
  });
  const internal = `https://localhost:10000/api/oauth/authorize?${query}`;
  const response = await GET(request(internal));
  const location = response.headers.get("location");
  assert.equal(response.status, 302);
  assert.ok(location, "authorization response has a Location header");
  const login = new URL(location);
  assert.equal(login.origin, "https://titanos-dwh6.onrender.com");
  assert.equal(login.pathname, "/login");
  assert.equal(login.searchParams.get("next"), `/api/oauth/authorize?${query}`);
  assert.equal(location.includes("localhost:10000"), false);

  delete process.env.NEXT_PUBLIC_APP_URL;
  const forwarded = await GET(request(internal, {
    "x-forwarded-host": "titan.aifluencee.com",
    "x-forwarded-proto": "https",
  }));
  assert.equal(new URL(forwarded.headers.get("location")).origin, "https://titan.aifluencee.com");

  console.log("PASS - OAuth login redirects always use the public Titan OS origin");
} catch (error) {
  console.error("FAIL - OAuth public-origin contract", error);
  process.exitCode = 1;
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
