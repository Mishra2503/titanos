"use client";

import { useMemo, useState } from "react";
import { Binoculars, MagnifyingGlass, Plus } from "@phosphor-icons/react";
import type { CompetitorListItem } from "@/lib/api";

const compact = (value: number | null | undefined) => {
  if (value == null) return "No follower data";
  if (value < 1_000) return `${value} followers`;
  if (value < 1_000_000) return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)}K followers`;
  return `${(value / 1_000_000).toFixed(1)}M followers`;
};

function WatchlistSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading competitor watchlist" aria-busy="true">
      {Array.from({ length: 5 }).map((_, index) => (
        <div key={index} className="flex items-center gap-3 rounded-xl border border-charcoal-700 p-3">
          <div className="skeleton h-10 w-10 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="skeleton h-3 w-2/3" />
            <div className="skeleton h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function CompetitorWatchlist({
  competitors,
  activeId,
  loading,
  onSelect,
  onAdd,
}: {
  competitors: CompetitorListItem[];
  activeId: string | null;
  loading: boolean;
  onSelect: (id: string) => void;
  onAdd: () => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return competitors;
    return competitors.filter((competitor) =>
      [competitor.username, competitor.display_name, competitor.category]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalized),
    );
  }, [competitors, query]);

  return (
    <aside className="overflow-hidden rounded-2xl border border-charcoal-700 bg-charcoal-800 shadow-card lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)]">
      <div className="flex items-center justify-between border-b border-charcoal-700 px-4 py-4">
        <div>
          <p className="text-sm font-bold text-ink">Watchlist</p>
          <p className="mt-0.5 text-[11px] text-ink-faint">{competitors.length} tracked creators</p>
        </div>
        <button
          type="button"
          onClick={onAdd}
          aria-label="Add competitor"
          title="Add competitor"
          className="press flex h-9 w-9 items-center justify-center rounded-full bg-lime text-white shadow-sm hover:shadow-pop"
        >
          <Plus size={17} weight="bold" />
        </button>
      </div>

      {competitors.length > 5 && (
        <label className="relative m-3 block">
          <span className="sr-only">Search watchlist</span>
          <MagnifyingGlass size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find a creator"
            className="w-full rounded-xl border border-charcoal-700 bg-charcoal py-2 pl-9 pr-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50 focus:bg-white"
          />
        </label>
      )}

      <div className="max-h-[calc(100vh-11rem)] overflow-y-auto p-3 pt-2">
        {loading ? (
          <WatchlistSkeleton />
        ) : filtered.length === 0 ? (
          <div className="px-3 py-10 text-center">
            <Binoculars size={24} className="mx-auto text-lime" />
            <p className="mt-3 text-sm font-semibold text-ink">No creator found</p>
            <p className="mt-1 text-xs text-ink-muted">Try another username or category.</p>
          </div>
        ) : (
          <div className="space-y-1.5" role="list" aria-label="Tracked competitors">
            {filtered.map((competitor) => {
              const active = activeId === competitor.id;
              const delta = competitor.follower_delta;
              return (
                <button
                  type="button"
                  key={competitor.id}
                  onClick={() => onSelect(competitor.id)}
                  className={`press group flex w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition-studio duration-studio ease-studio-out ${
                    active
                      ? "border-lime/35 bg-lime/[0.07] shadow-sm"
                      : "border-transparent hover:border-charcoal-700 hover:bg-charcoal"
                  }`}
                  aria-current={active ? "page" : undefined}
                >
                  <span className="relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-charcoal-700 bg-charcoal text-xs font-bold text-lime">
                    {competitor.avatar_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={competitor.avatar_url} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                    ) : (
                      competitor.username.slice(0, 2).toUpperCase()
                    )}
                    {active && <span className="absolute bottom-0 right-0 h-2.5 w-2.5 rounded-full border-2 border-white bg-lime" />}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">@{competitor.username}</span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-faint">
                      {compact(competitor.latest_followers)}
                    </span>
                    <span className="mt-1 flex items-center gap-2 text-[10px] font-medium text-ink-faint">
                      <span>{competitor.post_count} Reels</span>
                      {delta != null && (
                        <span className={delta >= 0 ? "text-emerald-700" : "text-red-400"}>
                          {delta >= 0 ? "+" : ""}{delta.toLocaleString()}
                        </span>
                      )}
                    </span>
                  </span>

                  <span className={`h-6 w-1 rounded-full transition-colors ${active ? "bg-lime" : "bg-transparent group-hover:bg-charcoal-600"}`} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </aside>
  );
}
