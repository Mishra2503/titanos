import ffmpegPath from "ffmpeg-static";
import Anthropic from "@anthropic-ai/sdk";
import { aiProvider, openAIChat } from "@/lib/server/ai";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import os from "node:os";
import path from "node:path";

// Per-video "watch" pipeline: download the reel → extract frames (ffmpeg) →
// transcribe audio (Groq whisper) → have Claude look at frames + transcript →
// structured analysis of the hook, format, script, pacing, and why it works.
// Technique ported from github.com/bradautomates/claude-video (MIT).
//
// Deliberately serial and streaming so a single video never holds more than a
// few MB in memory — this runs on a 512MB Render instance next to the app.

const VIDEO_MODEL = process.env.VIDEO_ANALYSIS_MODEL ?? "claude-sonnet-5";
const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const MAX_DURATION_S = 300; // longer than any reel — not our content type
const HOOK_TIMES = [0, 1, 2]; // always capture the first 3 seconds
const UNIFORM_FRAMES = 8;
const MAX_FRAMES = 11;
const MIN_FRAMES = 3;

export class VideoUrlExpiredError extends Error {
  constructor() { super("Video URL expired or inaccessible — re-sync to refresh it."); }
}
export class NotAVideoError extends Error {
  constructor(reason: string) { super(reason); }
}

export interface VideoAnalysisResult {
  transcript: string | null;
  analysis: Record<string, unknown>;
  summary: string;
  durationS: number | null;
  model: string;
}

// ── ffmpeg helpers ──────────────────────────────────────────────────────────

function ffmpeg(args: string[], timeoutMs: number): Promise<{ code: number | null; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error("ffmpeg binary not found (ffmpeg-static)"));
    const proc = spawn(ffmpegPath, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (d) => { if (stderr.length < 65536) stderr += d.toString(); });
    const timer = setTimeout(() => { proc.kill("SIGKILL"); reject(new Error("ffmpeg timed out")); }, timeoutMs);
    proc.on("error", (e) => { clearTimeout(timer); reject(e); });
    proc.on("close", (code) => { clearTimeout(timer); resolve({ code, stderr }); });
  });
}

// ffmpeg-static ships no ffprobe; parse duration + audio presence from
// `ffmpeg -i` stderr (exits non-zero without an output file — that's fine).
async function probe(videoPath: string): Promise<{ durationS: number | null; hasAudio: boolean }> {
  const { stderr } = await ffmpeg(["-i", videoPath], 15_000);
  const m = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const durationS = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
  return { durationS, hasAudio: /Stream #\d+:\d+.*Audio:/.test(stderr) };
}

// ── Download ────────────────────────────────────────────────────────────────

async function downloadVideo(videoUrl: string, dest: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(videoUrl, { signal: AbortSignal.timeout(60_000) });
  } catch (e) {
    throw new Error(`Video download failed: ${(e as Error).message}`);
  }
  if (res.status === 403 || res.status === 404 || res.status === 410) throw new VideoUrlExpiredError();
  if (!res.ok || !res.body) throw new Error(`Video download failed: HTTP ${res.status}`);

  const ct = res.headers.get("content-type") ?? "";
  if (ct && !ct.startsWith("video/") && ct !== "application/octet-stream" && !ct.startsWith("binary/")) {
    throw new NotAVideoError(`URL did not return a video (content-type: ${ct})`);
  }

  let bytes = 0;
  const guard = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes > MAX_VIDEO_BYTES) cb(new Error("Video exceeds 200MB limit"));
      else cb(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(res.body as import("stream/web").ReadableStream), guard, createWriteStream(dest));
}

// ── Frames ──────────────────────────────────────────────────────────────────

function frameTimestamps(durationS: number): number[] {
  const times = HOOK_TIMES.filter((t) => t < Math.max(durationS - 0.2, 0.1));
  const start = 3, end = Math.max(durationS - 0.5, start);
  if (end > start) {
    const step = (end - start) / UNIFORM_FRAMES;
    for (let i = 0; i < UNIFORM_FRAMES; i++) times.push(Math.round((start + step * (i + 0.5)) * 10) / 10);
  }
  return [...new Set(times)].sort((a, b) => a - b).slice(0, MAX_FRAMES);
}

async function extractFrames(videoPath: string, tmpDir: string, durationS: number): Promise<{ t: number; file: string }[]> {
  const frames: { t: number; file: string }[] = [];
  for (const t of frameTimestamps(durationS)) {
    const file = path.join(tmpDir, `frame_${t.toFixed(1)}.jpg`);
    // -ss before -i = fast keyframe seek; one spawn per frame keeps memory tiny
    const { code } = await ffmpeg(
      ["-ss", String(t), "-i", videoPath, "-frames:v", "1", "-vf", "scale=512:-2", "-q:v", "4", "-y", file],
      20_000,
    ).catch(() => ({ code: 1 }));
    if (code === 0) frames.push({ t, file });
  }
  if (frames.length < MIN_FRAMES) throw new Error(`Could only extract ${frames.length} frames — video may be corrupt`);
  return frames;
}

// ── Transcription (Groq whisper) ────────────────────────────────────────────

async function transcribe(videoPath: string, tmpDir: string): Promise<string | null> {
  const key = process.env.GROQ_API_KEY;
  if (!key) return null;
  try {
    const audioPath = path.join(tmpDir, "audio.mp3");
    const { code } = await ffmpeg(["-i", videoPath, "-vn", "-ac", "1", "-ar", "16000", "-b:a", "48k", "-y", audioPath], 30_000);
    if (code !== 0) return null;

    const form = new FormData();
    form.append("file", new File([new Uint8Array(await readFile(audioPath))], "audio.mp3", { type: "audio/mpeg" }));
    form.append("model", "whisper-large-v3");
    form.append("response_format", "verbose_json");

    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      console.error(`[video-analysis] Groq transcription failed: HTTP ${res.status}`);
      return null;
    }
    const json = (await res.json()) as { text?: string; segments?: { start: number; end: number; text: string }[] };
    if (json.segments?.length) {
      return json.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}s] ${s.text.trim()}`).join("\n");
    }
    return json.text?.trim() || null;
  } catch (e) {
    console.error("[video-analysis] transcription skipped:", (e as Error).message);
    return null; // transcript is best-effort by design
  }
}

// ── Claude vision ───────────────────────────────────────────────────────────

const ANALYSIS_INSTRUCTION = `You are a short-form video strategist. You just watched this Instagram reel via the timestamped frames above and the audio transcript. Analyze it and respond with ONLY a JSON object (no markdown fences, no commentary) with exactly these keys:
{
  "hookVisual": "what happens visually in the first 3 seconds that stops the scroll",
  "hookSpoken": "the spoken/text hook in the first 3 seconds, verbatim if in the transcript; 'none (music only)' if no speech",
  "format": "the content format, e.g. talking head, screen recording, b-roll + voiceover, meme, tutorial, vlog clip",
  "script": "the full script reconstructed from the transcript (verbatim where available) and on-screen text; empty string if none",
  "scriptSummary": "2-3 sentence summary of the message/story arc",
  "pacing": { "cutsEstimated": <number, estimated from visual change between frames>, "style" : "e.g. fast cuts every 1-2s, single static shot, slow b-roll" },
  "textOverlays": ["on-screen text you can read in the frames"],
  "visualStyle": "lighting, setting, editing style, captions style",
  "cta": "the call to action, or 'none'",
  "whyItWorks": "1-2 sentences: why this video likely performed the way its metrics show"
}`;

function extractJson(text: string): Record<string, unknown> {
  const cleaned = text.replace(/```(?:json)?/g, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("No JSON object in AI response");
  return JSON.parse(cleaned.slice(start, end + 1)) as Record<string, unknown>;
}

function buildPromptText(
  transcript: string | null,
  caption: string | null | undefined,
  metricsLine: string | null | undefined,
): string {
  return [
    caption ? `CAPTION: ${caption.replace(/\s+/g, " ").slice(0, 500)}` : "CAPTION: (none)",
    metricsLine ? `METRICS: ${metricsLine}` : null,
    transcript ? `AUDIO TRANSCRIPT (timestamped):\n${transcript.slice(0, 6000)}` : "AUDIO TRANSCRIPT: none available — likely music-only or transcription unavailable.",
    "",
    ANALYSIS_INSTRUCTION,
  ].filter((l) => l != null).join("\n");
}

// OpenAI-compatible vision path (e.g. GitHub Models GPT-5) — same frames +
// transcript, OpenAI image_url content format.
async function watchWithOpenAI(
  frames: { t: number; file: string }[],
  promptText: string,
): Promise<{ analysis: Record<string, unknown>; model: string }> {
  const content: unknown[] = [];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at ${f.t.toFixed(1)}s:` });
    content.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${(await readFile(f.file)).toString("base64")}` } });
  }
  content.push({ type: "text", text: promptText });

  const messages: { role: "user" | "assistant"; content: unknown }[] = [{ role: "user", content }];
  let res = await openAIChat(messages, 4000);
  try {
    return { analysis: extractJson(res.text), model: res.model };
  } catch {
    messages.push({ role: "assistant", content: res.text }, { role: "user", content: "Return only the valid JSON object, nothing else." });
    res = await openAIChat(messages, 4000);
    return { analysis: extractJson(res.text), model: res.model };
  }
}

async function watchWithClaude(
  frames: { t: number; file: string }[],
  transcript: string | null,
  caption: string | null | undefined,
  metricsLine: string | null | undefined,
): Promise<{ analysis: Record<string, unknown>; model: string }> {
  const promptText = buildPromptText(transcript, caption, metricsLine);

  if (aiProvider() === "openai") {
    return watchWithOpenAI(frames, promptText);
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not configured");
  const client = new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });

  const content: Anthropic.ContentBlockParam[] = [];
  for (const f of frames) {
    content.push({ type: "text", text: `Frame at ${f.t.toFixed(1)}s:` });
    content.push({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: (await readFile(f.file)).toString("base64") },
    });
  }
  content.push({ type: "text", text: promptText });

  const ask = async (messages: Anthropic.MessageParam[]) => {
    const res = await client.messages.create({ model: VIDEO_MODEL, max_tokens: 2000, messages });
    return { text: res.content.map((b) => (b.type === "text" ? b.text : "")).join("").trim(), model: res.model, content: res.content };
  };

  let messages: Anthropic.MessageParam[] = [{ role: "user", content }];
  let res = await ask(messages);
  try {
    return { analysis: extractJson(res.text), model: res.model };
  } catch {
    messages = [...messages, { role: "assistant", content: res.content }, { role: "user", content: "Return only the valid JSON object, nothing else." }];
    res = await ask(messages);
    return { analysis: extractJson(res.text), model: res.model };
  }
}

// ── Summary + report formatting ─────────────────────────────────────────────

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

export function buildSummary(analysis: Record<string, unknown>): string {
  const pacing = analysis.pacing as Record<string, unknown> | undefined;
  const parts = [
    str(analysis.hookVisual) && `hook(visual): ${str(analysis.hookVisual)}`,
    str(analysis.hookSpoken) && `hook(spoken): ${str(analysis.hookSpoken)}`,
    str(analysis.format) && `format: ${str(analysis.format)}`,
    pacing && str(pacing.style) && `pacing: ${str(pacing.style)}`,
    str(analysis.cta) && str(analysis.cta) !== "none" && `CTA: ${str(analysis.cta)}`,
    str(analysis.whyItWorks) && `why it works: ${str(analysis.whyItWorks)}`,
  ].filter(Boolean) as string[];
  const s = parts.join(" | ");
  return s.length > 380 ? s.slice(0, 377) + "…" : s;
}

// One-line injection for report prompts. Prefers the prebuilt summary.
export function formatAnalysisForReport(row: { summary: string | null; analysis: unknown }): string | null {
  if (row.summary) return row.summary;
  if (row.analysis && typeof row.analysis === "object") return buildSummary(row.analysis as Record<string, unknown>);
  return null;
}

// ── Orchestrator ────────────────────────────────────────────────────────────

export async function analyzeVideo(opts: {
  videoUrl: string;
  caption?: string | null;
  metricsLine?: string | null;
}): Promise<VideoAnalysisResult> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "va-"));
  try {
    const videoPath = path.join(tmpDir, "in.mp4");
    await downloadVideo(opts.videoUrl, videoPath);

    const { durationS, hasAudio } = await probe(videoPath);
    if (durationS == null) throw new Error("Could not read video duration");
    if (durationS > MAX_DURATION_S) throw new NotAVideoError(`Video is ${Math.round(durationS)}s — longer than a reel, skipping`);

    const frames = await extractFrames(videoPath, tmpDir, durationS);
    const transcript = hasAudio ? await transcribe(videoPath, tmpDir) : null;
    const { analysis, model } = await watchWithClaude(frames, transcript, opts.caption, opts.metricsLine);

    return { transcript, analysis, summary: buildSummary(analysis), durationS, model };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

export interface TranscriptResult {
  transcript: string | null;
  durationS: number | null;
}

// Cheap path for competitor reels: Groq transcription ONLY — no frame extraction
// and no Claude vision. Keeps competitor sync near-free at scale (50 reels each).
export async function transcribeVideoOnly(opts: { videoUrl: string }): Promise<TranscriptResult> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "va-"));
  try {
    const videoPath = path.join(tmpDir, "in.mp4");
    await downloadVideo(opts.videoUrl, videoPath);

    const { durationS, hasAudio } = await probe(videoPath);
    if (durationS == null) throw new Error("Could not read video duration");
    if (durationS > MAX_DURATION_S) throw new NotAVideoError(`Video is ${Math.round(durationS)}s — longer than a reel, skipping`);

    const transcript = hasAudio ? await transcribe(videoPath, tmpDir) : null;
    return { transcript, durationS };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// Crash-safety: remove leftover va-* work dirs older than an hour.
export async function sweepOrphanTmpDirs(): Promise<void> {
  try {
    const { readdir, stat } = await import("node:fs/promises");
    const base = os.tmpdir();
    for (const name of await readdir(base)) {
      if (!name.startsWith("va-")) continue;
      const dir = path.join(base, name);
      const s = await stat(dir).catch(() => null);
      if (s?.isDirectory() && Date.now() - s.mtimeMs > 3_600_000) {
        await rm(dir, { recursive: true, force: true }).catch(() => {});
      }
    }
  } catch { /* best-effort */ }
}
