import { POST, GET, OPTIONS, DELETE } from "./route.js";
import { TOOLS, TOOL_MAP, CORE_TOOLS, toolsForProfile } from "./tools.js";
import { OUT } from "./outputs.js";

let fail = 0;
const ok = (cond, label, detail = "") => {
  if (!cond) fail++;
  console.log(`  ${cond ? "ok  " : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`);
};

// A stand-in for NextRequest carrying only what the route reads.
const req = (body, { auth = "Bearer tos_good", accept = "application/json, text/event-stream", url = "https://titan.example.com/api/mcp" } = {}) => ({
  headers: new Headers({ ...(auth ? { authorization: auth } : {}), accept, "content-type": "application/json" }),
  nextUrl: new URL(url),
  url,
  json: async () => body,
});

const rpc = (method, params, id = 1) => ({ jsonrpc: "2.0", id, method, params });

async function post(body, opts) {
  const res = await POST(req(body, opts));
  const text = await res.text();
  const isSse = (res.headers.get("content-type") ?? "").includes("text/event-stream");
  const json = text ? JSON.parse(isSse ? text.slice(text.indexOf("data: ") + 6).trim() : text) : null;
  return { res, json, text, isSse };
}

// ── minimal JSON Schema validator, enough to catch a real contract break ────
function validate(schema, value, path = "$") {
  const errs = [];
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  const actual = value === null ? "null" : Array.isArray(value) ? "array" : typeof value;
  const matches = types.some((t) =>
    t === undefined || t === actual ||
    (t === "integer" && Number.isInteger(value)) ||
    (t === "number" && actual === "number"));
  if (!matches) return [`${path}: expected ${types.join("|")}, got ${actual}`];
  if (types.includes("object") && actual === "object") {
    for (const r of schema.required ?? []) {
      if (!(r in value)) errs.push(`${path}: missing required "${r}"`);
    }
    for (const [k, v] of Object.entries(value)) {
      const sub = schema.properties?.[k];
      if (sub && v !== undefined) errs.push(...validate(sub, v, `${path}.${k}`));
    }
  }
  if (types.includes("array") && actual === "array" && schema.items) {
    value.forEach((v, i) => errs.push(...validate(schema.items, v, `${path}[${i}]`)));
  }
  return errs;
}

console.log("\n── handshake ─────────────────────────────────────────────");
{
  const { res, json } = await post(rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } }));
  ok(res.status === 200, "initialize -> 200", `${res.status}`);
  ok(json.result.protocolVersion === "2025-06-18", "protocol echoed", json.result.protocolVersion);
  ok(res.headers.get("MCP-Protocol-Version") === "2025-06-18", "version header set");
  ok(/never estimate/.test(json.result.instructions), "instructions forbid inventing metrics");
}
{
  const { json } = await post(rpc("initialize", { protocolVersion: "1999-01-01" }));
  ok(json.result.protocolVersion === "2025-06-18", "unknown protocol falls back", json.result.protocolVersion);
}

console.log("\n── tool catalogue ────────────────────────────────────────");
{
  const { json } = await post(rpc("tools/list", {}));
  const tools = json.result.tools;
  ok(tools.length === TOOLS.length, "full profile lists every tool", `${tools.length}`);
  ok(tools.every((t) => t.outputSchema?.type === "object"), "every tool has an object outputSchema");
  ok(tools.every((t) => t.title && t.title.length > 3), "every tool has a display title");
  ok(tools.every((t) => t.annotations), "every tool is annotated");
  ok(tools.every((t) => /^[a-zA-Z0-9_-]{1,64}$/.test(t.name)), "names are client-safe");
  ok(tools.every((t) => t.inputSchema?.type === "object"), "every inputSchema is an object");
}
{
  const { json } = await post(rpc("tools/list", {}), { url: "https://titan.example.com/api/mcp?tools=core" });
  const n = json.result.tools.length;
  ok(n <= 40 && n > 0, "core profile fits the 40-tool ceiling", `${n} tools`);
  ok(json.result.tools.some((t) => t.name === "get_job_status"), "core keeps get_job_status");
  ok(n < TOOLS.length, "core is a real subset", `${n} of ${TOOLS.length}`);
}

console.log("\n── typed results ─────────────────────────────────────────");
const READ_TOOLS = [
  ["get_workspace", {}], ["list_connections", {}], ["list_media", {}],
  ["list_scheduled_posts", {}], ["get_board", {}], ["list_competitors", {}],
  ["get_competitor", { id: "c1" }], ["get_competitor_analytics", { id: "c1" }],
  ["list_competitor_reels", { id: "c1", sort: "outlier" }],
  ["get_reel", { competitor_id: "c1", reel_id: "p1" }],
  ["list_competitor_snapshots", { id: "c1" }], ["list_competitor_reports", { id: "c1" }],
  ["get_competitor_report", { competitor_id: "c1", report_id: "r1" }],
  ["list_scripts", {}], ["get_script", { id: "sc1" }],
  ["get_insights_summary", {}], ["get_video_analysis_status", {}],
  ["get_safety_health", {}], ["get_job_status", { job_id: "job_123" }], ["list_jobs", {}],
  ["search", { query: "hook" }], ["fetch", { id: "reel:c1:p1" }],
  ["run_card_ai", { id: "cd1", action: "hooks" }],
  ["create_card", { column_id: "col1", title: "New idea" }],
  ["schedule_posts", { media_asset_id: "m1", posts: [{ ig_account_id: "a1", caption: "x", scheduled_at: "2026-09-01T09:00:00Z" }] }],
  ["cancel_scheduled_post", { id: "s1" }],
  ["refresh_connection", { id: "a1" }],
  ["sync_competitor", { id: "c1" }],
  ["send_reel_to_board", { competitor_id: "c1", reel_id: "p1" }],
];

let schemaBreaks = 0;
for (const [name, args] of READ_TOOLS) {
  const { json } = await post(rpc("tools/call", { name, arguments: args }));
  const r = json.result;
  if (r?.isError) { ok(false, `${name} succeeded`, r.content[0].text.slice(0, 90)); continue; }
  const sc = r?.structuredContent;
  const isObj = sc && typeof sc === "object" && !Array.isArray(sc);
  if (!isObj) { ok(false, `${name} returns an object structuredContent`); continue; }
  const errs = validate(OUT[name], sc);
  if (errs.length) { schemaBreaks++; ok(false, `${name} matches its outputSchema`, errs.slice(0, 2).join("; ")); }
}
ok(schemaBreaks === 0, `all ${READ_TOOLS.length} exercised tools match their declared schema`);
{
  const { json } = await post(rpc("tools/call", { name: "get_workspace", arguments: {} }));
  ok(Array.isArray(json.result.content) && json.result.content[0].type === "text", "content[] kept for older clients");
  ok(json.result.content[0].text.includes("Titan"), "text mirrors the structured data");
}

console.log("\n── error handling ────────────────────────────────────────");
{
  const { json } = await post(rpc("tools/call", { name: "get_workspac", arguments: {} }));
  ok(!json.error, "unknown tool is not a protocol error");
  ok(json.result.isError === true, "unknown tool is a recoverable tool error");
  ok(/did you mean/i.test(json.result.content[0].text), "suggests the near miss", json.result.content[0].text);
}
{
  const { json } = await post(rpc("tools/call", { name: "delete_card", arguments: { id: "cd1" } }), { auth: "Bearer tos_readonly" });
  ok(json.result.isError === true, "read-only token refused a write");
  ok(/read-only/i.test(json.result.content[0].text), "refusal explains why");
}
{
  const { json } = await post(rpc("tools/call", { name: "get_reel", arguments: { competitor_id: "c1", reel_id: "nope" } }));
  ok(json.result.isError === true, "missing reel surfaces as a tool error");
}
{
  const { res } = await post(rpc("tools/list", {}), { auth: null });
  ok(res.status === 401, "no token -> 401", `${res.status}`);
  ok((res.headers.get("www-authenticate") ?? "").includes("resource_metadata"), "401 points at OAuth discovery");
  ok((res.headers.get("www-authenticate") ?? "").includes("titan.example.com"), "discovery uses the PUBLIC origin");
}
{
  const { json } = await post(rpc("nonsense/method", {}));
  ok(json.error?.code === -32601, "unknown method -> -32601");
}

console.log("\n── transport ─────────────────────────────────────────────");
{
  const { res, isSse, text } = await post(rpc("ping", {}), { accept: "text/event-stream" });
  ok(isSse, "SSE-only client gets an event stream", res.headers.get("content-type"));
  ok(text.startsWith("event: message\ndata: "), "stream framing is correct");
  ok(res.headers.get("X-Accel-Buffering") === "no", "proxy buffering disabled");
}
{
  const { isSse } = await post(rpc("ping", {}), { accept: "application/json, text/event-stream" });
  ok(!isSse, "dual-accept client still gets fast JSON");
}
{
  const { res } = await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  ok(res.status === 202, "notification -> 202 with no body", `${res.status}`);
}
{
  const { json } = await post([rpc("ping", {}, 1), rpc("tools/list", {}, 2)]);
  ok(Array.isArray(json) && json.length === 2, "batch request answered as a batch");
}
{
  const r = GET();
  ok(r.status === 405, "GET -> 405 so clients fall back to POST", `${r.status}`);
  ok(DELETE().status === 204, "DELETE -> 204 clean teardown");
  ok(OPTIONS().status === 204, "OPTIONS -> 204 preflight");
  ok(OPTIONS().headers.get("Access-Control-Allow-Origin") === "*", "CORS open for browser clients");
}

console.log("\n── payload discipline ────────────────────────────────────");
{
  const { json } = await post(rpc("tools/call", { name: "list_competitor_reels", arguments: { id: "c1" } }));
  const txt = JSON.stringify(json.result.structuredContent);
  ok(!txt.includes("tttttt"), "list view carries no transcripts");
  const { json: full } = await post(rpc("tools/call", { name: "get_reel", arguments: { competitor_id: "c1", reel_id: "p1" } }));
  ok(full.result.structuredContent.ai_watch.transcript.length > 0, "get_reel does carry the transcript");
}
{
  const { json } = await post(rpc("tools/call", { name: "list_competitor_reels", arguments: { id: "c1", only_outliers: true } }));
  const reels = json.result.structuredContent.reels;
  ok(reels.length === 1 && reels[0].is_outlier, "only_outliers filters correctly");
}

console.log(fail === 0 ? `\nPASS — every check green\n` : `\nFAIL — ${fail} problem(s)\n`);
process.exit(fail ? 1 : 0);
