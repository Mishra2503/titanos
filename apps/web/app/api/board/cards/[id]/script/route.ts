import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/server/db";
import { unauthorized, notFound, serverError } from "@/lib/server/errors";
import { aiErrorResponse } from "@/lib/server/ai";
import { generateScript, type ReelSeed } from "@/lib/server/scripts";
import { serializeCard } from "@/lib/server/board";

const VA_SELECT = { status: true, summary: true, analysis: true, transcript: true, analyzedAt: true, error: true } as const;

// "Script it" for a Content Board card. Turns the card (and, when present, the
// watched reference reel: transcript + detected hook/format) into a shoot-ready
// script and writes it straight into the card - hook, visual hook, caption,
// hashtags, and the full teleprompter body in `notes`. Reuses generateScript().
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const wsId = req.headers.get("x-workspace-id");
    if (!wsId) return unauthorized();
    const { id } = await params;

    const card = await db.boardCard.findFirst({
      where: { id, workspaceId: wsId },
      include: { videoAnalysis: { select: VA_SELECT } },
    });
    if (!card) return notFound("Card not found");

    const va = card.videoAnalysis;
    const a = (va?.analysis ?? {}) as Record<string, unknown>;
    const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : null);

    const seed: ReelSeed = {
      username: "you",
      niche: (card.platforms as string[])?.join(", ") || "AI/tech",
      caption: card.caption ?? null,
      hashtags: (card.hashtags as string[]) ?? [],
      views: null,
      likes: null,
      comments: null,
      transcript: va?.transcript ?? null,
      detectedHook: str(a.hookSpoken) ?? str(a.hookVisual) ?? card.hook ?? null,
      detectedFormat: str(a.format),
      // The card's own title/notes are the angle we build the script around.
      angleFromAnalysis: [card.title, card.notes].filter(Boolean).join(" - ").slice(0, 600) || null,
    };

    const gen = await generateScript(seed);

    const updated = await db.boardCard.update({
      where: { id },
      data: {
        notes: gen.body || card.notes,
        hook: gen.hook ?? card.hook,
        visualHook: str(a.hookVisual) ?? card.visualHook,
        caption: gen.caption ?? card.caption,
        hashtags: gen.hashtags.length ? gen.hashtags : (card.hashtags as string[]) ?? [],
        scriptedAt: new Date(),
      },
      include: { videoAnalysis: { select: VA_SELECT } },
    });

    return NextResponse.json(serializeCard(updated));
  } catch (e) {
    console.error("[card script]", e);
    return aiErrorResponse(e) ?? serverError(`Script generation failed: ${(e as Error)?.message ?? "unknown error"}`);
  }
}
