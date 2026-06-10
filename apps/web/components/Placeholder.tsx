// Splits a title so the final word carries the brand's single serif-italic
// flourish (mirrors the "Grow smarter with automation" reference treatment).
function splitTitle(title: string): { head: string; tail: string } {
  const words = title.trim().split(" ");
  if (words.length < 2) return { head: "", tail: title };
  return { head: words.slice(0, -1).join(" ") + " ", tail: words[words.length - 1] };
}

export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { head, tail } = splitTitle(title);
  return (
    <header className="mb-8 animate-reveal">
      <h1 className="text-3xl font-semibold tracking-tight text-ink">
        {head}
        <span className="font-serif italic font-normal text-lime">{tail}</span>
      </h1>
      {subtitle && <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
    </header>
  );
}

export function ModulePlaceholder({ title, phase }: { title: string; phase: string }) {
  return (
    <div>
      <PageHeader title={title} />
      <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-12 text-center">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-lime-dim">{phase}</p>
        <p className="mt-2 text-sm text-ink-muted">
          This module is part of the build roadmap and isn&apos;t wired up yet.
        </p>
      </div>
    </div>
  );
}
