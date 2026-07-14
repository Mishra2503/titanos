"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  approveScript,
  deleteScript,
  getScript,
  listScripts,
  regenerateScript,
  rewriteScript,
  updateScript,
  type Script,
} from "@/lib/api";
import { ArrowsClockwise, Check, PencilSimple, Sparkle, Trash } from "@phosphor-icons/react";

type Banner = { kind: "ok" | "err"; msg: string } | null;

const inputCls =
  "w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50";

export default function Page() {
  return (
    <Suspense fallback={<div className="font-mono text-sm text-ink-faint">Loading…</div>}>
      <ScriptwriterInner />
    </Suspense>
  );
}

function ScriptwriterInner() {
  const search = useSearchParams();
  const deepLinkId = search.get("script");

  const [list, setList] = useState<Script[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [script, setScript] = useState<Script | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await listScripts());
    } catch (e) {
      setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : "Failed to load scripts" });
    }
  }, []);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    setScript(null);
    try {
      setScript(await getScript(id));
    } catch (e) {
      setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : "Failed to load script" });
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Open the script passed from the "Generate script" handoff.
  useEffect(() => {
    if (deepLinkId) void select(deepLinkId);
  }, [deepLinkId, select]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  const onSaved = useCallback((s: Script) => {
    setScript(s);
    setList((cur) => (cur ? cur.map((x) => (x.id === s.id ? s : x)) : cur));
  }, []);

  async function removeScript(id: string) {
    if (!confirm("Delete this script?")) return;
    try {
      await deleteScript(id);
      if (selectedId === id) { setSelectedId(null); setScript(null); }
      await loadList();
      setBanner({ kind: "ok", msg: "Script deleted" });
    } catch (e) {
      setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : "Delete failed" });
    }
  }

  return (
    <div>
      <PageHeader
        title="Scriptwriter"
        subtitle="Turn competitor reels into shoot-ready scripts. Edit, rewrite or regenerate, then approve to the Content Board."
      />

      {banner && (
        <div
          className={`mb-5 animate-reveal rounded-lg border px-4 py-2.5 text-sm ${
            banner.kind === "ok" ? "border-lime/40 bg-lime/10 text-lime" : "border-red-400/40 bg-red-400/10 text-red-400"
          }`}
        >
          {banner.msg}
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* Draft list */}
        <div className="lg:col-span-4">
          {list && list.length === 0 ? (
            <div className="rounded-xl border-2 border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-14 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lime/10 text-lime">
                <Sparkle size={22} weight="fill" />
              </div>
              <p className="mt-3 text-sm text-ink">No scripts yet</p>
              <p className="mt-1 text-xs text-ink-muted">
                Open Competitors, analyze a reel, and hit “Generate script” to start one here.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {list?.map((s) => (
                <button
                  key={s.id}
                  onClick={() => select(s.id)}
                  className={`press lift block w-full rounded-xl border p-4 text-left transition-studio ${
                    selectedId === s.id ? "border-lime/50 bg-charcoal-700" : "border-charcoal-700 bg-charcoal-800 hover:border-charcoal-600"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="line-clamp-2 text-sm font-semibold text-ink">{s.title}</p>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
                        s.status === "APPROVED" ? "border-lime/40 bg-lime/10 text-lime" : "border-charcoal-600 text-ink-muted"
                      }`}
                    >
                      {s.status === "APPROVED" ? "Approved" : "Draft"}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-ink-muted">
                    {s.competitor_username ? `from @${s.competitor_username}` : "custom"} · {s.updated_at.slice(0, 10)}
                  </p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Editor */}
        <div className="lg:col-span-8">
          {!selectedId ? (
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-charcoal-700 bg-charcoal-800 text-center">
              <p className="text-sm text-ink-muted">Select a script to edit it</p>
            </div>
          ) : !script ? (
            <p className="font-mono text-sm text-ink-faint">Loading…</p>
          ) : (
            <ScriptEditor
              key={script.id}
              script={script}
              busy={busy}
              setBusy={setBusy}
              onSaved={onSaved}
              onDelete={() => removeScript(script.id)}
              setBanner={setBanner}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ScriptEditor({
  script,
  busy,
  setBusy,
  onSaved,
  onDelete,
  setBanner,
}: {
  script: Script;
  busy: string | null;
  setBusy: (v: string | null) => void;
  onSaved: (s: Script) => void;
  onDelete: () => void;
  setBanner: (b: Banner) => void;
}) {
  const [title, setTitle] = useState(script.title);
  const [hook, setHook] = useState(script.hook ?? "");
  const [body, setBody] = useState(script.body);
  const [caption, setCaption] = useState(script.caption ?? "");
  const [hashtags, setHashtags] = useState((script.hashtags ?? []).join(" "));
  const [instruction, setInstruction] = useState("");

  const research = script.research;
  const approved = script.status === "APPROVED";
  const dirty = useMemo(
    () =>
      title !== script.title ||
      hook !== (script.hook ?? "") ||
      body !== script.body ||
      caption !== (script.caption ?? "") ||
      hashtags !== (script.hashtags ?? []).join(" "),
    [title, hook, body, caption, hashtags, script],
  );

  const err = (e: unknown, fb: string) => setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : fb });
  const patchBody = () => ({
    title,
    hook: hook || null,
    body,
    caption: caption || null,
    hashtags: hashtags.split(/\s+/).map((h) => h.trim()).filter(Boolean).map((h) => (h.startsWith("#") ? h : `#${h}`)),
  });

  async function save() {
    setBusy("save");
    try {
      onSaved(await updateScript(script.id, patchBody()));
      setBanner({ kind: "ok", msg: "Saved" });
    } catch (e) {
      err(e, "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function doRewrite() {
    setBusy("rewrite");
    try {
      const s = await rewriteScript(script.id, instruction);
      setBody(s.body);
      onSaved(s);
      setInstruction("");
      setBanner({ kind: "ok", msg: "Rewritten" });
    } catch (e) {
      err(e, "Rewrite failed");
    } finally {
      setBusy(null);
    }
  }

  async function doRegenerate() {
    if (!confirm("Regenerate a fresh script? This replaces the current draft text.")) return;
    setBusy("regen");
    try {
      const s = await regenerateScript(script.id);
      setTitle(s.title); setHook(s.hook ?? ""); setBody(s.body); setCaption(s.caption ?? "");
      setHashtags((s.hashtags ?? []).join(" "));
      onSaved(s);
      setBanner({ kind: "ok", msg: "Regenerated with a fresh angle" });
    } catch (e) {
      err(e, "Regenerate failed");
    } finally {
      setBusy(null);
    }
  }

  async function doApprove() {
    setBusy("approve");
    try {
      if (dirty) onSaved(await updateScript(script.id, patchBody())); // persist edits first
      const res = await approveScript(script.id);
      onSaved(res.script);
      setBanner({ kind: "ok", msg: "Approved → added to Content Board “Ideas”. Open the Content Board to shoot it." });
    } catch (e) {
      err(e, "Approve failed");
    } finally {
      setBusy(null);
    }
  }

  const anyBusy = busy != null;

  return (
    <div className="animate-reveal space-y-4 rounded-xl border border-charcoal-700 bg-charcoal-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="w-full rounded-lg border border-transparent bg-transparent px-1 text-lg font-semibold text-ink outline-none hover:border-charcoal-600 focus:border-lime/50"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button onClick={save} disabled={anyBusy || !dirty} className="press rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50">
            {busy === "save" ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
          <button onClick={doApprove} disabled={anyBusy} className="btn-primary press px-3 py-1.5 text-xs disabled:opacity-50">
            <Check size={14} weight="bold" /> {busy === "approve" ? "Approving…" : approved ? "Re-approve" : "Approve → Board"}
          </button>
          <button onClick={onDelete} disabled={anyBusy} className="press rounded-lg border border-red-400/30 p-1.5 text-red-400 hover:bg-red-400/10 disabled:opacity-50" title="Delete">
            <Trash size={15} />
          </button>
        </div>
      </div>

      <p className="text-xs text-ink-muted">
        {script.competitor_username ? `Inspired by @${script.competitor_username}` : "Custom script"}
        {approved ? " · already on the Content Board" : ""}
      </p>

      {/* Research / strategy */}
      {research && (research.angle || research.trend_note || research.similar_creators.length > 0 || research.hook_options.length > 0) && (
        <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-lime">Strategy &amp; research</p>
          {research.estimate && (
            <p className="mt-1 text-[11px] text-ink-faint">Trend read is an AI estimate (live web research is off) — not measured data.</p>
          )}
          {research.angle && <p className="mt-2 text-sm text-ink-muted"><span className="font-semibold text-ink">Angle: </span>{research.angle}</p>}
          {research.trend_note && <p className="mt-1 text-sm text-ink-muted"><span className="font-semibold text-ink">Trend: </span>{research.trend_note}</p>}
          {research.similar_creators.length > 0 && (
            <p className="mt-1 text-xs text-ink-muted"><span className="font-semibold text-ink">Similar creators: </span>{research.similar_creators.join(", ")}</p>
          )}
          {research.hook_options.length > 0 && (
            <div className="mt-2">
              <p className="text-[11px] uppercase tracking-wider text-ink-faint">Hook options (click to use)</p>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {research.hook_options.map((h, i) => (
                  <button key={i} onClick={() => setHook(h)} className="press rounded-md bg-charcoal-700 px-2 py-1 text-xs text-ink-muted hover:text-lime">
                    {h}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Hook */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Hook</label>
        <input value={hook} onChange={(e) => setHook(e.target.value)} placeholder="The opening line" className={`${inputCls} mt-1`} />
      </div>

      {/* Script body */}
      <div>
        <label className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Script</label>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={16}
          className={`${inputCls} mt-1 font-mono leading-relaxed`}
        />
      </div>

      {/* AI edit controls */}
      <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-lime">
          <PencilSimple size={14} /> AI edit
        </p>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <input
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="How to rewrite it — e.g. punchier hook, add a stat, shorten to 30s…"
            className={inputCls}
          />
          <div className="flex shrink-0 gap-2">
            <button onClick={doRewrite} disabled={anyBusy} className="press rounded-lg border border-charcoal-600 px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50">
              {busy === "rewrite" ? "Rewriting…" : "Rewrite"}
            </button>
            <button onClick={doRegenerate} disabled={anyBusy} className="press flex items-center gap-1.5 rounded-lg border border-charcoal-600 px-3 py-2 text-xs font-semibold text-ink-muted hover:text-ink disabled:opacity-50">
              <ArrowsClockwise size={14} /> {busy === "regen" ? "Regenerating…" : "Regenerate"}
            </button>
          </div>
        </div>
      </div>

      {/* Caption + hashtags */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Caption</label>
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} className={`${inputCls} mt-1`} />
        </div>
        <div>
          <label className="text-xs font-semibold uppercase tracking-wider text-ink-faint">Hashtags</label>
          <textarea value={hashtags} onChange={(e) => setHashtags(e.target.value)} rows={3} placeholder="#ai #tech" className={`${inputCls} mt-1`} />
        </div>
      </div>
    </div>
  );
}
