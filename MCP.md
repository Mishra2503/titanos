# Titan OS MCP connector

One endpoint, every client. Titan OS speaks MCP over Streamable HTTP at:

```
https://<your-app>/api/mcp
```

Auth is a Bearer token: either a Personal Access Token you mint in Settings
(`tos_…`), or an OAuth 2.1 access token for clients that run the sign-in flow
themselves.

---

## Connecting

### Claude (desktop, web, Code)

Settings → Connectors → Add custom connector.

| Field | Value |
|---|---|
| URL | `https://<your-app>/api/mcp` |
| Auth | OAuth (Claude runs the flow) or Bearer PAT |

For Claude Code from the terminal:

```bash
claude mcp add --transport http titan-os https://<your-app>/api/mcp \
  --header "Authorization: Bearer tos_your_token"
```

### ChatGPT

Settings → Connectors → Create. Point it at the same URL. ChatGPT discovers
OAuth automatically from `/.well-known/oauth-protected-resource`, which the 401
response advertises.

ChatGPT also uses the `search` and `fetch` tools for deep research. Both return
the exact shape it expects, so citations resolve to real Titan OS URLs.

### Perplexity

Perplexity's connector is stricter about content type than the others. It sends
`Accept: text/event-stream` and rejects a JSON body. The endpoint reads the
Accept header and answers as an event stream when that is what was asked for, so
no separate URL is needed.

### Cursor, Antigravity, Windsurf, and other editors

These cap how many tools they will accept from one server. Titan OS exposes 50,
which is over the limit for several of them, and the failure mode is a silent
drop rather than an error. Use the core profile:

```
https://<your-app>/api/mcp?tools=core
```

That serves 31 tools covering the whole workflow: read the workspace, find what
is working, turn it into a script or a card, schedule it, poll the job. Drop the
query param once you need the long tail.

`~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "titan-os": {
      "url": "https://<your-app>/api/mcp?tools=core",
      "headers": { "Authorization": "Bearer tos_your_token" }
    }
  }
}
```

### Anything else

Any MCP client that speaks Streamable HTTP works. Point it at the URL, set the
Authorization header, and it will negotiate the rest. Protocol versions
`2025-06-18`, `2025-03-26`, and `2024-11-05` are all accepted.

---

## What the model sees

Every tool declares an `outputSchema`, and every successful call returns
`structuredContent`: the result as a real JSON object, next to the text copy
older clients still read.

This matters more than it sounds. Without a schema the client hands the model a
JSON string to read as prose, and the model fills gaps by guessing, which is how
metrics that were never in Titan OS end up in an answer. With one, the model
gets typed fields and knows a `null` means "not captured" rather than "zero".

The server-level instructions reinforce it: numbers come from the Instagram
Graph API or a stored scrape, and a missing number is reported as missing.

---

## Long-running work

Anything that calls Claude (reports, deep reel analysis, script writing, syncs)
takes 30 to 120 seconds. Clients give up well before that. Those tools return a
`job_id` immediately:

```
sync_competitor        → { job_id, status: "running" }
get_job_status(job_id) → { status: "done", result: { … } }
```

Poll about every 15 seconds. `list_jobs` shows recent work and how it ended.

---

## Verifying it

Two checks, both non-zero exit on failure.

**Offline, no server or database needed.** Runs the real route handler and the
real tool table against canned payloads shaped like the REST routes answer, then
validates every result against the schema that tool advertises:

```bash
cd apps/web && npm run test:mcp
```

Run this after touching anything under `lib/server/mcp/`. It catches the failure
`tsc` cannot see: a field declared as an object that arrives as null, which a
validating client rejects the whole result over.

**Against a deployment:**

```bash
cd apps/web && npm run test:mcp:live -- https://<your-app>/api/mcp tos_your_token
```

Handshake, schema audit, a real tool call, SSE negotiation, and the 401 path.

---

## Troubleshooting

**"Connector failed" right after adding it.** Check `NEXT_PUBLIC_APP_URL` is set
to the public HTTPS origin. Behind a proxy the request carries the internal bind
address, and every discovery hint then points at localhost.

**Tools missing in an editor.** You are over its tool cap. Add `?tools=core`.

**A tool times out.** Calls are cut off at 25 seconds with a message naming the
tool, tunable with `MCP_TOOL_TIMEOUT_MS`. If a read is hitting it, narrow the
request: a smaller `limit`, one competitor at a time.

**Search feels slow.** It reads up to eight competitors. Those reads run
together and are cached for 10 seconds, so a follow-up question in the same turn
is close to free.

**401 on every call.** The token is revoked, expired, or belongs to a suspended
user. Mint a new one in Settings.

**Writes rejected as read-only.** The token has a `read` scope without `write`,
or the user's role is VIEWER. Both are enforced server side; the tool list does
not hide write tools, it refuses them.
