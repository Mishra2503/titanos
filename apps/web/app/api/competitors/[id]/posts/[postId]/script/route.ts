import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { aiErrorResponse } from "@/lib/server/ai";
import { generateScript, serializeScript, type ReelSeed } from "@/lib/server/scripts";

// Generate a shoot-ready script from a competitor reel and persist it as a
// DRAFT the Scriptwriter tab opens.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    const userId = req.headers.get("x-user-id");
    if (!wsId) return unauthorized();
    const { id, postId } = await params;

    const post = await db.competitorPost.findFirst({
      where: { id: postId, competitorId: id, workspaceId: wsId },
      include: { videoAnalysis: true, competitor: { select: { username: true, category: true } } },
    });
    if (!post) return notFound("Reel not found");

    const va = post.videoAnalysis;
    const vaFields = (va?.analysis ?? {}) as Record<string, unknown>;
    const ca = (post.contentAnalysis ?? null) as { content_ideas?: { idea?: string }[] } | null;
    const angleFromAnalysis = ca?.content_ideas?.[0]?.idea ?? null;

    const seed: ReelSeed = {
      username: post.competitor.username,
      niche: post.competitor.category,
      caption: post.caption,
      hashtags: (post.hashtags as string[]) ?? [],
      views: post.views,
      likes: post.likes,
      comments: post.comments,
      transcript: va?.transcript ?? null,
      detectedHook: (vaFields.hook_spoken as string) ?? (vaFields.hook_visual as string) ?? null,
      detectedFormat: (vaFields.format as string) ?? null,
      angleFromAnalysis,
    };

    const gen = await generateScript(seed);

    const script = await db.script.create({
      data: {
        workspaceId: wsId,
        competitorId: id,
        competitorPostId: postId,
        title: gen.title,
        status: "DRAFT",
        sourceReel: {
          username: post.competitor.username,
          permalink: post.permalink,
          caption: post.caption,
          views: post.views,
          thumbnail_url: post.thumbnailUrl,
        },
        research: gen.research as unknown as object,
        hook: gen.hook,
        body: gen.body,
        caption: gen.caption,
        hashtags: gen.hashtags,
        model: gen.model,
        createdBy: userId ?? null,
      },
    });

    return NextResponse.json(serializeScript({ ...script, competitorUsername: post.competitor.username }), { status: 201 });
  } catch (e) {
    console.error("[reel script generate]", e);
    return aiErrorResponse(e) ?? serverError(`Script generation failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
