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
import { TrendChart, type TrendSeries } from "@/components/Charts";
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

  useEffect(() => {
    getInsightsSummary()
      .then((d) => {
        setData(d);
        setSelectedAccountIds(d.accounts.map((a) => a.account_id));
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

  const trendSeries: TrendSeries[] = useMemo(() => {
    const dated = filteredPosts.filter((p) => p.timestamp);
    return [
      {
        name: "Reach",
        color: "#7c3aed",
        points: dated
          .filter((p) => p.reach != null)
          .map((p) => ({ t: new Date(p.timestamp!).getTime(), v: p.reach! })),
      },
      {
        name: "Views",
        color: "#c4b5fd",
        points: dated
          .filter((p) => p.views != null)
          .map((p) => ({ t: new Date(p.timestamp!).getTime(), v: p.views! })),
      },
    ];
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
        subtitle="Cross-account performance and per-video analytics — built to inform tomorrow's content."
      />

      {error && <p className="mb-4 font-mono text-sm text-red-400">{error}</p>}

      {hasAccounts && data && (
        <DashboardFilters
          accounts={data.accounts}
          selectedAccountIds={selectedAccountIds}
          onAccountsChange={setSelectedAccountIds}
          range={range}
          onRangeChange={setRange}
        />
      )}

      {loading && (
        <p className="font-mono text-sm text-ink-faint">Loading live video analytics…</p>
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
              <p className="font-mono text-xs text-amber-300">
                @{a.username}: {a.error}
              </p>
              <p className="mt-1 font-mono text-[10px] text-ink-faint">
                Metrics for this account are unavailable — try reconnecting it on the Connect Instagram page.
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
            <div className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
              <div className="mb-4">
                <h3 className="text-base font-semibold text-ink">Performance trend</h3>
                <p className="mt-0.5 text-xs text-ink-faint">
                  Reach and views per post across the selected range
                </p>
              </div>
              <TrendChart series={trendSeries} height={200} />
            </div>
          )}

          <ContentBrief posts={filteredPosts} />

          <StrategyPanel posts={filteredPosts} />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg text-ink">Video performance</h2>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">Sort by</span>
                  <div className="flex flex-wrap gap-1">
                    {SORT_OPTIONS.map((opt) => (
                      <button
                        key={opt.key}
                        onClick={() => setSortBy(opt.key)}
                        className={`press rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition-studio duration-studio ease-studio-out ${
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
                <div className="grid gap-4 xl:grid-cols-2">
                  {filteredPosts.map((p, i) => (
                    <VideoCard key={p.id} post={p} rank={i + 1} />
                  ))}
                </div>
              )}
            </div>

            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <WhatsWorking posts={filteredPosts} />
              <HashtagLeaderboard posts={filteredPosts} />
            </aside>
          </div>

          <BestPostingTimes posts={filteredPosts} />

          {/* Comments Hub */}
          {data && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg text-ink">Comments Hub</h2>
                <p className="font-mono text-[10px] text-ink-faint">Click &ldquo;Reply on Instagram&rdquo; to open the post and respond</p>
              </div>
              {data.accounts
                .filter((a) => selectedAccountIds.includes(a.account_id))
                .map((account) => {
                  const postsWithComments = account.recent_posts
                    .filter((p) => (p.comments ?? 0) > 0)
                    .sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0))
                    .slice(0, 6);
                  if (postsWithComments.length === 0) return null;
                  return (
                    <div key={account.account_id} className="rounded-xl border border-charcoal-700 bg-charcoal-800 p-4">
                      <p className="mb-3 font-mono text-xs font-semibold text-lime">@{account.username}</p>
                      <div className="space-y-2">
                        {postsWithComments.map((post) => (
                          <div key={post.id} className="flex items-center justify-between gap-4 rounded-lg border border-charcoal-700 bg-charcoal px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-medium text-ink">
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
                                className="press shrink-0 rounded-md border border-lime/40 bg-lime/5 px-2.5 py-1 font-mono text-[10px] text-lime hover:bg-lime/10"
                              >
                                Reply on Instagram ↗
                              </a>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              <p className="font-mono text-[10px] text-ink-faint">
                Showing posts with comments — use the account filter above to focus on a specific account.
                Instagram requires replying natively in the app or via the Meta Business Suite.
              </p>
            </div>
          )}

          <div className="grid gap-6 lg:grid-cols-2">
            <HookPatterns posts={filteredPosts} />
            <FormatBreakdown posts={filteredPosts} />
          </div>

          {data && (
            <p className="font-mono text-[11px] text-ink-faint">
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
