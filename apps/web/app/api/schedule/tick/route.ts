import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { publishDuePosts } from "@/lib/server/publisher";
import { prepareInstagramMedia } from "@/lib/server/instagramMedia";
import { maintainInstagramTokens } from "@/lib/server/instagramTokens";
import { db } from "@/lib/server/db";
import { unauthorized, serverError } from "@/lib/server/errors";

const GITHUB_OIDC_ISSUER = "https://token.actions.githubusercontent.com";
const GITHUB_OIDC_AUDIENCE = "titan-os-scheduler";
const GITHUB_REPOSITORY = "Mishra2503/titanos";
const GITHUB_WORKFLOW_REF = `${GITHUB_REPOSITORY}/.github/workflows/titan-scheduler-clock.yml@refs/heads/master`;
const githubJwks = createRemoteJWKSet(new URL(`${GITHUB_OIDC_ISSUER}/.well-known/jwks`));

async function isAuthorized(req: NextRequest): Promise<boolean> {
  // Cloudflare/Supabase cron callers use the long-lived server secret.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && req.headers.get("x-cron-secret") === cronSecret) return true;

  // GitHub Actions uses a short-lived OIDC identity instead of copying a
  // repository secret. Restrict it to this repository, branch, and workflow.
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return false;
  try {
    const { payload } = await jwtVerify(authorization.slice(7), githubJwks, {
      issuer: GITHUB_OIDC_ISSUER,
      audience: GITHUB_OIDC_AUDIENCE,
    });
    return payload.repository === GITHUB_REPOSITORY
      && payload.ref === "refs/heads/master"
      && payload.workflow_ref === GITHUB_WORKFLOW_REF
      && (payload.event_name === "schedule" || payload.event_name === "workflow_dispatch");
  } catch (error) {
    console.warn("[schedule tick] GitHub OIDC rejected", error instanceof Error ? error.message : error);
    return false;
  }
}

// Protected, read-only diagnostics for scheduler recovery. Deliberately omits
// captions, Instagram handles/tokens, storage keys, and public media URLs.
export async function GET(req: NextRequest) {
  try {
    if (!(await isAuthorized(req))) return unauthorized();
    const now = new Date();
    const due = await db.scheduledPost.findMany({
      where: { status: "SCHEDULED", scheduledAt: { lte: now } },
      orderBy: { scheduledAt: "asc" },
      take: 10,
      select: {
        id: true,
        scheduledAt: true,
        attempts: true,
        error: true,
        containerId: true,
        processingStartedAt: true,
        campaign: {
          select: {
            mediaAsset: {
              select: {
                filename: true,
                width: true,
                height: true,
                durationS: true,
                format: true,
                sizeBytes: true,
              },
            },
          },
        },
      },
    });
    const processing = await db.scheduledPost.findMany({
      where: { status: "PROCESSING" },
      orderBy: { processingStartedAt: "asc" },
      take: 10,
      select: {
        id: true,
        scheduledAt: true,
        attempts: true,
        error: true,
        containerId: true,
        processingStartedAt: true,
        campaign: {
          select: {
            mediaAsset: {
              select: {
                filename: true,
                width: true,
                height: true,
                durationS: true,
                format: true,
                sizeBytes: true,
              },
            },
          },
        },
      },
    });
    return NextResponse.json({ ok: true, now, due, processing }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[schedule diagnostics]", error);
    return serverError();
  }
}

// Authenticated, non-publishing production check. It prepares and caches the
// delivery copy for the oldest overdue post but deliberately does not create an
// Instagram container or change the post's workflow status.
export async function PUT(req: NextRequest) {
  try {
    if (!(await isAuthorized(req))) return unauthorized();
    const post = await db.scheduledPost.findFirst({
      where: {
        status: { in: ["SCHEDULED", "PROCESSING"] },
        scheduledAt: { lte: new Date() },
      },
      orderBy: { scheduledAt: "asc" },
      select: {
        id: true,
        campaign: {
          select: {
            mediaAsset: {
              select: { id: true, publicUrl: true, sizeBytes: true },
            },
          },
        },
      },
    });
    if (!post) return NextResponse.json({ ok: true, prepared: false });

    const delivery = await prepareInstagramMedia(post.campaign.mediaAsset);
    return NextResponse.json(
      { ok: true, prepared: true, postId: post.id, action: delivery.action, reasons: delivery.reasons },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("[schedule preparation check]", error);
    return serverError();
  }
}

// Authenticated token maintenance does not publish content. It refreshes
// unexpired tokens nearing their deadline and marks expired tokens for OAuth.
export async function PATCH(req: NextRequest) {
  try {
    if (!(await isAuthorized(req))) return unauthorized();
    const tokens = await maintainInstagramTokens();
    return NextResponse.json({ ok: true, tokens }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[schedule token maintenance]", error);
    return serverError();
  }
}

// Authenticated publisher-only trigger for an external scheduler. Keep this
// endpoint independent from video analysis so a slow analysis job cannot block
// the clock that wakes Render and publishes due posts.
export async function POST(req: NextRequest) {
  try {
    // This path is public in middleware, so only the verified cron secret or
    // exact GitHub workflow identity authorizes publishing.
    if (!(await isAuthorized(req))) return unauthorized();

    // One kill switch must cover the in-process loop, Supabase clock, GitHub
    // backstop, and any manual cron call. This keeps maintenance deployments
    // from accidentally publishing queued content.
    if (process.env.ENABLE_PUBLISHER === "false") {
      return NextResponse.json(
        { ok: true, claimed: 0, publisher: { claimed: 0 }, skipped: "publisher_disabled" },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    // One Reel can spend several minutes processing at Meta. Limit request-led
    // work to one post; the next minute tick safely claims the next due row.
    const tokens = await maintainInstagramTokens();
    const publisher = await publishDuePosts({ maxPosts: 1 });
    return NextResponse.json(
      { ok: true, ...publisher, publisher, tokens },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[schedule tick]", e);
    return serverError();
  }
}
