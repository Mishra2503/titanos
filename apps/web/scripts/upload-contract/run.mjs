#!/usr/bin/env node
// Offline regression checks for the large-video multipart fallback.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
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
