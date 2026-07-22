import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { serializeCard } from "@/lib/server/board";

// One-click "Send to Content Board": turn a competitor reel into an idea-stage
// card. Mirrors the script-approve flow (find/create the "Ideas" column, create
// a card, link it back) but skips the script step so a reel lands on the board
// in a single click, straight from the reel modal.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string; postId: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id, postId } = await params;

    const post = await db.competitorPost.findFirst({
      where: { id: postId, competitorId: id, workspaceId: wsId },
      include: { videoAnalysis: true, competitor: { select: { username: true } } },
    });
    if (!post) return notFound("Reel not found");

    // Already on the board - return the existing card instead of duplicating.
    if (post.boardCardId) {
      const existing = await db.boardCard.findFirst({
        where: { id: post.boardCardId, workspaceId: wsId },
        include: { videoAnalysis: true },
      });
      if (existing) {
        return NextResponse.json(
          { card: serializeCard(existing), card_id: existing.id, column_id: existing.columnId, already: true },
          { status: 200 },
        );
      }
    }

    const va = post.videoAnalysis;
    const vaFields = (va?.analysis ?? {}) as Record<string, unknown>;
    const ca = (post.contentAnalysis ?? null) as {
      hook?: string | null;
      body?: string | null;
      cta?: string | null;
      content_ideas?: { idea?: string; angle?: string }[];
    } | null;

    const detectedHook =
      (vaFields.hook_spoken as string) ?? (vaFields.hook_visual as string) ?? ca?.hook ?? null;
    const captionFirstLine =
      post.caption?.split("\n").map((l) => l.trim()).find(Boolean) ?? null;
    const ideaFromAnalysis = ca?.content_ideas?.[0]?.idea ?? null;

    // Smart title: content idea > detected hook > first caption line > fallback.
    const title =
      ideaFromAnalysis ||
      detectedHook ||
      captionFirstLine ||
      `Reel from @${post.competitor.username}`;

    // Notes: keep the useful context so the card is actionable on its own.
    const noteParts: string[] = [];
    noteParts.push(`Idea from @${post.competitor.username}'s reel.`);
    if (ca?.content_ideas?.[0]?.angle) noteParts.push(`Angle: ${ca.content_ideas[0].angle}`);
    if (vaFields.why_it_works) noteParts.push(`Why it works: ${vaFields.why_it_works as string}`);
    if (va?.transcript) noteParts.push(`\nTranscript:\n${va.transcript}`);
    else if (post.caption) noteParts.push(`\nOriginal caption:\n${post.caption}`);

    // Find (or create) the "Ideas" column - same behaviour as script approve.
    let column = await db.boardColumn.findFirst({
      where: { workspaceId: wsId, name: { equals: "Ideas", mode: "insensitive" } },
    });
    if (!column) {
      const minPos = await db.boardColumn.aggregate({ where: { workspaceId: wsId }, _min: { position: true } });
      column = await db.boardColumn.create({
        data: { workspaceId: wsId, name: "Ideas", color: "slate", position: (minPos._min.position ?? 0) - 1 },
      });
    }

    const maxPos = await db.boardCard.aggregate({ where: { columnId: column.id }, _max: { position: true } });
    const card = await db.boardCard.create({
      data: {
        workspaceId: wsId,
        columnId: column.id,
        title: title.slice(0, 200),
        notes: noteParts.join("\n"),
        hook: detectedHook,
        caption: post.caption,
        hashtags: (post.hashtags as string[]) ?? [],
        status: "Idea",
        referenceUrl: post.permalink,
        coverImageUrl: post.thumbnailUrl,
        position: (maxPos._max.position ?? 0) + 1,
      },
      include: { videoAnalysis: true },
    });

    // Link the reel back so the "On board" badge lights up on refresh.
    await db.competitorPost.update({ where: { id: post.id }, data: { boardCardId: card.id } });

    return NextResponse.json(
      { card: serializeCard(card), card_id: card.id, column_id: column.id, already: false },
      { status: 201 },
    );
  } catch (e) {
    console.error("[reel -> board]", e);
    return serverError(`Could not add to board: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
