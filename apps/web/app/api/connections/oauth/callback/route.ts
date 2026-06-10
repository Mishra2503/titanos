import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { encryptSecret } from "@/lib/server/crypto";
import { serverError } from "@/lib/server/errors";

const IG = "https://graph.instagram.com";

async function exchangeCode(code: string): Promise<{ access_token: string; user_id: string }> {
  const res = await fetch("https://api.instagram.com/oauth/access_token", {
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
  const body = await res.json();
  if (!res.ok) throw new Error(`code_exchange_failed:${res.status}:${JSON.stringify(body)}`);
  return body;
}

async function getLongLived(shortToken: string): Promise<{ access_token: string; expires_in: number }> {
  const url = new URL(`${IG}/access_token`);
  url.searchParams.set("grant_type", "ig_exchange_token");
  url.searchParams.set("client_secret", process.env.INSTAGRAM_APP_SECRET ?? "");
  url.searchParams.set("access_token", shortToken);
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) throw new Error(`long_lived_failed:${res.status}:${JSON.stringify(body)}`);
  return body;
}

async function fetchProfile(token: string): Promise<{ id: string; username: string; account_type: string; followers_count?: number }> {
  const url = new URL(`${IG}/me`);
  url.searchParams.set("fields", "id,username,account_type,followers_count");
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString());
  const body = await res.json();
  if (!res.ok) throw new Error(`profile_failed:${res.status}:${JSON.stringify(body)}`);
  return body;
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

    const wsId = state;
    const ws = await db.workspace.findUnique({ where: { id: wsId } });
    if (!ws) return NextResponse.redirect(`${webUrl}/connections?error=invalid_state`);

    const short = await exchangeCode(code);
    const longLived = await getLongLived(short.access_token);
    const profile = await fetchProfile(longLived.access_token);

    const accountType = (profile.account_type ?? "").toUpperCase();
    if (!["BUSINESS", "CREATOR", "MEDIA_CREATOR"].includes(accountType)) {
      return NextResponse.redirect(`${webUrl}/connections?error=ineligible_account&type=${encodeURIComponent(accountType)}`);
    }

    const expiresAt = new Date(Date.now() + longLived.expires_in * 1000);
    const existing = await db.igAccount.findFirst({ where: { workspaceId: wsId, igUserId: profile.id } });

    if (existing) {
      await db.igAccount.update({
        where: { id: existing.id },
        data: {
          username: profile.username,
          accountType,
          accessTokenEnc: encryptSecret(longLived.access_token),
          tokenExpiresAt: expiresAt,
          status: "CONNECTED",
          followersCount: profile.followers_count ?? null,
          lastSyncedAt: new Date(),
        },
      });
    } else {
      const limit = Number(process.env.MAX_CONNECTIONS_PER_WORKSPACE ?? 10);
      const count = await db.igAccount.count({ where: { workspaceId: wsId } });
      if (count >= limit) return NextResponse.redirect(`${webUrl}/connections?error=connection_limit`);
      await db.igAccount.create({
        data: {
          workspaceId: wsId,
          igUserId: profile.id,
          username: profile.username,
          accountType,
          accessTokenEnc: encryptSecret(longLived.access_token),
          tokenExpiresAt: expiresAt,
          status: "CONNECTED",
          followersCount: profile.followers_count ?? null,
          lastSyncedAt: new Date(),
        },
      });
    }

    return NextResponse.redirect(`${webUrl}/connections?connected=${encodeURIComponent(profile.username)}`);
  } catch (e) {
    console.error("[oauth callback]", e);
    const msg = e instanceof Error ? e.message.split(":")[0] : "server_error";
    return NextResponse.redirect(`${webUrl}/connections?error=${encodeURIComponent(msg)}`);
  }
}
