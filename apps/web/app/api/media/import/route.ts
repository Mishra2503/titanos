import { NextRequest, NextResponse } from "next/server";
import { badRequest, serverError, unauthorized } from "@/lib/server/errors";
import { importRemoteMedia } from "@/lib/server/remoteMedia";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(req: NextRequest) {
  try {
    const workspaceId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!workspaceId || !userId) return unauthorized();

    const body = (await req.json().catch(() => null)) as { source_url?: unknown; filename?: unknown } | null;
    if (!body || typeof body.source_url !== "string" || !body.source_url.trim()) {
      return badRequest("missing_source_url", "source_url is required");
    }
    if (body.filename !== undefined && typeof body.filename !== "string") {
      return badRequest("invalid_filename", "filename must be a string");
    }

    const asset = await importRemoteMedia({
      workspaceId,
      userId,
      sourceUrl: body.source_url,
      filename: typeof body.filename === "string" ? body.filename : null,
    });
    return NextResponse.json(asset, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Remote media import failed";
    console.error("[media import]", message);
    if (/source_url|public IPv4|redirect|not a video|1GB|empty file/i.test(message)) {
      return badRequest("invalid_remote_media", message);
    }
    return serverError(`Remote media import failed: ${message}`);
  }
}
