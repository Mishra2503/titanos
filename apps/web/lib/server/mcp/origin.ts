// The app's PUBLIC origin, as seen by an external client.
//
// `new URL(request.url).origin` is NOT safe here: behind Render's proxy the
// request reaching Next carries the internal bind address, so that expression
// evaluates to `https://localhost:10000`. Shipping that into the OAuth
// `WWW-Authenticate: resource_metadata=…` hint sent every connector chasing
// discovery to localhost, and any tool that used it for a self-call failed
// outright. Everything that needs to name this server externally - discovery
// docs, JWT iss/aud, deep links in tool results - must go through here.

const FALLBACK = "http://localhost:3000";

function clean(url: string): string {
  return url.replace(/\/$/, "");
}

/** Origin from configuration alone (no request in hand). */
export function configuredOrigin(): string {
  return clean(process.env.NEXT_PUBLIC_APP_URL || FALLBACK);
}

/**
 * Public origin for a specific request. Prefers the explicitly configured URL,
 * then the proxy's forwarded host, and only then the request URL itself.
 */
export function publicOrigin(req: { headers: Headers; url: string }): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return clean(configured);

  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) {
    const proto = req.headers.get("x-forwarded-proto")?.split(",")[0].trim() || "https";
    return clean(`${proto}://${host}`);
  }

  try {
    return clean(new URL(req.url).origin);
  } catch {
    return FALLBACK;
  }
}
