// Shared Instagram / Apify helpers.
//
// The competitor sync route scrapes a whole profile; the Content Board's
// per-card "Analyze" needs to resolve ONE arbitrary reel URL to a direct mp4.
// Both go through Apify, so the primitives live here.

// The Apify token under any of the names we've used across deploys.
export function apifyToken(): string | null {
  return process.env.APIFY_TOKEN ?? process.env.APIFY_API_TOKEN ?? process.env.APIFY_KEY ?? null;
}

// The shortcode of an Instagram post/reel URL (…/p/<code>/, …/reel/<code>/).
export function shortcodeOf(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

// Run an Apify actor synchronously and return its dataset items.
export async function runApify<T>(actor: string, input: unknown, token: string): Promise<T[]> {
  const r = await fetch(
    `https://api.apify.com/v2/acts/${actor}/run-sync-get-dataset-items?token=${token}&timeout=110`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(125_000),
    },
  );
  const body = await r.json().catch(() => null);
  if (!r.ok) {
    const msg = (body as { error?: { message?: string } } | null)?.error?.message ?? `HTTP ${r.status}`;
    throw new Error(`Apify: ${msg}`);
  }
  return Array.isArray(body) ? (body as T[]) : [];
}

// One scraped Instagram item (loose — actors return slightly different shapes).
interface ScrapedItem {
  type?: string;
  shortCode?: string;
  url?: string;
  caption?: string;
  videoUrl?: string;
  videoUrlHd?: string;
  displayUrl?: string;
}

export class InstagramResolveError extends Error {}

// Resolve a single Instagram reel/post URL to a direct (transient) mp4 URL plus
// its caption, via Apify's general Instagram scraper. Returns videoUrl: null
// when the post is not a video (image/carousel with no reel).
export async function resolveInstagramVideoUrl(
  url: string,
): Promise<{ videoUrl: string | null; caption: string | null }> {
  const token = apifyToken();
  if (!token) throw new InstagramResolveError("APIFY_TOKEN is not set — cannot fetch the reel to watch it. Add it in Render.");

  const items = await runApify<ScrapedItem>(
    "apify~instagram-scraper",
    { directUrls: [url], resultsType: "posts", resultsLimit: 1, addParentData: false },
    token,
  );
  const item = items[0];
  if (!item) throw new InstagramResolveError("Could not fetch this Instagram post — check the URL is public and correct.");

  const videoUrl = item.videoUrl ?? item.videoUrlHd ?? null;
  return { videoUrl, caption: item.caption ?? null };
}
