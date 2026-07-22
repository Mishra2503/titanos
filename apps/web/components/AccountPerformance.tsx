"use client";

import { useMemo, useState } from "react";
import { BarChart, type Bar } from "@/components/Charts";
import type { AccountInsights } from "@/lib/api";

// Per-account performance bars: compare all accounts on one metric, or open
// one account and see all of its metrics side by side.

type MetricKey = "reach" | "views" | "likes" | "comments" | "shares" | "saves";

const METRICS: { key: MetricKey; label: string }[] = [
  { key: "reach", label: "Reach" },
  { key: "views", label: "Views" },
  { key: "likes", label: "Likes" },
  { key: "comments", label: "Comments" },
  { key: "shares", label: "Shares" },
  { key: "saves", label: "Saves" },
];

const ACCOUNT_COLORS = ["#7c3aed", "#a78bfa", "#5b21b6", "#c4b5fd", "#8b5cf6", "#6d28d9"];

function sumMetric(a: AccountInsights, key: MetricKey, sinceMs: number): number {
  return a.recent_posts
    .filter((p) => !p.timestamp || new Date(p.timestamp).getTime() >= sinceMs)
    .reduce((s, p) => {
      const v =
        key === "reach" ? p.reach
        : key === "views" ? p.views
        : key === "likes" ? p.likes
        : key === "comments" ? p.comments
        : key === "shares" ? p.shares
        : p.saved;
      return s + (v ?? 0);
    }, 0);
}

export function AccountPerformance({ accounts, sinceMs }: { accounts: AccountInsights[]; sinceMs: number }) {
  const [selected, setSelected] = useState<string>("all");
  const [metric, setMetric] = useState<MetricKey>("reach");

  const bars: Bar[] = useMemo(() => {
    if (selected === "all") {
      return accounts.map((a, i) => ({
        label: `@${a.username}`,
        value: sumMetric(a, metric, sinceMs),
        color: ACCOUNT_COLORS[i % ACCOUNT_COLORS.length],
      }));
    }
    const a = accounts.find((x) => x.account_id === selected);
    if (!a) return [];
    return METRICS.map((m, i) => ({
      label: m.label,
      value: sumMetric(a, m.key, sinceMs),
      color: i === 0 ? "#7c3aed" : "#a78bfa",
    }));
  }, [accounts, selected, metric, sinceMs]);

  if (accounts.length === 0) return null;

  return (
    <div className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-ink">Account performance</h3>
          <p className="mt-0.5 text-xs text-ink-faint">
            {selected === "all"
              ? `Total ${METRICS.find((m) => m.key === metric)?.label.toLowerCase()} per account in the selected range`
              : "All metrics for this account in the selected range"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setSelected("all")}
              className={`press rounded-full border px-3 py-1 text-xs font-medium ${
                selected === "all" ? "border-lime bg-lime/10 text-lime" : "border-charcoal-600 text-ink-muted hover:text-ink"
              }`}
            >
              All accounts
            </button>
            {accounts.map((a) => (
              <button
                key={a.account_id}
                onClick={() => setSelected(a.account_id)}
                className={`press rounded-full border px-3 py-1 text-xs font-medium ${
                  selected === a.account_id ? "border-lime bg-lime/10 text-lime" : "border-charcoal-600 text-ink-muted hover:text-ink"
                }`}
              >
                @{a.username}
              </button>
            ))}
          </div>
        </div>
      </div>

      {selected === "all" && (
        <div className="mb-5 flex flex-wrap gap-1">
          {METRICS.map((m) => (
            <button
              key={m.key}
              onClick={() => setMetric(m.key)}
              className={`press rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider ${
                metric === m.key ? "border-lime bg-lime/10 text-lime" : "border-charcoal-600 text-ink-faint hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}

      {bars.every((b) => b.value === 0) ? (
        <p className="rounded-lg border border-dashed border-charcoal-600 px-4 py-8 text-center text-sm text-ink-muted">
          No data in this range yet - metrics appear as posts accumulate.
        </p>
      ) : (
        <BarChart bars={bars} height={170} />
      )}
    </div>
  );
}
