"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  addCompetitorPost,
  addSnapshot,
  createCompetitor,
  deleteCompetitor,
  deleteCompetitorPost,
  deleteSnapshot,
  generateCompetitorReport,
  generateOverviewReport,
  getCompetitor,
  listCompetitors,
  syncCompetitor,
  updateCompetitor,
  type CompetitorDetail,
  type CompetitorListItem,
  type CompetitorReport,
  type PostInput,
  type SnapshotInput,
} from "@/lib/api";
import { TrendChart } from "@/components/Charts";

type Banner = { kind: "ok" | "err"; msg: string } | null;

const inputCls =
  "w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50";

const fmt = (n: number | null | undefined) =>
  n == null ? "—" : n.toLocaleString();

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
      setBanner({
        kind: "ok",
        msg: `Synced @${r.username} — ${r.followers_count?.toLocaleString() ?? "?"} followers, ${r.posts_imported} new post${r.posts_imported === 1 ? "" : "s"} imported`,
      });
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
          subtitle="Track rivals, log their growth and content, and get an AI plan to outgrow them."
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
            className="press rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-white"
          >
            Add competitor
          </button>
        </div>
      </div>

      {/* Honesty note about data provenance */}
      <div className="mb-5 rounded-lg border border-charcoal-700 bg-charcoal-800 px-4 py-2 text-xs text-ink-muted">
        <span className="font-mono uppercase tracking-wider text-lime">Manual intelligence</span>
        <span className="ml-2">
          You log what you observe (followers, posts, hashtags). Analysis, growth and the AI
          report are derived from that. Private metrics like a competitor&apos;s reach or saves
          aren&apos;t available on any official API, so they&apos;re never shown or invented.
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
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-charcoal-700 text-2xl">
            🎯
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
  const [tab, setTab] = useState<"overview" | "snapshots" | "posts" | "reports">("overview");
  const totalMix = Object.values(a.content_mix).reduce((s, n) => s + n, 0);

  const err = (e: unknown, fallback: string) =>
    setBanner({ kind: "err", msg: e instanceof ApiError ? e.message : fallback });

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
            className="press rounded-lg bg-lime px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {busy === "report" ? "Analyzing…" : "AI report"}
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
        {(["overview", "snapshots", "posts", "reports"] as const).map((t) => (
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
            {t === "posts" && ` (${detail.posts.length})`}
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

          {/* Viral Reels — posts sorted by views then engagement */}
          {detail.posts.length > 0 && (() => {
            const viral = [...detail.posts]
              .sort((a, b) => {
                const vDiff = (b.views ?? 0) - (a.views ?? 0);
                if (vDiff !== 0) return vDiff;
                return (b.engagement ?? 0) - (a.engagement ?? 0);
              })
              .slice(0, 5);
            return (
              <div>
                <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  Viral reels — top by views &amp; engagement
                </p>
                <div className="space-y-2">
                  {viral.map((p, idx) => {
                    const hookLine = p.what_works?.split("\n").find((l) => l.startsWith("Hook:"))?.replace("Hook:", "").trim();
                    const viralLine = p.what_works?.split("\n").find((l) => l.startsWith("Viral reason:"))?.replace("Viral reason:", "").trim();
                    return (
                      <div key={p.id} className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {idx < 3 && (
                              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded bg-lime font-mono text-[9px] font-bold text-white">
                                #{idx + 1}
                              </span>
                            )}
                            <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                              {p.post_type || "REEL"}{p.posted_on ? ` · ${String(p.posted_on).slice(0, 10)}` : ""}
                            </span>
                          </div>
                          <div className="flex shrink-0 gap-3 font-mono text-[10px]">
                            {p.views != null && <span className="text-sky-400">{fmt(p.views)} views</span>}
                            {p.engagement != null && <span className="text-lime">{fmt(p.engagement)} eng.</span>}
                            {p.likes != null && <span className="text-ink-faint">{fmt(p.likes)} likes</span>}
                          </div>
                        </div>
                        {p.caption && <p className="mt-1.5 line-clamp-2 text-xs text-ink-muted">{p.caption}</p>}
                        {hookLine && (
                          <div className="mt-2 rounded-md bg-lime/5 border border-lime/20 px-2 py-1">
                            <span className="font-mono text-[9px] uppercase tracking-wider text-lime">Hook </span>
                            <span className="text-xs text-ink-muted">{hookLine}</span>
                          </div>
                        )}
                        {viralLine && (
                          <div className="mt-1.5 rounded-md bg-charcoal-700/60 px-2 py-1">
                            <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">Why viral </span>
                            <span className="text-xs text-ink-muted">{viralLine}</span>
                          </div>
                        )}
                        {p.permalink && (
                          <a href={p.permalink} target="_blank" rel="noreferrer" className="mt-2 inline-block font-mono text-[10px] text-lime hover:underline">
                            Open reel ↗
                          </a>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

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

      {/* Posts */}
      {tab === "posts" && (
        <div className="mt-4 space-y-4">
          <PostForm
            onSubmit={async (body) => {
              try {
                await addCompetitorPost(detail.id, body);
                await onChanged();
                setBanner({ kind: "ok", msg: "Post saved" });
              } catch (e) {
                err(e, "Could not save post");
              }
            }}
          />
          {detail.posts.length === 0 ? (
            <p className="font-mono text-sm text-ink-faint">No saved posts yet. Log their reels above to track views, hooks, and viral reasons.</p>
          ) : (
            <div className="space-y-3">
              <p className="font-mono text-[10px] text-ink-faint uppercase tracking-wider">
                {detail.posts.length} posts · sorted by views
              </p>
              {[...detail.posts]
                .sort((a, b) => {
                  const vDiff = (b.views ?? 0) - (a.views ?? 0);
                  if (vDiff !== 0) return vDiff;
                  return (b.engagement ?? 0) - (a.engagement ?? 0);
                })
                .map((p) => {
                  const hookLine = p.what_works?.split("\n").find((l) => l.startsWith("Hook:"))?.replace("Hook:", "").trim();
                  const viralLine = p.what_works?.split("\n").find((l) => l.startsWith("Viral reason:"))?.replace("Viral reason:", "").trim();
                  return (
                    <div key={p.id} className="rounded-lg border border-charcoal-700 bg-charcoal p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="font-mono text-[10px] text-ink-faint">
                          {p.post_type || "POST"}{p.posted_on ? ` · ${String(p.posted_on).slice(0, 10)}` : ""}
                        </div>
                        <div className="flex shrink-0 items-center gap-3 font-mono text-[10px]">
                          {p.views != null && <span className="text-sky-400">{fmt(p.views)} views</span>}
                          {p.engagement != null && <span className="text-lime">{fmt(p.engagement)} eng.</span>}
                          {p.likes != null && <span className="text-ink-faint">{fmt(p.likes)} likes</span>}
                          {p.comments != null && <span className="text-ink-faint">{fmt(p.comments)} cmt</span>}
                          {p.permalink && (
                            <a href={p.permalink} target="_blank" rel="noreferrer" className="hover:text-lime">
                              open ↗
                            </a>
                          )}
                          <button
                            onClick={async () => {
                              try {
                                await deleteCompetitorPost(detail.id, p.id);
                                await onChanged();
                              } catch (e) {
                                err(e, "Delete failed");
                              }
                            }}
                            className="press hover:text-red-400"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                      {p.caption && <p className="mt-1.5 whitespace-pre-wrap text-xs text-ink-muted">{p.caption}</p>}
                      {p.hashtags.length > 0 && (
                        <p className="mt-1 font-mono text-[10px] text-lime-dim">{p.hashtags.join(" ")}</p>
                      )}
                      {hookLine && (
                        <div className="mt-2 rounded-md border border-lime/20 bg-lime/5 px-2 py-1">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-lime">Hook </span>
                          <span className="text-xs text-ink-muted">{hookLine}</span>
                        </div>
                      )}
                      {viralLine && (
                        <div className="mt-1.5 rounded-md bg-charcoal-700/60 px-2 py-1">
                          <span className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">Why viral </span>
                          <span className="text-xs text-ink-muted">{viralLine}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}

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
          <button onClick={submit} disabled={saving || !f.username.trim()} className="press rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
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
