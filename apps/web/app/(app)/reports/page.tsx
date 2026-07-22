"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { Markdown } from "@/components/Markdown";
import {
  ApiError,
  analyzeOwnReels,
  getVideoStatus,
  getWeeklyReport,
  type VideoStatusResult,
  type WeeklyReport,
  type WeeklyReportAccount,
} from "@/lib/api";

const fmt = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString());

function Delta({ now, prev }: { now: number; prev: number }) {
  if (prev === 0 && now === 0) return null;
  if (prev === 0) return <span className="font-mono text-[10px] text-lime">new</span>;
  const pct = Math.round(((now - prev) / prev) * 100);
  if (pct === 0) return null;
  return (
    <span className={`font-mono text-[10px] ${pct > 0 ? "text-lime" : "text-red-400"}`}>
      {pct > 0 ? "▲" : "▼"} {Math.abs(pct)}%
    </span>
  );
}

function AccountReport({ a }: { a: WeeklyReportAccount }) {
  const [showPosts, setShowPosts] = useState(false);
  const stats: { label: string; value: number }[] = [
    { label: "Reach", value: a.reach },
    { label: "Views", value: a.views },
    { label: "Likes", value: a.likes },
    { label: "Comments", value: a.comments },
    { label: "Shares", value: a.shares },
    { label: "Saves", value: a.saves },
  ];
  return (
    <div className="lift animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <h3 className="text-lg font-semibold text-ink">@{a.username}</h3>
          <span className="font-mono text-xs text-ink-faint">{fmt(a.followers)} followers</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="rounded-full border border-charcoal-600 px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
            {a.posts_published} post{a.posts_published === 1 ? "" : "s"} this week
          </span>
          <Delta now={a.reach} prev={a.prev_reach} />
        </div>
      </div>

      {a.error && <p className="mt-3 font-mono text-xs text-amber-300">{a.error}</p>}

      <div className="mt-4 grid grid-cols-3 gap-3 md:grid-cols-6">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg bg-charcoal px-3 py-2">
            <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{s.label}</p>
            <p className="mt-0.5 text-lg font-bold tracking-tight text-ink">{fmt(s.value)}</p>
          </div>
        ))}
      </div>

      {a.top_post && (
        <div className="mt-4 rounded-lg border border-lime/30 bg-lime/[0.04] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-lime">Top post this week</p>
          <p className="mt-1 text-sm font-medium text-ink">
            {(a.top_post.caption ?? "(no caption)").replace(/#\w+/g, "").trim().slice(0, 120)}
          </p>
          <p className="mt-1 font-mono text-[10px] text-ink-muted">
            {fmt(a.top_post.reach)} reach · {fmt(a.top_post.views)} views · {fmt(a.top_post.likes)} likes
            {a.top_post.engagement_rate != null && ` · ${a.top_post.engagement_rate}% er`}
            {a.top_post.permalink && (
              <>
                {" · "}
                <a href={a.top_post.permalink} target="_blank" rel="noreferrer" className="text-lime hover:underline">
                  open ↗
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {a.posts.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowPosts(!showPosts)}
            className="press font-mono text-[10px] uppercase tracking-wider text-lime hover:underline"
          >
            {showPosts ? "Hide posts" : `Show all ${a.posts.length} posts`}
          </button>
          {showPosts && (
            <div className="mt-2 overflow-x-auto rounded-lg border border-charcoal-700">
              <table className="w-full text-left text-sm">
                <thead className="bg-charcoal-700 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  <tr>
                    <th className="px-3 py-2 font-normal">Post</th>
                    <th className="px-3 py-2 text-right font-normal">Reach</th>
                    <th className="px-3 py-2 text-right font-normal">Views</th>
                    <th className="px-3 py-2 text-right font-normal">Likes</th>
                    <th className="px-3 py-2 text-right font-normal">Comments</th>
                    <th className="px-3 py-2 text-right font-normal">ER</th>
                  </tr>
                </thead>
                <tbody>
                  {a.posts.map((p, i) => (
                    <tr key={i} className="border-t border-charcoal-700 transition-colors duration-150 hover:bg-charcoal">
                      <td className="max-w-[260px] px-3 py-2">
                        <a href={p.permalink ?? "#"} target="_blank" rel="noreferrer" className="block truncate text-ink-muted hover:text-lime">
                          {(p.caption ?? "(no caption)").replace(/#\w+/g, "").trim().slice(0, 80)}
                        </a>
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{fmt(p.reach)}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{fmt(p.views)}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{fmt(p.likes)}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{fmt(p.comments)}</td>
                      <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.engagement_rate != null ? `${p.engagement_rate}%` : "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Small strip showing the "AI watched reels" queue for the workspace.
function VideoQueueStrip({ status }: { status: VideoStatusResult | null }) {
  if (!status) return null;
  const c = status.counts;
  const total = c.PENDING + c.PROCESSING + c.DONE + c.FAILED + c.SKIPPED;
  if (total === 0) return null;
  const bits = [
    c.DONE > 0 && `${c.DONE} watched`,
    c.PENDING + c.PROCESSING > 0 && `${c.PENDING + c.PROCESSING} in queue`,
    c.FAILED > 0 && `${c.FAILED} failed`,
    c.SKIPPED > 0 && `${c.SKIPPED} skipped`,
  ].filter(Boolean);
  return (
    <p className="mb-4 font-mono text-[11px] text-ink-faint">
      AI video analysis: {bits.join(" · ")}
      {c.FAILED > 0 && status.recent_errors[0]?.error && (
        <span className="text-amber-300"> - last error: {status.recent_errors[0].error}</span>
      )}
    </p>
  );
}

export default function ReportsPage() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [videoStatus, setVideoStatus] = useState<VideoStatusResult | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshVideoStatus = useCallback(async () => {
    try {
      const s = await getVideoStatus();
      setVideoStatus(s);
      // Keep polling only while there's work in the queue.
      const active = s.counts.PENDING + s.counts.PROCESSING > 0;
      if (!active && pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (active && !pollRef.current) pollRef.current = setInterval(refreshVideoStatus, 30_000);
    } catch { /* strip is cosmetic */ }
  }, []);

  useEffect(() => {
    refreshVideoStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshVideoStatus]);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      setReport(await getWeeklyReport());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Report generation failed");
    } finally {
      setLoading(false);
    }
  }

  async function analyzeReels() {
    setAnalyzing(true);
    setError(null);
    setNotice(null);
    try {
      const r = await analyzeOwnReels();
      setNotice(
        r.enqueued > 0
          ? `${r.enqueued} reel${r.enqueued === 1 ? "" : "s"} queued - the AI watches them in the background (a few minutes), then reports quote your real hooks.`
          : r.already_done > 0
            ? `All ${r.already_done} recent reels are already analyzed - reports will use them.`
            : "No new reels found to analyze.",
      );
      await refreshVideoStatus();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not queue reels for analysis");
    } finally {
      setAnalyzing(false);
    }
  }

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title="Weekly Report"
          subtitle="Every account, every post, last 7 days - with an AI summary of what worked and what to do next."
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={analyzeReels}
            disabled={analyzing}
            className="press rounded-lg border border-charcoal-600 px-4 py-2 text-sm font-medium text-ink-muted hover:border-lime/50 hover:text-ink disabled:opacity-50"
          >
            {analyzing ? "Queuing reels…" : "Analyze my recent reels"}
          </button>
          <button
            onClick={generate}
            disabled={loading}
            className="btn-primary press disabled:opacity-50"
          >
            {loading ? "Crunching the week…" : report ? "Refresh report" : "Get weekly report"}
          </button>
        </div>
      </div>

      {notice && <p className="mb-4 text-sm font-medium text-lime">{notice}</p>}
      {error && <p className="mb-4 text-sm font-medium text-red-400">{error}</p>}
      <VideoQueueStrip status={videoStatus} />

      {!report && !loading && (
        <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-16 text-center">
          <p className="text-sm font-medium text-ink">Generate this week&apos;s performance report</p>
          <p className="mt-1 text-sm text-ink-muted">
            Pulls live data for every connected account, compares to last week, and writes the takeaways.
          </p>
        </div>
      )}

      {loading && !report && (
        <p className="text-sm font-medium text-ink-faint">Fetching live data for all accounts and writing the report - this takes ~30 seconds…</p>
      )}

      {report && (
        <div className="space-y-6">
          <div className="animate-reveal relative overflow-hidden rounded-2xl p-6 text-white shadow-pop" style={{ background: "linear-gradient(135deg, #5047EB 0%, #4338CA 50%, #312E81 100%)" }}>
            <div
              aria-hidden
              className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full blur-3xl"
              style={{ background: "radial-gradient(circle, rgba(167,139,250,0.4), transparent 70%)" }}
            />
            <p className="relative text-xs font-semibold uppercase tracking-[0.2em] text-white/60">Executive summary</p>
            <div className="relative mt-4 rounded-xl border border-white/10 bg-white/[0.06] p-5">
              <Markdown text={report.summary} />
              <p className="pt-3 text-[10px] font-medium text-white/40">
                Generated {new Date(report.generated_at).toLocaleString()} · last {report.range_days} days
              </p>
            </div>
          </div>

          {report.accounts.map((a) => (
            <AccountReport key={a.account_id} a={a} />
          ))}
        </div>
      )}
    </div>
  );
}
