"use client";

// Lightweight SVG trend charts — no chart library, fully theme-controlled.
// Lines draw in on mount (pathLength trick); reduced-motion users get the
// final state instantly via the global media query.

export interface TrendPoint {
  t: number; // epoch ms
  v: number;
}

export interface TrendSeries {
  name: string;
  color: string;
  points: TrendPoint[];
}

const W = 600;
const H = 200;
const PAD = 6;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function dateLabel(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function TrendChart({
  series,
  height = 180,
  valueLabel,
}: {
  series: TrendSeries[];
  height?: number;
  valueLabel?: string;
}) {
  const drawn = series
    .map((s) => ({ ...s, points: [...s.points].sort((a, b) => a.t - b.t) }))
    .filter((s) => s.points.length >= 2);
  const all = drawn.flatMap((s) => s.points);
  if (all.length < 2) return null;

  const t0 = Math.min(...all.map((p) => p.t));
  const t1 = Math.max(...all.map((p) => p.t));
  const vmax = Math.max(...all.map((p) => p.v), 1);

  const x = (t: number) => (t1 === t0 ? W / 2 : PAD + ((t - t0) / (t1 - t0)) * (W - 2 * PAD));
  const y = (v: number) => H - PAD - (v / vmax) * (H - 2 * PAD);

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          {drawn.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
        <span className="font-mono text-[10px] text-ink-faint">
          peak {compact(vmax)}
          {valueLabel ? ` ${valueLabel}` : ""}
        </span>
      </div>

      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="w-full"
        style={{ height }}
        role="img"
        aria-label={`Trend chart: ${drawn.map((s) => s.name).join(", ")}`}
      >
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0}
            x2={W}
            y1={H * f}
            y2={H * f}
            stroke="#edebf5"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {drawn.map((s) => {
          const pts = s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(" L ");
          const line = `M ${pts}`;
          const area = `${line} L ${x(s.points[s.points.length - 1].t)},${H - PAD} L ${x(s.points[0].t)},${H - PAD} Z`;
          return (
            <g key={s.name}>
              <path d={area} fill={s.color} opacity={0.08} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2}
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
                pathLength={1}
                className="chart-line"
              />
            </g>
          );
        })}
      </svg>

      <div className="mt-1.5 flex justify-between font-mono text-[10px] text-ink-faint">
        <span>{dateLabel(t0)}</span>
        <span>{dateLabel(t1)}</span>
      </div>
    </div>
  );
}
