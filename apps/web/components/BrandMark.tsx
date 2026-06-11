// Aifluencee brand mark: violet-gradient "ΛI" on a dark rounded tile,
// matching the supplied logo (and app/icon.svg favicon).
export function BrandMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect width="64" height="64" rx="14" fill="#17141f" />
      <defs>
        <linearGradient id="brand-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#a78bfa" />
          <stop offset="1" stopColor="#5b21b6" />
        </linearGradient>
      </defs>
      <path
        d="M14 46 L26 18 L38 46"
        fill="none"
        stroke="url(#brand-g)"
        strokeWidth="6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <line x1="48" y1="18" x2="48" y2="46" stroke="url(#brand-g)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}

export function BrandWordmark({ stacked = false }: { stacked?: boolean }) {
  if (stacked) {
    return (
      <div className="leading-tight">
        <p className="text-sm font-extrabold tracking-tight text-ink">Aifluencee</p>
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-lime">Content Hub</p>
      </div>
    );
  }
  return (
    <p className="text-base font-extrabold tracking-tight text-ink">
      Aifluencee <span className="text-lime">Content Hub</span>
    </p>
  );
}
