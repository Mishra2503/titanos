// S3-compatible object storage (Cloudflare R2 or Backblaze B2) - hosts master
// reels at public URLs that Instagram's Graph API can download from.
import { S3Client } from "@aws-sdk/client-s3";

const REQUIRED_VARS = [
  "S3_ENDPOINT",
  "S3_REGION",
  "S3_ACCESS_KEY_ID",
  "S3_SECRET_ACCESS_KEY",
  "S3_BUCKET",
  "S3_PUBLIC_BASE_URL",
] as const;

export function assertStorageConfigured(): void {
  const missing = REQUIRED_VARS.filter((v) => !process.env[v]);
  if (missing.length) throw new Error("storage_not_configured");
}

let client: S3Client | null = null;

export function getS3(): S3Client {
  assertStorageConfigured();
  if (!client) {
    client = new S3Client({
      region: process.env.S3_REGION!, // "auto" for R2; e.g. "us-west-004" for B2
      endpoint: process.env.S3_ENDPOINT!,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
      forcePathStyle: true,
      // R2 and B2 both reject the CRC32 checksums the SDK sends by default.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

export function s3Bucket(): string {
  return process.env.S3_BUCKET!;
}

function publicBase(): string {
  return (process.env.S3_PUBLIC_BASE_URL ?? "").replace(/\/+$/, "");
}

export function publicUrlForKey(key: string): string {
  return `${publicBase()}/${key}`;
}

// Inverse of publicUrlForKey; null for URLs not under our base (legacy Cloudinary rows).
export function keyForPublicUrl(url: string): string | null {
  const base = publicBase();
  if (!base || !url.startsWith(`${base}/`)) return null;
  return url.slice(base.length + 1);
}

// Register-route validation: only keys we would have minted are accepted.
export const KEY_RE = /^titan-os\/masters\/[A-Za-z0-9._-]+$/;

export function makeObjectKey(filename: string): { videoKey: string; thumbKey: string } {
  const base = filename
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 60) || "reel";
  const ext = (filename.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? "mp4").toLowerCase();
  const videoKey = `titan-os/masters/${Date.now()}-${base}.${ext}`;
  const thumbKey = videoKey.replace(/\.[^.]+$/, "") + "-thumb.jpg";
  return { videoKey, thumbKey };
}
