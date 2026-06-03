// Information architecture (PRD §6). ownerOnly items are hidden from EDITORs in UI;
// the server independently enforces access (Rail #4) — UI hiding is convenience only.
export interface NavItem {
  label: string;
  href: string;
  ownerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard" },
  { label: "Connections", href: "/connections", ownerOnly: true },
  { label: "Content Board", href: "/board" },
  { label: "Scriptwriter", href: "/scriptwriter" },
  { label: "Post & Schedule", href: "/scheduler" },
  { label: "Insights", href: "/insights" },
  { label: "Competitors", href: "/competitors" },
  { label: "Content Library", href: "/library" },
  { label: "Settings", href: "/settings", ownerOnly: true },
];
