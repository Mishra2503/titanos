"use client";

// Lightweight SVG charts — no external library, fully theme-controlled.
// Light-theme redesign: white bg, E8E8FF gridlines, blue-violet fills.

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

export function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(Math.round(n));
}

function dateLabel(t: number): string {
  return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ===== Trend Chart ====================================================

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
      {/* Legend + peak label */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-4">
          {drawn.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5 text-[11px] font-medium text-ink-faint">
              <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
              {s.name}
            </span>
          ))}
        </div>
        <span className="text-[11px] text-ink-faint">
          peak {compact(vmax)}{valueLabel ? ` ${valueLabel}` : ""}
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
        {/* Light gridlines */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line
            key={f}
            x1={0} x2={W}
            y1={H * f} y2={H * f}
            stroke="#E8E8FF"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {/* Gradient defs for area fills */}
        <defs>
          {drawn.map((s, i) => (
            <linearGradient key={i} id={`area-grad-${i}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.color} stopOpacity="0.18" />
              <stop offset="100%" stopColor={s.color} stopOpacity="0.01" />
            </linearGradient>
          ))}
        </defs>

        {drawn.map((s, i) => {
          const pts = s.points.map((p) => `${x(p.t)},${y(p.v)}`).join(" L ");
          const line = `M ${pts}`;
          const area = `${line} L ${x(s.points[s.points.length - 1].t)},${H - PAD} L ${x(s.points[0].t)},${H - PAD} Z`;
          return (
            <g key={s.name}>
              <path d={area} fill={`url(#area-grad-${i})`} />
              <path
                d={line}
                fill="none"
                stroke={s.color}
                strokeWidth={2.5}
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

      <div className="mt-1.5 flex justify-between text-[11px] text-ink-faint">
        <span>{dateLabel(t0)}</span>
        <span>{dateLabel(t1)}</span>
      </div>
    </div>
  );
}

// ===== Bar Chart ======================================================

export interface Bar {
  label: string;
  value: number;
  color?: string;
}

export function BarChart({ bars, height = 180 }: { bars: Bar[]; height?: number }) {
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.value), 1);
  return (
    <div className="flex items-end gap-2" style={{ height: height + 44 }}>
      {bars.map((b, i) => {
        const ratio = b.value / max;
        const barColor = b.color ?? "#5047EB";
        return (
          <div key={b.label} className="flex min-w-0 flex-1 flex-col items-center justify-end">
            <p className="mb-1.5 text-xs font-semibold text-ink">{compact(b.value)}</p>
            <div className="flex w-full items-end justify-center" style={{ height }}>
              <div
                className="chart-bar w-full max-w-[56px] rounded-t-xl"
                style={{
                  height: `${Math.max(4, ratio * 100)}%`,
                  backgroundColor: barColor,
                  opacity: ratio < 0.3 ? 0.45 + ratio * 1.8 : 1,
                  animationDelay: `${i * 60}ms`,
                }}
              />
            </div>
            <p className="mt-2 w-full truncate text-center text-[10px] font-medium uppercase tracking-wide text-ink-faint" title={b.label}>
              {b.label}
            </p>
          </div>
        );
      })}
    </div>
  );
}

// ===== Donut Chart ====================================================

export interface DonutSlice {
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  slices,
  size = 160,
  label,
  sublabel,
}: {
  slices: DonutSlice[];
  size?: number;
  label?: string;
  sublabel?: string;
}) {
  const total = slices.reduce((a, s) => a + s.value, 0);
  if (total === 0) return null;

  const cx = size / 2;
  const cy = size / 2;
  const r = size * 0.38;
  const stroke = size * 0.13;

  let cumAngle = -90; // start from top
  const arcs = slices.map((s) => {
    const angle = (s.value / total) * 360;
    const startAngle = cumAngle;
    cumAngle += angle;
    return { ...s, startAngle, angle };
  });

  function polarToXY(angleDeg: number, radius: number) {
    const rad = (angleDeg * Math.PI) / 180;
    return {
      x: cx + radius * Math.cos(rad),
      y: cy + radius * Math.sin(rad),
    };
  }

  function arcPath(startAngle: number, angle: number) {
    const capped = Math.min(angle, 359.99);
    const start = polarToXY(startAngle, r);
    const end = polarToXY(startAngle + capped, r);
    const largeArc = capped > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  }

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
          {/* Track */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke="#E8E8FF" strokeWidth={stroke} />
          {/* Segments */}
          {arcs.map((arc, i) => (
            <path
              key={i}
              d={arcPath(arc.startAngle, arc.angle)}
              fill="none"
              stroke={arc.color}
              strokeWidth={stroke}
              strokeLinecap="round"
              style={{ filter: `drop-shadow(0 2px 4px ${arc.color}40)` }}
            />
          ))}
        </svg>
        {/* Center label */}
        {(label || sublabel) && (
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            {label && <span className="text-lg font-bold text-ink leading-tight">{label}</span>}
            {sublabel && <span className="text-[10px] text-ink-faint mt-0.5">{sublabel}</span>}
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="mt-4 flex flex-wrap justify-center gap-x-4 gap-y-1.5">
        {slices.map((s) => (
          <span key={s.label} className="flex items-center gap-1.5 text-[11px] text-ink-muted">
            <span className="h-2 w-2 rounded-full flex-shrink-0" style={{ backgroundColor: s.color }} />
            {s.label}
            <span className="font-semibold text-ink">{Math.round((s.value / total) * 100)}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}
