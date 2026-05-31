"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { ScheduleCalendar } from "@/components/ScheduleCalendar";
import {
  ApiError,
  apiFetch,
  cancelScheduledPost,
  createCampaign,
  getInsightsSummary,
  getSchedule,
  retryScheduledPost,
  uploadMedia,
  type InsightsSummary,
  type MediaAsset,
  type ScheduleListItem,
  type ScheduledPostRowIn,
  type ScheduledPostStatus,
} from "@/lib/api";

interface ConnAccount {
  id: string;
  username: string;
  status: string;
  followers_count: number | null;
  capacity: { remaining: number | null; total: number | null; used: number | null } | null;
}

interface RowDraft {
  ig_account_id: string;
  caption: string;
  hashtags: string[];
  scheduled_at: string; // datetime-local string
}

const STATUS_STYLE: Record<ScheduledPostStatus, string> = {
  SCHEDULED: "bg-sky-400/10 text-sky-300 border-sky-400/40",
  PROCESSING: "bg-amber-400/10 text-amber-300 border-amber-400/40",
  PUBLISHED: "bg-lime/10 text-lime border-lime/40",
  FAILED: "bg-red-400/10 text-red-400 border-red-400/40",
  CANCELED: "bg-charcoal-600 text-ink-faint border-charcoal-600",
};

// Convert a Date -> "YYYY-MM-DDTHH:MM" for <input type="datetime-local">
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function extractHashtags(text: string): string[] {
  return Array.from(new Set((text.match(/#\w+/g) ?? []).map((t) => t.toLowerCase())));
}

export default function SchedulerPage() {
  const [tab, setTab] = useState<"compose" | "queue" | "calendar">("compose");
  const [accounts, setAccounts] = useState<ConnAccount[]>([]);
  const [schedule, setSchedule] = useState<ScheduleListItem[]>([]);
  const [insights, setInsights] = useState<InsightsSummary | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState(false);

  // Compose state
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [localSpecs, setLocalSpecs] = useState<{ ok: boolean; reason?: string; duration?: number; width?: number; height?: number } | null>(null);
  const [media, setMedia] = useState<MediaAsset | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, RowDraft>>({});
  const [scheduling, setScheduling] = useState(false);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  const [scheduleOk, setScheduleOk] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // --- data loaders ---------------------------------------------------------
  const loadAccounts = useCallback(async () => {
    try {
      const list = await apiFetch<ConnAccount[]>("/api/connections");
      setAccounts(list);
    } catch (err) {
      // editors can't list connections; that's OK — they won't see selectable accounts.
      if (!(err instanceof ApiError && err.status === 403)) throw err;
    }
  }, []);

  const loadSchedule = useCallback(async () => {
    setLoadingSchedule(true);
    try {
      setSchedule(await getSchedule());
    } finally {
      setLoadingSchedule(false);
    }
  }, []);

  useEffect(() => {
    void loadAccounts();
    void loadSchedule();
    // Insights are best-effort: the calendar still works without them, just without
    // the reach/engagement overlay on posted entries.
    getInsightsSummary()
      .then(setInsights)
      .catch(() => setInsights(null));
  }, [loadAccounts, loadSchedule]);

  // --- file handling --------------------------------------------------------
  function handleFile(f: File | null) {
    setMedia(null);
    setUploadError(null);
    setLocalSpecs(null);
    setFile(f);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    if (!f) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(f);
    setPreviewUrl(url);
    // Probe duration/dimensions via the browser before sending to backend.
    const v = document.createElement("video");
    v.preload = "metadata";
    v.src = url;
    v.onloadedmetadata = () => {
      const duration = v.duration;
      const width = v.videoWidth;
      const height = v.videoHeight;
      const aspect = width && height ? width / height : 0;
      const aspectOk = Math.abs(aspect - 9 / 16) < 0.05;
      const durOk = duration >= 5 && duration <= 90;
      if (!durOk) setLocalSpecs({ ok: false, reason: `Duration ${duration.toFixed(1)}s — must be 5–90s`, duration, width, height });
      else if (!aspectOk) setLocalSpecs({ ok: false, reason: `Aspect ${width}×${height} — must be 9:16 vertical`, duration, width, height });
      else setLocalSpecs({ ok: true, duration, width, height });
    };
  }

  async function startUpload() {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    try {
      const asset = await uploadMedia(file);
      setMedia(asset);
    } catch (err) {
      setUploadError(err instanceof ApiError ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }

  // --- account/row management ----------------------------------------------
  function toggleAccount(id: string) {
    if (selected.includes(id)) {
      setSelected(selected.filter((x) => x !== id));
      const { [id]: _, ...rest } = rows;
      setRows(rest);
    } else {
      setSelected([...selected, id]);
      // Default scheduled_at: now + 1h, staggered 30min per index
      const start = new Date(Date.now() + 60 * 60 * 1000 + selected.length * 30 * 60 * 1000);
      setRows({
        ...rows,
        [id]: { ig_account_id: id, caption: "", hashtags: [], scheduled_at: toLocalInput(start) },
      });
    }
  }

  function updateRow(id: string, patch: Partial<RowDraft>) {
    setRows({ ...rows, [id]: { ...rows[id], ...patch } });
  }

  function autoStagger() {
    const base = new Date(Date.now() + 60 * 60 * 1000); // start: now + 1h
    const next: Record<string, RowDraft> = {};
    selected.forEach((id, i) => {
      const t = new Date(base.getTime() + i * 30 * 60 * 1000);
      next[id] = { ...(rows[id] ?? { ig_account_id: id, caption: "", hashtags: [] }), scheduled_at: toLocalInput(t) };
    });
    setRows(next);
  }

  // --- schedule submit ------------------------------------------------------
  async function submitSchedule() {
    if (!media || selected.length === 0) return;
    setScheduling(true);
    setScheduleError(null);
    setScheduleOk(null);
    try {
      const posts: ScheduledPostRowIn[] = selected.map((id) => {
        const r = rows[id];
        return {
          ig_account_id: id,
          caption: r.caption.trim(),
          hashtags: r.hashtags.length ? r.hashtags : extractHashtags(r.caption),
          // datetime-local has no timezone; treat as the user's local timezone.
          scheduled_at: new Date(r.scheduled_at).toISOString(),
        };
      });
      if (posts.some((p) => !p.caption)) {
        throw new Error("Every selected account needs a caption.");
      }
      await createCampaign(media.id, posts, file?.name);
      setScheduleOk(`Scheduled ${posts.length} post${posts.length === 1 ? "" : "s"}`);
      // Reset compose state and switch to queue
      setSelected([]);
      setRows({});
      setMedia(null);
      setFile(null);
      setLocalSpecs(null);
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      setPreviewUrl(null);
      if (fileRef.current) fileRef.current.value = "";
      await loadSchedule();
      setTab("queue");
    } catch (err) {
      setScheduleError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Failed to schedule");
    } finally {
      setScheduling(false);
    }
  }

  // --- queue actions --------------------------------------------------------
  async function onCancel(id: string) {
    if (!confirm("Cancel this scheduled post?")) return;
    await cancelScheduledPost(id);
    await loadSchedule();
  }
  async function onRetry(id: string) {
    await retryScheduledPost(id);
    await loadSchedule();
  }

  const composeReady = !!media && selected.length > 0;

  const grouped = useMemo(() => {
    const upcoming: ScheduleListItem[] = [];
    const live: ScheduleListItem[] = [];
    const issues: ScheduleListItem[] = [];
    schedule.forEach((p) => {
      if (p.status === "PUBLISHED") live.push(p);
      else if (p.status === "FAILED" || p.status === "CANCELED") issues.push(p);
      else upcoming.push(p);
    });
    return { upcoming, live, issues };
  }, [schedule]);

  // --- render ---------------------------------------------------------------
  return (
    <div>
      <PageHeader
        title="Post & Schedule"
        subtitle="Upload one master reel, schedule it across your accounts, publish via the official Graph API."
      />

      <div className="mb-6 flex gap-1 rounded-full border border-charcoal-600 bg-charcoal-700/40 p-0.5 w-fit">
        {(["compose", "queue", "calendar"] as const).map((t) => (
          <button
            key={t}
            onClick={() => {
              setTab(t);
              if (t === "queue" || t === "calendar") void loadSchedule();
            }}
            className={`press rounded-full px-4 py-1.5 text-sm transition-studio duration-studio ease-studio-out ${
              tab === t ? "bg-lime text-charcoal font-semibold" : "text-ink-muted hover:text-ink"
            }`}
          >
            {t === "compose"
              ? "Compose"
              : t === "queue"
                ? `Queue (${schedule.length})`
                : "Calendar"}
          </button>
        ))}
      </div>

      {tab === "compose" && (
        <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
          {/* Upload + preview */}
          <div className="space-y-4">
            <div
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                handleFile(e.dataTransfer.files?.[0] ?? null);
              }}
              className="press cursor-pointer rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 p-6 text-center hover:border-lime/50"
            >
              <input
                ref={fileRef}
                type="file"
                accept="video/mp4,video/quicktime,video/*"
                className="hidden"
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
              />
              {!previewUrl ? (
                <>
                  <p className="font-mono text-xs uppercase tracking-wider text-lime">Master reel</p>
                  <p className="mt-2 text-sm text-ink-muted">Drop a video, or click to pick</p>
                  <p className="mt-1 font-mono text-[10px] text-ink-faint">
                    9:16 · 5–90s · MP4 or MOV
                  </p>
                </>
              ) : (
                <video src={previewUrl} className="mx-auto max-h-72 rounded-lg" controls muted />
              )}
            </div>

            {localSpecs && (
              <div
                className={`animate-reveal rounded-lg border px-3 py-2 text-xs ${
                  localSpecs.ok
                    ? "border-lime/40 bg-lime/10 text-lime"
                    : "border-red-400/40 bg-red-400/10 text-red-400"
                }`}
              >
                {localSpecs.ok
                  ? `Valid reel · ${localSpecs.duration?.toFixed(1)}s · ${localSpecs.width}×${localSpecs.height}`
                  : localSpecs.reason}
              </div>
            )}

            {file && localSpecs?.ok && !media && (
              <button
                onClick={startUpload}
                disabled={uploading}
                className="press w-full rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-charcoal disabled:opacity-60"
              >
                {uploading ? "Uploading to Cloudinary…" : "Upload to Cloudinary"}
              </button>
            )}
            {uploadError && (
              <p className="font-mono text-xs text-red-400">{uploadError}</p>
            )}
            {media && (
              <div className="rounded-lg border border-lime/30 bg-lime/[0.04] p-3 font-mono text-xs text-lime">
                ✓ Uploaded · {media.duration_s?.toFixed(1)}s · {media.format?.toUpperCase()} · {media.size_bytes ? (media.size_bytes / 1024 / 1024).toFixed(1) : "?"} MB
              </div>
            )}
          </div>

          {/* Accounts + matrix */}
          <div className="space-y-4">
            <div>
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  Target accounts ({selected.length})
                </p>
                {selected.length > 1 && (
                  <button
                    onClick={autoStagger}
                    className="press font-mono text-[10px] uppercase tracking-wider text-lime hover:underline"
                  >
                    Auto-stagger (+30 min)
                  </button>
                )}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {accounts.length === 0 && (
                  <p className="text-sm text-ink-faint">No connected accounts yet. Connect one first.</p>
                )}
                {accounts.map((a) => {
                  const on = selected.includes(a.id);
                  const cap = a.capacity;
                  return (
                    <button
                      key={a.id}
                      onClick={() => toggleAccount(a.id)}
                      className={`press rounded-full border px-3 py-1.5 text-xs ${
                        on
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-charcoal-600 text-ink-muted hover:text-ink"
                      }`}
                      title={cap?.remaining != null ? `${cap.remaining}/${cap.total} 24h capacity left` : ""}
                    >
                      @{a.username}
                      {cap?.remaining != null && (
                        <span className="ml-1.5 font-mono text-[10px] opacity-70">
                          {cap.remaining}/{cap.total}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {selected.length > 0 && (
              <div className="space-y-3">
                {selected.map((id) => {
                  const a = accounts.find((x) => x.id === id);
                  const r = rows[id];
                  if (!a || !r) return null;
                  return (
                    <div
                      key={id}
                      className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-4"
                    >
                      <div className="flex items-center justify-between">
                        <p className="text-sm text-ink">@{a.username}</p>
                        <input
                          type="datetime-local"
                          value={r.scheduled_at}
                          onChange={(e) => updateRow(id, { scheduled_at: e.target.value })}
                          className="rounded-md border border-charcoal-600 bg-charcoal-700 px-2 py-1 font-mono text-xs text-ink outline-none focus:border-lime"
                        />
                      </div>
                      <textarea
                        value={r.caption}
                        onChange={(e) =>
                          updateRow(id, {
                            caption: e.target.value,
                            hashtags: extractHashtags(e.target.value),
                          })
                        }
                        rows={4}
                        placeholder="Write a caption tailored to this account…"
                        className="mt-2 w-full resize-none rounded-lg border border-charcoal-600 bg-charcoal-700 px-3 py-2 text-sm text-ink outline-none focus:border-lime placeholder:text-ink-faint"
                      />
                      <div className="mt-1 flex justify-between font-mono text-[10px] text-ink-faint">
                        <span>{r.caption.length}/2200 chars</span>
                        <span>{extractHashtags(r.caption).length} hashtags detected</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {scheduleError && (
              <p className="font-mono text-xs text-red-400">{scheduleError}</p>
            )}
            {scheduleOk && (
              <p className="font-mono text-xs text-lime">{scheduleOk}</p>
            )}

            <div className="flex items-center justify-end gap-3">
              <p className="font-mono text-[10px] text-ink-faint">
                {!media && "Upload a video to enable scheduling"}
                {media && selected.length === 0 && "Pick at least one account"}
              </p>
              <button
                onClick={submitSchedule}
                disabled={!composeReady || scheduling}
                className="press rounded-lg bg-lime px-5 py-2 text-sm font-semibold text-charcoal disabled:opacity-50"
              >
                {scheduling ? "Scheduling…" : `Schedule ${selected.length || ""}`.trim()}
              </button>
            </div>
          </div>
        </div>
      )}

      {tab === "calendar" && (
        <ScheduleCalendar schedule={schedule} insights={insights} />
      )}

      {tab === "queue" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {loadingSchedule ? "Refreshing…" : `${schedule.length} total`}
            </p>
            <button
              onClick={() => void loadSchedule()}
              className="press rounded-full border border-charcoal-600 px-3 py-1 text-xs text-ink-muted hover:text-ink"
            >
              Refresh
            </button>
          </div>

          {schedule.length === 0 && !loadingSchedule && (
            <div className="rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-12 text-center text-sm text-ink-muted">
              Nothing scheduled yet. Switch to Compose to plan your first post.
            </div>
          )}

          {(["upcoming", "live", "issues"] as const).map((key) => {
            const items = grouped[key];
            if (items.length === 0) return null;
            return (
              <section key={key}>
                <h3 className="mb-3 text-sm uppercase tracking-wider text-ink-faint">
                  {key === "upcoming" ? "Upcoming" : key === "live" ? "Published" : "Failed / Canceled"}
                  <span className="ml-2 font-mono text-[10px] text-ink-faint">{items.length}</span>
                </h3>
                <div className="space-y-2">
                  {items.map((p) => (
                    <div
                      key={p.id}
                      className="animate-reveal flex gap-4 rounded-xl border border-charcoal-700 bg-charcoal-800 p-4"
                    >
                      <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded-md bg-charcoal-600">
                        {p.thumbnail_url && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <video
                            src={p.thumbnail_url}
                            className="h-full w-full object-cover"
                            muted
                          />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-3">
                          <p className="truncate text-sm text-ink">
                            @{p.ig_username}
                            <span className="ml-2 font-mono text-xs text-ink-faint">
                              {new Date(p.scheduled_at).toLocaleString()}
                            </span>
                          </p>
                          <span
                            className={`whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[p.status]}`}
                          >
                            {p.status.toLowerCase()}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{p.caption}</p>
                        {p.error && (
                          <p className="mt-1 font-mono text-[10px] text-red-400">{p.error}</p>
                        )}
                        <div className="mt-2 flex items-center gap-2">
                          {p.permalink && (
                            <a
                              href={p.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="press rounded-md border border-charcoal-600 px-2 py-1 font-mono text-[10px] text-lime hover:bg-lime/5"
                            >
                              View on Instagram ↗
                            </a>
                          )}
                          {(p.status === "SCHEDULED" || p.status === "PROCESSING") && (
                            <button
                              onClick={() => onCancel(p.id)}
                              className="press rounded-md border border-red-400/30 px-2 py-1 font-mono text-[10px] text-red-400 hover:bg-red-400/10"
                            >
                              Cancel
                            </button>
                          )}
                          {(p.status === "FAILED" || p.status === "CANCELED") && (
                            <button
                              onClick={() => onRetry(p.id)}
                              className="press rounded-md border border-lime/30 px-2 py-1 font-mono text-[10px] text-lime hover:bg-lime/10"
                            >
                              Retry
                            </button>
                          )}
                          {p.attempts > 0 && (
                            <span className="font-mono text-[10px] text-ink-faint">
                              {p.attempts} attempt{p.attempts === 1 ? "" : "s"}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
