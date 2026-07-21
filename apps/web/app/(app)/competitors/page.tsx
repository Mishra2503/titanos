"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  addCompetitorPost,
  addSnapshot,
  analyzeReelIdea,
  createCompetitor,
  generateScriptFromReel,
  getWindowInsights,
  scriptFromWindowTrend,
  deleteCompetitor,
  deleteCompetitorPost,
  deleteSnapshot,
  generateCompetitorReport,
  generateOverviewReport,
  getCompetitor,
  listCompetitors,
  syncCompetitor,
  tagCompetitorPost,
  updateCompetitor,
  type CompetitorDetail,
  type CompetitorListItem,
  type CompetitorPost,
  type CompetitorReport,
  type ContentAnalysis,
  type PostInput,
  type SnapshotInput,
  type WindowInsights,
} from "@/lib/api";
import { TrendChart } from "@/components/Charts";
import {
  Binoculars,
  ChatCircle,
  Eye,
  Heart,
  Lightning,
  Play,
  Sparkle,
  TrendUp,
} from "@phosphor-icons/react";

type Banner = { kind: "ok" | "err"; msg: string } | null;

const inputCls =
  "w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

// Reel date + time, e.g. "Jul 15, 2:30 PM". Falls back to the date-only string.
const fmtDateTime = (p: CompetitorPost): string => {
  const iso = p.posted_at ?? (p.posted_on ? `${p.posted_on}T00:00:00Z` : null);
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return p.posted_on ?? "";
  const date = d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return p.posted_at ? `${date}, ${d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}` : date;
};
// Full day header, e.g. "Monday, July 15".
const fmtDayHeader = (iso: string): string => {
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00` : iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
};
// Group posts (already newest-first) by day key, preserving descending order.
function groupByDay(posts: CompetitorPost[]): [string, CompetitorPost[]][] {
  const groups = new Map<string, CompetitorPost[]>();
  for (const p of posts) {
    const key = p.posted_at ? p.posted_at.slice(0, 10) : (p.posted_on ?? "undated");
    (groups.get(key) ?? groups.set(key, []).get(key)!).push(p);
  }
  return [...groups.entries()];
}
const RANGE_OPTIONS: [number, string][] = [
  [7, "Last 7 days"], [28, "Last 28 days"], [30, "Last 30 days"],
  [60, "Last 60 days"], [90, "Last 90 days"], [0, "All time"],
];

// Compact number for tight card chips: 203680 → "203.7K", 1_600_000 → "1.6M".
const compact = (n: number | null | undefined) => {
  if (n == null) return "—";
  if (n < 1000) return String(n);
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)}K`;
  return `${(n / 1_000_000).toFixed(1)}M`;
};

// Per-reel engagement rate from public numbers we actually have.
const reelEngRate = (p: CompetitorPost): number | null =>
  p.views && p.views > 0
    ? Math.round((((p.likes ?? 0) + (p.comments ?? 0)) / p.views) * 1000) / 10
    : null;

const byScore = (items: CompetitorPost[]) =>
  [...items].sort((x, y) => {
    const sx = (x.views ?? 0) > 0 ? x.views! : x.engagement ?? 0;
    const sy = (y.views ?? 0) > 0 ? y.views! : y.engagement ?? 0;
    return sy - sx;
  });

// The AI-watch intelligence panel: watch progress, format mix, outliers, and a
// hook bank — all built from reels the server actually downloaded and watched.
function AiVideoAnalysis({ detail }: { detail: CompetitorDetail }) {
  const reels = detail.posts.filter((p) => (p.post_type ?? "").toUpperCase() === "REEL" || p.video_analysis != null);
  const watched = detail.posts.filter((p) => p.video_analysis?.status === "DONE");
  const pending = detail.posts.filter((p) => p.video_analysis?.status === "PENDING" || p.video_analysis?.status === "PROCESSING").length;
  const failed = detail.posts.filter((p) => p.video_analysis?.status === "FAILED").length;
  if (watched.length === 0 && pending === 0) return null;

  // Format mix from watched reels
  const fmtCounts = new Map<string, number>();
  for (const p of watched) {
    const f = p.video_analysis?.format?.trim();
    if (f) fmtCounts.set(f, (fmtCounts.get(f) ?? 0) + 1);
  }
  const formats = [...fmtCounts.entries()].sort((a, b) => b[1] - a[1]);
  const fmtTotal = formats.reduce((s, [, n]) => s + n, 0);

  // Hook bank — real hooks from watched reels
  const hooks = Array.from(
    new Set(
      watched
        .map((p) => p.video_analysis?.hook_spoken?.trim() || p.video_analysis?.hook_visual?.trim())
        .filter((h): h is string => !!h && h.toLowerCase() !== "none (music only)"),
    ),
  ).slice(0, 10);

  const outliers = detail.analytics.outliers ?? [];
  const metric = detail.analytics.outlier_metric ?? "views";

  return (
    <div className="space-y-4 rounded-lg border border-lime/20 bg-lime/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase tracking-wider text-lime">AI video analysis — watched the reels</p>
        <p className="font-mono text-[10px] text-ink-faint">
          {watched.length} watched{pending > 0 ? ` · ${pending} in queue` : ""}{failed > 0 ? ` · ${failed} failed` : ""}
          {reels.length > 0 ? ` of ${reels.length} reels` : ""}
        </p>
      </div>

      {pending > 0 && (
        <p className="font-mono text-[10px] text-sky-400">Watching {pending} more reel{pending === 1 ? "" : "s"}… results appear here automatically.</p>
      )}

      {formats.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">Format mix (watched reels)</p>
          <div className="flex h-3 overflow-hidden rounded-full bg-charcoal-700">
            {formats.map(([f, n], i) => (
              <div key={f} title={`${f}: ${n}`} className={["bg-lime", "bg-lime-dim", "bg-sky-400", "bg-ink-faint", "bg-charcoal-600"][i % 5]} style={{ width: `${(n / fmtTotal) * 100}%` }} />
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-ink-muted">
            {formats.map(([f, n]) => (
              <span key={f}>{f} <span className="text-ink-faint">×{n}</span></span>
            ))}
          </div>
        </div>
      )}

      {outliers.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">
            Outliers — beat their median {metric} by 2x+
          </p>
          <div className="space-y-1.5">
            {outliers.map((p) => (
              <div key={p.id} className="rounded-md bg-charcoal/60 px-2 py-1.5">
                <div className="flex items-center justify-between gap-2 font-mono text-[10px]">
                  <span className="font-bold text-lime">{p.outlier_multiple}× median</span>
                  <span className="text-ink-faint">
                    {p.views != null && metric === "views" ? `${fmt(p.views)} views` : `${fmt(p.engagement)} eng.`}
                    {p.permalink && (
                      <> · <a href={p.permalink} target="_blank" rel="noreferrer" className="hover:text-lime">open ↗</a></>
                    )}
                  </span>
                </div>
                {p.video_analysis?.status === "DONE" && (p.video_analysis.hook_spoken || p.video_analysis.hook_visual) && (
                  <p className="mt-0.5 text-xs text-ink-muted"><span className="text-ink-faint">Hook:</span> {p.video_analysis.hook_spoken || p.video_analysis.hook_visual}</p>
                )}
                {p.video_analysis?.why_it_works && (
                  <p className="mt-0.5 text-xs text-ink-muted"><span className="text-ink-faint">Why:</span> {p.video_analysis.why_it_works}</p>
                )}
                {!p.video_analysis && p.caption && <p className="mt-0.5 line-clamp-1 text-xs text-ink-muted">{p.caption}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {hooks.length > 0 && (
        <div>
          <p className="mb-1.5 font-mono text-[9px] uppercase tracking-wider text-ink-faint">Hook bank (real hooks from watched reels)</p>
          <ul className="space-y-1">
            {hooks.map((h, i) => (
              <li key={i} className="text-xs text-ink-muted">• {h}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function Delta({ value, pct }: { value: number | null; pct: number | null }) {
  if (value == null) return <span className="text-ink-faint">—</span>;
  const up = value >= 0;
  return (
    <span className={up ? "text-lime" : "text-red-400"}>
      {up ? "▲" : "▼"} {Math.abs(value).toLocaleString()}
      {pct != null ? ` (${up ? "+" : ""}${pct}%)` : ""}
    </span>
  );
}

export default function CompetitorsPage() {
  const [list, setList] = useState<CompetitorListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CompetitorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [showAdd, setShowAdd] = useState(false);
  const [viewReport, setViewReport] = useState<CompetitorReport | null>(null);

  const loadList = useCallback(async () => {
    try {
      setList(await listCompetitors());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load competitors");
    }
  }, []);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  useEffect(() => {
    if (!banner) return;
    const t = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(t);
  }, [banner]);

  const select = useCallback(async (id: string) => {
    setSelectedId(id);
    setDetail(null);
    try {
      setDetail(await getCompetitor(id));
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Failed to load" });
    }
  }, []);

  const refreshDetail = useCallback(async () => {
    try {
      if (selectedId) setDetail(await getCompetitor(selectedId));
      await loadList();
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Refresh failed" });
    }
  }, [selectedId, loadList]);

  // While the AI is still watching this competitor's reels, poll so the
  // watched cards, format mix, and outliers stream in without a manual refresh.
  const hasPendingVideos = !!detail?.posts.some(
    (p) => p.video_analysis?.status === "PENDING" || p.video_analysis?.status === "PROCESSING",
  );
  useEffect(() => {
    if (!hasPendingVideos) return;
    const t = setInterval(() => { void refreshDetail(); }, 25_000);
    return () => clearInterval(t);
  }, [hasPendingVideos, refreshDetail]);

  async function genReport(id: string) {
    setBusy("report");
    try {
      const r = await generateCompetitorReport(id);
      setViewReport(r);
      await refreshDetail();
      setBanner({ kind: "ok", msg: "Report generated" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Report failed" });
    } finally {
      setBusy(null);
    }
  }

  async function doSync(id: string) {
    setBusy("sync");
    try {
      const r = await syncCompetitor(id);
      await refreshDetail();
      const bits = [
        `${r.followers_count?.toLocaleString() ?? "?"} followers`,
        `${r.posts_imported} new post${r.posts_imported === 1 ? "" : "s"}`,
        r.views_enriched ? `view counts on ${r.views_enriched} reels` : null,
        r.videos_enqueued ? `${r.videos_enqueued} reel${r.videos_enqueued === 1 ? "" : "s"} queued for AI watching` : null,
      ].filter(Boolean);
      setBanner({ kind: "ok", msg: `Synced @${r.username} — ${bits.join(", ")}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Sync failed" });
    } finally {
      setBusy(null);
    }
  }

  async function genOverview() {
    setBusy("overview");
    try {
      setViewReport(await generateOverviewReport());
      setBanner({ kind: "ok", msg: "Landscape report generated" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Report failed" });
    } finally {
      setBusy(null);
    }
  }

  async function removeCompetitor(id: string, username: string) {
    if (!confirm(`Remove @${username} and all its tracked data?`)) return;
    try {
      await deleteCompetitor(id);
      if (selectedId === id) {
        setSelectedId(null);
        setDetail(null);
      }
      await loadList();
      setBanner({ kind: "ok", msg: `Removed @${username}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Delete failed" });
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Competitors"
          subtitle="Track rivals, watch every reel, and turn what's working for them into your next post."
        />
        <div className="flex gap-2">
          <button
            onClick={genOverview}
            disabled={busy === "overview" || !list || list.length === 0}
            className="press rounded-lg border border-charcoal-600 px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          >
            {busy === "overview" ? "Analyzing…" : "Landscape report"}
          </button>
          <button
            onClick={() => setShowAdd(true)}
            className="btn-primary press"
          >
            Add competitor
          </button>
        </div>
      </div>

      {/* Data provenance */}
      <div className="mb-5 rounded-lg border border-charcoal-700 bg-charcoal-800 px-4 py-2 text-xs text-ink-muted">
        <span className="font-mono uppercase tracking-wider text-lime">Live intelligence</span>
        <span className="ml-2">
          Sync pulls followers, captions, likes, comments and posting times from the official
          Business Discovery API, reel view counts from the scraper, and a transcript + format
          breakdown from watching each reel. Private metrics (shares, saves, reach) aren&apos;t
          exposed for other accounts, so they&apos;re never shown or invented.
        </span>
      </div>

      {banner && (
        <div
          className={`mb-6 animate-reveal rounded-lg border px-4 py-2.5 text-sm ${
            banner.kind === "ok"
              ? "border-lime/40 bg-lime/10 text-lime"
              : "border-red-400/40 bg-red-400/10 text-red-400"
          }`}
        >
          {banner.msg}
        </div>
      )}
      {error && <p className="font-mono text-sm text-red-400">{error}</p>}

      {list && list.length === 0 && (
        <div
          onClick={() => setShowAdd(true)}
          className="cursor-pointer rounded-xl border-2 border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-16 text-center hover:border-charcoal-500"
        >
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-lime/10 text-lime">
            <Binoculars size={26} />
          </div>
          <p className="mt-4 text-sm text-ink">Add your first competitor to start tracking</p>
          <p className="mt-1 font-mono text-xs text-ink-faint">
            Their handle, niche, follower count, top posts and hashtags
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        {/* List / leaderboard */}
        {list && list.length > 0 && (
          <div className="lg:col-span-4">
            <div className="space-y-2">
              {list.map((c) => (
                <button
                  key={c.id}
                  onClick={() => select(c.id)}
                  className={`press lift block w-full rounded-xl border p-4 text-left transition-studio duration-studio ease-studio-out ${
                    selectedId === c.id
                      ? "border-lime/50 bg-charcoal-700"
                      : "border-charcoal-700 bg-charcoal-800 hover:border-charcoal-600"
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-charcoal-600 font-mono text-xs text-lime">
                      {c.username.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">@{c.username}</p>
                      <p className="truncate font-mono text-[10px] text-ink-faint">
                        {c.category || "—"}
                      </p>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between font-mono text-[11px]">
                    <span className="text-ink-muted">{fmt(c.latest_followers)} followers</span>
                    <Delta value={c.follower_delta} pct={c.follower_delta_pct} />
                  </div>
                  <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-ink-faint">
                    <span>
                      {c.avg_engagement_rate != null ? `${c.avg_engagement_rate}% eng` : "no eng data"}
                    </span>
                    <span>
                      {c.post_count} posts · {c.snapshot_count} snaps
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Detail */}
        {selectedId && (
          <div className="lg:col-span-8">
            {!detail ? (
              <p className="font-mono text-sm text-ink-faint">Loading…</p>
            ) : (
              <CompetitorDetailView
                detail={detail}
                busy={busy}
                onSync={() => doSync(detail.id)}
                onGenReport={() => genReport(detail.id)}
                onRemove={() => removeCompetitor(detail.id, detail.username)}
                onChanged={refreshDetail}
                onViewReport={setViewReport}
                setBanner={setBanner}
              />
            )}
          </div>
        )}

        {list && list.length > 0 && !selectedId && (
          <div className="hidden lg:col-span-8 lg:block">
            <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-charcoal-700 bg-charcoal-800 text-center">
              <p className="text-sm text-ink-faint">Select a competitor to see the full breakdown</p>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <AddCompetitorModal
          onClose={() => setShowAdd(false)}
          onCreated={async (id) => {
            setShowAdd(false);
            await loadList();
            await select(id);
            setBanner({ kind: "ok", msg: "Competitor added — pulling live data from Instagram…" });
            // Best-effort auto-sync right after adding, so stats appear without
            // any manual data entry.
            await doSync(id);
          }}
          setBanner={setBanner}
        />
      )}

      {viewReport && (
        <ReportModal report={viewReport} onClose={() => setViewReport(null)} />
      )}
    </div>
  );
}

// ===================================================================

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-charcoal-700 bg-charcoal-800 p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 font-mono text-[10px] text-ink-faint">{sub}</p>}
    </div>
  );
}

function SectionTitle({ children, hint }: { children: React.ReactNode; hint?: string }) {
  return (
    <div className="mb-3 flex items-baseline justify-between">
      <h3 className="text-sm font-semibold text-ink">{children}</h3>
      {hint && <span className="text-[11px] text-ink-faint">{hint}</span>}
    </div>
  );
}

function ReelMetric({
  icon: Icon,
  value,
  label,
  accent,
}: {
  icon: typeof Eye;
  value: string;
  label: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <Icon size={16} weight="fill" className={accent ? "text-lime" : "text-ink-muted"} />
      <span className="text-sm font-semibold text-ink">{value}</span>
      <span className="text-xs text-ink-muted">{label}</span>
    </div>
  );
}

function ReelThumb({ post, rounded }: { post: CompetitorPost; rounded: string }) {
  const [broken, setBroken] = useState(false);
  const va = post.video_analysis;
  const watched = va?.status === "DONE";
  const watching = va?.status === "PENDING" || va?.status === "PROCESSING";
  const outlier = post.is_outlier || (post.outlier_multiple != null && post.outlier_multiple >= 2);
  const onBoard = !!post.board_card_id;
  const scripted = post.scripted && !onBoard;
  const used = post.used;
  return (
    <div className={`relative aspect-[4/5] overflow-hidden bg-charcoal-700 ${rounded}`}>
      {post.thumbnail_url && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={post.thumbnail_url}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-ink-faint">
          <Play size={28} weight="fill" />
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/45 via-transparent to-transparent" />
      {outlier && post.outlier_multiple != null && (
        <span className="absolute left-2 top-2 flex items-center gap-1 rounded-md bg-lime px-1.5 py-0.5 text-[10px] font-bold text-black shadow-pop">
          <Lightning size={11} weight="fill" /> {post.outlier_multiple}× median
        </span>
      )}
      {watched && (
        <span className="absolute right-2 top-2 flex items-center gap-1 rounded-md bg-black/55 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">
          <Sparkle size={11} weight="fill" className="text-lime" /> Watched
        </span>
      )}
      {watching && (
        <span className="absolute right-2 top-2 rounded-md bg-sky-400/80 px-1.5 py-0.5 text-[10px] font-medium text-black backdrop-blur-sm">
          Watching…
        </span>
      )}
      {(onBoard || scripted || used) && (
        <div className="absolute bottom-2 left-2 flex flex-wrap items-center gap-1">
          {onBoard && (
            <span className="rounded-md bg-lime px-1.5 py-0.5 text-[10px] font-bold text-black shadow-pop">On board</span>
          )}
          {scripted && (
            <span className="rounded-md bg-lime/85 px-1.5 py-0.5 text-[10px] font-bold text-black shadow-pop">Scripted</span>
          )}
          {used && (
            <span className="rounded-md bg-black/60 px-1.5 py-0.5 text-[10px] font-medium text-white backdrop-blur-sm">Used</span>
          )}
        </div>
      )}
    </div>
  );
}

function ReelCard({
  post,
  onOpen,
  onAnalyze,
  analyzing,
  onTag,
  tagging,
}: {
  post: CompetitorPost;
  onOpen: (p: CompetitorPost) => void;
  onAnalyze: (p: CompetitorPost) => void;
  analyzing: boolean;
  onTag: (p: CompetitorPost, patch: { used?: boolean }) => void;
  tagging: boolean;
}) {
  const hook = post.video_analysis?.hook_spoken || post.video_analysis?.hook_visual;
  const er = reelEngRate(post);
  const analyzed = !!post.content_analysis;
  return (
    <div
      onClick={() => onOpen(post)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onOpen(post); }}
      className="group flex h-full cursor-pointer flex-col overflow-hidden rounded-xl border border-charcoal-700 bg-charcoal-800 text-left transition-studio duration-studio ease-studio-out hover:border-charcoal-500 hover:shadow-pop"
    >
      <ReelThumb post={post} rounded="" />
      <div className="flex flex-1 flex-col p-3">
        <p className="text-xs text-ink-muted">
          {post.post_type || "REEL"}
          {fmtDateTime(post) ? ` · ${fmtDateTime(post)}` : ""}
        </p>
        <p className="mt-1 line-clamp-2 min-h-[2.75rem] text-sm text-ink">{hook || post.caption || "No caption"}</p>

        {/* Footer pinned to the bottom so every card in a row is the same height. */}
        <div className="mt-auto">
          <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2">
            <ReelMetric icon={Eye} value={compact(post.views)} label="views" accent={post.views != null} />
            <ReelMetric icon={TrendUp} value={er != null ? `${er}%` : "—"} label="eng rate" />
            <ReelMetric icon={Heart} value={compact(post.likes)} label="likes" />
            <ReelMetric icon={ChatCircle} value={compact(post.comments)} label="comments" />
          </div>

          {/* Hashtag row is always rendered (min height reserved) so presence/absence
              never changes card height. */}
          <div className="mt-3 flex min-h-[1.5rem] flex-wrap items-center gap-1">
            {post.hashtags.slice(0, 3).map((h) => (
              <span key={h} className="rounded bg-charcoal-700 px-1.5 py-0.5 text-[11px] text-ink-muted">
                {h}
              </span>
            ))}
            {post.hashtags.length > 3 && (
              <span className="px-1 py-0.5 text-[11px] text-ink-faint">+{post.hashtags.length - 3}</span>
            )}
          </div>

          {(post.tags?.length ?? 0) > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-1">
              {post.tags!.slice(0, 4).map((t) => (
                <span key={t} className="rounded-full border border-charcoal-600 px-1.5 py-0.5 text-[10px] text-ink-muted">
                  {t}
                </span>
              ))}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              onClick={(e) => { e.stopPropagation(); onAnalyze(post); }}
              disabled={analyzing}
              className={`press flex flex-1 items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-semibold transition-studio disabled:opacity-60 ${
                analyzed
                  ? "border-lime/40 bg-lime/10 text-lime hover:bg-lime/15"
                  : "border-charcoal-600 text-ink-muted hover:border-lime/40 hover:text-lime"
              }`}
            >
              <Sparkle size={14} weight="fill" />
              {analyzing ? "Researching…" : analyzed ? "View content idea" : "Analyze"}
            </button>
            <button
              onClick={(e) => { e.stopPropagation(); onTag(post, { used: !post.used }); }}
              disabled={tagging}
              title={post.used ? "Marked used — click to unmark" : "Mark as used so it drops out of Hide-used"}
              className={`press flex items-center justify-center gap-1 rounded-lg border px-2.5 py-2 text-xs font-semibold transition-studio disabled:opacity-60 ${
                post.used
                  ? "border-charcoal-500 bg-charcoal-600/60 text-ink"
                  : "border-charcoal-600 text-ink-faint hover:border-charcoal-500 hover:text-ink-muted"
              }`}
            >
              {post.used ? "Used ✓" : "Mark used"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function InsightRow({ label, value }: { label: string; value: string | null | undefined }) {
  if (!value) return null;
  return (
    <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
      <p className="text-xs uppercase tracking-wider text-lime">{label}</p>
      <p className="mt-1 text-sm text-ink-muted">{value}</p>
    </div>
  );
}

function HotBadge({ score, tag }: { score: number | null; tag: string | null }) {
  const s = score ?? 0;
  const tone =
    s >= 70
      ? "border-red-400/40 bg-red-400/10 text-red-400"
      : s >= 40
        ? "border-amber-300/50 bg-amber-300/10 text-amber-300"
        : "border-charcoal-600 bg-charcoal text-ink-muted";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-bold ${tone}`}>
      {tag || (s >= 70 ? "🔥 Hot" : s >= 40 ? "Rising" : "Steady")}
      {score != null && <span className="opacity-80">· {score}/100</span>}
    </span>
  );
}

function GenerateScriptButton({
  post,
  onGenerateScript,
  scripting,
  variant,
}: {
  post: CompetitorPost;
  onGenerateScript: (p: CompetitorPost) => void;
  scripting: boolean;
  variant: "primary" | "ghost";
}) {
  return (
    <button
      onClick={() => onGenerateScript(post)}
      disabled={scripting}
      className={
        variant === "primary"
          ? "btn-primary press mt-3 w-full disabled:opacity-60"
          : "press mt-2 flex w-full items-center justify-center gap-1.5 rounded-lg border border-charcoal-600 px-3 py-2 text-xs font-semibold text-ink-muted hover:border-lime/40 hover:text-lime disabled:opacity-60"
      }
    >
      {scripting ? "Writing script…" : "✍️ Generate full script"}
    </button>
  );
}

function ContentOpportunity({
  post,
  analyzing,
  onAnalyze,
  error,
  onGenerateScript,
  scripting,
}: {
  post: CompetitorPost;
  analyzing: boolean;
  onAnalyze: (p: CompetitorPost) => void;
  error?: string | null;
  onGenerateScript: (p: CompetitorPost) => void;
  scripting: boolean;
}) {
  const ca = post.content_analysis;

  if (analyzing) {
    return (
      <div className="rounded-xl border border-lime/30 bg-lime/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-lime">
          <Sparkle size={16} weight="fill" className="animate-pulse" /> Researching this reel across the web…
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Dissecting the hook, body and CTA, then checking how hot the topic is right now across social,
          blogs and articles. This can take up to a minute.
        </p>
      </div>
    );
  }

  if (!ca) {
    return (
      <div className="rounded-xl border border-charcoal-600 bg-charcoal p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <Sparkle size={16} weight="fill" className="text-lime" /> Turn this reel into a content idea
        </p>
        <p className="mt-1 text-xs text-ink-muted">
          Deep-research this reel — hook, body and CTA — then find a high-potential idea for you and score how
          hot the topic is.
        </p>
        {error && (
          <p className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
            {error}
          </p>
        )}
        <button
          onClick={() => onAnalyze(post)}
          className="btn-primary press mt-3 w-full"
        >
          {error ? "Try again" : "Analyze this reel"}
        </button>
        <GenerateScriptButton post={post} onGenerateScript={onGenerateScript} scripting={scripting} variant="ghost" />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <InsightRow label="Hook" value={ca.hook} />
      <InsightRow label="Body" value={ca.body} />
      <InsightRow label="CTA" value={ca.cta} />

      {ca.content_ideas.length > 0 && (
        <div className="rounded-xl border border-lime/30 bg-lime/5 p-4">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Sparkle size={16} weight="fill" className="text-lime" /> Content opportunities for you
          </p>
          {ca.estimate && (
            <p className="mt-1 text-[11px] text-ink-faint">
              Trend read is an AI estimate (live web research is off). Scores reflect the model&apos;s judgement, not measured data.
            </p>
          )}
          <div className="mt-3 space-y-3">
            {ca.content_ideas.map((idea, i) => (
              <div key={i} className="rounded-lg border border-charcoal-700 bg-charcoal-800 p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-ink">{idea.idea}</p>
                  <HotBadge score={idea.hot_score} tag={idea.hot_tag} />
                </div>
                {idea.angle && <p className="mt-1 text-sm text-ink-muted">{idea.angle}</p>}
                {idea.trend_summary && (
                  <p className="mt-2 text-xs text-ink-muted">
                    <span className="font-semibold text-ink">Why it's hot: </span>
                    {idea.trend_summary}
                  </p>
                )}
                {(idea.suggested_hook || idea.suggested_format) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs">
                    {idea.suggested_format && (
                      <span className="rounded-md bg-charcoal-700 px-2 py-1 text-ink-muted">
                        Format: {idea.suggested_format}
                      </span>
                    )}
                    {idea.suggested_hook && (
                      <span className="rounded-md bg-charcoal-700 px-2 py-1 text-ink-muted">
                        Hook: {idea.suggested_hook}
                      </span>
                    )}
                  </div>
                )}
                {idea.sources.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {idea.sources.slice(0, 5).map((src, j) => (
                      <a
                        key={j}
                        href={src.url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-lime hover:underline"
                      >
                        {src.title || "source"} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <GenerateScriptButton post={post} onGenerateScript={onGenerateScript} scripting={scripting} variant="primary" />
        </div>
      )}
    </div>
  );
}

// Official Instagram embed — plays the real reel, never expires, free.
function IgEmbed({ post }: { post: CompetitorPost }) {
  const base = post.permalink?.trim();
  const src = base ? `${base.replace(/\/+$/, "")}/embed/` : null;
  if (!src) return <ReelThumb post={post} rounded="rounded-xl" />;
  return (
    <div className="overflow-hidden rounded-xl border border-charcoal-700 bg-charcoal-700" style={{ aspectRatio: "4 / 6" }}>
      <iframe
        src={src}
        className="h-full w-full"
        loading="lazy"
        allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
        allowFullScreen
        title="Instagram reel"
      />
    </div>
  );
}

function ReelModal({
  post,
  onClose,
  onAnalyze,
  analyzing,
  error,
  onGenerateScript,
  scripting,
  onTag,
  tagging,
}: {
  post: CompetitorPost;
  onClose: () => void;
  onAnalyze: (p: CompetitorPost) => void;
  analyzing: boolean;
  error?: string | null;
  onGenerateScript: (p: CompetitorPost) => void;
  scripting: boolean;
  onTag: (p: CompetitorPost, patch: { tags?: string[]; used?: boolean }) => void;
  tagging: boolean;
}) {
  const va = post.video_analysis;
  const watched = va?.status === "DONE";
  const watching = va?.status === "PENDING" || va?.status === "PROCESSING";
  const er = reelEngRate(post);
  const [tagText, setTagText] = useState("");
  const tags = post.tags ?? [];
  const addTag = () => {
    const t = tagText.trim().replace(/[,]+$/, "").trim();
    if (!t || tags.includes(t)) { setTagText(""); return; }
    onTag(post, { tags: [...tags, t].slice(0, 20) });
    setTagText("");
  };
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] animate-reveal">
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800 shadow-pop"
      >
        <div className="flex items-center justify-between border-b border-charcoal-700 px-5 py-3">
          <p className="text-sm font-semibold text-ink">
            {post.post_type || "REEL"}
            {post.posted_on ? ` · ${String(post.posted_on).slice(0, 10)}` : ""}
          </p>
          <div className="flex items-center gap-2">
            {post.permalink && (
              <a
                href={post.permalink}
                target="_blank"
                rel="noreferrer"
                className="press rounded-lg border border-charcoal-600 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
              >
                Open on Instagram ↗
              </a>
            )}
            <button onClick={onClose} className="press rounded-lg px-2 py-1 text-sm text-ink-muted hover:text-ink">
              ✕
            </button>
          </div>
        </div>

        <div className="grid gap-5 overflow-y-auto p-5 md:[grid-template-columns:300px_1fr]">
          {/* Media + metrics */}
          <div>
            <IgEmbed post={post} />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <div className="rounded-lg border border-charcoal-700 bg-charcoal p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-ink-faint">Views</p>
                <p className="text-lg font-semibold text-ink">{fmt(post.views)}</p>
              </div>
              <div className="rounded-lg border border-charcoal-700 bg-charcoal p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-ink-faint">Eng rate</p>
                <p className="text-lg font-semibold text-ink">{er != null ? `${er}%` : "—"}</p>
              </div>
              <div className="rounded-lg border border-charcoal-700 bg-charcoal p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-ink-faint">Likes</p>
                <p className="text-lg font-semibold text-ink">{fmt(post.likes)}</p>
              </div>
              <div className="rounded-lg border border-charcoal-700 bg-charcoal p-2.5">
                <p className="text-[10px] uppercase tracking-wider text-ink-faint">Comments</p>
                <p className="text-lg font-semibold text-ink">{fmt(post.comments)}</p>
              </div>
              {post.outlier_multiple != null && (
                <div className="col-span-2 rounded-lg border border-lime/30 bg-lime/5 p-2.5">
                  <p className="text-[10px] uppercase tracking-wider text-lime">Outlier</p>
                  <p className="text-lg font-semibold text-ink">{post.outlier_multiple}× their median</p>
                </div>
              )}
            </div>
            <div className="mt-2 rounded-lg border border-charcoal-700 bg-charcoal/60 p-2.5">
              <p className="text-[10px] uppercase tracking-wider text-ink-faint">Shares · Saves · Reach</p>
              <p className="mt-0.5 text-[11px] text-ink-faint">
                Private — Instagram doesn&apos;t expose these for accounts you don&apos;t own, so Titan
                OS never shows or invents them.
              </p>
            </div>
          </div>

          {/* What the reel says + AI dissection */}
          <div className="space-y-3">
            <ContentOpportunity
              post={post}
              analyzing={analyzing}
              onAnalyze={onAnalyze}
              error={error}
              onGenerateScript={onGenerateScript}
              scripting={scripting}
            />

            {/* Transcript (Groq) — the "watch the reel" payload */}
            {va?.transcript ? (
              <details className="rounded-lg border border-charcoal-700 bg-charcoal p-3" open>
                <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-lime">Transcript</summary>
                <p className="mt-2 max-h-64 overflow-y-auto whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">{va.transcript}</p>
              </details>
            ) : watching ? (
              <div className="rounded-lg border border-sky-400/30 bg-sky-400/5 p-3 text-sm text-sky-400">
                Transcribing this reel now — the transcript appears here automatically.
              </div>
            ) : watched ? (
              <div className="rounded-lg border border-dashed border-charcoal-600 bg-charcoal p-3 text-sm text-ink-faint">
                No spoken audio detected (music-only), so there is no transcript.
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-charcoal-600 bg-charcoal p-3 text-sm text-ink-faint">
                Not transcribed yet. Reels are queued automatically on sync (needs GROQ_API_KEY).
              </div>
            )}

            {/* Detected hook/format/why (present for own-style vision analysis only) */}
            {(va?.hook_spoken || va?.hook_visual || va?.format || va?.why_it_works) && (
              <>
                <InsightRow label="Spoken hook" value={va?.hook_spoken} />
                <InsightRow label="Visual hook" value={va?.hook_visual} />
                <InsightRow label="Format" value={va?.format} />
                <InsightRow label="Why it works" value={va?.why_it_works} />
              </>
            )}

            {post.caption && (
              <details className="rounded-lg border border-charcoal-700 bg-charcoal p-3" open>
                <summary className="cursor-pointer text-[11px] uppercase tracking-wider text-ink-faint">Caption</summary>
                <p className="mt-2 whitespace-pre-wrap text-sm text-ink-muted">{post.caption}</p>
              </details>
            )}

            {post.hashtags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {post.hashtags.map((h) => (
                  <span key={h} className="rounded-md bg-charcoal-700 px-2 py-1 text-[11px] text-ink-muted">
                    {h}
                  </span>
                ))}
              </div>
            )}

            {/* Tags + used marker — so this reel isn't re-worked twice */}
            <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] uppercase tracking-wider text-ink-faint">Tags</p>
                <button
                  onClick={() => onTag(post, { used: !post.used })}
                  disabled={tagging}
                  className={`press rounded-md border px-2 py-1 text-[11px] font-semibold disabled:opacity-60 ${
                    post.used ? "border-charcoal-500 bg-charcoal-600/60 text-ink" : "border-charcoal-600 text-ink-faint hover:text-ink-muted"
                  }`}
                >
                  {post.used ? "Used ✓" : "Mark used"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-lg border border-charcoal-600 bg-charcoal-700 p-2">
                {tags.map((t) => (
                  <span key={t} className="flex items-center gap-1 rounded-full border border-charcoal-500 bg-charcoal-600/60 px-2 py-0.5 text-xs text-ink-muted">
                    {t}
                    <button onClick={() => onTag(post, { tags: tags.filter((x) => x !== t) })} disabled={tagging} className="text-ink-faint hover:text-red-400" aria-label={`Remove ${t}`}>
                      ×
                    </button>
                  </span>
                ))}
                <input
                  value={tagText}
                  onChange={(e) => setTagText(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                  placeholder="add tag…"
                  className="min-w-[120px] flex-1 bg-transparent text-xs text-ink outline-none placeholder:text-ink-faint"
                />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function CompetitorDetailView({
  detail,
  busy,
  onSync,
  onGenReport,
  onRemove,
  onChanged,
  onViewReport,
  setBanner,
}: {
  detail: CompetitorDetail;
  busy: string | null;
  onSync: () => void;
  onGenReport: () => void;
  onRemove: () => void;
  onChanged: () => Promise<void>;
  onViewReport: (r: CompetitorReport) => void;
  setBanner: (b: Banner) => void;
}) {
  const a = detail.analytics;
  const [tab, setTab] = useState<"overview" | "snapshots" | "reels" | "reports">("overview");
  const [reelView, setReelView] = useState<"recent" | "top" | "trending">("recent");
  const [openPost, setOpenPost] = useState<CompetitorPost | null>(null);
  const [showLog, setShowLog] = useState(false);
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [scriptingId, setScriptingId] = useState<string | null>(null);
  const [taggingId, setTaggingId] = useState<string | null>(null);
  const [hideUsed, setHideUsed] = useState(false);
  const [rangeDays, setRangeDays] = useState<number>(28); // 0 = all time
  const [insights, setInsights] = useState<WindowInsights | null>(null);
  const [insightsBusy, setInsightsBusy] = useState<"analyze" | "script" | null>(null);
  const router = useRouter();
  const totalMix = Object.values(a.content_mix).reduce((s, n) => s + n, 0);

  const err = (e: unknown, fallback: string) =>
    setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : fallback });

  // Aggregate "this window" trend read (on-demand, one light AI call).
  async function analyzeWindow() {
    setInsightsBusy("analyze");
    try {
      setInsights(await getWindowInsights(detail.id, rangeDays || 28));
    } catch (e) {
      err(e, "Weekly analysis failed");
    } finally {
      setInsightsBusy(null);
    }
  }
  async function scriptFromTrend(angle: string) {
    setInsightsBusy("script");
    setBanner({ kind: "ok", msg: "Writing a script from this trend…" });
    try {
      const { script } = await scriptFromWindowTrend(detail.id, rangeDays || 28, angle);
      router.push(`/scriptwriter?script=${script.id}`);
    } catch (e) {
      err(e, "Script generation failed");
    } finally {
      setInsightsBusy(null);
    }
  }

  // Generate a full script from a reel, then hand off to the Scriptwriter tab.
  const generateScript = useCallback(
    async (post: CompetitorPost) => {
      setScriptingId(post.id);
      setBanner({ kind: "ok", msg: "Writing a script from this reel…" });
      try {
        const s = await generateScriptFromReel(detail.id, post.id);
        router.push(`/scriptwriter?script=${s.id}`);
      } catch (e) {
        setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : "Script generation failed" });
      } finally {
        setScriptingId(null);
      }
    },
    [detail.id, router],
  );

  // Deep per-reel research → content idea + trend/hot score.
  const analyzeReel = useCallback(
    async (post: CompetitorPost) => {
      setOpenPost(post); // open the modal so progress + results are visible
      if (post.content_analysis) return; // already researched — just view it
      setAnalyzeError(null);
      setAnalyzingId(post.id);
      try {
        const res = await analyzeReelIdea(detail.id, post.id);
        setOpenPost((cur) => (cur && cur.id === post.id ? { ...cur, content_analysis: res } : cur));
        await onChanged();
        setBanner({ kind: "ok", msg: "Content opportunity ready" });
      } catch (e) {
        const msg = e instanceof ApiError ? e.message : "Analysis failed — try again";
        setAnalyzeError(msg);
        setBanner({ kind: "err", msg });
      } finally {
        setAnalyzingId(null);
      }
    },
    [detail.id, onChanged, setBanner],
  );

  // Tag a reel (manual tags + "used" toggle) so it isn't re-worked twice.
  const tagReel = useCallback(
    async (post: CompetitorPost, patch: { tags?: string[]; used?: boolean }) => {
      setTaggingId(post.id);
      // Optimistically reflect the change in the open modal.
      setOpenPost((cur) => (cur && cur.id === post.id ? { ...cur, ...patch } : cur));
      try {
        const res = await tagCompetitorPost(detail.id, post.id, patch);
        setOpenPost((cur) => (cur && cur.id === post.id ? { ...cur, tags: res.tags, used: res.used } : cur));
        await onChanged();
      } catch (e) {
        err(e, "Could not update tags");
        await onChanged(); // revert the optimistic change from server truth
      } finally {
        setTaggingId(null);
      }
    },
    [detail.id, onChanged],
  );

  // Reel lists for the segmented control. The range dropdown filters the Recent
  // view; Top/Trending keep their own logic.
  const cutoff = Date.now() - 30 * 24 * 3600 * 1000;
  const inRange = (p: CompetitorPost) => {
    if (rangeDays === 0) return true;
    const t = p.posted_at ? new Date(p.posted_at).getTime() : null;
    return t != null && Date.now() - t <= rangeDays * 24 * 3600 * 1000;
  };
  const recentReels = detail.posts.filter(inRange); // already newest-first from the API
  const reels =
    reelView === "trending"
      ? byScore(detail.posts.filter((p) => p.posted_on && new Date(p.posted_on).getTime() >= cutoff)).slice(0, 10)
      : reelView === "top"
        ? byScore(detail.posts).slice(0, 50)
        : recentReels;
  const visibleReels = hideUsed ? reels.filter((p) => !p.used) : reels;
  const usedCount = reels.filter((p) => p.used).length;
  const rangeLabel = RANGE_OPTIONS.find(([d]) => d === rangeDays)?.[1] ?? `Last ${rangeDays} days`;
  const postsPerWeek = rangeDays > 0 && recentReels.length ? Math.round((recentReels.length / rangeDays) * 7 * 10) / 10 : null;

  return (
    <div className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-lg font-semibold text-ink">@{detail.username}</h2>
            {detail.category && (
              <span className="rounded-full border border-charcoal-600 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                {detail.category}
              </span>
            )}
          </div>
          {detail.display_name && (
            <p className="text-sm text-ink-muted">{detail.display_name}</p>
          )}
          <div className="mt-1 flex gap-3 font-mono text-[11px] text-ink-faint">
            <a
              href={detail.profile_url || `https://instagram.com/${detail.username}`}
              target="_blank"
              rel="noreferrer"
              className="hover:text-lime"
            >
              Open profile ↗
            </a>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            onClick={onSync}
            disabled={busy === "sync"}
            className="press rounded-lg border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-semibold text-lime disabled:opacity-50"
            title="Pull followers, engagement and recent posts via the official Business Discovery API"
          >
            {busy === "sync" ? "Syncing…" : "Sync live data"}
          </button>
          <button
            onClick={onGenReport}
            disabled={busy === "report"}
            className="btn-primary press px-3 py-1.5 text-xs disabled:opacity-50"
            title={
              detail.posts.some((p) => p.video_analysis?.status === "PENDING" || p.video_analysis?.status === "PROCESSING")
                ? "Videos are still being watched — the report gets sharper once they finish, but you can run it now."
                : "Full strategy: niche, formats, outliers and why, hook bank, and our scripting playbook"
            }
          >
            {busy === "report" ? "Analyzing…" : "Generate full strategy"}
          </button>
          <button
            onClick={onRemove}
            className="press rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10"
          >
            Remove
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="mt-4 flex gap-1 border-b border-charcoal-700">
        {(["overview", "reels", "snapshots", "reports"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`press -mb-px border-b-2 px-3 py-2 text-xs capitalize ${
              tab === t
                ? "border-lime text-ink"
                : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {t}
            {t === "reels" && ` (${detail.posts.length})`}
            {t === "snapshots" && ` (${detail.snapshots.length})`}
            {t === "reports" && ` (${detail.reports.length})`}
          </button>
        ))}
      </div>

      {/* Overview */}
      {tab === "overview" && (
        <div className="mt-4 space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Followers" value={fmt(a.latest_followers)} />
            <Stat
              label="Growth"
              value={a.follower_delta != null ? `${a.follower_delta >= 0 ? "+" : ""}${a.follower_delta.toLocaleString()}` : "—"}
              sub={a.growth_since ? `since ${a.growth_since}` : "add 2+ snapshots"}
            />
            <Stat
              label="Engagement"
              value={a.avg_engagement_rate != null ? `${a.avg_engagement_rate}%` : "—"}
            />
            <Stat
              label="Cadence"
              value={a.posts_per_week != null ? `${a.posts_per_week}/wk` : "—"}
              sub={a.posts_per_week == null ? "add dated posts" : undefined}
            />
          </div>

          {/* Follower growth graph (needs 2+ dated snapshots) */}
          {detail.snapshots.filter((s) => s.captured_on && s.followers_count != null).length >= 2 && (
            <div className="rounded-lg border border-charcoal-700 bg-charcoal/60 p-4">
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Follower growth
              </p>
              <TrendChart
                height={150}
                valueLabel="followers"
                series={[
                  {
                    name: "Followers",
                    color: "#7c3aed",
                    points: detail.snapshots
                      .filter((s) => s.captured_on && s.followers_count != null)
                      .map((s) => ({ t: new Date(s.captured_on).getTime(), v: s.followers_count! })),
                  },
                ]}
              />
            </div>
          )}

          {/* Content mix */}
          {totalMix > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Content mix (saved posts)
              </p>
              <div className="flex h-3 overflow-hidden rounded-full bg-charcoal-700">
                {Object.entries(a.content_mix).map(([k, n], i) => (
                  <div
                    key={k}
                    title={`${k}: ${n}`}
                    className={["bg-lime", "bg-lime-dim", "bg-ink-faint", "bg-charcoal-600"][i % 4]}
                    style={{ width: `${(n / totalMix) * 100}%` }}
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2 font-mono text-[10px] text-ink-muted">
                {Object.entries(a.content_mix).map(([k, n]) => (
                  <span key={k}>
                    {k} {Math.round((n / totalMix) * 100)}%
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Top hashtags */}
          {a.top_hashtags.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Most-used hashtags
              </p>
              <div className="flex flex-wrap gap-1.5">
                {a.top_hashtags.map((h) => (
                  <span
                    key={h.tag}
                    title={h.avg_engagement != null ? `avg ${h.avg_engagement} interactions` : undefined}
                    className="rounded-md bg-charcoal-700 px-2 py-1 font-mono text-[11px] text-ink-muted"
                  >
                    {h.tag} <span className="text-ink-faint">×{h.count}</span>
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* AI video analysis — format mix, outliers, hook bank */}
          <AiVideoAnalysis detail={detail} />

          {/* Viral reels — clean card grid, click for the full watch view */}
          {detail.posts.length > 0 && (
            <div>
              <SectionTitle hint="top by views & engagement">Viral reels</SectionTitle>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 auto-rows-fr">
                {byScore(detail.posts)
                  .slice(0, 6)
                  .map((p) => (
                    <ReelCard key={p.id} post={p} onOpen={setOpenPost} onAnalyze={analyzeReel} analyzing={analyzingId === p.id} onTag={tagReel} tagging={taggingId === p.id} />
                  ))}
              </div>
            </div>
          )}

          {/* Top posts by engagement */}
          {a.top_posts.length > 0 && (
            <div>
              <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Top posts by engagement (from logged snapshots)
              </p>
              <div className="space-y-2">
                {a.top_posts.map((p) => (
                  <div key={p.id} className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
                    <div className="flex items-center justify-between font-mono text-[10px] text-ink-faint">
                      <span>{p.post_type || "POST"}{p.posted_on ? ` · ${String(p.posted_on).slice(0, 10)}` : ""}</span>
                      <span className="text-lime">{fmt(p.engagement)} interactions</span>
                    </div>
                    {p.caption && (
                      <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{p.caption}</p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {detail.notes && (
            <div>
              <p className="mb-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                Notes
              </p>
              <p className="whitespace-pre-wrap text-sm text-ink-muted">{detail.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* Snapshots */}
      {tab === "snapshots" && (
        <div className="mt-4 space-y-4">
          <SnapshotForm
            onSubmit={async (body) => {
              try {
                await addSnapshot(detail.id, body);
                await onChanged();
                setBanner({ kind: "ok", msg: "Snapshot saved" });
              } catch (e) {
                err(e, "Could not save snapshot");
              }
            }}
          />
          {detail.snapshots.length === 0 ? (
            <p className="font-mono text-sm text-ink-faint">No snapshots yet. Log one above to start tracking growth.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-charcoal-700">
              <table className="w-full text-left text-xs">
                <thead className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  <tr className="border-b border-charcoal-700">
                    <th className="px-3 py-2">Date</th>
                    <th className="px-3 py-2">Followers</th>
                    <th className="px-3 py-2">Posts</th>
                    <th className="px-3 py-2">Avg likes</th>
                    <th className="px-3 py-2">Eng %</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody className="text-ink-muted">
                  {[...detail.snapshots].reverse().map((s) => (
                    <tr key={s.id} className="border-b border-charcoal-700 last:border-0">
                      <td className="px-3 py-2 font-mono">{s.captured_on ? String(s.captured_on).slice(0, 10) : "—"}</td>
                      <td className="px-3 py-2">{fmt(s.followers_count)}</td>
                      <td className="px-3 py-2">{fmt(s.posts_count)}</td>
                      <td className="px-3 py-2">{fmt(s.avg_likes)}</td>
                      <td className="px-3 py-2">{s.engagement_rate != null ? `${s.engagement_rate}%` : "—"}</td>
                      <td className="px-3 py-2 text-right">
                        <button
                          onClick={async () => {
                            try {
                              await deleteSnapshot(detail.id, s.id);
                              await onChanged();
                            } catch (e) {
                              err(e, "Delete failed");
                            }
                          }}
                          className="press text-ink-faint hover:text-red-400"
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Reels */}
      {tab === "reels" && (() => {
        const reelCell = (p: CompetitorPost) => (
          <div key={p.id} className="group relative">
            <ReelCard post={p} onOpen={setOpenPost} onAnalyze={analyzeReel} analyzing={analyzingId === p.id} onTag={tagReel} tagging={taggingId === p.id} />
            <button
              onClick={async (e) => {
                e.stopPropagation();
                try {
                  await deleteCompetitorPost(detail.id, p.id);
                  await onChanged();
                } catch (er) {
                  err(er, "Delete failed");
                }
              }}
              className="press absolute bottom-2 right-2 z-10 hidden rounded-md bg-black/55 px-1.5 py-0.5 text-[11px] text-white backdrop-blur-sm hover:text-red-400 group-hover:block"
              title="Remove this reel"
            >
              ✕
            </button>
          </div>
        );
        return (
        <div className="mt-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex rounded-lg border border-charcoal-700 bg-charcoal p-0.5">
                {(
                  [
                    ["recent", "Recent"],
                    ["top", "Top 50"],
                    ["trending", "Trending 30d"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    onClick={() => setReelView(key)}
                    className={`press rounded-md px-3 py-1.5 text-xs font-medium ${
                      reelView === key ? "bg-lime/15 text-lime" : "text-ink-muted hover:text-ink"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {reelView === "recent" && (
                <select
                  value={rangeDays}
                  onChange={(e) => { setRangeDays(Number(e.target.value)); setInsights(null); }}
                  className="rounded-lg border border-charcoal-600 bg-charcoal px-2.5 py-1.5 text-xs text-ink outline-none focus:border-lime/50"
                >
                  {RANGE_OPTIONS.map(([d, label]) => (
                    <option key={d} value={d}>{label}</option>
                  ))}
                </select>
              )}
            </div>
            <div className="flex items-center gap-3">
              <button
                onClick={() => setHideUsed((v) => !v)}
                disabled={usedCount === 0 && !hideUsed}
                className={`press rounded-lg border px-2.5 py-1.5 text-xs font-medium disabled:opacity-40 ${
                  hideUsed ? "border-lime/40 bg-lime/10 text-lime" : "border-charcoal-600 text-ink-muted hover:text-ink"
                }`}
                title="Hide reels you've marked used"
              >
                {hideUsed ? `Showing unused${usedCount ? ` · ${usedCount} hidden` : ""}` : `Hide used${usedCount ? ` (${usedCount})` : ""}`}
              </button>
              <button onClick={() => setShowLog((v) => !v)} className="press text-xs text-ink-faint hover:text-ink">
                {showLog ? "Hide manual log" : "Log a reel manually"}
              </button>
            </div>
          </div>

          {/* Window insights: posting cadence (free) + on-demand trend → script */}
          {reelView === "recent" && (
            <div className="rounded-xl border border-charcoal-700 bg-charcoal p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-ink">
                  <span className="font-semibold text-ink">{recentReels.length}</span> reels in {rangeLabel.toLowerCase()}
                  {postsPerWeek != null && <span className="text-ink-muted"> · ~{postsPerWeek}/week</span>}
                </p>
                <button
                  onClick={analyzeWindow}
                  disabled={insightsBusy != null || recentReels.length === 0}
                  className="press flex items-center gap-1.5 rounded-lg border border-lime/40 bg-lime/10 px-3 py-1.5 text-xs font-semibold text-lime disabled:opacity-50"
                >
                  <Sparkle size={14} weight="fill" /> {insightsBusy === "analyze" ? "Analyzing…" : "Analyze this week"}
                </button>
              </div>
              {insights && (
                <div className="mt-3 space-y-2 border-t border-charcoal-700 pt-3">
                  {insights.estimate && (
                    <p className="text-[11px] text-ink-faint">Trend read is an AI estimate (live web research off).</p>
                  )}
                  {insights.summary && <p className="text-sm text-ink-muted">{insights.summary}</p>}
                  {insights.topics.length > 0 && (
                    <p className="text-sm text-ink-muted"><span className="font-semibold text-ink">Topics: </span>{insights.topics.join(", ")}</p>
                  )}
                  {insights.what_works.length > 0 && (
                    <ul className="ml-4 list-disc text-sm text-ink-muted">
                      {insights.what_works.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  )}
                  {insights.best_angle && (
                    <div className="mt-2 rounded-lg border border-lime/30 bg-lime/5 p-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-lime">Best angle for you</p>
                      <p className="mt-1 text-sm text-ink">{insights.best_angle}</p>
                      <button
                        onClick={() => scriptFromTrend(insights.best_angle!)}
                        disabled={insightsBusy != null}
                        className="btn-primary press mt-2 text-xs disabled:opacity-60"
                      >
                        {insightsBusy === "script" ? "Writing script…" : "✍️ Generate script from this"}
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {showLog && (
            <PostForm
              onSubmit={async (body) => {
                try {
                  await addCompetitorPost(detail.id, body);
                  await onChanged();
                  setBanner({ kind: "ok", msg: "Reel saved" });
                } catch (e) {
                  err(e, "Could not save reel");
                }
              }}
            />
          )}

          {visibleReels.length === 0 ? (
            <p className="font-mono text-sm text-ink-faint">
              {hideUsed && reels.length > 0
                ? "Every reel here is marked used — turn off Hide used to see them."
                : reelView === "recent"
                  ? `No reels in ${rangeLabel.toLowerCase()} — widen the range or Sync.`
                  : reelView === "trending"
                    ? "No reels in the last 30 days yet — Sync to pull recent posts."
                    : "No reels yet. Hit Sync live data to pull them automatically."}
            </p>
          ) : reelView === "recent" ? (
            // Newest-first, grouped by day
            <div className="space-y-5">
              {groupByDay(visibleReels).map(([day, dayReels]) => (
                <div key={day}>
                  <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-faint">
                    {day === "undated" ? "Undated" : fmtDayHeader(day)}
                    <span className="ml-2 text-ink-muted">· {dayReels.length} reel{dayReels.length === 1 ? "" : "s"}</span>
                  </p>
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 auto-rows-fr">
                    {dayReels.map(reelCell)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 auto-rows-fr">
              {visibleReels.map(reelCell)}
            </div>
          )}
        </div>
        );
      })()}

      {/* Reports */}
      {tab === "reports" && (
        <div className="mt-4 space-y-2">
          {detail.reports.length === 0 ? (
            <p className="font-mono text-sm text-ink-faint">
              No reports yet. Click "AI report" to generate a strategy breakdown from the tracked data.
            </p>
          ) : (
            detail.reports.map((r) => (
              <button
                key={r.id}
                onClick={() => onViewReport(r)}
                className="press block w-full rounded-lg border border-charcoal-700 bg-charcoal p-3 text-left hover:border-charcoal-600"
              >
                <p className="text-sm text-ink">{r.title}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-ink-faint">{r.content.slice(0, 160)}</p>
              </button>
            ))
          )}
        </div>
      )}

      {openPost && (
        <ReelModal
          post={openPost}
          onClose={() => { setOpenPost(null); setAnalyzeError(null); }}
          onAnalyze={analyzeReel}
          analyzing={analyzingId === openPost.id}
          error={analyzeError}
          onGenerateScript={generateScript}
          scripting={scriptingId === openPost.id}
          onTag={tagReel}
          tagging={taggingId === openPost.id}
        />
      )}
    </div>
  );
}

// ===================================================================

function numOrNull(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function SnapshotForm({ onSubmit }: { onSubmit: (b: SnapshotInput) => Promise<void> }) {
  const today = new Date().toISOString().slice(0, 10);
  const [f, setF] = useState({ captured_on: today, followers: "", posts: "", likes: "", comments: "" });
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Log a snapshot</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <input type="date" className={inputCls} value={f.captured_on} onChange={(e) => setF({ ...f, captured_on: e.target.value })} />
        <input placeholder="Followers" inputMode="numeric" className={inputCls} value={f.followers} onChange={(e) => setF({ ...f, followers: e.target.value })} />
        <input placeholder="Posts" inputMode="numeric" className={inputCls} value={f.posts} onChange={(e) => setF({ ...f, posts: e.target.value })} />
        <input placeholder="Avg likes" inputMode="numeric" className={inputCls} value={f.likes} onChange={(e) => setF({ ...f, likes: e.target.value })} />
        <input placeholder="Avg comments" inputMode="numeric" className={inputCls} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} />
      </div>
      <button
        onClick={async () => {
          setSaving(true);
          await onSubmit({
            captured_on: f.captured_on || null,
            followers_count: numOrNull(f.followers),
            posts_count: numOrNull(f.posts),
            avg_likes: numOrNull(f.likes),
            avg_comments: numOrNull(f.comments),
          });
          setF({ ...f, followers: "", posts: "", likes: "", comments: "" });
          setSaving(false);
        }}
        disabled={saving}
        className="press mt-2 rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        {saving ? "Saving…" : "Add snapshot"}
      </button>
    </div>
  );
}

function PostForm({ onSubmit }: { onSubmit: (b: PostInput) => Promise<void> }) {
  const [f, setF] = useState({ type: "REEL", permalink: "", caption: "", likes: "", comments: "", views: "", posted_on: "", hook: "", viral_reason: "" });
  const [saving, setSaving] = useState(false);

  return (
    <div className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
      <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">Log a competitor post / reel</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <select className={inputCls} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>
          <option value="REEL">Reel</option>
          <option value="CAROUSEL">Carousel</option>
          <option value="IMAGE">Image</option>
          <option value="STORY">Story</option>
        </select>
        <input placeholder="Views" inputMode="numeric" className={inputCls} value={f.views} onChange={(e) => setF({ ...f, views: e.target.value })} />
        <input placeholder="Likes" inputMode="numeric" className={inputCls} value={f.likes} onChange={(e) => setF({ ...f, likes: e.target.value })} />
        <input placeholder="Comments" inputMode="numeric" className={inputCls} value={f.comments} onChange={(e) => setF({ ...f, comments: e.target.value })} />
        <input type="date" className={inputCls} value={f.posted_on} onChange={(e) => setF({ ...f, posted_on: e.target.value })} />
      </div>
      <input placeholder="Reel / post URL (permalink)" className={`${inputCls} mt-2`} value={f.permalink} onChange={(e) => setF({ ...f, permalink: e.target.value })} />
      <textarea placeholder="Caption (hashtags auto-extracted)" rows={2} className={`${inputCls} mt-2`} value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} />
      <input
        placeholder="Hook — the opening line / first 3 seconds that grab attention"
        className={`${inputCls} mt-2`}
        value={f.hook}
        onChange={(e) => setF({ ...f, hook: e.target.value })}
      />
      <textarea
        placeholder="Why it's going viral — main reason (editing, topic, trend, emotion, CTA…)"
        rows={2}
        className={`${inputCls} mt-2`}
        value={f.viral_reason}
        onChange={(e) => setF({ ...f, viral_reason: e.target.value })}
      />
      <button
        onClick={async () => {
          setSaving(true);
          const parts: string[] = [];
          if (f.hook.trim()) parts.push(`Hook: ${f.hook.trim()}`);
          if (f.viral_reason.trim()) parts.push(`Viral reason: ${f.viral_reason.trim()}`);
          await onSubmit({
            post_type: f.type,
            permalink: f.permalink || null,
            caption: f.caption || null,
            likes: numOrNull(f.likes),
            comments: numOrNull(f.comments),
            views: numOrNull(f.views),
            posted_on: f.posted_on || null,
            what_works: parts.length ? parts.join("\n") : null,
          });
          setF({ type: f.type, permalink: "", caption: "", likes: "", comments: "", views: "", posted_on: "", hook: "", viral_reason: "" });
          setSaving(false);
        }}
        disabled={saving}
        className="press mt-2 rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
      >
        {saving ? "Saving…" : "Save post"}
      </button>
    </div>
  );
}

function AddCompetitorModal({
  onClose,
  onCreated,
  setBanner,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
  setBanner: (b: Banner) => void;
}) {
  const [f, setF] = useState({ username: "", display_name: "", category: "", profile_url: "", notes: "", followers: "" });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit() {
    if (!f.username.trim()) return;
    setSaving(true);
    setFormError(null);
    try {
      const c = await createCompetitor({
        username: f.username,
        display_name: f.display_name || null,
        category: f.category || null,
        profile_url: f.profile_url || null,
        notes: f.notes || null,
      });
      // Seed an initial snapshot if a follower count was provided.
      if (numOrNull(f.followers) != null) {
        await addSnapshot(c.id, { followers_count: numOrNull(f.followers) });
      }
      onCreated(c.id);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? err.code === "conflict" || err.status === 409
            ? "You're already tracking that competitor."
            : err.message
          : "Could not add competitor. Check your connection and try again.";
      setFormError(msg);
      setBanner({ kind: "err", msg });
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] animate-reveal">
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md rounded-2xl border border-charcoal-700 bg-charcoal-800 p-5 shadow-pop">
        <h3 className="text-base font-semibold text-ink">Add competitor</h3>
        <div className="mt-4 space-y-2">
          <input autoFocus placeholder="username (without @)" className={inputCls} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} />
          <input placeholder="Display name (optional)" className={inputCls} value={f.display_name} onChange={(e) => setF({ ...f, display_name: e.target.value })} />
          <div className="grid grid-cols-2 gap-2">
            <input placeholder="Niche / category" className={inputCls} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
            <input placeholder="Current followers" inputMode="numeric" className={inputCls} value={f.followers} onChange={(e) => setF({ ...f, followers: e.target.value })} />
          </div>
          <input placeholder="Profile URL (optional)" className={inputCls} value={f.profile_url} onChange={(e) => setF({ ...f, profile_url: e.target.value })} />
          <textarea placeholder="Notes on their positioning / content pillars" rows={2} className={inputCls} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
        {formError && (
          <p className="mt-3 rounded-lg border border-red-400/40 bg-red-400/10 px-3 py-2 text-xs text-red-400">
            {formError}
          </p>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button onClick={onClose} className="press rounded-lg border border-charcoal-600 px-4 py-2 text-sm text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !f.username.trim()} className="btn-primary press disabled:opacity-50">
            {saving ? "Adding…" : "Add"}
          </button>
        </div>
      </div>
    </div>
  );
}

function ReportModal({ report, onClose }: { report: CompetitorReport; onClose: () => void }) {
  function copy() {
    void navigator.clipboard.writeText(report.content);
  }
  return (
    <div onClick={onClose} className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-[2px] animate-reveal">
      <div onClick={(e) => e.stopPropagation()} className="flex max-h-[88vh] w-full max-w-2xl flex-col rounded-2xl border border-charcoal-700 bg-charcoal-800 shadow-pop">
        <div className="flex items-center justify-between border-b border-charcoal-700 px-5 py-3">
          <p className="truncate text-sm font-semibold text-ink">{report.title}</p>
          <div className="flex shrink-0 gap-2">
            <button onClick={copy} className="press rounded-lg border border-charcoal-600 px-2.5 py-1 text-xs text-ink-muted hover:text-ink">
              Copy
            </button>
            <button onClick={onClose} className="press rounded-lg px-2 py-1 text-sm text-ink-muted hover:text-ink">
              ✕
            </button>
          </div>
        </div>
        <div className="overflow-y-auto px-5 py-4">
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-ink-muted">{report.content}</pre>
        </div>
        {report.model && (
          <div className="border-t border-charcoal-700 px-5 py-2 font-mono text-[10px] text-ink-faint">
            Generated by {report.model}
          </div>
        )}
      </div>
    </div>
  );
}
