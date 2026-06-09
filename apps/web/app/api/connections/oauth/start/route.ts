import { NextRequest, NextResponse } from "next/server";
import { badRequest, unauthorized, serverError } from "@/lib/server/errors";

export async function GET(req: NextRequest) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();

    const appId = process.env.INSTAGRAM_APP_ID;
    const redirectUri = process.env.INSTAGRAM_REDIRECT_URI;
    if (!appId || !redirectUri) {
      return badRequest(
        "not_configured",
        "Instagram OAuth credentials are not configured. Set INSTAGRAM_APP_ID and INSTAGRAM_REDIRECT_URI.",
      );
    }

    const url = new URL("https://www.instagram.com/oauth/authorize");
    url.searchParams.set("client_id", appId);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set(
      "scope",
      "instagram_business_basic,instagram_business_manage_insights,instagram_business_content_publish",
    );
    url.searchParams.set("response_type", "code");
    url.searchParams.set("state", wsId);

    return NextResponse.json({ authorize_url: url.toString() });
  } catch (e) {
    console.error("[oauth start]", e);
    return serverError();
  }
}
