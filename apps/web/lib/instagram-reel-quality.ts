export const INSTAGRAM_REEL_MIN_DURATION_S = 3;
export const INSTAGRAM_REEL_MAX_DURATION_S = 15 * 60;
export const INSTAGRAM_REEL_MAX_BYTES = 1024 * 1024 * 1024;
export const INSTAGRAM_REEL_MAX_HORIZONTAL_PX = 1920;

export type ReelQualityLevel = "ready" | "optimize" | "blocked";

export interface ReelQualityAssessment {
  level: ReelQualityLevel;
  headline: string;
  details: string[];
}

export interface ReelBasics {
  filename?: string | null;
  sizeBytes?: number | null;
  durationS?: number | null;
  width?: number | null;
  height?: number | null;
}

// Browser-safe first pass. Codec, chroma, bitrate and moov placement are
// checked server-side with ffmpeg immediately before Instagram publishing.
export function assessInstagramReelBasics(input: ReelBasics): ReelQualityAssessment {
  const details: string[] = [];
  let level: ReelQualityLevel = "ready";

  const extension = input.filename?.match(/\.([^.]+)$/)?.[1]?.toLowerCase() ?? null;
  if (extension && extension !== "mp4" && extension !== "mov") {
    level = "optimize";
    details.push("Titan will create an Instagram-safe MP4 delivery copy; your master stays untouched.");
  }

  if (input.sizeBytes != null && input.sizeBytes > INSTAGRAM_REEL_MAX_BYTES) {
    return {
      level: "blocked",
      headline: "File is larger than Instagram's 1 GB publishing limit",
      details: ["Export a smaller master before scheduling."],
    };
  }

  if (input.durationS != null) {
    if (input.durationS < INSTAGRAM_REEL_MIN_DURATION_S) {
      return {
        level: "blocked",
        headline: "Reels must be at least 3 seconds long",
        details: ["Extend the video before scheduling."],
      };
    }
    if (input.durationS > INSTAGRAM_REEL_MAX_DURATION_S) {
      return {
        level: "blocked",
        headline: "Reels must be 15 minutes or shorter",
        details: ["Trim the video before scheduling."],
      };
    }
  }

  if (input.width && input.height) {
    if (input.width > INSTAGRAM_REEL_MAX_HORIZONTAL_PX) {
      level = "optimize";
      details.push(`Titan will downscale the ${input.width}px-wide source to Instagram's 1920px horizontal limit.`);
    }

    const aspect = input.width / input.height;
    const target = 9 / 16;
    if (Math.abs(aspect - target) > 0.015) {
      details.push("This is not 9:16, so Instagram may crop it or add empty space.");
      if (level === "ready") level = "optimize";
    }

    if (input.width < 1080 || input.height < 1920) {
      details.push("The source is below 1080×1920; Titan will not invent detail by upscaling it.");
      if (level === "ready") level = "optimize";
    }
  }

  return {
    level,
    headline: level === "ready" ? "High-quality Reel master" : "Quality preparation required",
    details: details.length
      ? details
      : ["Titan will verify codec, frame rate, bitrate, audio and fast-start layout before publishing."],
  };
}
