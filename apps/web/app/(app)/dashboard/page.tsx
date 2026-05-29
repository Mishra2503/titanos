"use client";

import { PageHeader } from "@/components/Placeholder";

// Priority KPIs in PRD order (FR-INS-4). No fabricated values (Rail #3):
// real numbers only appear once accounts are connected and insights sync.
const KPIS = [
  "Reach",
  "Engagement rate",
  "Saves",
  "Shares",
  "DM leads",
  "Calls booked",
];

export default function DashboardPage() {
  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Cross-account performance and lead funnel." />

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
        {KPIS.map((label, i) => (
          <div
            key={label}
            className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-5"
            style={{ animationDelay: `${i * 40}ms` }}
          >
            <p className="font-mono text-xs uppercase tracking-wider text-ink-faint">{label}</p>
            <p className="mt-3 font-mono text-3xl text-ink-muted">—</p>
            <p className="mt-1 text-xs text-ink-faint">No data yet</p>
          </div>
        ))}
      </div>

      <div className="mt-8 animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-8 text-center">
        <p className="text-sm text-ink-muted">
          Connect an Instagram Business/Creator account to see live insights.
        </p>
      </div>
    </div>
  );
}
