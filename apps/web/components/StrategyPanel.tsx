"use client";

import { useState } from "react";
import { ApiError, generateStrategy, type RecentPost, type StrategyPostIn } from "@/lib/api";
import { Markdown } from "@/components/Markdown";

function toStrategyPost(p: RecentPost): StrategyPostIn {
  return {
    caption: p.caption,
    reach: p.reach,
    views: p.views,
    likes: p.likes,
    comments: p.comments,
    shares: p.shares,
    saved: p.saved,
    engagement_rate: p.engagement_rate,
    avg_watch_time_sec: p.avg_watch_time_sec,
    media_product_type: p.media_product_type,
    timestamp: p.timestamp,
    hashtags: p.hashtags,
  };
}

export function StrategyPanel({ posts }: { posts: RecentPost[] }) {
  const [text, setText] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const r = await generateStrategy(posts.slice(0, 40).map(toStrategyPost));
      setText(r.text);
      setGeneratedAt(r.generated_at);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Strategy generation failed");
    } finally {
      setLoading(false);
    }
  }

  function copy() {
    if (text) void navigator.clipboard.writeText(text);
  }

  return (
    <div className="animate-reveal relative overflow-hidden rounded-2xl bg-ink p-6 text-white">
      {/* Soft violet glow in the corner — the one dark "premium" moment on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -top-24 h-72 w-72 rounded-full bg-[radial-gradient(circle,rgba(124,58,237,0.35),transparent_70%)] blur-2xl"
      />

      <div className="relative flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-violet-300">AI content strategist</p>
          <h3 className="mt-1.5 text-xl font-bold tracking-tight text-white">
            Get this week&apos;s plan <span className="text-violet-300">from your data</span>
          </h3>
          <p className="mt-1 max-w-md text-xs text-white/60">
            Real post metrics + tracked competitors, turned into reel ideas, hooks, a posting plan and a distribution checklist.
          </p>
        </div>
        <div className="flex gap-2">
          {text && (
            <button onClick={copy} className="press rounded-lg border border-white/20 px-3 py-1.5 text-xs text-white/80 hover:bg-white/10 hover:text-white">
              Copy
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading || posts.length === 0}
            className="press rounded-lg bg-lime px-4 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            {loading ? "Analyzing your data…" : text ? "Regenerate" : "Generate weekly strategy"}
          </button>
        </div>
      </div>

      {posts.length === 0 && (
        <p className="relative mt-3 font-mono text-[11px] text-white/50">Needs at least one post with metrics in the selected range.</p>
      )}
      {error && <p className="relative mt-3 font-mono text-xs text-red-300">{error}</p>}

      {text && (
        <div className="relative mt-5 space-y-1 rounded-xl bg-white p-5">
          <Markdown text={text} />
          {generatedAt && (
            <p className="pt-3 font-mono text-[10px] text-ink-faint">
              Generated {new Date(generatedAt).toLocaleString()} from {Math.min(posts.length, 40)} posts
            </p>
          )}
        </div>
      )}
    </div>
  );
}
