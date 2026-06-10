import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";
import { unauthorized, badRequest, serverError } from "@/lib/server/errors";

// Issues a short-lived signature so the browser can upload the video straight
// to Cloudinary. This avoids proxying hundreds of MB through the Next server
// (the cause of the old "internal server error" on large reels).
export async function POST(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET } = process.env;
    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      return badRequest("cloudinary_not_configured", "Cloudinary credentials are not set. Add CLOUDINARY_CLOUD_NAME / API_KEY / API_SECRET to the environment.");
    }

    const { filename } = (await req.json().catch(() => ({}))) as { filename?: string };
    const base = (filename ?? "reel").replace(/\.[^.]+$/, "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 60);
    const publicId = `${Date.now()}-${base}`;
    const folder = "titan-os/masters";
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = cloudinary.utils.api_sign_request(
      { folder, public_id: publicId, timestamp },
      CLOUDINARY_API_SECRET,
    );

    return NextResponse.json({
      cloud_name: CLOUDINARY_CLOUD_NAME,
      api_key: CLOUDINARY_API_KEY,
      timestamp,
      folder,
      public_id: publicId,
      signature,
    });
  } catch (e) {
    console.error("[media sign]", e);
    return serverError();
  }
}
