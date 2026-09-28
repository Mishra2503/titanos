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

These cap how many tools they will accept from one server. Titan OS exposes 54,
which is over the limit for several of them, and the failure mode is a silent
drop rather than an error. Use the core profile:

```
https://<your-app>/api/mcp?tools=core
```

That serves 35 tools covering the whole workflow: read the workspace, ingest a
video, find what is working, turn it into a script or a card, schedule it, poll the job. Drop the
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
takes 30 to 120 seconds, while a large 4K video preparation can take up to an
hour on a constrained instance. Clients give up well before that. Those tools return a
`job_id` immediately:

```
sync_competitor        → { job_id, status: "running" }
get_job_status(job_id) → { status: "done", result: { … } }
```

Poll about every 15 seconds. `list_jobs` shows recent work and how it ended.

---

## Uploading and scheduling a video from an agent

A remote MCP server cannot open a path on the client machine. Passing
`/Users/name/Videos/reel.mp4` to Titan does not transfer the file.

Use the path that matches the client:

1. **ChatGPT or Codex attachment:** attach the video and call `ingest_media`.
   The tool declares OpenAI's `video_file` bridge, so the client supplies a
   temporary download URL. Poll `get_job_status`; only a `done` job means the
   delivery copy is ready, and `result.id` is the new `media_asset_id`.
2. **Public or signed HTTPS URL:** call `ingest_media` with `source_url`, poll
   the job, then use `result.id`. Titan blocks local/private addresses,
   revalidates redirects, caps the stream at 1 GB, and stores its own durable
   master.
3. **Claude Code, Codex, or another local coding agent:** call
   `create_media_upload`, `PUT` the raw file bytes to `upload_url` with the
   returned headers, then call `register_media_upload` with the unchanged
   `upload_token` and `storage_key`. Registration returns a job; poll it until
   `done`, then use `result.id`.

For an older item returned by `list_media`, call `prepare_media` and poll its
job before scheduling. `schedule_posts` refuses unprepared media instead of
accepting a schedule that is likely to fail at publish time.

Then call `get_safety_health` and `list_connections`. If
`publishing.enabled` is false, scheduling is still available but nothing will
auto-publish until the server kill switch is enabled. Finally call
`schedule_posts` with the media id, target account, future ISO 8601 time,
caption, hashtags, and a stable `idempotency_key`. Reuse that key only when
retrying the same uncertain call.

`schedule_posts` queues future work; it never means "already published".
Confirm the eventual result with `list_scheduled_posts` and look for
`PUBLISHED` plus a permalink.

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

**The agent can see a local video but Titan cannot.** Seeing/analyzing an
attachment and transferring it to a remote connector are different operations.
Use `ingest_media` for an OpenAI attachment/HTTPS URL, or the
`create_media_upload` → PUT → `register_media_upload` sequence for a local
coding agent. Do not base64-encode a large video into an MCP call.
