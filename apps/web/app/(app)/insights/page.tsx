"use client";

import { useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  getInsightsSummary,
  type AccountInsights,
  type InsightsSummary,
} from "@/lib/api";

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-1 font-mono text-lg text-ink">
        {value === null || value === undefined ? "—" : value.toLocaleString()}
      </p>
    </div>
  );
}

function AccountCard({ a }: { a: AccountInsights }) {
  return (
    <div className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg text-ink">@{a.username}</h2>
        <span className="font-mono text-xs text-ink-faint">
          {a.followers?.toLocaleString() ?? "—"} followers
        </span>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-4 md:grid-cols-6">
        <Stat label="Reach (posts)" value={a.reach} />
        <Stat label="Eng. rate" value={a.engagement_rate === null ? null : `${a.engagement_rate}%`} />
        <Stat label="Saves" value={a.saves} />
        <Stat label="Shares" value={a.shares} />
        <Stat label="Likes" value={a.likes} />
        <Stat label="Comments" value={a.comments} />
      </div>

      {a.recent_posts.length > 0 && (
        <div className="mt-6">
          <p className="mb-2 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            Recent posts ({a.posts_analyzed} analyzed)
          </p>
          <div className="overflow-hidden rounded-lg border border-charcoal-700">
            <table className="w-full text-left text-sm">
              <thead className="bg-charcoal-700 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                <tr>
                  <th className="px-3 py-2 font-normal">Post</th>
                  <th className="px-3 py-2 text-right font-normal">Reach</th>
                  <th className="px-3 py-2 text-right font-normal">Likes</th>
                  <th className="px-3 py-2 text-right font-normal">Comments</th>
                  <th className="px-3 py-2 text-right font-normal">Shares</th>
                  <th className="px-3 py-2 text-right font-normal">Saves</th>
                </tr>
              </thead>
              <tbody>
                {a.recent_posts.slice(0, 10).map((p) => (
                  <tr key={p.id} className="border-t border-charcoal-700">
                    <td className="max-w-[260px] px-3 py-2">
                      <a
                        href={p.permalink ?? "#"}
                        target="_blank"
                        rel="noreferrer"
                        className="block truncate text-ink-muted hover:text-lime"
                      >
                        {p.caption ?? p.media_product_type ?? "Post"}
                      </a>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.reach ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.likes ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.comments ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.shares ?? "—"}</td>
                    <td className="px-3 py-2 text-right font-mono text-ink-muted">{p.saved ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

export default function InsightsPage() {
  const [data, setData] = useState<InsightsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getInsightsSummary()
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err.message : "Failed to load insights"))
      .finally(() => setLoading(false));
  }, []);

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

      <div className="space-y-6">
        {data?.accounts.map((a) => (
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
