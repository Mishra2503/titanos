import type { AccountInsights } from "@/lib/api";
import { AccountChips } from "@/components/AccountChips";

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
  return (
    <div className="sticky top-0 z-30 -mx-10 mb-6 border-b border-charcoal-700 bg-charcoal-800/85 px-10 py-3 backdrop-blur">
      <div className="flex flex-wrap items-center gap-4">
        <AccountChips
          accounts={accounts.map((a) => ({ account_id: a.account_id, username: a.username, followers: a.followers }))}
          selectedIds={selectedAccountIds}
          onChange={onAccountsChange}
        />

        <div className="ml-auto flex items-center gap-1 rounded-full border border-charcoal-600 bg-charcoal-700/40 p-0.5">
          {RANGES.map((r) => (
            <button
              key={r}
              onClick={() => onRangeChange(r)}
              className={`press rounded-full px-3.5 py-1.5 text-xs font-semibold transition-studio duration-studio ease-studio-out ${
                range === r ? "bg-lime text-white shadow-card" : "text-ink-muted hover:text-ink"
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
