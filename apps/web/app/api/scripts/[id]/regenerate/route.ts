import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { aiErrorResponse } from "@/lib/server/ai";
import { regenerateScript, serializeScript, type ReelSeed } from "@/lib/server/scripts";

// Regenerate a fresh script variation from the same source reel + strategy.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;
    const script = await db.script.findFirst({ where: { id, workspaceId: wsId } });
    if (!script) return notFound("Script not found");

    // Rebuild the reel context (prefer the live reel; fall back to the snapshot).
    const post = script.competitorPostId
      ? await db.competitorPost.findFirst({
          where: { id: script.competitorPostId, workspaceId: wsId },
          include: { videoAnalysis: true, competitor: { select: { username: true, category: true } } },
        })
      : null;
    const snap = (script.sourceReel ?? {}) as Record<string, unknown>;
    const va = post?.videoAnalysis;
    const vaFields = (va?.analysis ?? {}) as Record<string, unknown>;

    const seed: ReelSeed = {
      username: post?.competitor.username ?? (snap.username as string) ?? "creator",
      niche: post?.competitor.category ?? null,
      caption: post?.caption ?? (snap.caption as string) ?? null,
      hashtags: (post?.hashtags as string[]) ?? [],
      views: post?.views ?? (typeof snap.views === "number" ? (snap.views as number) : null),
      likes: post?.likes ?? null,
      comments: post?.comments ?? null,
      transcript: va?.transcript ?? null,
      detectedHook: (vaFields.hook_spoken as string) ?? (vaFields.hook_visual as string) ?? null,
      detectedFormat: (vaFields.format as string) ?? null,
      angleFromAnalysis: null,
    };

    const gen = await regenerateScript(seed, script.body);
    const updated = await db.script.update({
      where: { id },
      data: {
        title: gen.title,
        hook: gen.hook,
        body: gen.body,
        caption: gen.caption,
        hashtags: gen.hashtags,
        research: gen.research as unknown as object,
        model: gen.model,
      },
    });

    return NextResponse.json(serializeScript({ ...updated, competitorUsername: post?.competitor.username ?? (snap.username as string) ?? null }));
  } catch (e) {
    console.error("[script regenerate]", e);
    return aiErrorResponse(e) ?? serverError(`Regenerate failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
