"use client";

// Vivid account selector chips, shared by Dashboard and Insights.
// Active = solid violet with white text + avatar; inactive = white pill.

function compact(n: number | null | undefined): string {
  if (n == null) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

export interface ChipAccount {
  account_id: string;
  username: string;
  followers?: number | null;
}

export function AccountChips({
  accounts,
  selectedIds,
  onChange,
}: {
  accounts: ChipAccount[];
  selectedIds: string[];
  onChange: (next: string[]) => void;
}) {
  const allSelected = selectedIds.length === accounts.length;

  const toggle = (id: string) => {
    if (selectedIds.includes(id)) {
      const next = selectedIds.filter((x) => x !== id);
      onChange(next.length === 0 ? accounts.map((a) => a.account_id) : next);
    } else {
      onChange([...selectedIds, id]);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      {accounts.length > 1 && (
        <button
          onClick={() => onChange(accounts.map((a) => a.account_id))}
          className={`press lift rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-studio duration-studio ease-studio-out ${
            allSelected
              ? "border-lime bg-lime text-white shadow-card"
              : "border-charcoal-600 bg-charcoal-800 text-ink-muted hover:border-lime/50 hover:text-ink"
          }`}
        >
          All accounts ({accounts.length})
        </button>
      )}
      {accounts.map((a) => {
        const on = selectedIds.includes(a.account_id);
        return (
          <button
            key={a.account_id}
            onClick={() => toggle(a.account_id)}
            className={`press lift flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-xs font-semibold transition-studio duration-studio ease-studio-out ${
              on
                ? "border-lime bg-lime text-white shadow-card"
                : "border-charcoal-600 bg-charcoal-800 text-ink-muted hover:border-lime/50 hover:text-ink"
            }`}
          >
            <span
              className={`flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold uppercase ${
                on ? "bg-white/20 text-white" : "bg-lime/10 text-lime"
              }`}
            >
              {a.username.slice(0, 2)}
            </span>
            <span>@{a.username}</span>
            {a.followers != null && (
              <span className={on ? "font-medium text-white/70" : "font-medium text-ink-faint"}>
                {compact(a.followers)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
