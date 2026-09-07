// Shared upload size constants - imported by both the browser uploader
// (lib/api.ts) and the server proxy route (app/api/media/upload/route.ts).
// Keep this file free of "use client" and server-only imports.

// Browser -> Titan -> S3 multipart fallback chunk size. S3 requires every
// multipart chunk except the last to be at least 5MB. Keeping each request at
// 8MB avoids proxy body limits while bounding server memory to one small part.
export const MULTIPART_UPLOAD_PART_BYTES = 8 * 1024 * 1024;

// A little headroom for request framing while still rejecting accidental or
// malicious oversized part bodies in the multipart route.
export const MULTIPART_UPLOAD_MAX_PART_BYTES = 10 * 1024 * 1024;

// Keep the legacy one-request fallback comfortably below common proxy limits.
// Larger files use the multipart relay above instead of one huge request.
export const SERVER_UPLOAD_MAX_BYTES = 90 * 1024 * 1024;

export interface MultipartPartPlan {
  partNumber: number;
  start: number;
  end: number;
}

export interface CompletedMultipartPart {
  part_number: number;
  etag: string;
}

export function isCompletedMultipartPartList(
  value: unknown,
): value is CompletedMultipartPart[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 10_000 && value.every(
    (part, index) =>
      typeof part === "object" &&
      part !== null &&
      (part as CompletedMultipartPart).part_number === index + 1 &&
      typeof (part as CompletedMultipartPart).etag === "string" &&
      (part as CompletedMultipartPart).etag.length > 0,
  );
}

export function planMultipartParts(
  sizeBytes: number,
  partBytes = MULTIPART_UPLOAD_PART_BYTES,
): MultipartPartPlan[] {
  if (!Number.isSafeInteger(sizeBytes) || sizeBytes <= 0) {
    throw new Error("invalid_upload_size");
  }
  if (!Number.isSafeInteger(partBytes) || partBytes < 5 * 1024 * 1024) {
    throw new Error("invalid_part_size");
  }
  const count = Math.ceil(sizeBytes / partBytes);
  if (count > 10_000) throw new Error("too_many_upload_parts");
  return Array.from({ length: count }, (_, index) => ({
    partNumber: index + 1,
    start: index * partBytes,
    end: Math.min(sizeBytes, (index + 1) * partBytes),
  }));
}
