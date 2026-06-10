import type { AccountInsights } from "@/lib/api";

export type RangeKey = "7" | "28" | "90" | "all";
export const RANGE_LABEL: Record<RangeKey, string> = {
  "7": "7d",
  "28": "28d",
  "90": "90d",
  all: "All",
};
const RANGES: RangeKey[] = ["7", "28", "90", "all"];

interface Props {
  accounts: AccountInsights[];
  selectedAccountIds: string[];
  onAccountsChange: (next: string[]) => void;
  range: RangeKey;
  onRangeChange: (next: RangeKey) => void;
}

export function DashboardFilters({
  accounts,
  selectedAccountIds,
  onAccountsChange,
  range,
  onRangeChange,
}: Props) {
  const allSelected = selectedAccountIds.length === accounts.length;

  const toggle = (id: string) => {
    if (selectedAccountIds.includes(id)) {
      const next = selectedAccountIds.filter((x) => x !== id);
      onAccountsChange(next.length === 0 ? accounts.map((a) => a.account_id) : next);
    } else {
      onAccountsChange([...selectedAccountIds, id]);
    }
  };

  return (
    <div className="sticky top-0 z-30 -mx-10 mb-6 border-b border-charcoal-700 bg-charcoal-800/85 px-10 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            Accounts
          </span>
          {accounts.length > 1 && (
            <button
              onClick={() => onAccountsChange(accounts.map((a) => a.account_id))}
              className={`press rounded-full border px-2.5 py-1 text-xs ${
                allSelected
                  ? "border-lime bg-lime/10 text-lime"
                  : "border-charcoal-600 text-ink-muted hover:text-ink"
              }`}
            >
              All ({accounts.length})
            </button>
          )}
          {accounts.map((a) => {
            const on = selectedAccountIds.includes(a.account_id);
            return (
              <button
                key={a.account_id}
                onClick={() => toggle(a.account_id)}
                className={`press rounded-full border px-2.5 py-1 text-xs transition-studio duration-studio ease-studio-out ${
                  on
                    ? "border-lime bg-lime/10 text-lime"
                    : "border-charcoal-600 text-ink-muted hover:text-ink"
                }`}
              >
                @{a.username}
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex items-center gap-1 rounded-full border border-charcoal-600 bg-charcoal-700/40 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`press rounded-full px-3 py-1 text-xs font-medium transition-studio duration-studio ease-studio-out ${
                range === r ? "bg-lime text-white" : "text-ink-muted hover:text-ink"
              }`}
            >
              {RANGE_LABEL[r]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
