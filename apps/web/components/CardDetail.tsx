"use client";

import { useMemo, useState } from "react";
import {
  ApiError,
  type AiAction,
  type BoardCard,
  type CardPatch,
  cardAi,
} from "@/lib/api";

const EMOJIS = ["📝", "🎬", "🔥", "💡", "🚀", "⚡", "🎯", "🧠", "✨", "📱", "🎥", "📊", "🤖", "😡"];
const PLATFORMS = [
  "Instagram",
  "Instagram Reels",
  "YouTube Shorts",
  "TikTok",
  "X",
  "LinkedIn",
];

function parseHashtags(s: string): string[] {
  const tags = s.match(/#\w+/g) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  tags.forEach((t) => {
    const lc = t.toLowerCase();
    if (!seen.has(lc)) {
      seen.add(lc);
      out.push(lc);
    }
  });
  return out;
}

function parseHooks(s: string): string[] {
  return s
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:\d+[).:-]|[-•])\s*/, "").trim())
    .filter((line) => line.length > 0)
    .slice(0, 5);
}

interface Props {
  card: BoardCard;
  onClose: () => void;
  onSave: (patch: CardPatch) => Promise<void>;
  onDelete: () => Promise<void>;
}

export function CardDetail({ card, onClose, onSave, onDelete }: Props) {
  const [draft, setDraft] = useState<BoardCard>(card);
  const [tagInput, setTagInput] = useState("");
  const [busy, setBusy] = useState<AiAction | "save" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiHooks, setAiHooks] = useState<string[] | null>(null);

  const set = <K extends keyof BoardCard>(key: K, value: BoardCard[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const togglePlatform = (p: string) => {
    set(
      "platforms",
      draft.platforms.includes(p)
        ? draft.platforms.filter((x) => x !== p)
        : [...draft.platforms, p],
    );
  };

  const addHashtag = () => {
    const raw = tagInput.trim().replace(/^#*/, "");
    if (!raw) return;
    const tag = "#" + raw.toLowerCase().replace(/\s+/g, "");
    if (!draft.hashtags.includes(tag)) set("hashtags", [...draft.hashtags, tag]);
    setTagInput("");
  };

  const removeHashtag = (tag: string) =>
    set("hashtags", draft.hashtags.filter((t) => t !== tag));

  async function runAi(action: AiAction) {
    setAiError(null);
    setAiHooks(null);
    setBusy(action);
    try {
      const { text } = await cardAi(card.id, action);
      if (action === "hooks") {
        setAiHooks(parseHooks(text));
      } else if (action === "caption") {
        set("caption", text);
      } else if (action === "hashtags") {
        const parsed = parseHashtags(text);
        if (parsed.length > 0) set("hashtags", parsed);
        else set("caption", (draft.caption ?? "") + (draft.caption ? "\n\n" : "") + text);
      } else if (action === "refine") {
        if (draft.caption) set("caption", text);
        else if (draft.hook) set("hook", text);
        else set("notes", text);
      }
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : "AI request failed");
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    setBusy("save");
    try {
      const patch: CardPatch = {
        title: draft.title,
        notes: draft.notes,
        emoji: draft.emoji,
        status: draft.status,
        platforms: draft.platforms,
        publish_date: draft.publish_date,
        hook: draft.hook,
        visual_hook: draft.visual_hook,
        caption: draft.caption,
        hashtags: draft.hashtags,
        reference_url: draft.reference_url,
        raw_footage_url: draft.raw_footage_url,
        cover_image_url: draft.cover_image_url,
      };
      await onSave(patch);
      onClose();
    } finally {
      setBusy(null);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-charcoal-600 bg-charcoal-700 px-3 py-2 text-sm text-ink outline-none focus:border-lime placeholder:text-ink-faint";
  const labelCls =
    "font-mono text-[10px] uppercase tracking-wider text-ink-faint";

  const hasContext = useMemo(
    () => !!(draft.title || draft.notes || draft.hook || draft.caption),
    [draft],
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:p-8"
      onClick={onClose}
    >
      <div
        className="my-4 w-full max-w-3xl animate-reveal rounded-2xl border border-charcoal-600 bg-charcoal-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-charcoal-700 px-6 py-5">
          <div className="relative">
            <button
              onClick={() => {
                const i = EMOJIS.indexOf(draft.emoji ?? "");
                set("emoji", EMOJIS[(i + 1) % EMOJIS.length]);
              }}
              className="press flex h-10 w-10 items-center justify-center rounded-lg bg-charcoal-700 text-2xl hover:bg-charcoal-600"
              title="Cycle emoji"
            >
              {draft.emoji ?? "📝"}
            </button>
          </div>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Untitled card"
            className="flex-1 bg-transparent text-2xl font-semibold text-ink outline-none placeholder:text-ink-faint"
          />
          <button onClick={onClose} className="press text-2xl text-ink-faint hover:text-ink">
            ×
          </button>
        </div>

        {/* Properties */}
        <div className="grid grid-cols-1 gap-4 border-b border-charcoal-700 px-6 py-5 md:grid-cols-2">
          <div>
            <p className={labelCls}>Status</p>
            <input
              value={draft.status ?? ""}
              onChange={(e) => set("status", e.target.value)}
              placeholder="Ready to record"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <p className={labelCls}>Publish date</p>
            <input
              type="date"
              value={draft.publish_date ?? ""}
              onChange={(e) => set("publish_date", e.target.value || null)}
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div className="md:col-span-2">
            <p className={labelCls}>Platforms</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {PLATFORMS.map((p) => {
                const on = draft.platforms.includes(p);
                return (
                  <button
                    key={p}
                    onClick={() => togglePlatform(p)}
                    className={`press rounded-full border px-2.5 py-1 text-xs transition-studio duration-studio ease-studio-out ${
                      on
                        ? "border-lime bg-lime/10 text-lime"
                        : "border-charcoal-600 text-ink-muted hover:text-ink"
                    }`}
                  >
                    {p}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <p className={labelCls}>Reference reel URL</p>
            <input
              value={draft.reference_url ?? ""}
              onChange={(e) => set("reference_url", e.target.value || null)}
              placeholder="https://instagram.com/reel/…"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div>
            <p className={labelCls}>Raw footage URL</p>
            <input
              value={draft.raw_footage_url ?? ""}
              onChange={(e) => set("raw_footage_url", e.target.value || null)}
              placeholder="https://drive.google.com/…"
              className={`mt-1 ${inputCls}`}
            />
          </div>
          <div className="md:col-span-2">
            <p className={labelCls}>Cover image URL</p>
            <input
              value={draft.cover_image_url ?? ""}
              onChange={(e) => set("cover_image_url", e.target.value || null)}
              placeholder="https://…"
              className={`mt-1 ${inputCls}`}
            />
          </div>
        </div>

        {/* AI toolbar */}
        <div className="border-b border-charcoal-700 px-6 py-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-lime">
              ✨ AI assist
            </span>
            {(["hooks", "caption", "hashtags", "refine"] as AiAction[]).map((a) => (
              <button
                key={a}
                onClick={() => runAi(a)}
                disabled={!hasContext || busy !== null}
                className="press rounded-full border border-lime/40 bg-lime/5 px-3 py-1 text-xs text-lime hover:bg-lime/10 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === a
                  ? "Thinking…"
                  : a === "hooks"
                    ? "5 hook ideas"
                    : a === "caption"
                      ? "Write caption"
                      : a === "hashtags"
                        ? "Suggest hashtags"
                        : "Refine"}
              </button>
            ))}
            {!hasContext && (
              <span className="font-mono text-[10px] text-ink-faint">
                add a title or notes first
              </span>
            )}
          </div>
          {aiError && (
            <p className="mt-2 font-mono text-xs text-red-400">{aiError}</p>
          )}
          {aiHooks && (
            <div className="mt-3 space-y-1.5 rounded-lg border border-lime/20 bg-lime/[0.04] p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-lime">
                Click a hook to use it
              </p>
              {aiHooks.map((h, i) => (
                <button
                  key={i}
                  onClick={() => {
                    set("hook", h);
                    setAiHooks(null);
                  }}
                  className="press block w-full rounded-md px-2 py-1.5 text-left text-sm text-ink hover:bg-lime/10"
                >
                  {h}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Long-form fields */}
        <div className="space-y-4 px-6 py-5">
          <div>
            <p className={labelCls}>Visual hook</p>
            <textarea
              value={draft.visual_hook ?? ""}
              onChange={(e) => set("visual_hook", e.target.value || null)}
              rows={2}
              placeholder="On-screen text, opening shot, B-roll concept…"
              className={`mt-1 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <p className={labelCls}>Hook (opening line)</p>
            <textarea
              value={draft.hook ?? ""}
              onChange={(e) => set("hook", e.target.value || null)}
              rows={2}
              placeholder="The first 7 seconds — make them stop scrolling."
              className={`mt-1 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <p className={labelCls}>Caption</p>
            <textarea
              value={draft.caption ?? ""}
              onChange={(e) => set("caption", e.target.value || null)}
              rows={6}
              placeholder="What goes under the post on Instagram…"
              className={`mt-1 resize-none ${inputCls}`}
            />
          </div>
          <div>
            <p className={labelCls}>Hashtags ({draft.hashtags.length})</p>
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-charcoal-600 bg-charcoal-700 p-2">
              {draft.hashtags.map((t) => (
                <span
                  key={t}
                  className="flex items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 font-mono text-xs text-lime"
                >
                  {t}
                  <button
                    onClick={() => removeHashtag(t)}
                    className="text-lime/70 hover:text-red-400"
                    aria-label={`Remove ${t}`}
                  >
                    ×
                  </button>
                </span>
              ))}
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " " || e.key === ",") {
                    e.preventDefault();
                    addHashtag();
                  } else if (e.key === "Backspace" && !tagInput && draft.hashtags.length > 0) {
                    removeHashtag(draft.hashtags[draft.hashtags.length - 1]);
                  }
                }}
                placeholder="add hashtag…"
                className="min-w-[120px] flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
              />
            </div>
          </div>
          <div>
            <p className={labelCls}>Notes</p>
            <textarea
              value={draft.notes ?? ""}
              onChange={(e) => set("notes", e.target.value || null)}
              rows={3}
              placeholder="Anything else worth remembering…"
              className={`mt-1 resize-none ${inputCls}`}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between rounded-b-2xl border-t border-charcoal-700 bg-charcoal-800 px-6 py-4">
          <button
            onClick={onDelete}
            className="press rounded-lg border border-red-400/30 px-3 py-1.5 text-sm text-red-400 hover:bg-red-400/10"
          >
            Delete
          </button>
          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="press rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink"
            >
              Cancel
            </button>
            <button
              onClick={save}
              disabled={busy === "save"}
              className="press rounded-lg bg-lime px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-60"
            >
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
