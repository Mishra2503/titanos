"use client";

import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { VideoCard, WhatsWorking } from "@/components/VideoPerformance";
import {
  ApiError,
  getInsightsSummary,
  type InsightsSummary,
  type Kpi,
  type RecentPost,
} from "@/lib/api";

function formatValue(k: Kpi): string {
  if (!k.available || k.value === null) return "—";
  const v = k.unit === "%" ? k.value.toLocaleString() : Math.round(k.value).toLocaleString();
  return `${v}${k.unit ?? ""}`;
}

export default function DashboardPage() {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInsightsSummary()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load insights"))
      .finally(() => setLoading(false));
  }, []);

  // All posts across every connected account, ranked best-first by reach.
  const posts: RecentPost[] = useMemo(() => {
    const all = (data?.accounts ?? []).flatMap((a) => a.recent_posts);
    return [...all].sort((x, y) => (y.reach ?? 0) - (x.reach ?? 0));
  }, [data]);

  const hasAccounts = (data?.accounts.length ?? 0) > 0;

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Cross-account performance and per-video analytics." />

      {error && <p className="mb-4 font-mono text-sm text-red-400">{error}</p>}

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {(data?.kpis ?? []).map((k, i) => (
          <div
            key={k.key}
            className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-5"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">{k.label}</p>
            <p className="mt-3 font-mono text-3xl text-ink">{loading ? "…" : formatValue(k)}</p>
            <p className="mt-1 text-xs text-ink-faint">
              {k.available ? k.note ?? "Live from Instagram" : k.note ?? "Unavailable"}
            </p>
          </div>
        ))}
      </div>

      {loading && (
        <p className="mt-8 font-mono text-sm text-ink-faint">Loading live video analytics…</p>
      )}

      {!loading && !hasAccounts && (
        <div className="mt-8 animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-8 text-center">
          <p className="text-sm text-ink-muted">
            Connect an Instagram Business/Creator account to see live insights.
          </p>
        </div>
      )}

      {hasAccounts && (
        <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_320px]">
          <div>
            <h2 className="mb-4 text-lg text-ink">Video performance</h2>
            <div className="grid gap-4 xl:grid-cols-2">
              {posts.map((p, i) => (
                <VideoCard key={p.id} post={p} rank={i + 1} />
              ))}
            </div>
          </div>
          <aside className="space-y-4 lg:sticky lg:top-8 lg:self-start">
            <WhatsWorking posts={posts} />
            {data && (
              <p className="font-mono text-[11px] text-ink-faint">
                Last updated {new Date(data.generated_at).toLocaleTimeString()} ·{" "}
                {posts.length} posts analyzed · {data.accounts.length} account(s)
              </p>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
