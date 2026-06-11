import type { RecentPost } from "@/lib/api";

// ===== shared helpers =================================================

export function sumOf(posts: RecentPost[], key: keyof RecentPost): number {
  return posts.reduce((acc, p) => acc + (typeof p[key] === "number" ? (p[key] as number) : 0), 0);
}

function postInteractions(p: RecentPost): number {
  return (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0) + (p.saved ?? 0);
}

export interface Kpis {
  reach: number;
  saves: number;
  shares: number;
  views: number;
  engagement: number | null;
  avg_watch_sec: number | null;
  posts: number;
}

export function aggregateKpis(posts: RecentPost[]): Kpis {
  const reach = sumOf(posts, "reach");
  const saves = sumOf(posts, "saved");
  const shares = sumOf(posts, "shares");
  const views = sumOf(posts, "views");
  const interactions = posts.reduce((a, p) => a + postInteractions(p), 0);
  const engagement = reach > 0 ? +((interactions / reach) * 100).toFixed(1) : null;
  const watchVals = posts.map((p) => p.avg_watch_time_sec).filter((v): v is number => v !== null);
  const avg_watch_sec =
    watchVals.length > 0
      ? +(watchVals.reduce((a, b) => a + b, 0) / watchVals.length).toFixed(1)
      : null;
  return { reach, saves, shares, views, engagement, avg_watch_sec, posts: posts.length };
}

/** Split the most-recent half vs the older half so we can compute period-over-period deltas. */
export function periodSplit(posts: RecentPost[]): { current: RecentPost[]; prior: RecentPost[] } {
  const sorted = [...posts]
    .filter((p) => p.timestamp)
    .sort((a, b) => (a.timestamp! < b.timestamp! ? 1 : -1));
  const mid = Math.floor(sorted.length / 2);
  return { current: sorted.slice(0, mid), prior: sorted.slice(mid) };
}

function pct(current: number, prior: number): number | null {
  if (prior === 0) return current === 0 ? null : null;
  return +(((current - prior) / prior) * 100).toFixed(0);
}

// ===== KPI tiles with delta ==========================================

interface Tile {
  key: string;
  label: string;
  value: string;
  delta: number | null;
  note: string;
  unavailable?: boolean;
}

function fmtNum(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n >= 1000 ? n.toLocaleString() : String(n);
}

export function KpiTiles({
  posts,
  dmLeads,
  callsBooked,
}: {
  posts: RecentPost[];
  dmLeads: { value: number | null; available: boolean; note: string };
  callsBooked: { value: number | null; available: boolean; note: string };
}) {
  const k = aggregateKpis(posts);
  const { current, prior } = periodSplit(posts);
  const enoughForDelta = current.length >= 4 && prior.length >= 4;
  const kc = enoughForDelta ? aggregateKpis(current) : null;
  const kp = enoughForDelta ? aggregateKpis(prior) : null;

  const tiles: Tile[] = [
    {
      key: "reach",
      label: "Reach",
      value: fmtNum(k.reach),
      delta: kc && kp ? pct(kc.reach, kp.reach) : null,
      note: `Across ${k.posts} post${k.posts === 1 ? "" : "s"}`,
    },
    {
      key: "engagement",
      label: "Engagement rate",
      value: k.engagement === null ? "—" : `${k.engagement}%`,
      delta:
        kc?.engagement !== null && kp?.engagement !== null && kc && kp
          ? pct(kc.engagement!, kp.engagement!)
          : null,
      note: "Interactions ÷ reach",
    },
    {
      key: "views",
      label: "Views",
      value: fmtNum(k.views),
      delta: kc && kp ? pct(kc.views, kp.views) : null,
      note: "Reels playback",
    },
    {
      key: "saves",
      label: "Saves",
      value: fmtNum(k.saves),
      delta: kc && kp ? pct(kc.saves, kp.saves) : null,
      note: "Signal of high intent",
    },
    {
      key: "shares",
      label: "Shares",
      value: fmtNum(k.shares),
      delta: kc && kp ? pct(kc.shares, kp.shares) : null,
      note: "Algorithmic boost",
    },
    {
      key: "watch",
      label: "Avg watch time",
      value: k.avg_watch_sec === null ? "—" : `${k.avg_watch_sec}s`,
      delta:
        kc?.avg_watch_sec !== null && kp?.avg_watch_sec !== null && kc && kp
          ? pct(kc.avg_watch_sec!, kp.avg_watch_sec!)
          : null,
      note: "Reels hook strength",
    },
    {
      key: "dm",
      label: "DM leads",
      value: dmLeads.value === null ? "—" : fmtNum(dmLeads.value),
      delta: null,
      note: dmLeads.note,
      unavailable: !dmLeads.available,
    },
    {
      key: "calls",
      label: "Calls booked",
      value: callsBooked.value === null ? "—" : fmtNum(callsBooked.value),
      delta: null,
      note: callsBooked.note,
      unavailable: !callsBooked.available,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {tiles.map((t, i) => (
        <div
          key={t.key}
          className="lift animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-4"
          style={{ animationDelay: `${i * 30}ms` }}
        >
          <div className="flex items-baseline justify-between">
            <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
              {t.label}
            </p>
            {t.delta !== null && (
              <span
                className={`font-mono text-[10px] ${
                  t.delta > 0 ? "text-lime" : t.delta < 0 ? "text-red-400" : "text-ink-faint"
                }`}
              >
                {t.delta > 0 ? "▲" : t.delta < 0 ? "▼" : "·"} {Math.abs(t.delta)}%
              </span>
            )}
          </div>
          <p className="mt-2 font-heading text-3xl font-bold tracking-tight text-ink">{t.value}</p>
          <p className="mt-1 text-[11px] text-ink-faint">{t.note}</p>
        </div>
      ))}
    </div>
  );
}

// ===== Hashtag leaderboard ===========================================

interface TagRow {
  tag: string;
  count: number;
  avgReach: number;
  avgEng: number | null;
}

function hashtagStats(posts: RecentPost[]): TagRow[] {
  const map = new Map<string, RecentPost[]>();
  posts.forEach((p) => p.hashtags.forEach((h) => map.set(h, [...(map.get(h) ?? []), p])));
  const rows: TagRow[] = [];
  map.forEach((ps, tag) => {
    if (ps.length < 2) return;
    const reaches = ps.map((p) => p.reach ?? 0);
    const ers = ps.map((p) => p.engagement_rate).filter((v): v is number => v !== null);
    rows.push({
      tag,
      count: ps.length,
      avgReach: Math.round(reaches.reduce((a, b) => a + b, 0) / ps.length),
      avgEng: ers.length ? +(ers.reduce((a, b) => a + b, 0) / ers.length).toFixed(1) : null,
    });
  });
  return rows.sort((a, b) => b.avgReach - a.avgReach).slice(0, 10);
}

export function HashtagLeaderboard({ posts }: { posts: RecentPost[] }) {
  const rows = hashtagStats(posts);
  if (rows.length === 0) return null;
  const max = rows[0].avgReach || 1;
  return (
    <Section title="Hashtag performance" subtitle="Avg reach per tag (used on ≥2 posts)">
      <div className="space-y-1.5">
        {rows.map((r) => (
          <div key={r.tag} className="group">
            <div className="flex items-baseline justify-between font-mono text-xs">
              <span className="truncate text-lime/90">{r.tag}</span>
              <span className="ml-3 whitespace-nowrap text-ink-muted">
                {r.avgReach.toLocaleString()}{" "}
                <span className="text-ink-faint">· {r.count} posts</span>
                {r.avgEng !== null && (
                  <span className="text-ink-faint"> · {r.avgEng}% er</span>
                )}
              </span>
            </div>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-charcoal-700">
              <div
                className="h-full rounded-full bg-lime/70 transition-studio duration-studio ease-studio-out"
                style={{ width: `${(r.avgReach / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ===== Best posting times ============================================

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]; // display order
const DAY_INDEX_FROM_DATE = [6, 0, 1, 2, 3, 4, 5]; // JS getDay() (Sun=0..Sat=6) -> Mon-first index

function dayOfWeekStats(posts: RecentPost[]): { day: string; avgReach: number; count: number }[] {
  const buckets = Array.from({ length: 7 }, () => [] as number[]);
  const counts = Array.from({ length: 7 }, () => 0);
  posts.forEach((p) => {
    if (!p.timestamp || p.reach === null) return;
    const d = new Date(p.timestamp).getDay();
    const idx = DAY_INDEX_FROM_DATE[d];
    buckets[idx].push(p.reach);
    counts[idx] += 1;
  });
  return DAY_NAMES.map((name, i) => ({
    day: name,
    avgReach: buckets[i].length ? Math.round(buckets[i].reduce((a, b) => a + b, 0) / buckets[i].length) : 0,
    count: counts[i],
  }));
}

// Benchmark posting windows for AI/tech reels (IG audience research consensus:
// tech audiences scroll late morning + post-work evenings; weekends skew
// morning). Blended with the account's own reach-by-day data below.
const AI_NICHE_SCHEDULE: { time: string; why: string }[] = [
  { time: "7:00 PM", why: "Post-work scroll peak" },           // Mon
  { time: "11:00 AM", why: "Late-morning break" },             // Tue
  { time: "7:00 PM", why: "Midweek evening peak" },            // Wed
  { time: "11:00 AM", why: "Pre-lunch discovery" },            // Thu
  { time: "5:00 PM", why: "Early weekend wind-down" },         // Fri
  { time: "10:00 AM", why: "Weekend morning browse" },         // Sat
  { time: "7:00 PM", why: "Sunday planning scroll" },          // Sun
];

export function BestPostingTimes({ posts }: { posts: RecentPost[] }) {
  const rows = dayOfWeekStats(posts);
  const max = Math.max(1, ...rows.map((r) => r.avgReach));
  const hasData = rows.some((r) => r.count > 0);
  const bestOwn = hasData ? [...rows].sort((a, b) => b.avgReach - a.avgReach)[0] : null;
  return (
    <Section
      title="Best posting times"
      subtitle="Your avg reach by day, with the suggested AI-niche upload window for each day"
    >
      <div className="grid grid-cols-7 gap-2">
        {rows.map((r, i) => {
          const ratio = hasData ? r.avgReach / max : 0;
          const isBest = bestOwn != null && r.day === bestOwn.day && r.avgReach > 0;
          return (
            <div key={r.day} className="text-center">
              <div className="relative flex h-24 items-end justify-center">
                <div
                  className={`w-full rounded-md transition-studio duration-studio ease-studio-out ${
                    r.count === 0 ? "bg-charcoal-700" : isBest ? "bg-lime" : "bg-lime/60"
                  }`}
                  style={{ height: `${Math.max(4, ratio * 100)}%` }}
                />
              </div>
              <p className={`mt-2 text-xs font-semibold ${isBest ? "text-lime" : "text-ink"}`}>{r.day}</p>
              <p className="font-mono text-[10px] text-ink-faint">
                {r.count === 0 ? "no posts" : `${r.avgReach.toLocaleString()} avg`}
              </p>
              <p
                className="mt-1.5 rounded-md bg-lime/10 px-1 py-0.5 text-[10px] font-semibold text-lime-dim"
                title={AI_NICHE_SCHEDULE[i].why}
              >
                {AI_NICHE_SCHEDULE[i].time}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs leading-relaxed text-ink-muted">
        Suggested times are the consensus windows for AI/tech audiences on Instagram (late-morning
        breaks and the 7&nbsp;PM post-work scroll){bestOwn && bestOwn.avgReach > 0 ? (
          <> — and your own data says <strong className="text-ink">{bestOwn.day}</strong> is your strongest day, so prioritize it.</>
        ) : (
          <>. As your posts accumulate, your own reach-by-day data will sharpen these recommendations.</>
        )}
      </p>
    </Section>
  );
}

// ===== Hook patterns =================================================

function hook(p: RecentPost): string {
  const c = (p.caption ?? "").replace(/#\w+/g, "").replace(/\s+/g, " ").trim();
  return c.length > 90 ? c.slice(0, 90) + "…" : c || "(no caption)";
}

export function HookPatterns({ posts }: { posts: RecentPost[] }) {
  const top = [...posts]
    .filter((p) => (p.reach ?? 0) > 0 && p.caption)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))
    .slice(0, 5);
  if (top.length === 0) return null;
  return (
    <Section
      title="Hooks that worked"
      subtitle="Top caption openings — patterns to repeat in your next script"
    >
      <ol className="space-y-3">
        {top.map((p, i) => (
          <li key={p.id} className="flex gap-3">
            <span className="font-mono text-xs text-lime">{i + 1}.</span>
            <div className="min-w-0 flex-1">
              <p className="text-sm text-ink">{hook(p)}</p>
              <p className="mt-0.5 font-mono text-[10px] text-ink-faint">
                {(p.reach ?? 0).toLocaleString()} reach ·{" "}
                {p.engagement_rate === null ? "—" : `${p.engagement_rate}%`} er ·{" "}
                {p.avg_watch_time_sec === null ? "—" : `${p.avg_watch_time_sec}s avg`}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </Section>
  );
}

// ===== Format breakdown ==============================================

interface FormatStat {
  format: string;
  count: number;
  avgReach: number;
  avgEng: number | null;
}

function formatStats(posts: RecentPost[]): FormatStat[] {
  const groups = new Map<string, RecentPost[]>();
  posts.forEach((p) => {
    const key = p.media_product_type || "POST";
    groups.set(key, [...(groups.get(key) ?? []), p]);
  });
  const out: FormatStat[] = [];
  groups.forEach((ps, format) => {
    const reaches = ps.map((p) => p.reach ?? 0);
    const ers = ps.map((p) => p.engagement_rate).filter((v): v is number => v !== null);
    out.push({
      format,
      count: ps.length,
      avgReach: Math.round(reaches.reduce((a, b) => a + b, 0) / ps.length),
      avgEng: ers.length ? +(ers.reduce((a, b) => a + b, 0) / ers.length).toFixed(1) : null,
    });
  });
  return out.sort((a, b) => b.avgReach - a.avgReach);
}

export function FormatBreakdown({ posts }: { posts: RecentPost[] }) {
  const rows = formatStats(posts);
  if (rows.length === 0) return null;
  return (
    <Section title="Content mix" subtitle="Which format earns the reach">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
        {rows.map((r) => (
          <div key={r.format} className="rounded-lg border border-charcoal-700 bg-charcoal-700/40 p-4">
            <p className="font-mono text-[10px] uppercase tracking-wider text-lime">{r.format}</p>
            <p className="mt-2 font-mono text-xl text-ink">{r.avgReach.toLocaleString()}</p>
            <p className="font-mono text-[10px] text-ink-faint">
              avg reach · {r.count} post{r.count === 1 ? "" : "s"}
              {r.avgEng !== null && ` · ${r.avgEng}% er`}
            </p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ===== Content brief (plain-language derived bullets) ================

function deriveBriefBullets(posts: RecentPost[]): string[] {
  const bullets: string[] = [];
  if (posts.length < 5) return bullets;

  // Best day of week
  const days = dayOfWeekStats(posts).filter((r) => r.count >= 1);
  if (days.length >= 2) {
    const best = [...days].sort((a, b) => b.avgReach - a.avgReach)[0];
    const others = days.filter((d) => d.day !== best.day && d.count > 0);
    const avgOthers =
      others.reduce((a, b) => a + b.avgReach, 0) / Math.max(1, others.length);
    if (best.avgReach > 0 && avgOthers > 0) {
      const mult = (best.avgReach / avgOthers).toFixed(1);
      bullets.push(
        `Post on **${best.day}** — averages ${best.avgReach.toLocaleString()} reach (${mult}× the other days).`,
      );
    }
  }

  // Top hashtag
  const tags = hashtagStats(posts);
  if (tags.length >= 1) {
    const t = tags[0];
    bullets.push(
      `Your strongest hashtag is **${t.tag}** — ${t.avgReach.toLocaleString()} avg reach across ${t.count} posts. Use it on your next post.`,
    );
  }

  // Winning format
  const fmt = formatStats(posts);
  if (fmt.length >= 2) {
    const [top, second] = fmt;
    if (top.avgReach > 0 && second.avgReach > 0) {
      const mult = (top.avgReach / second.avgReach).toFixed(1);
      bullets.push(
        `**${top.format}** outperforms ${second.format} by ${mult}× — keep prioritizing this format.`,
      );
    }
  }

  // Hook from best post
  const top = [...posts]
    .filter((p) => (p.reach ?? 0) > 0 && p.caption)
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0];
  if (top) {
    const h = hook(top);
    const short = h.length > 60 ? h.slice(0, 60) + "…" : h;
    bullets.push(`Your best hook opened with: *"${short}"* — try a variation tomorrow.`);
  }

  // Watch time anomaly (reels)
  const watches = posts
    .filter((p) => p.avg_watch_time_sec !== null)
    .map((p) => ({ id: p.id, w: p.avg_watch_time_sec as number, p }));
  if (watches.length >= 3) {
    const avg = watches.reduce((a, b) => a + b.w, 0) / watches.length;
    const best = [...watches].sort((a, b) => b.w - a.w)[0];
    if (best.w >= avg * 1.4) {
      bullets.push(
        `**${best.w}s avg watch** on your best reel vs ${avg.toFixed(1)}s typical — study its opening 3 seconds.`,
      );
    }
  }

  return bullets.slice(0, 5);
}

function renderBullet(text: string): React.ReactNode {
  // bold **x** and italic *x* — every pushed element needs a stable key so React doesn't warn.
  const parts: React.ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\*[^*]+\*)/g;
  let last = 0;
  let k = 0;
  text.replace(re, (m, _g, off: number) => {
    if (off > last) parts.push(<span key={k++}>{text.slice(last, off)}</span>);
    if (m.startsWith("**"))
      parts.push(
        <strong key={k++} className="text-ink">
          {m.slice(2, -2)}
        </strong>,
      );
    else
      parts.push(
        <em key={k++} className="text-lime/90">
          {m.slice(1, -1)}
        </em>,
      );
    last = off + m.length;
    return m;
  });
  if (last < text.length) parts.push(<span key={k++}>{text.slice(last)}</span>);
  return parts;
}

export function ContentBrief({ posts }: { posts: RecentPost[] }) {
  const bullets = deriveBriefBullets(posts);
  if (bullets.length === 0) return null;
  return (
    <div className="animate-reveal rounded-xl border border-lime/30 bg-gradient-to-br from-lime/[0.06] to-transparent p-6">
      <div className="flex items-baseline justify-between">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">
          Tomorrow's content brief
        </p>
        <span className="font-mono text-[10px] text-ink-faint">
          derived from your last {posts.length} posts
        </span>
      </div>
      <ul className="mt-4 space-y-2.5 text-sm text-ink-muted">
        {bullets.map((b, i) => (
          <li key={i} className="flex gap-3">
            <span className="font-mono text-lime">→</span>
            <span>{renderBullet(b)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ===== shared layout =================================================

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="mb-4">
        <h3 className="text-base text-ink">{title}</h3>
        {subtitle && <p className="mt-0.5 text-xs text-ink-faint">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
