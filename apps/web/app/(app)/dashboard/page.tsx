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

export default function DashboardPage() {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<RangeKey>("28");
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

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
      .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0));
  }, [data, range, selectedAccountIds]);

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
        subtitle="Cross-account performance and per-video analytics — built to inform tomorrow’s content."
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
          <KpiTiles posts={filteredPosts} dmLeads={dmLeads} callsBooked={callsBooked} />

          <ContentBrief posts={filteredPosts} />

          <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
            <div className="space-y-3">
              <h2 className="text-lg text-ink">Video performance</h2>
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
