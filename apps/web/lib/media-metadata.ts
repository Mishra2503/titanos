"use client";

// Extracts video dimensions/duration and a poster-frame thumbnail locally in
// the browser before upload — the S3-compatible store (unlike Cloudinary)
// doesn't inspect or transform media, so the client is the only place this
// metadata can come from. Every failure path degrades to nulls; this must
// never block an upload.

export interface LocalVideoMeta {
  width: number | null;
  height: number | null;
  durationS: number | null;
  thumbnail: Blob | null;
}

const EMPTY: LocalVideoMeta = { width: null, height: null, durationS: null, thumbnail: null };

function once<K extends keyof HTMLVideoElementEventMap>(el: HTMLVideoElement, event: K, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => { cleanup(); resolve(false); }, timeoutMs);
    const onEvent = () => { cleanup(); resolve(true); };
    const onError = () => { cleanup(); resolve(false); };
    const cleanup = () => {
      clearTimeout(timer);
      el.removeEventListener(event, onEvent);
      el.removeEventListener("error", onError);
    };
    el.addEventListener(event, onEvent);
    el.addEventListener("error", onError);
  });
}

export async function extractVideoMetadata(file: File): Promise<LocalVideoMeta> {
  const url = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.preload = "metadata";
  video.muted = true;
  video.playsInline = true;
  try {
    video.src = url;
    if (!(await once(video, "loadedmetadata", 10_000))) return EMPTY;

    const width = video.videoWidth || null;
    const height = video.videoHeight || null;
    const durationS = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : null;

    let thumbnail: Blob | null = null;
    if (width && height) {
      video.currentTime = Math.min(0.5, (durationS ?? 1) / 2);
      if (await once(video, "seeked", 5_000)) {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")?.drawImage(video, 0, 0, width, height);
        thumbnail = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.8));
      }
    }

    return { width, height, durationS, thumbnail };
  } catch {
    return EMPTY;
  } finally {
    video.removeAttribute("src");
    URL.revokeObjectURL(url);
  }
}
