import { isIP } from "node:net";

const SAFE_VIDEO_EXTENSIONS = new Set(["mp4", "mov", "m4v", "webm"]);

function isPublicIpv4Literal(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return false;
  }
  const [a, b] = octets;
  return !(
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

/** Reject every non-public address before a server-side media import connects. */
export function isPublicImportAddress(address: string): boolean {
  // IPv6-only imports are intentionally unsupported for now. This keeps the
  // SSRF boundary easy to audit and still covers the object/CDN hosts agents
  // normally use, which publish public A records.
  return isIP(address) === 4 && isPublicIpv4Literal(address);
}

/** Parse the user-supplied source without permitting local services or exotic ports. */
export function parseRemoteMediaUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("source_url must be a valid absolute HTTPS URL");
  }
  if (url.protocol !== "https:") throw new Error("source_url must use HTTPS");
  if (url.username || url.password) throw new Error("source_url must not contain embedded credentials");
  if (url.port && url.port !== "443") throw new Error("source_url must use the standard HTTPS port");
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("source_url must use a public hostname");
  }
  if (isIP(hostname) && !isPublicImportAddress(hostname)) {
    throw new Error("source_url must not target a private or reserved network address");
  }
  url.hostname = hostname;
  url.hash = "";
  return url;
}

/** Strip signed query parameters before persisting an import request in MCP job history. */
export function redactRemoteMediaUrl(raw: string): string {
  const url = parseRemoteMediaUrl(raw);
  return `${url.protocol}//${url.host}${url.pathname}`;
}

export function remoteMediaFilename(url: URL, requested?: string | null): string {
  let fromPath = url.pathname.split("/").pop() || "";
  try { fromPath = decodeURIComponent(fromPath); } catch { /* keep the encoded filename */ }
  const candidate = (requested?.trim() || fromPath || "imported-reel.mp4")
    .replace(/[\\/\0]/g, "_")
    .slice(0, 160);
  const extension = candidate.match(/\.([A-Za-z0-9]+)$/)?.[1]?.toLowerCase();
  return extension && SAFE_VIDEO_EXTENSIONS.has(extension) ? candidate : `${candidate}.mp4`;
}
