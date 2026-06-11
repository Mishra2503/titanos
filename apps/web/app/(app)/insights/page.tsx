"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  getInsightsSummary,
  type AccountInsights,
  type InsightsSummary,
  type RecentPost,
} from "@/lib/api";
import { TrendChart } from "@/components/Charts";
import { AccountChips } from "@/components/AccountChips";

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 text-xl font-bold tracking-tight text-ink">
        {value === null || value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}

function hookOf(p: RecentPost): string {
  const c = (p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
  return c.length > 80 ? c.slice(0, 80) + "…" : c || "(no caption)";
}

function PostTable({ posts }: { posts: RecentPost[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-charcoal-700">
      <table className="w-full text-left text-sm">
        <thead className="bg-charcoal-700 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
          <tr>
            <th className="px-3 py-2 font-normal">Post</th>
            <th className="px-3 py-2 text-right font-normal">Reach</th>
            <th className="px-3 py-2 text-right font-normal">Views</th>
            <th className="px-3 py-2 text-right font-normal">Likes</th>
            <th className="px-3 py-2 text-right font-normal">Comments</th>
            <th className="px-3 py-2 text-right font-normal">Shares</th>
            <th className="px-3 py-2 text-right font-normal">Saves</th>
            <th className="px-3 py-2 text-right font-normal">ER</th>
            <th className="px-3 py-2 text-right font-normal">Watch</th>
            <th className="px-3 py-2 text-right font-normal">Posted</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((p) => (
            <tr key={p.id} className="border-t border-charcoal-700 transition-colors duration-150 hover:bg-charcoal">
              <td className="max-w-[260px] px-3 py-2">
                <a
                  href={p.permalink ?? "#"}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-ink-muted hover:text-lime"
                  title={p.caption ?? undefined}
                >
                  {hookOf(p)}
                </a>
                <span className="font-mono text-[9px] uppercase text-ink-faint">
                  {p.media_product_type ?? "post"}
                </span>
              </td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.reach?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.views?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.likes?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.comments?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.shares?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.saved?.toLocaleString() ?? "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.engagement_rate != null ? `${p.engagement_rate}%` : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.avg_watch_time_sec != null ? `${p.avg_watch_time_sec}s` : "—"}</td>
              <td className="px-3 py-2 text-right font-mono text-ink-faint whitespace-nowrap">
                {p.timestamp ? new Date(p.timestamp).toLocaleDateString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function AccountCard({ a }: { a: AccountInsights }) {
  const [expanded, setExpanded] = useState(false);
  const shown = expanded ? a.recent_posts : a.recent_posts.slice(0, 10);
  const topPost = a.recent_posts[0] ?? null;

  return (
    <div className="lift animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-ink">@{a.username}</h2>
        <span className="font-mono text-xs text-ink-faint">
          {a.followers?.toLocaleString() ?? "—"} followers
          {a.profile_views != null && ` · ${a.profile_views.toLocaleString()} profile views (28d)`}
        </span>
      </div>

      {a.error && (
        <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 px-3 py-2">
          <p className="font-mono text-xs text-amber-300">{a.error}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">
            If this persists, reconnect the account on the Connect Instagram page.
          </p>
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 gap-4 md:grid-cols-7">
        <Stat label="Reach (posts)" value={a.reach} />
        <Stat label="Views" value={a.views ?? null} />
        <Stat label="Eng. rate" value={a.engagement_rate === null ? null : `${a.engagement_rate}%`} />
        <Stat label="Saves" value={a.saves} />
        <Stat label="Shares" value={a.shares} />
        <Stat label="Likes" value={a.likes} />
        <Stat label="Comments" value={a.comments} />
      </div>

      {a.recent_posts.filter((p) => p.timestamp && p.reach != null).length >= 2 && (
        <div className="mt-6 rounded-lg border border-charcoal-700 bg-charcoal/60 p-4">
          <TrendChart
            height={140}
            series={[
              {
                name: "Reach per post",
                color: "#7c3aed",
                points: a.recent_posts
                  .filter((p) => p.timestamp && p.reach != null)
                  .map((p) => ({ t: new Date(p.timestamp!).getTime(), v: p.reach! })),
              },
            ]}
          />
        </div>
      )}

      {topPost && (topPost.reach ?? 0) > 0 && (
        <div className="mt-5 rounded-lg border border-lime/30 bg-lime/[0.04] p-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-lime">Top performer</p>
          <p className="mt-1 text-sm text-ink">{hookOf(topPost)}</p>
          <p className="mt-1 font-mono text-[10px] text-ink-faint">
            {(topPost.reach ?? 0).toLocaleString()} reach
            {topPost.views != null && ` · ${topPost.views.toLocaleString()} views`}
            {topPost.engagement_rate != null && ` · ${topPost.engagement_rate}% er`}
            {topPost.avg_watch_time_sec != null && ` · ${topPost.avg_watch_time_sec}s avg watch`}
            {topPost.permalink && (
              <>
                {" · "}
                <a href={topPost.permalink} target="_blank" rel="noreferrer" className="text-lime hover:underline">
                  open ↗
                </a>
              </>
            )}
          </p>
        </div>
      )}

      {a.recent_posts.length > 0 && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              Posts ({a.posts_analyzed} analyzed, sorted by reach)
            </p>
            {a.recent_posts.length > 10 && (
              <button
                onClick={() => setExpanded(!expanded)}
                className="press font-mono text-[10px] uppercase tracking-wider text-lime hover:underline"
              >
                {expanded ? "Show top 10" : `Show all ${a.recent_posts.length}`}
              </button>
            )}
          </div>
          <PostTable posts={shown} />
        </div>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    getInsightsSummary()
      .then((d) => {
        setData(d);
        setSelectedIds(d.accounts.map((a) => a.account_id));
      })
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load insights"))
      .finally(() => setLoading(false));
  }, []);

  const visible = data?.accounts.filter((a) => selectedIds.includes(a.account_id)) ?? [];

  return (
    <div>
      <PageHeader title="Insights" subtitle="Honest per-account analytics from the Instagram Graph API." />

      {loading && <p className="font-mono text-sm text-ink-faint">Loading live insights…</p>}
      {error && <p className="font-mono text-sm text-red-400">{error}</p>}

      {!loading && data && data.accounts.length === 0 && (
        <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-12 text-center">
          <p className="text-sm text-ink-muted">Connect an account to see insights.</p>
        </div>
      )}

      {data && data.accounts.length > 0 && (
        <div className="mb-6 animate-reveal">
          <AccountChips
            accounts={data.accounts.map((a) => ({ account_id: a.account_id, username: a.username, followers: a.followers }))}
            selectedIds={selectedIds}
            onChange={setSelectedIds}
          />
        </div>
      )}

      <div className="space-y-6">
        {visible.map((a) => (
          <AccountCard key={a.account_id} a={a} />
        ))}
      </div>

      {data && data.accounts.length > 0 && (
        <p className="mt-6 font-mono text-[11px] text-ink-faint">
          Saves data may be unavailable on some posts depending on the API; shown values are
          directly reported by Instagram. Last updated{" "}
          {new Date(data.generated_at).toLocaleTimeString()}.
        </p>
      )}
    </div>
  );
}
