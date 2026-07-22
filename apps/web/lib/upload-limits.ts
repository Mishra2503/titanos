// Shared upload size constants - imported by both the browser uploader
// (lib/api.ts) and the server proxy route (app/api/media/upload/route.ts).
// Keep this file free of "use client" and server-only imports.

// Cloudinary chunked-upload chunk size. Cloudinary requires >=5MB for every
// chunk except the last; 20MB matches their own SDK default. Files above
// ~100MB are rejected by Cloudinary unless sent chunked.
export const CLOUDINARY_CHUNK_BYTES = 20 * 1024 * 1024;

// Max body the server-side proxy fallback will accept. Cloudflare fronts the
// Render deployment and kills request bodies around 100MB at the edge (the
// opaque 502s) - stay comfortably under it. Bigger files must go directly
// from the browser to Cloudinary in chunks.
export const SERVER_UPLOAD_MAX_BYTES = 90 * 1024 * 1024;
