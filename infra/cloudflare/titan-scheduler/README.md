# Titan OS scheduler clock

This free Cloudflare Worker calls Titan's publisher-only scheduler endpoint once
per minute. The Render and Worker secret values must match. Titan also includes
a GitHub Actions five-minute clock as an immediately deployable backstop; do not
remove that backstop until this Worker is live and its scheduled logs are green.

```sh
npx wrangler secret put TITAN_CRON_SECRET
npx wrangler deploy
```

The secret must never be committed. Verify deployment in Cloudflare's Worker
logs and in Titan's Render logs before relying on scheduled publishing.
