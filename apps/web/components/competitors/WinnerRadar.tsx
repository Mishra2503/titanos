"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle,
  Eye,
  Heart,
  Lightning,
  MagnifyingGlass,
  Play,
  Sparkle,
  TrendUp,
} from "@phosphor-icons/react";
import type {
  CompetitorFeed,
  CompetitorFeedPost,
  CompetitorListItem,
} from "@/lib/api";

type SortMode = "signal" | "views" | "recent" | "engagement";
type Period = 7 | 28 | 90 | 0;

const compact = (value: number | null | undefined) => {
  if (value == null) return "-";
  if (value < 1_000) return String(value);
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K`;
  return `${(value / 1_000_000).toFixed(1)}M`;
};

const engagementRate = (post: CompetitorFeedPost) =>
  post.views && post.views > 0
    ? Math.round((((post.likes ?? 0) + (post.comments ?? 0)) / post.views) * 1_000) / 10
    : null;

function relativeDate(value: string | null | undefined) {
  if (!value) return "Date unavailable";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Date unavailable";
  const days = Math.max(0, Math.floor((Date.now() - timestamp) / 86_400_000));
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function RadarSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" aria-label="Loading winning Reels" aria-busy="true">
      {Array.from({ length: 6 }).map((_, index) => (
        <div key={index} className="overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800">
          <div className="skeleton aspect-[4/5] rounded-none" />
          <div className="space-y-3 p-4">
            <div className="skeleton h-4 w-2/3" />
            <div className="skeleton h-3 w-full" />
            <div className="skeleton h-8 w-full" />
          </div>
        </div>
      ))}
    </div>
  );
}

function WinnerCard({ post, rank, onOpen }: { post: CompetitorFeedPost; rank: number; onOpen: () => void }) {
  const [imageFailed, setImageFailed] = useState(false);
  const rate = engagementRate(post);
  const hook = post.video_analysis?.hook_spoken || post.video_analysis?.hook_visual || post.caption;
  const isWinner = (post.outlier_multiple ?? 0) >= 2;

  return (
    <button
      type="button"
      onClick={onOpen}
      className="press group relative flex h-full w-full flex-col overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800 text-left shadow-card transition-studio duration-studio ease-studio-out hover:-translate-y-0.5 hover:border-lime/40 hover:shadow-pop"
      aria-label={`Open Reel breakdown from @${post.competitor_username}`}
    >
      <span className={`absolute inset-y-0 left-0 z-20 w-1 ${isWinner ? "bg-amber-300" : "bg-lime"}`} aria-hidden="true" />
      <div className="relative aspect-[4/5] overflow-hidden bg-charcoal">
        {post.thumbnail_url && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={post.thumbnail_url}
            alt=""
            referrerPolicy="no-referrer"
            onError={() => setImageFailed(true)}
            className="h-full w-full object-cover transition-transform duration-500 ease-studio-out group-hover:scale-[1.025]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-charcoal via-charcoal-700 to-charcoal-600 text-lime">
            <Play size={38} weight="fill" />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/5 to-black/20" />

        <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
          <span className="rounded-md bg-black/60 px-2 py-1 font-mono text-[10px] font-semibold tracking-wide text-white backdrop-blur-md">
            #{rank.toString().padStart(2, "0")}
          </span>
          {isWinner ? (
            <span className="flex items-center gap-1 rounded-full bg-amber-300 px-2.5 py-1 text-[11px] font-bold text-[#3B2500] shadow-sm">
              <Lightning size={12} weight="fill" /> Winner · {post.outlier_multiple}×
            </span>
          ) : (
            <span className="rounded-full bg-black/60 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-md">
              {post.outlier_multiple != null ? `${post.outlier_multiple}× median` : "New signal"}
            </span>
          )}
        </div>

        <div className="absolute bottom-3 left-4 right-3 text-white">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full border border-white/30 bg-white/15 text-[10px] font-bold backdrop-blur-md">
              {post.competitor_avatar_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={post.competitor_avatar_url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
              ) : (
                post.competitor_username.slice(0, 2).toUpperCase()
              )}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">@{post.competitor_username}</span>
              <span className="block text-[11px] text-white/75">{relativeDate(post.posted_at)}</span>
            </span>
          </div>
        </div>
      </div>

      <div className="flex flex-1 flex-col p-4 pl-5">
        <p className="line-clamp-2 min-h-[2.8rem] text-sm font-semibold leading-snug text-ink">
          {hook || "No hook or caption captured yet"}
        </p>

        <div className="mt-3 grid grid-cols-3 divide-x divide-charcoal-700 rounded-xl border border-charcoal-700 bg-charcoal px-1 py-2.5">
          <span className="flex items-center justify-center gap-1.5 text-xs text-ink-muted" title="Views">
            <Eye size={14} weight="fill" className="text-lime" />
            <strong className="text-ink">{compact(post.views)}</strong>
          </span>
          <span className="flex items-center justify-center gap-1.5 text-xs text-ink-muted" title="Engagement rate">
            <TrendUp size={14} weight="bold" />
            <strong className="text-ink">{rate != null ? `${rate}%` : "-"}</strong>
          </span>
          <span className="flex items-center justify-center gap-1.5 text-xs text-ink-muted" title="Likes and comments">
            <Heart size={13} weight="fill" />
            <strong className="text-ink">{compact((post.likes ?? 0) + (post.comments ?? 0))}</strong>
          </span>
        </div>

        <div className="mt-3 flex min-h-6 flex-wrap items-center gap-1.5">
          {post.video_analysis?.status === "DONE" && (
            <span className="inline-flex items-center gap-1 rounded-full bg-lime/10 px-2 py-1 text-[10px] font-semibold text-lime">
              <Sparkle size={11} weight="fill" /> AI transcript
            </span>
          )}
          {post.board_card_id && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-700">
              <CheckCircle size={11} weight="fill" /> On board
            </span>
          )}
          {post.scripted && !post.board_card_id && (
            <span className="rounded-full bg-sky-100 px-2 py-1 text-[10px] font-semibold text-sky-700">Scripted</span>
          )}
          {post.used && (
            <span className="rounded-full bg-charcoal-700 px-2 py-1 text-[10px] font-semibold text-ink-muted">Used</span>
          )}
        </div>

        <div className="mt-auto flex items-center justify-between border-t border-charcoal-700 pt-3 text-xs">
          <span className="text-ink-faint">
            Compared with @{post.competitor_username}&apos;s own median
          </span>
          <span className="font-semibold text-lime group-hover:underline">Open breakdown</span>
        </div>
      </div>
    </button>
  );
}

export function WinnerRadar({
  feed,
  competitors,
  loading,
  onOpen,
}: {
  feed: CompetitorFeed | null;
  competitors: CompetitorListItem[];
  loading: boolean;
  onOpen: (post: CompetitorFeedPost) => void;
}) {
  const [query, setQuery] = useState("");
  const [competitorId, setCompetitorId] = useState("all");
  const [period, setPeriod] = useState<Period>(28);
  const [sort, setSort] = useState<SortMode>("signal");
  const [winnersOnly, setWinnersOnly] = useState(true);
  const [hideUsed, setHideUsed] = useState(false);
  const [visibleCount, setVisibleCount] = useState(24);

  useEffect(() => setVisibleCount(24), [query, competitorId, period, sort, winnersOnly, hideUsed]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const cutoff = period === 0 ? 0 : Date.now() - period * 86_400_000;
    const items = (feed?.posts ?? []).filter((post) => {
      if (competitorId !== "all" && post.competitor_id !== competitorId) return false;
      if (winnersOnly && (post.outlier_multiple ?? 0) < 2) return false;
      if (hideUsed && post.used) return false;
      if (cutoff && (!post.posted_at || new Date(post.posted_at).getTime() < cutoff)) return false;
      if (!normalized) return true;
      const searchable = [
        post.competitor_username,
        post.competitor_display_name,
        post.competitor_category,
        post.caption,
        post.video_analysis?.hook_spoken,
        post.video_analysis?.hook_visual,
        ...(post.hashtags ?? []),
        ...(post.tags ?? []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return searchable.includes(normalized);
    });

    return items.sort((a, b) => {
      if (sort === "views") return (b.views ?? 0) - (a.views ?? 0);
      if (sort === "engagement") return ((b.likes ?? 0) + (b.comments ?? 0)) - ((a.likes ?? 0) + (a.comments ?? 0));
      if (sort === "recent") return new Date(b.posted_at ?? 0).getTime() - new Date(a.posted_at ?? 0).getTime();
      return (b.outlier_multiple ?? 0) - (a.outlier_multiple ?? 0) || (b.views ?? 0) - (a.views ?? 0);
    });
  }, [competitorId, feed?.posts, hideUsed, period, query, sort, winnersOnly]);

  const visible = filtered.slice(0, visibleCount);
  const topSignal = filtered[0]?.outlier_multiple ?? null;

  return (
    <section aria-labelledby="winner-radar-title" className="min-w-0">
      <div className="overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800 shadow-card">
        <div className="grid gap-5 bg-[#17171F] px-5 py-5 text-white sm:grid-cols-[1fr_auto] sm:items-end lg:px-6">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#B8B4FF]">
              <span className="h-2 w-2 rounded-full bg-[#8B83FF] shadow-[0_0_0_5px_rgba(139,131,255,0.13)]" />
              Live competitive signal
            </div>
            <h2 id="winner-radar-title" className="mt-3 text-2xl font-bold tracking-tight sm:text-3xl">Winner Radar</h2>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-white/65">
              Find the Reels outperforming each creator&apos;s normal baseline, then turn the strongest signal into your next idea.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-px overflow-hidden rounded-xl border border-white/10 bg-white/10 text-center">
            <div className="bg-[#17171F] px-4 py-3">
              <p className="text-xl font-bold">{filtered.length}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">matches</p>
            </div>
            <div className="bg-[#17171F] px-4 py-3">
              <p className="text-xl font-bold text-[#FFC565]">{topSignal != null ? `${topSignal}×` : "-"}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">top signal</p>
            </div>
            <div className="bg-[#17171F] px-4 py-3">
              <p className="text-xl font-bold">{feed?.totals.watched ?? 0}</p>
              <p className="text-[10px] uppercase tracking-wider text-white/50">transcribed</p>
            </div>
          </div>
        </div>

        <div className="grid gap-3 border-b border-charcoal-700 p-4 lg:grid-cols-[minmax(220px,1fr)_repeat(3,auto)] lg:items-center">
          <label className="relative block">
            <span className="sr-only">Search competitor Reels</span>
            <MagnifyingGlass size={17} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search creators, hooks, captions or tags"
              className="w-full rounded-xl border border-charcoal-700 bg-charcoal py-2.5 pl-10 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50 focus:bg-white"
            />
          </label>
          <select
            value={competitorId}
            onChange={(event) => setCompetitorId(event.target.value)}
            aria-label="Filter by competitor"
            className="rounded-xl border border-charcoal-700 bg-charcoal px-3 py-2.5 text-sm text-ink outline-none focus:border-lime/50"
          >
            <option value="all">All competitors</option>
            {competitors.map((competitor) => (
              <option key={competitor.id} value={competitor.id}>@{competitor.username}</option>
            ))}
          </select>
          <select
            value={period}
            onChange={(event) => setPeriod(Number(event.target.value) as Period)}
            aria-label="Filter by publishing period"
            className="rounded-xl border border-charcoal-700 bg-charcoal px-3 py-2.5 text-sm text-ink outline-none focus:border-lime/50"
          >
            <option value={7}>Last 7 days</option>
            <option value={28}>Last 28 days</option>
            <option value={90}>Last 90 days</option>
            <option value={0}>All time</option>
          </select>
          <select
            value={sort}
            onChange={(event) => setSort(event.target.value as SortMode)}
            aria-label="Sort competitor Reels"
            className="rounded-xl border border-charcoal-700 bg-charcoal px-3 py-2.5 text-sm text-ink outline-none focus:border-lime/50"
          >
            <option value="signal">Strongest signal</option>
            <option value="views">Most views</option>
            <option value="recent">Most recent</option>
            <option value="engagement">Most engagement</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setWinnersOnly((value) => !value)}
              aria-pressed={winnersOnly}
              className={`press inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${winnersOnly ? "border-amber-300/60 bg-amber-50 text-amber-700" : "border-charcoal-700 text-ink-muted hover:text-ink"}`}
            >
              <Lightning size={13} weight="fill" /> Winners only
            </button>
            <button
              type="button"
              onClick={() => setHideUsed((value) => !value)}
              aria-pressed={hideUsed}
              className={`press rounded-full border px-3 py-1.5 text-xs font-semibold ${hideUsed ? "border-lime/40 bg-lime/10 text-lime" : "border-charcoal-700 text-ink-muted hover:text-ink"}`}
            >
              Hide used
            </button>
          </div>
          <p className="text-xs text-ink-faint">
            Winner = 2× or more above that creator&apos;s median {feed?.totals.posts ? `· ${feed.totals.posts} Reels indexed` : ""}
          </p>
        </div>
      </div>

      <div className="mt-5">
        {loading ? (
          <RadarSkeleton />
        ) : visible.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-14 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-lime/10 text-lime">
              <MagnifyingGlass size={22} />
            </div>
            <h3 className="mt-4 text-base font-semibold text-ink">No Reels match these signals</h3>
            <p className="mx-auto mt-1 max-w-md text-sm text-ink-muted">
              Show all Reels, widen the date range, or clear the search to bring more competitor posts into view.
            </p>
            <button
              type="button"
              onClick={() => { setQuery(""); setCompetitorId("all"); setPeriod(0); setWinnersOnly(false); setHideUsed(false); }}
              className="press mt-4 rounded-full border border-charcoal-600 px-4 py-2 text-sm font-semibold text-ink hover:border-lime/40 hover:text-lime"
            >
              Reset filters
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {visible.map((post, index) => (
                <WinnerCard key={post.id} post={post} rank={index + 1} onOpen={() => onOpen(post)} />
              ))}
            </div>
            {visibleCount < filtered.length && (
              <div className="mt-5 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleCount((count) => count + 24)}
                  className="press rounded-full border border-charcoal-600 bg-charcoal-800 px-5 py-2.5 text-sm font-semibold text-ink hover:border-lime/40 hover:text-lime"
                >
                  Load 24 more
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
