"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ApiError,
  type AiAction,
  type BoardCard,
  type CardPatch,
  type PostVideoAnalysis,
  analyzeCard,
  cardAi,
  getCardAnalysis,
  scriptCard,
} from "@/lib/api";

const EMOJIS = ["📝", "🎬", "🔥", "💡", "🚀", "⚡", "🎯", "🧠", "✨", "📱", "🎥", "📊", "🤖", "😡"];
const PLATFORMS = ["Instagram", "Instagram Reels", "YouTube Shorts", "TikTok", "X", "LinkedIn"];

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
  onCardChanged: (partial: Partial<BoardCard>) => void;
}

export function CardDetail({ card, onClose, onSave, onDelete, onCardChanged }: Props) {
  const [draft, setDraft] = useState<BoardCard>(card);
  const [tagInput, setTagInput] = useState("");
  const [labelInput, setLabelInput] = useState("");
  const [busy, setBusy] = useState<AiAction | "save" | "analyze" | "script" | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [aiHooks, setAiHooks] = useState<string[] | null>(null);
  const [analysis, setAnalysis] = useState<PostVideoAnalysis | null>(card.video_analysis ?? null);
  const [scriptedAt, setScriptedAt] = useState<string | null>(card.scripted_at ?? null);

  // Keep the parent's live-merge callback fresh without re-subscribing effects.
  const changedRef = useRef(onCardChanged);
  changedRef.current = onCardChanged;

  const set = <K extends keyof BoardCard>(key: K, value: BoardCard[K]) =>
    setDraft((d) => ({ ...d, [key]: value }));

  const togglePlatform = (p: string) => {
    set(
      "platforms",
      draft.platforms.includes(p) ? draft.platforms.filter((x) => x !== p) : [...draft.platforms, p],
    );
  };

  const addHashtag = () => {
    const raw = tagInput.trim().replace(/^#*/, "");
    if (!raw) return;
    const tag = "#" + raw.toLowerCase().replace(/\s+/g, "");
    if (!draft.hashtags.includes(tag)) set("hashtags", [...draft.hashtags, tag]);
    setTagInput("");
  };
  const removeHashtag = (tag: string) => set("hashtags", draft.hashtags.filter((t) => t !== tag));

  const addTag = () => {
    const raw = labelInput.trim().replace(/[,]+$/, "").trim();
    if (!raw) return;
    if (!draft.tags.includes(raw)) set("tags", [...draft.tags, raw]);
    setLabelInput("");
  };
  const removeTag = (t: string) => set("tags", draft.tags.filter((x) => x !== t));

  const buildPatch = useCallback(
    (): CardPatch => ({
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
      tags: draft.tags,
    }),
    [draft],
  );

  async function runAi(action: AiAction) {
    setAiError(null);
    setAiHooks(null);
    setBusy(action);
    try {
      const { text } = await cardAi(card.id, action);
      if (action === "hooks") setAiHooks(parseHooks(text));
      else if (action === "caption") set("caption", text);
      else if (action === "hashtags") {
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

  // Persist the current draft first (so the server sees the latest reference URL
  // / notes), without closing the modal.
  const persistDraft = useCallback(() => onSave(buildPatch()), [onSave, buildPatch]);

  async function analyze() {
    setActionError(null);
    setBusy("analyze");
    try {
      await persistDraft(); // make sure reference_url is saved before we watch it
      const va = await analyzeCard(card.id);
      setAnalysis(va);
      changedRef.current({ video_analysis: va });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Could not start the analysis");
    } finally {
      setBusy(null);
    }
  }

  async function scriptIt() {
    setActionError(null);
    setBusy("script");
    try {
      await persistDraft();
      const updated = await scriptCard(card.id);
      setDraft((d) => ({
        ...d,
        notes: updated.notes,
        hook: updated.hook,
        visual_hook: updated.visual_hook,
        caption: updated.caption,
        hashtags: updated.hashtags,
      }));
      setScriptedAt(updated.scripted_at);
      changedRef.current(updated);
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : "Script generation failed");
    } finally {
      setBusy(null);
    }
  }

  // Poll while the reel is being watched.
  const watching = analysis?.status === "PENDING" || analysis?.status === "PROCESSING";
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(async () => {
      try {
        const va = await getCardAnalysis(card.id);
        setAnalysis(va);
        changedRef.current({ video_analysis: va });
      } catch {
        /* keep polling */
      }
    }, 8000);
    return () => clearInterval(t);
  }, [watching, card.id]);

  async function save() {
    setBusy("save");
    try {
      await onSave(buildPatch());
      onClose();
    } finally {
      setBusy(null);
    }
  }

  const inputCls =
    "w-full rounded-lg border border-charcoal-600 bg-charcoal-700 px-3 py-2 text-sm text-ink outline-none focus:border-lime placeholder:text-ink-faint";
  const labelCls = "font-mono text-[10px] uppercase tracking-wider text-ink-faint";

  const hasContext = useMemo(
    () => !!(draft.title || draft.notes || draft.hook || draft.caption),
    [draft],
  );
  const analyzed = analysis?.status === "DONE";
  const anyBusy = busy !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-3 sm:p-6"
      onClick={onClose}
    >
      <div
        className="my-3 w-full max-w-5xl animate-reveal rounded-2xl border border-charcoal-600 bg-charcoal-800 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center gap-3 border-b border-charcoal-700 px-6 py-4">
          <button
            onClick={() => {
              const i = EMOJIS.indexOf(draft.emoji ?? "");
              set("emoji", EMOJIS[(i + 1) % EMOJIS.length]);
            }}
            className="press flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-charcoal-700 text-2xl hover:bg-charcoal-600"
            title="Cycle emoji"
          >
            {draft.emoji ?? "📝"}
          </button>
          <input
            value={draft.title}
            onChange={(e) => set("title", e.target.value)}
            placeholder="Untitled card"
            className="min-w-0 flex-1 bg-transparent text-xl font-semibold text-ink outline-none placeholder:text-ink-faint sm:text-2xl"
          />
          {analyzed && (
            <span className="hidden flex-shrink-0 rounded-full bg-sky-400/10 px-2 py-0.5 text-[11px] font-medium text-sky-300 sm:inline">
              👁 Analyzed
            </span>
          )}
          {scriptedAt && (
            <span className="hidden flex-shrink-0 rounded-full bg-lime/10 px-2 py-0.5 text-[11px] font-medium text-lime sm:inline">
              📝 Scripted
            </span>
          )}
          <button onClick={onClose} className="press flex-shrink-0 text-2xl text-ink-faint hover:text-ink">
            ×
          </button>
        </div>

        {/* Two-pane body */}
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-5">
          {/* LEFT — the record surface (script / teleprompter) */}
          <div className="space-y-4 border-b border-charcoal-700 px-6 py-5 lg:col-span-3 lg:border-b-0 lg:border-r">
            {/* AI assist */}
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] uppercase tracking-wider text-lime">✨ AI assist</span>
                {(["hooks", "caption", "hashtags", "refine"] as AiAction[]).map((a) => (
                  <button
                    key={a}
                    onClick={() => runAi(a)}
                    disabled={!hasContext || anyBusy}
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
              </div>
              {aiError && <p className="mt-2 font-mono text-xs text-red-400">{aiError}</p>}
              {aiHooks && (
                <div className="mt-3 space-y-1.5 rounded-lg border border-lime/20 bg-lime/[0.04] p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-lime">Click a hook to use it</p>
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

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <p className={labelCls}>Visual hook</p>
                <textarea
                  value={draft.visual_hook ?? ""}
                  onChange={(e) => set("visual_hook", e.target.value || null)}
                  rows={2}
                  placeholder="On-screen text, opening shot, B-roll…"
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
            </div>

            {/* The teleprompter — big and readable */}
            <div>
              <div className="flex items-center justify-between">
                <p className={labelCls}>Script / Teleprompter</p>
                <span className="font-mono text-[10px] text-ink-faint">{(draft.notes ?? "").length} chars</span>
              </div>
              <textarea
                value={draft.notes ?? ""}
                onChange={(e) => set("notes", e.target.value || null)}
                rows={18}
                placeholder="HOOK (0-3s): …&#10;BODY beat 1: …&#10;BODY beat 2: …&#10;CTA: …&#10;&#10;Write or generate the full script here — this is what you read on camera."
                className="mt-1 w-full resize-y rounded-lg border border-charcoal-600 bg-charcoal-700 px-4 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-lime placeholder:text-ink-faint"
              />
            </div>
          </div>

          {/* RIGHT — meta + actions */}
          <div className="space-y-4 px-6 py-5 lg:col-span-2">
            {/* Primary actions */}
            <div className="space-y-2 rounded-xl border border-charcoal-700 bg-charcoal-900/40 p-3">
              <button
                onClick={analyze}
                disabled={anyBusy || !draft.reference_url?.trim()}
                title={draft.reference_url?.trim() ? "Watch the reference reel frame-by-frame + transcript" : "Add a Reference reel URL first"}
                className="press flex w-full items-center justify-center gap-2 rounded-lg border border-sky-400/40 bg-sky-400/10 px-3 py-2 text-sm font-semibold text-sky-300 hover:bg-sky-400/20 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "analyze" ? "Starting…" : watching ? "Watching the reel…" : analyzed ? "👁 Re-analyze reel" : "👁 Analyze reel"}
              </button>
              <button
                onClick={scriptIt}
                disabled={anyBusy || !hasContext}
                title={analyzed ? "Turn the watched reel into a shoot-ready script" : "Best after Analyze — will still use the card's context"}
                className="btn-primary press flex w-full items-center justify-center gap-2 px-3 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-40"
              >
                {busy === "script" ? "Scripting…" : scriptedAt ? "📝 Re-script it" : "📝 Script it"}
              </button>
              {actionError && <p className="font-mono text-xs text-red-400">{actionError}</p>}
              {!draft.reference_url?.trim() && (
                <p className="font-mono text-[10px] text-ink-faint">Add a reference reel URL below to analyze it.</p>
              )}
            </div>

            {/* Analysis result */}
            {analysis && <AnalysisPanel analysis={analysis} onUseScript={(s) => set("notes", s)} />}

            {/* Meta */}
            <div className="grid grid-cols-2 gap-3">
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
            </div>

            <div>
              <p className={labelCls}>Platforms</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {PLATFORMS.map((p) => {
                  const on = draft.platforms.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => togglePlatform(p)}
                      className={`press rounded-full border px-2.5 py-1 text-xs transition-studio duration-studio ease-studio-out ${
                        on ? "border-lime bg-lime/10 text-lime" : "border-charcoal-600 text-ink-muted hover:text-ink"
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
            <div className="grid grid-cols-1 gap-3">
              <div>
                <p className={labelCls}>Raw footage URL</p>
                <input
                  value={draft.raw_footage_url ?? ""}
                  onChange={(e) => set("raw_footage_url", e.target.value || null)}
                  placeholder="https://drive.google.com/…"
                  className={`mt-1 ${inputCls}`}
                />
              </div>
              <div>
                <p className={labelCls}>Cover image URL</p>
                <input
                  value={draft.cover_image_url ?? ""}
                  onChange={(e) => set("cover_image_url", e.target.value || null)}
                  placeholder="https://…"
                  className={`mt-1 ${inputCls}`}
                />
              </div>
            </div>

            {/* Caption */}
            <div>
              <p className={labelCls}>Caption</p>
              <textarea
                value={draft.caption ?? ""}
                onChange={(e) => set("caption", e.target.value || null)}
                rows={4}
                placeholder="What goes under the post on Instagram…"
                className={`mt-1 resize-none ${inputCls}`}
              />
            </div>

            {/* Hashtags */}
            <div>
              <p className={labelCls}>Hashtags ({draft.hashtags.length})</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-charcoal-600 bg-charcoal-700 p-2">
                {draft.hashtags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-full border border-lime/30 bg-lime/10 px-2 py-0.5 font-mono text-xs text-lime"
                  >
                    {t}
                    <button onClick={() => removeHashtag(t)} className="text-lime/70 hover:text-red-400" aria-label={`Remove ${t}`}>
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

            {/* Manual tags */}
            <div>
              <p className={labelCls}>Tags</p>
              <div className="mt-1.5 flex flex-wrap items-center gap-1.5 rounded-lg border border-charcoal-600 bg-charcoal-700 p-2">
                {draft.tags.map((t) => (
                  <span
                    key={t}
                    className="flex items-center gap-1 rounded-full border border-charcoal-500 bg-charcoal-600/60 px-2 py-0.5 text-xs text-ink-muted"
                  >
                    {t}
                    <button onClick={() => removeTag(t)} className="text-ink-faint hover:text-red-400" aria-label={`Remove ${t}`}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={labelInput}
                  onChange={(e) => setLabelInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === ",") {
                      e.preventDefault();
                      addTag();
                    } else if (e.key === "Backspace" && !labelInput && draft.tags.length > 0) {
                      removeTag(draft.tags[draft.tags.length - 1]);
                    }
                  }}
                  placeholder="tag… (e.g. Used, Priority)"
                  className="min-w-[120px] flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
                />
              </div>
            </div>
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
            <button onClick={onClose} className="press rounded-lg px-3 py-1.5 text-sm text-ink-muted hover:text-ink">
              Cancel
            </button>
            <button onClick={save} disabled={busy === "save"} className="btn-primary press px-4 py-1.5 disabled:opacity-60">
              {busy === "save" ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis, onUseScript }: { analysis: PostVideoAnalysis; onUseScript: (s: string) => void }) {
  const { status } = analysis;
  const row = (label: string, value: string | null | undefined) =>
    value ? (
      <p className="text-xs text-ink-muted">
        <span className="font-semibold text-ink">{label}: </span>
        {value}
      </p>
    ) : null;

  if (status === "PENDING" || status === "PROCESSING") {
    return (
      <div className="rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-3">
        <p className="flex items-center gap-2 text-xs font-semibold text-sky-300">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-sky-400" />
          Watching the reel — extracting frames + transcript…
        </p>
        <p className="mt-1 text-[11px] text-ink-faint">This runs in the background; results appear here automatically.</p>
      </div>
    );
  }
  if (status === "FAILED" || status === "SKIPPED") {
    return (
      <div className="rounded-xl border border-red-400/20 bg-red-400/[0.05] p-3">
        <p className="text-xs font-semibold text-red-400">Couldn&apos;t watch this reel</p>
        {analysis.error && <p className="mt-1 text-[11px] text-ink-muted">{analysis.error}</p>}
      </div>
    );
  }
  // DONE
  return (
    <div className="space-y-2 rounded-xl border border-sky-400/20 bg-sky-400/[0.05] p-3">
      <p className="font-mono text-[10px] uppercase tracking-wider text-sky-300">👁 What the reel does</p>
      {row("Visual hook", analysis.hook_visual)}
      {row("Spoken hook", analysis.hook_spoken)}
      {row("Format", analysis.format)}
      {row("CTA", analysis.cta)}
      {row("Why it works", analysis.why_it_works)}
      {analysis.script && (
        <details className="mt-1 rounded-lg border border-charcoal-700 bg-charcoal-800/60 p-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-ink-muted">Reconstructed reel script</summary>
          <p className="mt-1.5 whitespace-pre-wrap text-xs leading-relaxed text-ink-muted">{analysis.script}</p>
          <button
            onClick={() => onUseScript(analysis.script as string)}
            className="press mt-2 rounded-md border border-charcoal-600 px-2 py-1 text-[11px] text-ink-muted hover:text-lime"
          >
            Copy into teleprompter
          </button>
        </details>
      )}
      {analysis.transcript && (
        <details className="rounded-lg border border-charcoal-700 bg-charcoal-800/60 p-2">
          <summary className="cursor-pointer text-[11px] font-semibold text-ink-muted">Transcript</summary>
          <p className="mt-1.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-ink-faint">{analysis.transcript}</p>
        </details>
      )}
    </div>
  );
}
