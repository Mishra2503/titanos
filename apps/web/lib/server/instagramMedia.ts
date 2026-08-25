import ffmpegPath from "ffmpeg-static";
import { HeadObjectCommand } from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import {
  INSTAGRAM_REEL_MAX_BYTES,
  INSTAGRAM_REEL_MAX_DURATION_S,
  INSTAGRAM_REEL_MAX_HORIZONTAL_PX,
  INSTAGRAM_REEL_MIN_DURATION_S,
} from "@/lib/instagram-reel-quality";
import { getS3, instagramDeliveryKey, publicUrlForKey, s3Bucket } from "@/lib/server/s3";

const MIN_FPS = 23;
const MAX_FPS = 60;
const MAX_VIDEO_KBPS = 25_000;
const MAX_AUDIO_KBPS = 128;
const MAX_AUDIO_HZ = 48_000;
const DEFAULT_PREP_TIMEOUT_MS = 20 * 60 * 1000;
const MASTER_DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

export interface InstagramMediaProbe {
  durationS: number | null;
  bitrateKbps: number | null;
  videoCodec: string | null;
  pixelFormat: string | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  progressive: boolean;
  hasAudio: boolean;
  audioCodec: string | null;
  audioHz: number | null;
  audioChannels: number | null;
  audioBitrateKbps: number | null;
}

export interface PreparedInstagramMedia {
  url: string;
  action: "cached" | "remuxed" | "transcoded";
  reasons: string[];
}

function numberFromFraction(raw: string): number | null {
  const [a, b] = raw.split("/").map(Number);
  const value = b == null ? a : a / b;
  return Number.isFinite(value) && value > 0 ? value : null;
}

export function parseInstagramMediaProbe(stderr: string): InstagramMediaProbe {
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationS = duration
    ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
    : null;
  const overallBitrate = stderr.match(/Duration:[^\n]*bitrate:\s*([\d.]+)\s*kb\/s/i);
  const videoLine = stderr.split("\n").find((line) => /Stream #\d+:\d+.*Video:/i.test(line)) ?? "";
  const audioLine = stderr.split("\n").find((line) => /Stream #\d+:\d+.*Audio:/i.test(line)) ?? "";
  const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})\b/);
  const fpsMatch = videoLine.match(/([\d.]+(?:\/[\d.]+)?)\s*fps\b/i);
  const pixelFormat = videoLine.match(/\b(yuvj?\d{3}p(?:\d{2}(?:le|be))?|nv12|p010le)\b/i)?.[1]?.toLowerCase() ?? null;
  const audioHz = audioLine.match(/\b(\d+)\s*Hz\b/i);
  const audioBitrate = audioLine.match(/\b([\d.]+)\s*kb\/s\b/i);
  const channels = /\bmono\b/i.test(audioLine)
    ? 1
    : /\bstereo\b/i.test(audioLine)
      ? 2
      : /\b5\.1\b/.test(audioLine)
        ? 6
        : /\b7\.1\b/.test(audioLine)
          ? 8
          : audioLine.match(/\b(\d+)\s*channels?\b/i)?.[1];

  return {
    durationS,
    bitrateKbps: overallBitrate ? Number(overallBitrate[1]) : null,
    videoCodec: videoLine.match(/Video:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase() ?? null,
    pixelFormat,
    width: dimensions ? Number(dimensions[1]) : null,
    height: dimensions ? Number(dimensions[2]) : null,
    fps: fpsMatch ? numberFromFraction(fpsMatch[1]) : null,
    progressive: !/\b(interlaced|top first|bottom first)\b/i.test(videoLine),
    hasAudio: Boolean(audioLine),
    audioCodec: audioLine.match(/Audio:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase() ?? null,
    audioHz: audioHz ? Number(audioHz[1]) : null,
    audioChannels: channels ? Number(channels) : null,
    audioBitrateKbps: audioBitrate ? Number(audioBitrate[1]) : null,
  };
}

function runFfmpeg(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("Instagram quality preparation is unavailable: ffmpeg binary not found"));
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk) => {
      if (stderr.length < 128 * 1024) stderr += chunk.toString();
    });
    const timer = setTimeout(() => {
      proc.kill("SIGKILL");
      reject(new Error("Instagram quality preparation timed out"));
    }, timeoutMs);
    proc.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stderr });
    });
  });
}

async function probeMedia(inputPath: string): Promise<InstagramMediaProbe> {
  const { stderr } = await runFfmpeg(["-hide_banner", "-i", inputPath], 20_000);
  return parseInstagramMediaProbe(stderr);
}

async function downloadMaster(url: string, destination: string): Promise<void> {
  const response = await fetch(url, { signal: AbortSignal.timeout(MASTER_DOWNLOAD_TIMEOUT_MS) });
  if (!response.ok || !response.body) throw new Error(`Could not download the master video (HTTP ${response.status})`);
  const declaredBytes = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredBytes) && declaredBytes > INSTAGRAM_REEL_MAX_BYTES) {
    throw new Error("Master video exceeds Instagram's 1 GB publishing limit");
  }

  let bytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      callback(bytes > INSTAGRAM_REEL_MAX_BYTES ? new Error("Master video exceeds Instagram's 1 GB publishing limit") : null, chunk);
    },
  });
  await pipeline(
    Readable.fromWeb(response.body as import("node:stream/web").ReadableStream),
    limiter,
    createWriteStream(destination),
  );
}

async function deliveryExists(key: string): Promise<boolean> {
  try {
    await getS3().send(new HeadObjectCommand({ Bucket: s3Bucket(), Key: key }));
    return true;
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (error as { name?: string }).name === "NotFound") return false;
    throw error;
  }
}

function qualityPlan(probe: InstagramMediaProbe): { videoCopy: boolean; audioCopy: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const codecOk = probe.videoCodec === "h264" || probe.videoCodec === "hevc";
  // Use 8-bit 4:2:0 for the safest Instagram ingestion path. 10-bit 4:2:0
  // technically has the same chroma layout but is not accepted consistently.
  const chromaOk = probe.pixelFormat === "yuv420p" || probe.pixelFormat === "yuvj420p";
  const fpsOk = probe.fps != null && probe.fps >= MIN_FPS && probe.fps <= MAX_FPS;
  const widthOk = probe.width != null && probe.width <= INSTAGRAM_REEL_MAX_HORIZONTAL_PX;
  const bitrateOk = probe.bitrateKbps == null || probe.bitrateKbps <= MAX_VIDEO_KBPS;
  const videoCopy = codecOk && chromaOk && fpsOk && widthOk && bitrateOk && probe.progressive;

  if (!codecOk) reasons.push(`video codec ${probe.videoCodec ?? "unknown"}`);
  if (!chromaOk) reasons.push(`pixel format ${probe.pixelFormat ?? "unknown"}`);
  if (!fpsOk) reasons.push(`frame rate ${probe.fps?.toFixed(2) ?? "unknown"} fps`);
  if (!widthOk) reasons.push(`horizontal resolution ${probe.width ?? "unknown"} px`);
  if (!bitrateOk) reasons.push(`bitrate ${Math.round(probe.bitrateKbps ?? 0)} kbps`);
  if (!probe.progressive) reasons.push("interlaced video");

  const audioCopy = !probe.hasAudio || (
    probe.audioCodec === "aac" &&
    (probe.audioHz == null || probe.audioHz <= MAX_AUDIO_HZ) &&
    (probe.audioChannels == null || probe.audioChannels <= 2) &&
    (probe.audioBitrateKbps == null || probe.audioBitrateKbps <= MAX_AUDIO_KBPS)
  );
  if (!audioCopy) reasons.push("audio is outside Instagram's AAC 48 kHz / 128 kbps / stereo limits");

  return { videoCopy, audioCopy, reasons };
}

function maxVideoBitrateKbps(durationS: number): number {
  // Leave room for 128 kbps audio + container overhead and remain below 1 GB.
  const fileLimitKbps = Math.floor((INSTAGRAM_REEL_MAX_BYTES * 8 * 0.92) / 1000 / durationS - MAX_AUDIO_KBPS);
  return Math.max(2_500, Math.min(20_000, fileLimitKbps));
}

export function buildInstagramFfmpegArgs(
  inputPath: string,
  outputPath: string,
  probe: InstagramMediaProbe,
): { args: string[]; action: "remuxed" | "transcoded"; reasons: string[] } {
  const plan = qualityPlan(probe);
  const args = ["-hide_banner", "-y", "-i", inputPath, "-map", "0:v:0", "-map", "0:a:0?"];

  if (plan.videoCopy) {
    args.push("-c:v", "copy");
    if (probe.videoCodec === "hevc") args.push("-tag:v", "hvc1");
  } else {
    const maxrate = maxVideoBitrateKbps(probe.durationS ?? 60);
    const filters: string[] = [];
    if (!probe.progressive) filters.push("yadif");
    filters.push(
      (probe.width ?? 0) > INSTAGRAM_REEL_MAX_HORIZONTAL_PX
        ? `scale=${INSTAGRAM_REEL_MAX_HORIZONTAL_PX}:-2:flags=lanczos`
        : "scale=trunc(iw/2)*2:trunc(ih/2)*2:flags=lanczos",
    );
    args.push(
      "-c:v", "libx264",
      "-preset", "slow",
      "-crf", "15",
      "-maxrate", `${maxrate}k`,
      "-bufsize", `${maxrate * 2}k`,
      "-pix_fmt", "yuv420p",
      "-profile:v", "high",
      "-g", "60",
      "-keyint_min", "60",
      "-sc_threshold", "0",
      "-vf", filters.join(","),
    );
    const fpsOk = probe.fps != null && probe.fps >= MIN_FPS && probe.fps <= MAX_FPS;
    args.push(...(fpsOk ? ["-fps_mode", "passthrough"] : ["-r", "30", "-fps_mode", "cfr"]));
  }

  if (!probe.hasAudio) args.push("-an");
  else if (plan.audioCopy) args.push("-c:a", "copy");
  else args.push("-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2");

  args.push("-movflags", "+faststart", "-map_metadata", "0", outputPath);
  return {
    args,
    action: plan.videoCopy && plan.audioCopy ? "remuxed" : "transcoded",
    reasons: plan.reasons,
  };
}

export async function prepareInstagramMedia(asset: {
  id: string;
  publicUrl: string;
  sizeBytes?: number | null;
}): Promise<PreparedInstagramMedia> {
  if (asset.sizeBytes != null && asset.sizeBytes > INSTAGRAM_REEL_MAX_BYTES) {
    throw new Error("Master video exceeds Instagram's 1 GB publishing limit");
  }

  const key = instagramDeliveryKey(asset.id);
  if (await deliveryExists(key)) return { url: publicUrlForKey(key), action: "cached", reasons: [] };

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "ig-media-"));
  const inputPath = path.join(tmpDir, "master");
  const outputPath = path.join(tmpDir, "instagram.mp4");
  try {
    await downloadMaster(asset.publicUrl, inputPath);
    const probe = await probeMedia(inputPath);
    if (probe.durationS == null) throw new Error("Could not read the master video's duration");
    if (probe.durationS < INSTAGRAM_REEL_MIN_DURATION_S || probe.durationS > INSTAGRAM_REEL_MAX_DURATION_S) {
      throw new Error(`Video duration ${probe.durationS.toFixed(1)}s is outside Instagram's 3 second to 15 minute Reel limit`);
    }
    if (!probe.videoCodec || !probe.width || !probe.height) throw new Error("Could not read a valid video stream from the master");

    const { args, action, reasons } = buildInstagramFfmpegArgs(inputPath, outputPath, probe);
    const timeoutMs = Number(process.env.INSTAGRAM_MEDIA_PREP_TIMEOUT_MS ?? DEFAULT_PREP_TIMEOUT_MS);
    const result = await runFfmpeg(args, Number.isFinite(timeoutMs) ? timeoutMs : DEFAULT_PREP_TIMEOUT_MS);
    if (result.code !== 0) {
      throw new Error(`Instagram quality preparation failed: ${result.stderr.trim().split("\n").slice(-3).join(" ")}`);
    }
    const output = await stat(outputPath);
    if (output.size > INSTAGRAM_REEL_MAX_BYTES) throw new Error("Prepared Reel still exceeds Instagram's 1 GB publishing limit");

    await new Upload({
      client: getS3(),
      params: {
        Bucket: s3Bucket(),
        Key: key,
        Body: createReadStream(outputPath),
        ContentType: "video/mp4",
        CacheControl: "public, max-age=31536000, immutable",
      },
      partSize: 10 * 1024 * 1024,
      queueSize: 1,
    }).done();

    console.log(`[instagram-media] ${asset.id}: ${action}${reasons.length ? ` (${reasons.join(", ")})` : ""}`);
    return { url: publicUrlForKey(key), action, reasons };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}
