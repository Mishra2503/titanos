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
    <div className="animate-reveal rounded-xl border border-lime/30 bg-gradient-to-br from-lime/[0.06] to-transparent p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime">AI content strategist</p>
          <p className="mt-1 text-xs text-ink-faint">
            Turns your real post metrics + tracked competitors into this week&apos;s reel ideas, hooks, posting plan and distribution checklist.
          </p>
        </div>
        <div className="flex gap-2">
          {text && (
            <button onClick={copy} className="press rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs text-ink-muted hover:text-ink">
              Copy
            </button>
          )}
          <button
            onClick={generate}
            disabled={loading || posts.length === 0}
            className="press rounded-lg bg-lime px-4 py-1.5 text-xs font-semibold text-charcoal disabled:opacity-50"
          >
            {loading ? "Analyzing your data…" : text ? "Regenerate" : "Generate weekly strategy"}
          </button>
        </div>
      </div>

      {posts.length === 0 && (
        <p className="mt-3 font-mono text-[11px] text-ink-faint">Needs at least one post with metrics in the selected range.</p>
      )}
      {error && <p className="mt-3 font-mono text-xs text-red-400">{error}</p>}

      {text && (
        <div className="mt-4 space-y-1 rounded-lg border border-charcoal-700 bg-charcoal-800/80 p-4">
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
