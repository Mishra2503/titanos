# Titan OS — Account Safety

This document explains every guardrail Titan OS uses to keep your Instagram
accounts from being flagged, frozen, or banned, and what's left for you to do
to fully verify the app with Meta.

## TL;DR

You're using Titan OS in the safest possible way already: official Meta Graph
API only, no proxies, no scraping, no anti-detect anything. On top of that, the
app runs five active guardrails before every publish:

1. **Per-account daily cap** (default 3) — stops bursts that look bot-like.
2. **Per-account hourly cap** (default 1) — stops same-hour spam.
3. **Minimum 90-min gap** between posts on the same account.
4. **±90s publish jitter** so nothing fires at a machine-precise second.
5. **Cross-account spacing** when scheduling the same master to many accounts.

These caps are stricter than Meta's own (100/24h). They run *before* Meta even
sees the request, so you can't accidentally cross a line.

## What gets accounts banned (and how we mitigate each)

| Real Meta ban trigger | Our mitigation |
|---|---|
| Unofficial APIs / scraping | We use the official Instagram Graph API only (Rail #1). |
| Posting bursts | Daily + hourly caps + minimum gap, all enforced before scheduling. |
| Machine-precise timestamps | Publish-time jitter randomizes the actual API call by ±90s. |
| Identical content across accounts | You generate per-account captions via the Content Board AI assist. |
| Hashtag stuffing | Cards cap practically at 15 (UI guidance); Meta hard-caps at 30. |
| Rate-limit violations | We call `content_publishing_limit` before every publish and refuse if at cap. |
| Token compromise | Tokens are Fernet-encrypted at rest, never sent to the browser. |
| Token expiry | Auto-refresh worker re-rolls long-lived tokens before the 60-day deadline. |
| Sudden activity spike | Conservative defaults (3/day) make even max usage look like a normal creator. |

## What you'll see in the UI

- **Connections page** — every account card shows a **Safety badge** (Safe /
  Caution / Pause) with a one-line reason and your `posts in 24h / 7d` counts.
- **Composer (Post & Schedule)** — if your batch would breach any cap, the
  schedule call is rejected with a clear message before any post is created.
- **Audit log** — every publish (success or failure) is recorded server-side
  for compliance.

## Tunable defaults

These live in `apps/api/.env` and the server reads them on boot:

```
SAFETY_ENABLED=true
SAFETY_DAILY_CAP=3
SAFETY_HOURLY_CAP=1
SAFETY_MIN_GAP_MINUTES=90
SAFETY_JITTER_SECONDS=90
```

Bump them carefully. Going higher than `5/day` per account starts to look
unusual for a creator and reduces the safety margin.

## What "verified" actually means with Meta

The word gets used for two different things:

1. **App Review** — what the Titan OS app needs to leave Development mode.
   Once approved, any IG Business/Creator account can connect (today only the
   accounts you add as "Instagram Testers" can). Not paid; it's a submission +
   approval process. See checklist below.
2. **Meta Verified** — the blue check on the IG account itself. Separate
   subscription, completely unrelated to our app, has zero effect on ban risk.

## App Review prep checklist

When you're ready to take Titan OS to non-tester users, you'll need:

- [ ] **Privacy policy** hosted at a public URL (typical: yourdomain.com/privacy).
- [ ] **Terms of service** at a public URL.
- [ ] **Data deletion** endpoint or URL (we own a `/disconnect` flow already; just need a public page explaining it).
- [ ] **Business verification** on the Meta app (verify your business with Meta — separate flow).
- [ ] **App icon + name + tagline** that clearly describe a content-scheduling tool.
- [ ] **Screencast** (≤3 min) showing the full flow: connect IG → compose a reel → schedule → live publish via the official API.
- [ ] **Use-case explanation** for each of the three scopes we request:
  - `instagram_business_basic` — read account profile to display it in the dashboard.
  - `instagram_business_manage_insights` — show reach/engagement per post.
  - `instagram_business_content_publish` — schedule and publish reels on behalf of the user.
- [ ] **Test credentials** (a working IG account) for the Meta reviewer to use.

Submit all this in the Meta Developer dashboard → your Titan OS app → App
Review. Reviews usually take 1–3 weeks; rejections are common on the first
pass and almost always about documentation clarity, not the app's actual
behavior.

## What this doc cannot guarantee

Meta's enforcement systems are opaque and change frequently. Following every
rule here dramatically reduces ban risk — it does not bring it to zero.
Specifically:

- We can't moderate the *content* of your reels for community-standard
  violations. That's still on you.
- If you repost the same video across many accounts identically, Meta may
  classify the accounts as duplicates regardless of our rate caps.
- Sudden behavioral shifts on long-dormant accounts can trigger review even
  with safe cadence — warm new accounts up gradually (1 post every few days
  for the first 2 weeks).

When in doubt, post fewer reels than you think you can.
