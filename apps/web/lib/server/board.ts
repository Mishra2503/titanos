import { videoAnalysisOut } from "./videoAnalysis";

// Shared Content Board card serialization (Prisma row → client shape). Kept in
// one place so the board list, the card PATCH, and the analyze/script routes all
// emit the same fields - including the new tags, scripted_at and the watched
// reference-reel analysis.

interface VaRow {
  status: string;
  summary: string | null;
  analysis: unknown;
  transcript: string | null;
  analyzedAt?: Date | null;
  error?: string | null;
}

export interface CardRow {
  id: string;
  columnId: string;
  title: string;
  notes: string | null;
  position: number;
  emoji: string | null;
  status: string | null;
  platforms: unknown;
  publishDate: string | null;
  hook: string | null;
  visualHook: string | null;
  caption: string | null;
  hashtags: unknown;
  referenceUrl: string | null;
  rawFootageUrl: string | null;
  coverImageUrl: string | null;
  scriptedAt: Date | null;
  tags: unknown;
  videoAnalysis?: VaRow | null;
}

export function serializeCard(c: CardRow) {
  return {
    id: c.id,
    column_id: c.columnId,
    title: c.title,
    notes: c.notes,
    position: c.position,
    emoji: c.emoji,
    status: c.status,
    platforms: (c.platforms as string[]) ?? [],
    publish_date: c.publishDate,
    hook: c.hook,
    visual_hook: c.visualHook,
    caption: c.caption,
    hashtags: (c.hashtags as string[]) ?? [],
    reference_url: c.referenceUrl,
    raw_footage_url: c.rawFootageUrl,
    cover_image_url: c.coverImageUrl,
    scripted_at: c.scriptedAt ? c.scriptedAt.toISOString() : null,
    tags: (c.tags as string[]) ?? [],
    video_analysis: videoAnalysisOut(c.videoAnalysis ?? null),
  };
}
