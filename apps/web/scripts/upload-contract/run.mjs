#!/usr/bin/env node
// Offline regression checks for the large-video multipart fallback.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import ts from "typescript";

const here = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(here, "../../lib/upload-limits.ts");
const source = readFileSync(sourcePath, "utf8");
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleShim = { exports: {} };
new Function("module", "exports", compiled)(moduleShim, moduleShim.exports);

const {
  MULTIPART_UPLOAD_PART_BYTES,
  isCompletedMultipartPartList,
  planMultipartParts,
} = moduleShim.exports;

const mib = 1024 * 1024;
const uploadedFileBytes = 274_698_417;
const parts = planMultipartParts(uploadedFileBytes);
assert.equal(MULTIPART_UPLOAD_PART_BYTES, 8 * mib);
assert.equal(parts.length, 33);
assert.deepEqual(parts[0], { partNumber: 1, start: 0, end: 8 * mib });
assert.deepEqual(parts.at(-1), { partNumber: 33, start: 256 * mib, end: uploadedFileBytes });
for (let index = 1; index < parts.length; index += 1) {
  assert.equal(parts[index].start, parts[index - 1].end, `gap before part ${index + 1}`);
}

assert.deepEqual(planMultipartParts(1), [{ partNumber: 1, start: 0, end: 1 }]);
assert.throws(() => planMultipartParts(0), /invalid_upload_size/);
assert.throws(() => planMultipartParts(10 * mib, 4 * mib), /invalid_part_size/);
assert.equal(isCompletedMultipartPartList([
  { part_number: 1, etag: '"first"' },
  { part_number: 2, etag: '"second"' },
]), true);
assert.equal(isCompletedMultipartPartList([
  { part_number: 2, etag: '"second"' },
]), false);

console.log("upload contract: exact 274,698,417-byte master -> 33 contiguous parts; completion list validation passed");

const require = createRequire(import.meta.url);
const policyPath = path.resolve(here, "../../lib/server/remoteMediaPolicy.ts");
const policySource = readFileSync(policyPath, "utf8");
const policyCompiled = ts.transpileModule(policySource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
const policyShim = { exports: {} };
new Function("require", "module", "exports", policyCompiled)(require, policyShim, policyShim.exports);
const {
  isPublicImportAddress,
  parseRemoteMediaUrl,
  redactRemoteMediaUrl,
  remoteMediaFilename,
} = policyShim.exports;

assert.equal(isPublicImportAddress("8.8.8.8"), true);
for (const address of ["127.0.0.1", "10.0.0.1", "169.254.169.254", "172.16.0.1", "192.168.1.2", "::1"]) {
  assert.equal(isPublicImportAddress(address), false, `${address} must be rejected`);
}
assert.throws(() => parseRemoteMediaUrl("http://cdn.example.com/reel.mp4"), /HTTPS/);
assert.throws(() => parseRemoteMediaUrl("https://localhost/reel.mp4"), /public hostname/);
assert.throws(() => parseRemoteMediaUrl("https://127.0.0.1/reel.mp4"), /private or reserved/);
assert.throws(() => parseRemoteMediaUrl("https://cdn.example.com:8443/reel.mp4"), /standard HTTPS port/);
assert.equal(
  redactRemoteMediaUrl("https://cdn.example.com/reel.mp4?X-Amz-Signature=secret#fragment"),
  "https://cdn.example.com/reel.mp4",
);
assert.equal(remoteMediaFilename(new URL("https://cdn.example.com/reel.mov")), "reel.mov");
assert.equal(remoteMediaFilename(new URL("https://cdn.example.com/download"), "campaign"), "campaign.mp4");

console.log("upload contract: remote imports reject private networks and redact signed URL secrets");
