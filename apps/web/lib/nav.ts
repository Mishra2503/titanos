// Information architecture. ownerOnly items are hidden from EDITORs in UI;
// the server independently enforces access — UI hiding is convenience only.
// `icon` keys map to Phosphor icons in the app shell.
export interface NavItem {
  label: string;
  href: string;
  icon: string;
  ownerOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/dashboard", icon: "dashboard" },
  { label: "Connect Instagram", href: "/connections", icon: "instagram", ownerOnly: true },
  { label: "Content Board", href: "/board", icon: "board" },
  { label: "Scriptwriter", href: "/scriptwriter", icon: "script" },
  { label: "Post & Schedule", href: "/scheduler", icon: "calendar" },
  { label: "Insights", href: "/insights", icon: "chart" },
  { label: "Weekly Report", href: "/reports", icon: "report" },
  { label: "Competitors", href: "/competitors", icon: "binoculars" },
  { label: "Content Library", href: "/library", icon: "library" },
  { label: "Settings", href: "/settings", icon: "settings", ownerOnly: true },
];
