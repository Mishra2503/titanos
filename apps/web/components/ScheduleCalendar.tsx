"use client";

import { useMemo, useState } from "react";
import type { InsightsSummary, RecentPost, ScheduleListItem, ScheduledPostStatus } from "@/lib/api";

// ===== entry shape (unified scheduled + already-published) =================

interface CalEntry {
  id: string;
  at: Date;
  username: string;
  caption: string;
  status: ScheduledPostStatus | "POSTED";
  reach: number | null;
  engagement_rate: number | null;
  permalink: string | null;
  source: "scheduled" | "posted";
}

const STATUS_DOT: Record<CalEntry["status"], string> = {
  SCHEDULED: "bg-sky-400",
  PROCESSING: "bg-amber-400",
  PUBLISHED: "bg-lime",
  POSTED: "bg-lime/70", // posted directly to IG, not via Titan OS
  FAILED: "bg-red-400",
  CANCELED: "bg-charcoal-600",
};

// ===== helpers =============================================================

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addMonths(d: Date, n: number): Date {
  return new Date(d.getFullYear(), d.getMonth() + n, 1);
}

function buildMonthGrid(cursor: Date): Date[] {
  const first = startOfMonth(cursor);
  // Week starts on Monday for a creator's typical rhythm.
  const dayOfWeekMon0 = (first.getDay() + 6) % 7;
  const start = new Date(first);
  start.setDate(first.getDate() - dayOfWeekMon0);
  const days: Date[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    days.push(d);
  }
  return days;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function fmtHM(d: Date): string {
  return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function mergeEntries(
  schedule: ScheduleListItem[],
  insights: InsightsSummary | null,
): CalEntry[] {
  const byMediaId = new Map<string, RecentPost & { username: string }>();
  insights?.accounts.forEach((a) =>
    a.recent_posts.forEach((p) => byMediaId.set(p.id, { ...p, username: a.username })),
  );

  const fromSchedule: CalEntry[] = schedule.map((p) => {
    const matched = byMediaId.get(""); // placeholder - we'd need published_media_id on the list item to match exactly
    return {
      id: `s:${p.id}`,
      at: new Date(p.scheduled_at),
      username: p.ig_username,
      caption: p.caption,
      status: p.status,
      reach: matched?.reach ?? null,
      engagement_rate: matched?.engagement_rate ?? null,
      permalink: p.permalink,
      source: "scheduled",
    };
  });

  // Posted-direct-to-IG entries: every insights post that wasn't scheduled by us.
  const scheduledLinks = new Set(
    schedule.filter((s) => s.permalink).map((s) => s.permalink as string),
  );
  const fromPosted: CalEntry[] = [];
  insights?.accounts.forEach((a) =>
    a.recent_posts.forEach((p) => {
      if (!p.timestamp) return;
      if (p.permalink && scheduledLinks.has(p.permalink)) return; // already covered
      fromPosted.push({
        id: `p:${p.id}`,
        at: new Date(p.timestamp),
        username: a.username,
        caption: p.caption ?? "(no caption)",
        status: "POSTED",
        reach: p.reach ?? null,
        engagement_rate: p.engagement_rate,
        permalink: p.permalink,
        source: "posted",
      });
    }),
  );

  return [...fromSchedule, ...fromPosted].sort((a, b) => a.at.getTime() - b.at.getTime());
}

interface HourStat {
  hour: number;
  avgReach: number;
  count: number;
}

function bestPostingHour(entries: CalEntry[]): HourStat | null {
  const buckets: Record<number, number[]> = {};
  entries.forEach((e) => {
    if (e.reach && e.reach > 0) {
      const h = e.at.getHours();
      (buckets[h] ??= []).push(e.reach);
    }
  });
  const stats: HourStat[] = Object.entries(buckets).map(([h, arr]) => ({
    hour: Number(h),
    avgReach: Math.round(arr.reduce((a, b) => a + b, 0) / arr.length),
    count: arr.length,
  }));
  if (stats.length < 2) return null;
  return stats.sort((a, b) => b.avgReach - a.avgReach)[0];
}

function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

// ===== component ===========================================================

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function ScheduleCalendar({
  schedule,
  insights,
}: {
  schedule: ScheduleListItem[];
  insights: InsightsSummary | null;
}) {
  const [cursor, setCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState<Date | null>(null);

  const entries = useMemo(() => mergeEntries(schedule, insights), [schedule, insights]);
  const today = new Date();
  const days = buildMonthGrid(cursor);

  const byDay = useMemo(() => {
    const m = new Map<string, CalEntry[]>();
    entries.forEach((e) => {
      const key = e.at.toDateString();
      m.set(key, [...(m.get(key) ?? []), e]);
    });
    return m;
  }, [entries]);

  const best = useMemo(() => bestPostingHour(entries), [entries]);
  const selectedEntries = selectedDate ? byDay.get(selectedDate.toDateString()) ?? [] : [];

  const monthLabel = cursor.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  return (
    <div className="space-y-4">
      {/* Header + best-time insight */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCursor(addMonths(cursor, -1))}
            className="press rounded-md border border-charcoal-600 px-2 py-1 text-sm text-ink-muted hover:text-ink"
          >
            ←
          </button>
          <h3 className="text-lg text-ink">{monthLabel}</h3>
          <button
            onClick={() => setCursor(addMonths(cursor, 1))}
            className="press rounded-md border border-charcoal-600 px-2 py-1 text-sm text-ink-muted hover:text-ink"
          >
            →
          </button>
          <button
            onClick={() => setCursor(startOfMonth(new Date()))}
            className="press ml-1 rounded-md border border-charcoal-600 px-2 py-1 font-mono text-xs text-ink-muted hover:text-ink"
          >
            Today
          </button>
        </div>
        {best && (
          <div className="rounded-lg border border-lime/30 bg-lime/[0.05] px-3 py-1.5 text-xs">
            <span className="font-mono text-[10px] uppercase tracking-wider text-lime">
              Best time so far
            </span>
            <span className="ml-2 text-ink">
              Posts around <strong className="text-lime">{hourLabel(best.hour)}</strong> average{" "}
              <strong className="text-lime">{best.avgReach.toLocaleString()}</strong> reach
            </span>
          </div>
        )}
      </div>

      {/* Weekday header */}
      <div className="grid grid-cols-7 gap-1 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
        {WEEKDAYS.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Day grid */}
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const inMonth = d.getMonth() === cursor.getMonth();
          const isToday = sameDay(d, today);
          const items = byDay.get(d.toDateString()) ?? [];
          const max = 3;
          return (
            <button
              key={d.toISOString()}
              onClick={() => setSelectedDate(d)}
              className={`press flex min-h-[110px] flex-col gap-1 rounded-lg border p-2 text-left transition-studio duration-studio ease-studio-out ${
                isToday
                  ? "border-lime/60 bg-lime/[0.04]"
                  : inMonth
                    ? "border-charcoal-700 bg-charcoal-800 hover:border-charcoal-600"
                    : "border-charcoal-700/40 bg-charcoal-800/40"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span
                  className={`font-mono text-xs ${
                    isToday
                      ? "text-lime"
                      : inMonth
                        ? "text-ink"
                        : "text-ink-faint"
                  }`}
                >
                  {d.getDate()}
                </span>
                {items.length > 0 && (
                  <span className="font-mono text-[9px] text-ink-faint">{items.length}</span>
                )}
              </div>
              {items.slice(0, max).map((e) => (
                <div
                  key={e.id}
                  className="flex items-center gap-1.5 truncate rounded bg-charcoal-700/40 px-1.5 py-0.5"
                >
                  <span className={`h-1.5 w-1.5 flex-shrink-0 rounded-full ${STATUS_DOT[e.status]}`} />
                  <span className="truncate font-mono text-[9px] text-ink-muted">
                    {fmtHM(e.at)} · @{e.username}
                  </span>
                </div>
              ))}
              {items.length > max && (
                <span className="font-mono text-[9px] text-ink-faint">
                  +{items.length - max} more
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Day detail drawer */}
      {selectedDate && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setSelectedDate(null)}
        >
          <div
            className="w-full max-w-xl animate-reveal rounded-2xl border border-charcoal-600 bg-charcoal-800 p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-baseline justify-between">
              <h3 className="text-lg text-ink">
                {selectedDate.toLocaleDateString(undefined, {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </h3>
              <button
                onClick={() => setSelectedDate(null)}
                className="press text-xl text-ink-faint hover:text-ink"
              >
                ×
              </button>
            </div>
            {selectedEntries.length === 0 ? (
              <p className="mt-4 text-sm text-ink-muted">No posts on this day.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {selectedEntries.map((e) => (
                  <li
                    key={e.id}
                    className="rounded-lg border border-charcoal-700 bg-charcoal-700/40 p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-ink">
                        {fmtHM(e.at)} · @{e.username}
                      </span>
                      <span className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-muted">
                        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_DOT[e.status]}`} />
                        {e.status.toLowerCase()}
                      </span>
                    </div>
                    <p className="mt-1.5 line-clamp-2 text-sm text-ink-muted">{e.caption}</p>
                    {(e.reach !== null || e.engagement_rate !== null) && (
                      <p className="mt-1 font-mono text-[11px] text-ink-faint">
                        {e.reach !== null && (
                          <>
                            reach <span className="text-lime">{e.reach.toLocaleString()}</span>
                            {"  ·  "}
                          </>
                        )}
                        {e.engagement_rate !== null && (
                          <>
                            engagement{" "}
                            <span className="text-lime">{e.engagement_rate}%</span>
                          </>
                        )}
                      </p>
                    )}
                    {e.permalink && (
                      <a
                        href={e.permalink}
                        target="_blank"
                        rel="noreferrer"
                        className="press mt-2 inline-block rounded-md border border-charcoal-600 px-2 py-1 font-mono text-[10px] text-lime hover:bg-lime/5"
                      >
                        View on Instagram ↗
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
