"use client";

import { useState } from "react";
import { ApiError, generateStrategy, type RecentPost, type StrategyPostIn } from "@/lib/api";

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

// Minimal markdown rendering: headings, bold, bullets — enough for the
// strategy output without pulling in a markdown library.
function renderMarkdown(text: string): React.ReactNode {
  return text.split("\n").map((line, i) => {
    const renderInline = (s: string) => {
      const parts: React.ReactNode[] = [];
      const re = /\*\*([^*]+)\*\*/g;
      let last = 0; let m: RegExpExecArray | null; let k = 0;
      while ((m = re.exec(s))) {
        if (m.index > last) parts.push(<span key={k++}>{s.slice(last, m.index)}</span>);
        parts.push(<strong key={k++} className="text-ink">{m[1]}</strong>);
        last = m.index + m[0].length;
      }
      if (last < s.length) parts.push(<span key={k++}>{s.slice(last)}</span>);
      return parts;
    };
    const trimmed = line.trim();
    if (/^#{1,4}\s/.test(trimmed)) {
      return <p key={i} className="mt-4 text-sm font-semibold text-lime">{trimmed.replace(/^#{1,4}\s/, "")}</p>;
    }
    if (/^[-*•]\s/.test(trimmed)) {
      return (
        <p key={i} className="ml-3 flex gap-2 text-sm text-ink-muted">
          <span className="text-lime">→</span>
          <span>{renderInline(trimmed.replace(/^[-*•]\s/, ""))}</span>
        </p>
      );
    }
    if (trimmed === "") return <div key={i} className="h-2" />;
    return <p key={i} className="text-sm text-ink-muted">{renderInline(trimmed)}</p>;
  });
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
            Get this week&apos;s plan <span className="font-serif italic font-normal text-violet-300">from your data</span>
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
          {renderMarkdown(text)}
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
