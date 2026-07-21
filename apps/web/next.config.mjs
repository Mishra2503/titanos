import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // ffmpeg-static resolves its binary path at runtime from node_modules —
  // bundling it would break the computed path, so keep it external.
  serverExternalPackages: ["ffmpeg-static"],
  webpack: (config) => {
    config.resolve.alias["@"] = __dirname;
    return config;
  },
  experimental: {
    // Next.js caps request bodies passing through middleware at 10MB by
    // default. Our middleware matches every route (including
    // /api/media/upload), so without raising this, any reel over ~10MB is
    // silently truncated before it reaches the route handler — the real
    // cause of "Failed to parse body as FormData" on real-world video sizes.
    middlewareClientMaxBodySize: "500mb",
  },
};

export default nextConfig;
