import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { encryptSecret } from "@/lib/server/crypto";
import { serverError } from "@/lib/server/errors";

const GRAPH = `https://graph.facebook.com/${process.env.INSTAGRAM_GRAPH_VERSION ?? "v21.0"}`;

async function exchangeCode(code: string): Promise<{ access_token: string; user_id: string }> {
  const url = new URL("https://api.instagram.com/oauth/access_token");
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.INSTAGRAM_APP_ID ?? "",
      client_secret: process.env.INSTAGRAM_APP_SECRET ?? "",
      grant_type: "authorization_code",
      redirect_uri: process.env.INSTAGRAM_REDIRECT_URI ?? "",
      code,
    }),
  });
  if (!res.ok) throw new Error(`code exchange failed: ${res.status}`);
  return res.json();
}

async function getLongLived(shortToken: string) {
  const res = await fetch(`${GRAPH}/oauth/access_token?grant_type=ig_exchange_token&client_secret=${process.env.INSTAGRAM_APP_SECRET}&access_token=${shortToken}`);
  if (!res.ok) throw new Error(`long-lived exchange failed: ${res.status}`);
  return res.json() as Promise<{ access_token: string; expires_in: number }>;
}

async function fetchProfile(token: string) {
  const fields = "id,username,account_type,followers_count";
  const res = await fetch(`${GRAPH}/me?fields=${fields}&access_token=${token}`);
  if (!res.ok) throw new Error(`profile fetch failed: ${res.status}`);
  return res.json() as Promise<{ id: string; username: string; account_type: string; followers_count?: number }>;
}

export async function GET(req: NextRequest) {
  const webUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
  try {
    const { searchParams } = req.nextUrl;
    const code = searchParams.get("code");
    const state = searchParams.get("state");
    const error = searchParams.get("error");

    if (error) return NextResponse.redirect(`${webUrl}/connections?error=${encodeURIComponent(error)}`);
    if (!code || !state) return NextResponse.redirect(`${webUrl}/connections?error=missing_params`);

    // state encodes workspace_id (set when initiating OAuth)
    const wsId = state;
    const ws = await db.workspace.findUnique({ where: { id: wsId } });
    if (!ws) return NextResponse.redirect(`${webUrl}/connections?error=invalid_state`);

    const short = await exchangeCode(code);
    const longLived = await getLongLived(short.access_token);
    const profile = await fetchProfile(longLived.access_token);

    const accountType = (profile.account_type ?? "").toUpperCase();
    if (!["BUSINESS", "CREATOR"].includes(accountType)) {
      return NextResponse.redirect(`${webUrl}/connections?error=ineligible_account`);
    }

    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000);
    const existing = await db.igAccount.findFirst({ where: { workspaceId: wsId, igUserId: profile.id } });

    if (existing) {
      await db.igAccount.update({
        where: { id: existing.id },
        data: { username: profile.username, accountType, accessTokenEnc: encryptSecret(longLived.access_token), tokenExpiresAt: expiresAt, status: "CONNECTED", followersCount: profile.followers_count ?? null, lastSyncedAt: new Date() },
      });
    } else {
      const limit = Number(process.env.MAX_CONNECTIONS_PER_WORKSPACE ?? 10);
      const count = await db.igAccount.count({ where: { workspaceId: wsId } });
      if (count >= limit) return NextResponse.redirect(`${webUrl}/connections?error=connection_limit`);
      await db.igAccount.create({
        data: { workspaceId: wsId, igUserId: profile.id, username: profile.username, accountType, accessTokenEnc: encryptSecret(longLived.access_token), tokenExpiresAt: expiresAt, status: "CONNECTED", followersCount: profile.followers_count ?? null, lastSyncedAt: new Date() },
      });
    }

    return NextResponse.redirect(`${webUrl}/connections?connected=${encodeURIComponent(profile.username)}`);
  } catch (e) {
    console.error("[oauth callback]", e);
    return NextResponse.redirect(`${webUrl}/connections?error=server_error`);
  }
}
