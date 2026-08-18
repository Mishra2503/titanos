#!/usr/bin/env node
// Offline contract test for the Titan OS MCP endpoint.
//
// Runs the real route handler and the real tool table against canned payloads
// shaped exactly like the REST routes answer, then validates every result
// against the outputSchema that tool advertises.
//
// This exists because the failure it catches is invisible to `tsc`. A field
// declared as an object but delivered as null typechecks perfectly and then
// makes a validating client reject the whole tool result at runtime, which
// reaches the user as an intermittent "the connector errored" with nothing
// naming the field. Ask a stricter question than the compiler does.
//
//   node scripts/mcp-contract/run.mjs
//
// No server, no database, no network.

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, cpSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const web = path.resolve(here, "../..");

let work;
try {
  work = mkdtempSync(path.join(tmpdir(), "titan-mcp-contract-"));
  const mcp = path.join(work, "mcp");

  // Transpile the four real modules, rewriting their imports at the seams.
  execFileSync(process.execPath, [path.join(here, "transpile.cjs"), web, work], { stdio: "inherit" });

  // Drop the stubs and the assertions in alongside them.
  for (const f of readdirSync(here)) {
    if (f.startsWith("stub-") || f === "contract.mjs") cpSync(path.join(here, f), path.join(mcp, f));
  }
  execFileSync(process.execPath, ["-e", 'require("fs").writeFileSync(process.argv[1], JSON.stringify({type:"module"}))', path.join(mcp, "package.json")]);

  await import(pathToFileURL(path.join(mcp, "contract.mjs")).href);
} catch (e) {
  if (e?.status !== undefined) process.exit(e.status);
  console.error("\ncontract test could not run:", e.message);
  console.error("(this harness needs `sucrase`, which ships with the app's dependencies)\n");
  process.exit(1);
} finally {
  if (work) rmSync(work, { recursive: true, force: true });
}
