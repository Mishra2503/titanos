import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { Readable, Transform } from "node:stream";
import type { IncomingMessage } from "node:http";
import { DeleteObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { db } from "@/lib/server/db";
import { INSTAGRAM_REEL_MAX_BYTES } from "@/lib/instagram-reel-quality";
import { prepareInstagramMedia } from "@/lib/server/instagramMedia";
import { getS3, makeObjectKey, publicUrlForKey, s3Bucket } from "@/lib/server/s3";
import {
  isPublicImportAddress,
  parseRemoteMediaUrl,
  remoteMediaFilename,
} from "@/lib/server/remoteMediaPolicy";

const MAX_REDIRECTS = 5;
const CONNECT_TIMEOUT_MS = 30_000;
const IDLE_TIMEOUT_MS = 60_000;

interface RemoteResponse {
  response: IncomingMessage;
  finalUrl: URL;
}

async function publicIpv4For(hostname: string): Promise<string> {
  const records = await lookup(hostname, { all: true, verbatim: true });
  const match = records.find((record) => record.family === 4 && isPublicImportAddress(record.address));
  if (!match) throw new Error("source_url did not resolve to a public IPv4 address");
  return match.address;
}

async function openRemoteVideo(raw: string | URL, redirects = 0): Promise<RemoteResponse> {
  if (redirects > MAX_REDIRECTS) throw new Error(`source_url exceeded ${MAX_REDIRECTS} redirects`);
  const url = parseRemoteMediaUrl(String(raw));
  const address = await publicIpv4For(url.hostname);

  const response = await new Promise<IncomingMessage>((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      headers: {
        Accept: "video/*, application/octet-stream;q=0.9",
        "User-Agent": "Titan-OS-Media-Importer/1.0",
      },
      // Pin the already-vetted public address so a second DNS lookup cannot
      // rebind the hostname to a private service between validation and fetch.
      lookup: (_hostname, _options, callback) => callback(null, address, 4),
      timeout: CONNECT_TIMEOUT_MS,
    }, resolve);
    req.setTimeout(IDLE_TIMEOUT_MS, () => req.destroy(new Error("source_url stopped sending data")));
    req.on("error", reject);
    req.end();
  });

  if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
    const location = response.headers.location;
    response.resume();
    if (!location) throw new Error("source_url redirected without a Location header");
    return openRemoteVideo(new URL(location, url), redirects + 1);
  }
  if (response.statusCode !== 200) {
    response.resume();
    throw new Error(`source_url returned HTTP ${response.statusCode ?? "unknown"}`);
  }

  const contentType = String(response.headers["content-type"] ?? "").split(";", 1)[0].toLowerCase();
  if (contentType && !contentType.startsWith("video/") && contentType !== "application/octet-stream") {
    response.resume();
    throw new Error(`source_url returned ${contentType}, not a video`);
  }
  const contentLength = Number(response.headers["content-length"]);
  if (Number.isFinite(contentLength) && contentLength > INSTAGRAM_REEL_MAX_BYTES) {
    response.resume();
    throw new Error("source video exceeds Instagram's 1GB reel limit");
  }
  return { response, finalUrl: url };
}

export async function importRemoteMedia(input: {
  workspaceId: string;
  userId: string;
  sourceUrl: string;
  filename?: string | null;
}): Promise<Record<string, unknown>> {
  const { response, finalUrl } = await openRemoteVideo(input.sourceUrl);
  const filename = remoteMediaFilename(finalUrl, input.filename);
  const contentType = String(response.headers["content-type"] ?? "video/mp4").split(";", 1)[0];
  const { videoKey } = makeObjectKey(filename);
  let uploaded = false;
  let seenBytes = 0;

  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      seenBytes += chunk.length;
      if (seenBytes > INSTAGRAM_REEL_MAX_BYTES) callback(new Error("source video exceeds Instagram's 1GB reel limit"));
      else callback(null, chunk);
    },
  });

  try {
    await new Upload({
      client: getS3(),
      params: {
        Bucket: s3Bucket(),
        Key: videoKey,
        Body: Readable.from(response).pipe(limiter),
        ContentType: contentType || "video/mp4",
      },
      partSize: 10 * 1024 * 1024,
      queueSize: 1,
      leavePartsOnError: false,
    }).done();
    uploaded = true;

    if (seenBytes <= 0) throw new Error("source_url returned an empty file");
    const format = filename.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? null;
    const asset = await db.mediaAsset.create({
      data: {
        workspaceId: input.workspaceId,
        filename,
        storageKey: videoKey,
        publicUrl: publicUrlForKey(videoKey),
        thumbnailUrl: null,
        width: null,
        height: null,
        durationS: null,
        format,
        sizeBytes: seenBytes,
        uploadedBy: input.userId,
      },
    });

    void prepareInstagramMedia(asset).catch((error) => {
      console.error(`[media import] Instagram preparation failed for ${asset.id}:`, error instanceof Error ? error.message : error);
    });

    return {
      id: asset.id,
      filename: asset.filename,
      public_url: asset.publicUrl,
      thumbnail_url: asset.thumbnailUrl,
      width: asset.width,
      height: asset.height,
      duration_s: asset.durationS,
      format: asset.format,
      size_bytes: asset.sizeBytes,
      created_at: asset.createdAt.toISOString(),
      in_use: false,
    };
  } catch (error) {
    response.destroy();
    if (uploaded) {
      await getS3().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: videoKey })).catch(() => {});
    }
    throw error;
  }
}
