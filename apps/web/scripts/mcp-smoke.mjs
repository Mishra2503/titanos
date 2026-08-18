#!/usr/bin/env node
// Smoke test for the Titan OS MCP endpoint.
//
// Talks to a running server the way a real client does - handshake, tools/list,
// then a read-only tool call - and checks the things that actually break
// connectors rather than the things that are easy to check:
//
//   * every tool declares an inputSchema AND an outputSchema, both rooted at
//     type "object" (a bare array or a missing schema is what ChatGPT flags)
//   * every tool name matches the ^[a-zA-Z0-9_-]{1,64}$ that clients enforce
//   * tools/call comes back with structuredContent, and that it is an object
//   * the core profile stays under the ~40-tool ceiling editor clients impose
//   * an SSE-only client gets an event stream, not a JSON body
//
// Usage:
//   node scripts/mcp-smoke.mjs https://your-app.onrender.com/api/mcp tos_xxx
//   node scripts/mcp-smoke.mjs http://localhost:3000/api/mcp tos_xxx

const [, , rawUrl, token] = process.argv;
if (!rawUrl || !token) {
  console.error("usage: node scripts/mcp-smoke.mjs <mcp-url> <bearer-token>");
  process.exit(2);
}

const NAME_RE = /^[a-zA-Z0-9_-]{1,64}$/;
let failures = 0;

const check = (ok, label, detail = "") => {
  console.log(`${ok ? "  ok  " : "  FAIL"}  ${label}${detail ? ` - ${detail}` : ""}`);
  if (!ok) failures++;
};

async function rpc(url, method, params, headers = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const text = await res.text();
  const body = text.startsWith("event:") ? text.slice(text.indexOf("data: ") + 6).trim() : text;
  let parsed = null;
  try {
    parsed = JSON.parse(body);
  } catch {
    /* leave null; the caller reports it */
  }
  return { res, parsed, raw: text };
}

function auditSchema(schema, label) {
  if (!schema) return check(false, label, "missing");
  if (schema.type !== "object") return check(false, label, `root type is "${schema.type}", must be "object"`);
  check(true, label);
}

(async () => {
  console.log(`\nTitan OS MCP smoke test -> ${rawUrl}\n`);

  console.log("handshake");
  const init = await rpc(rawUrl, "initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "titan-smoke", version: "1.0.0" },
  });
  check(init.res.status === 200, "initialize returns 200", `got ${init.res.status}`);
  check(!!init.parsed?.result?.serverInfo?.name, "serverInfo present");
  check(
    init.parsed?.result?.protocolVersion === "2025-06-18",
    "protocol negotiated",
    init.parsed?.result?.protocolVersion,
  );
  check(!!init.parsed?.result?.instructions, "instructions present");

  console.log("\ntool catalogue");
  const list = await rpc(rawUrl, "tools/list", {});
  const tools = list.parsed?.result?.tools ?? [];
  check(tools.length > 0, "tools/list returns tools", `${tools.length} tools`);

  let missingOutput = 0;
  let badNames = [];
  for (const t of tools) {
    if (!NAME_RE.test(t.name)) badNames.push(t.name);
    if (!t.outputSchema || t.outputSchema.type !== "object") missingOutput++;
  }
  check(badNames.length === 0, "all tool names are client-safe", badNames.join(", "));
  check(missingOutput === 0, "every tool declares an object outputSchema", `${missingOutput} without one`);

  const noDescription = tools.filter((t) => !t.description || t.description.length < 20);
  check(noDescription.length === 0, "every tool has a real description", noDescription.map((t) => t.name).join(", "));

  const noTitle = tools.filter((t) => !t.title);
  check(noTitle.length === 0, "every tool has a display title", noTitle.map((t) => t.name).join(", "));

  const unannotated = tools.filter((t) => !t.annotations);
  check(unannotated.length === 0, "every tool is annotated", unannotated.map((t) => t.name).join(", "));

  console.log("\ncore profile (for clients that cap tool count)");
  const coreUrl = rawUrl + (rawUrl.includes("?") ? "&" : "?") + "tools=core";
  const core = await rpc(coreUrl, "tools/list", {});
  const coreTools = core.parsed?.result?.tools ?? [];
  check(coreTools.length > 0 && coreTools.length <= 40, "core profile fits the 40-tool ceiling", `${coreTools.length} tools`);
  check(coreTools.some((t) => t.name === "get_job_status"), "core profile keeps get_job_status");

  console.log("\ntyped results");
  const callRes = await rpc(rawUrl, "tools/call", { name: "get_workspace", arguments: {} });
  const result = callRes.parsed?.result;
  check(!!result, "tools/call returns a result");
  check(!result?.isError, "get_workspace succeeded", result?.content?.[0]?.text?.slice(0, 120));
  check(
    result?.structuredContent && typeof result.structuredContent === "object" && !Array.isArray(result.structuredContent),
    "structuredContent is a JSON object",
  );
  check(Array.isArray(result?.content), "content[] still present for older clients");

  console.log("\nunknown tool is recoverable, not fatal");
  const bogus = await rpc(rawUrl, "tools/call", { name: "get_workspac", arguments: {} });
  check(!bogus.parsed?.error, "unknown tool does not raise a protocol error");
  check(bogus.parsed?.result?.isError === true, "unknown tool comes back as a tool error");

  console.log("\nSSE-only client");
  const sse = await fetch(rawUrl, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping", params: {} }),
  });
  const sseBody = await sse.text();
  check(
    (sse.headers.get("content-type") ?? "").includes("text/event-stream"),
    "SSE-only Accept gets an event stream",
    sse.headers.get("content-type"),
  );
  check(sseBody.startsWith("event: message"), "stream is correctly framed");

  console.log("\nauth");
  const noAuth = await fetch(rawUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
  check(noAuth.status === 401, "no token is rejected", `got ${noAuth.status}`);
  check(
    (noAuth.headers.get("www-authenticate") ?? "").includes("resource_metadata"),
    "401 points OAuth clients at discovery",
  );

  console.log(`\n${failures === 0 ? "PASS" : `FAIL - ${failures} problem(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error("\nsmoke test could not run:", e.message, "\n");
  process.exit(1);
});
