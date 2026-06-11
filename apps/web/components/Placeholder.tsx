export function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="mb-8 animate-reveal">
      <h1 className="text-4xl font-bold tracking-tight text-ink">{title}</h1>
      <div className="mt-3 h-[3px] w-12 rounded-full bg-gradient-to-r from-[#8b5cf6] via-[#6d28d9] to-transparent" />
      {subtitle && <p className="mt-3 max-w-xl text-sm leading-relaxed text-ink-muted">{subtitle}</p>}
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
