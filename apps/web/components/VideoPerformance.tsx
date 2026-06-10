import type { RecentPost } from "@/lib/api";

function fmt(n: number | null): string {
  return n === null || n === undefined ? "—" : n.toLocaleString();
}

function fmtSec(s: number | null): string {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = Math.round(s % 60);
  return `${m}m ${rem}s`;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-charcoal-700/60 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-ink-faint">{label}</p>
      <p className="mt-0.5 font-mono text-sm text-ink">{value}</p>
    </div>
  );
}

export function VideoCard({ post, rank }: { post: RecentPost; rank: number }) {
  return (
    <div className="animate-reveal overflow-hidden rounded-xl border border-charcoal-700 bg-charcoal-800">
      <div className="flex gap-4 p-4">
        <div className="relative h-28 w-20 flex-shrink-0 overflow-hidden rounded-lg bg-charcoal-600">
          {post.thumbnail_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={post.thumbnail_url}
              alt=""
              className="h-full w-full object-cover"
              referrerPolicy="no-referrer"
            />
          ) : null}
          {rank <= 3 && (
            <span className="absolute left-1 top-1 rounded bg-lime px-1.5 py-0.5 font-mono text-[9px] font-bold text-charcoal">
              #{rank}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-wider text-lime-dim">
              {post.media_product_type ?? "POST"}
            </span>
            <a
              href={post.permalink ?? "#"}
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[10px] text-ink-faint hover:text-lime"
            >
              {post.timestamp ? new Date(post.timestamp).toLocaleDateString() : "view ↗"}
            </a>
          </div>
          <p className="mt-1 line-clamp-2 text-sm text-ink-muted">
            {post.caption?.replace(/#\w+/g, "").trim() || "(no caption)"}
          </p>
          {post.hashtags.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {post.hashtags.slice(0, 12).map((h) => (
                <span
                  key={h}
                  className="rounded-full border border-charcoal-600 px-2 py-0.5 font-mono text-[10px] text-lime/80"
                >
                  {h}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-4 gap-2 px-4 pb-4">
        <Metric label="Reach" value={fmt(post.reach)} />
        <Metric label="Views" value={fmt(post.views)} />
        <Metric label="Avg watch" value={fmtSec(post.avg_watch_time_sec)} />
        <Metric
          label="Eng. rate"
          value={post.engagement_rate === null ? "—" : `${post.engagement_rate}%`}
        />
        <Metric label="Likes" value={fmt(post.likes)} />
        <Metric label="Comments" value={fmt(post.comments)} />
        <Metric label="Shares" value={fmt(post.shares)} />
        <Metric label="Saves" value={fmt(post.saved)} />
      </div>
    </div>
  );
}

export function WhatsWorking({ posts }: { posts: RecentPost[] }) {
  const withReach = posts.filter((p) => (p.reach ?? 0) > 0);
  if (withReach.length === 0) return null;

  const topReach = [...withReach].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0];
  const topEng = [...withReach]
    .filter((p) => p.engagement_rate !== null)
    .sort((a, b) => (b.engagement_rate ?? 0) - (a.engagement_rate ?? 0))[0];
  const topWatch = [...withReach]
    .filter((p) => p.avg_watch_time_sec !== null)
    .sort((a, b) => (b.avg_watch_time_sec ?? 0) - (a.avg_watch_time_sec ?? 0))[0];

  // Most common hashtags across the top 5 posts by reach.
  const counts = new Map<string, number>();
  [...withReach]
    .sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))
    .slice(0, 5)
    .forEach((p) => p.hashtags.forEach((h) => counts.set(h, (counts.get(h) ?? 0) + 1)));
  const topTags = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([h]) => h);

  const line = (label: string, p: RecentPost | undefined, metric: string) =>
    p ? (
      <li className="flex items-baseline justify-between gap-3 py-1">
        <span className="truncate text-ink-muted">
          {label}: <span className="text-ink">{(p.caption || "post").slice(0, 48)}</span>
        </span>
        <span className="whitespace-nowrap font-mono text-lime">{metric}</span>
      </li>
    ) : null;

  return (
    <div className="animate-reveal rounded-xl border border-lime/20 bg-lime/[0.03] p-5">
      <p className="font-mono text-xs uppercase tracking-wider text-lime">What's working</p>
      <ul className="mt-3 text-sm">
        {line("Best reach", topReach, `${topReach.reach?.toLocaleString()} reach`)}
        {line(
          "Best engagement",
          topEng,
          topEng ? `${topEng.engagement_rate}%` : "",
        )}
        {line(
          "Most watched",
          topWatch,
          topWatch ? `${topWatch.avg_watch_time_sec}s avg` : "",
        )}
      </ul>
      {topTags.length > 0 && (
        <div className="mt-3 border-t border-charcoal-700 pt-3">
          <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            Hashtags on your top posts
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {topTags.map((h) => (
              <span
                key={h}
                className="rounded-full border border-lime/30 px-2 py-0.5 font-mono text-[11px] text-lime/90"
              >
                {h}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
