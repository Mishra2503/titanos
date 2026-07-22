"use client";

// Minimal markdown rendering: headings, bold, bullets, numbered lists -
// enough for AI output without pulling in a markdown library.
export function Markdown({ text }: { text: string }) {
  return (
    <>
      {text.split("\n").map((line, i) => {
        const renderInline = (s: string) => {
          const parts: React.ReactNode[] = [];
          const re = /\*\*([^*]+)\*\*/g;
          let last = 0; let m: RegExpExecArray | null; let k = 0;
          while ((m = re.exec(s))) {
            if (m.index > last) parts.push(<span key={k++}>{s.slice(last, m.index)}</span>);
            parts.push(<strong key={k++} className="font-semibold text-ink">{m[1]}</strong>);
            last = m.index + m[0].length;
          }
          if (last < s.length) parts.push(<span key={k++}>{s.slice(last)}</span>);
          return parts;
        };
        const trimmed = line.trim();
        if (/^#{1,4}\s/.test(trimmed)) {
          return <p key={i} className="mt-4 text-sm font-bold text-lime">{renderInline(trimmed.replace(/^#{1,4}\s/, ""))}</p>;
        }
        if (/^\d+\.\s/.test(trimmed)) {
          return <p key={i} className="mt-3 text-sm font-semibold text-ink">{renderInline(trimmed)}</p>;
        }
        if (/^[-*•]\s/.test(trimmed)) {
          return (
            <p key={i} className="ml-3 flex gap-2 text-sm leading-relaxed text-ink-muted">
              <span className="text-lime">→</span>
              <span>{renderInline(trimmed.replace(/^[-*•]\s/, ""))}</span>
            </p>
          );
        }
        if (trimmed === "") return <div key={i} className="h-2" />;
        return <p key={i} className="text-sm leading-relaxed text-ink-muted">{renderInline(trimmed)}</p>;
      })}
    </>
  );
}
