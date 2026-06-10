export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8 animate-reveal">
      <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-ink-muted">{subtitle}</p>}
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
          This module is part of the build roadmap and isn't wired up yet.
        </p>
      </div>
    </div>
  );
}
