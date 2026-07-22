"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { VideoCard, WhatsWorking } from "@/components/VideoPerformance";
import { DashboardFilters, type RangeKey } from "@/components/DashboardFilters";
import {
  BestPostingTimes,
  ContentBrief,
  FormatBreakdown,
  HashtagLeaderboard,
  HookPatterns,
  KpiTiles,
} from "@/components/DashboardAnalytics";
import { StrategyPanel } from "@/components/StrategyPanel";
import { TrendChart, DonutChart, type TrendSeries, type DonutSlice } from "@/components/Charts";
import { AccountPerformance } from "@/components/AccountPerformance";
import {
  ApiError,
  getInsightsSummary,
  type InsightsSummary,
  type RecentPost,
} from "@/lib/api";

const RANGE_DAYS: Record<RangeKey, number | null> = {
  "7": 7,
  "28": 28,
  "90": 90,
  all: null,
};

type SortKey = "reach" | "views" | "shares" | "engagement" | "likes" | "saves" | "comments";
const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: "reach", label: "Reach" },
  { key: "views", label: "Views" },
  { key: "shares", label: "Shares" },
  { key: "engagement", label: "Engagement" },
  { key: "likes", label: "Likes" },
  { key: "saves", label: "Saves" },
  { key: "comments", label: "Comments" },
];

function sortValue(p: RecentPost, key: SortKey): number {
  switch (key) {
    case "reach": return p.reach ?? 0;
    case "views": return p.views ?? 0;
    case "shares": return p.shares ?? 0;
    case "engagement": return p.engagement_rate ?? 0;
    case "likes": return p.likes ?? 0;
    case "saves": return p.saved ?? 0;
    case "comments": return p.comments ?? 0;
  }
}

export default function DashboardPage() {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("28");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<SortKey>("reach");
  const [showAllVideos, setShowAllVideos] = useState(false);
  const [commentsAccountId, setCommentsAccountId] = useState<string | null>(null);

  useEffect(() => {
    getInsightsSummary()
      .then((d) => {
        setData(d);
        setSelectedAccountIds(d.accounts.map((a) => a.account_id));
        setCommentsAccountId(d.accounts[0]?.account_id ?? null);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : "Failed to load insights"),
      )
      .finally(() => setLoading(false));
  }, []);

  const filteredPosts: RecentPost[] = useMemo(() => {
    if (!data) return [];
    const days = RANGE_DAYS[range];
    const since = days === null ? 0 : Date.now() - days * 86_400_000;
    const accounts = data.accounts.filter((a) =>
      selectedAccountIds.length === 0 ? true : selectedAccountIds.includes(a.account_id),
    );
    const posts = accounts.flatMap((a) => a.recent_posts);
    return posts
      .filter((p) => !p.timestamp || new Date(p.timestamp).getTime() >= since)
      .sort((a, b) => sortValue(b, sortBy) - sortValue(a, sortBy));
  }, [data, range, selectedAccountIds, sortBy]);

  // Long ranges (90d / All) collapse to the top 10 until "Show all" is clicked.
  const isLongRange = range === "90" || range === "all";
  const collapsed = isLongRange && !showAllVideos && filteredPosts.length > 10;
  const displayedPosts = collapsed ? filteredPosts.slice(0, 10) : filteredPosts;

  const trendSeries: TrendSeries[] = useMemo(() => {
    const dated = filteredPosts.filter((p) => p.timestamp);
    return [
      {
        name: "Reach",
        color: "#5047EB",
        points: dated
          .filter((p) => p.reach != null)
          .map((p) => ({ t: new Date(p.timestamp!).getTime(), v: p.reach! })),
      },
      {
        name: "Views",
        color: "#7168F0",
        points: dated
          .filter((p) => p.views != null)
          .map((p) => ({ t: new Date(p.timestamp!).getTime(), v: p.views! })),
      },
    ];
  }, [filteredPosts]);

  const formatSlices: DonutSlice[] = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const p of filteredPosts) {
      const type = (p as unknown as Record<string, string>).media_type ?? "IMAGE";
      const label =
        type === "REEL" ? "Reels" :
        type === "CAROUSEL_ALBUM" ? "Carousel" :
        type === "VIDEO" ? "Video" : "Static";
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const palette: Record<string, string> = {
      Reels: "#5047EB",
      Carousel: "#7168F0",
      Static: "#CACBFF",
      Video: "#A5B4FC",
    };
    return Object.entries(counts).map(([label, value]) => ({
      label,
      value,
      color: palette[label] ?? "#CACBFF",
    }));
  }, [filteredPosts]);

  // DM leads + calls-booked stay sourced from the API summary (GHL pending).
  const dmLeads = useMemo(() => {
    const k = data?.kpis.find((x) => x.key === "dm_leads");
    return { value: k?.value ?? null, available: !!k?.available, note: k?.note ?? "" };
  }, [data]);
  const callsBooked = useMemo(() => {
    const k = data?.kpis.find((x) => x.key === "calls_booked");
    return { value: k?.value ?? null, available: !!k?.available, note: k?.note ?? "" };
  }, [data]);

  const hasAccounts = (data?.accounts.length ?? 0) > 0;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle="Cross-account performance and per-video analytics - built to inform tomorrow's content."
      />

      {error && <p className="mb-4 text-sm font-medium text-red-400">{error}</p>}

      {hasAccounts && data && (
        <DashboardFilters
          accounts={data.accounts}
          selectedAccountIds={selectedAccountIds}
          onAccountsChange={setSelectedAccountIds}
          range={range}
          onRangeChange={(r) => {
            setRange(r);
            setShowAllVideos(false);
          }}
        />
      )}

      {loading && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="skeleton h-28" style={{ animationDelay: `${i * 80}ms` }} />
            ))}
          </div>
          <div className="skeleton h-72" />
          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="skeleton h-96" />
            <div className="skeleton h-64" />
          </div>
        </div>
      )}

      {!loading && !hasAccounts && (
        <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-12 text-center">
          <p className="text-sm text-ink-muted">
            Connect an Instagram Business/Creator account to see live insights.
          </p>
        </div>
      )}

      {hasAccounts && (
        <div className="space-y-6">
          {data?.accounts.filter((a) => a.error).map((a) => (
            <div key={a.account_id} className="rounded-lg border border-amber-400/40 bg-amber-400/10 px-4 py-3">
              <p className="text-xs font-medium text-amber-600">
                @{a.username}: {a.error}
              </p>
              <p className="mt-1 text-[10px] font-medium text-ink-faint">
                Metrics for this account are unavailable - try reconnecting it on the Connect Instagram page.
              </p>
            </div>
          ))}

          <KpiTiles posts={filteredPosts} dmLeads={dmLeads} callsBooked={callsBooked} />

          {data && (
            <AccountPerformance
              accounts={data.accounts}
              sinceMs={RANGE_DAYS[range] === null ? 0 : Date.now() - RANGE_DAYS[range]! * 86_400_000}
            />
          )}

          {trendSeries.some((s) => s.points.length >= 2) && (
            <div className="animate-reveal grid gap-6 lg:grid-cols-[1fr_280px]">
              <div className="rounded-2xl border border-charcoal-700 bg-charcoal-800 p-6 shadow-card">
                <div className="mb-4">
                  <h3 className="font-heading text-base font-semibold text-ink">Performance trend</h3>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    Reach and views per post across the selected range
                  </p>
                </div>
                <TrendChart series={trendSeries} height={200} />
              </div>

              {formatSlices.length > 0 && (
                <div className="rounded-2xl border border-charcoal-700 bg-charcoal-800 p-6 shadow-card">
                  <div className="mb-4">
                    <h3 className="font-heading text-base font-semibold text-ink">Format mix</h3>
                    <p className="mt-0.5 text-xs text-ink-faint">
                      Post types in view
                    </p>
                  </div>
                  <div className="flex items-center justify-center py-2">
                    <DonutChart
                      slices={formatSlices}
                      size={150}
                      label={String(filteredPosts.length)}
                      sublabel="posts"
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          <ContentBrief posts={filteredPosts} />

          <StrategyPanel posts={filteredPosts} />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold text-ink">Video performance</h2>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-ink-faint">Sort by</span>
                  <div className="flex flex-wrap gap-1">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setSortBy(opt.key)}
                        className={`press rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider transition-studio duration-studio ease-studio-out ${
                          sortBy === opt.key
                            ? "border-lime bg-lime/10 text-lime"
                            : "border-charcoal-600 text-ink-faint hover:text-ink"
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              {filteredPosts.length === 0 ? (
                <p className="rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 p-6 text-center text-sm text-ink-muted">
                  No posts in this range. Try widening the time window.
                </p>
              ) : (
                <>
                  <div className="grid gap-4 xl:grid-cols-2">
                    {displayedPosts.map((p, i) => (
                      <VideoCard key={p.id} post={p} rank={i + 1} />
                    ))}
                  </div>
                  {isLongRange && filteredPosts.length > 10 && (
                    <button
                      onClick={() => setShowAllVideos(!showAllVideos)}
                      className="press lift mt-2 w-full rounded-xl border border-charcoal-600 bg-charcoal-800 py-3 text-sm font-semibold text-lime hover:border-lime/40"
                    >
                      {collapsed
                        ? `Show all ${filteredPosts.length} videos`
                        : "Show top 10 only"}
                    </button>
                  )}
                </>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <WhatsWorking posts={filteredPosts} />
              <HashtagLeaderboard posts={filteredPosts} />
            </aside>
          </div>

          <BestPostingTimes posts={filteredPosts} />

          {/* Comments Hub - one account at a time, with reel thumbnails */}
          {data && data.accounts.length > 0 && (() => {
            const account =
              data.accounts.find((a) => a.account_id === commentsAccountId) ?? data.accounts[0];
            const postsWithComments = account.recent_posts
              .filter((p) => (p.comments ?? 0) > 0)
              .sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0))
              .slice(0, 8);
            return (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h2 className="font-heading text-lg font-semibold text-ink">Comments Hub</h2>
                  <p className="text-[10px] font-medium text-ink-faint">Click &ldquo;Reply on Instagram&rdquo; to open the post and respond</p>
                </div>

                <div className="flex flex-wrap gap-2">
                  {data.accounts.map((a) => {
                    const on = a.account_id === account.account_id;
                    return (
                      <button
                        key={a.account_id}
                        onClick={() => setCommentsAccountId(a.account_id)}
                        className={`press flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-xs font-semibold transition-studio duration-studio ease-studio-out ${
                          on
                            ? "border-lime bg-lime text-white"
                            : "border-charcoal-600 bg-charcoal-800 text-ink-muted hover:border-lime/50 hover:text-ink"
                        }`}
                      >
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold uppercase ${
                            on ? "bg-white/20 text-white" : "bg-lime/10 text-lime"
                          }`}
                        >
                          {a.username.slice(0, 2)}
                        </span>
                        @{a.username}
                      </button>
                    );
                  })}
                </div>

                <div className="rounded-2xl border border-charcoal-700 bg-charcoal-800 p-4 shadow-card">
                  {postsWithComments.length === 0 ? (
                    <p className="py-6 text-center text-sm text-ink-muted">
                      No comments yet on @{account.username}&apos;s recent posts.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {postsWithComments.map((post) => (
                        <div key={post.id} className="flex items-center gap-3 rounded-xl border border-charcoal-700 bg-charcoal px-3 py-2.5 transition-colors duration-150 hover:border-lime/30">
                          <div className="h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-charcoal-700">
                            {post.thumbnail_url && (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={post.thumbnail_url}
                                alt=""
                                className="h-full w-full object-cover"
                                referrerPolicy="no-referrer"
                                loading="lazy"
                              />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-sm font-medium text-ink">
                              {post.caption?.replace(/#\w+/g, "").trim() || "(no caption)"}
                            </p>
                            <div className="mt-1 flex gap-3 text-xs font-medium text-ink-muted">
                              <span className="font-semibold text-lime">{(post.comments ?? 0).toLocaleString()} comments</span>
                              {post.likes != null && <span>{post.likes.toLocaleString()} likes</span>}
                              {post.timestamp && (
                                <span>{new Date(post.timestamp).toLocaleDateString()}</span>
                              )}
                            </div>
                          </div>
                          {post.permalink && (
                            <a
                              href={post.permalink}
                              target="_blank"
                              rel="noreferrer"
                              className="press shrink-0 rounded-lg border border-lime/40 bg-lime/5 px-2.5 py-1 text-[10px] font-semibold text-lime hover:bg-lime/10"
                            >
                              Reply on Instagram ↗
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <p className="text-[10px] font-medium text-ink-faint">
                  Pick an account above to see its posts with comments. Instagram requires replying
                  natively in the app or via the Meta Business Suite.
                </p>
              </div>
            );
          })()}

          <div className="grid gap-6 lg:grid-cols-2">
            <HookPatterns posts={filteredPosts} />
            <FormatBreakdown posts={filteredPosts} />
          </div>

          {data && (
            <p className="text-[11px] font-medium text-ink-faint">
              Last updated {new Date(data.generated_at).toLocaleTimeString()} ·{" "}
              {filteredPosts.length} posts in view · {selectedAccountIds.length} of{" "}
              {data.accounts.length} account(s) selected
            </p>
          )}
        </div>
      )}
    </div>
  );
}
