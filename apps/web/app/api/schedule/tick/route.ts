import { NextRequest, NextResponse } from "next/server";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { publishDuePosts } from "@/lib/server/publisher";
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

// Authenticated publisher-only trigger for an external scheduler. Keep this
// endpoint independent from video analysis so a slow analysis job cannot block
// the clock that wakes Render and publishes due posts.
export async function POST(req: NextRequest) {
  try {
    // This path is public in middleware, so only the verified cron secret or
    // exact GitHub workflow identity authorizes publishing.
    if (!(await isAuthorized(req))) return unauthorized();

    // One Reel can spend several minutes processing at Meta. Limit request-led
    // work to one post; the next minute tick safely claims the next due row.
    const publisher = await publishDuePosts({ maxPosts: 1 });
    return NextResponse.json(
      { ok: true, ...publisher, publisher },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[schedule tick]", e);
    return serverError();
  }
}
