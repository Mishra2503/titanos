"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Binoculars,
  CalendarPlus,
  ChartLineUp,
  ClipboardText,
  FilmStrip,
  GearSix,
  InstagramLogo,
  Kanban,
  PencilLine,
  SidebarSimple,
  SignOut,
  SquaresFour,
} from "@phosphor-icons/react";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { NAV_ITEMS } from "@/lib/nav";
import { BrandMark, BrandWordmark } from "@/components/BrandMark";

const ICONS: Record<string, React.ComponentType<{ size?: number; weight?: "regular" | "bold" | "fill" | "duotone" }>> = {
  dashboard: SquaresFour,
  instagram: InstagramLogo,
  board: Kanban,
  script: PencilLine,
  calendar: CalendarPlus,
  chart: ChartLineUp,
  report: ClipboardText,
  binoculars: Binoculars,
  library: FilmStrip,
  settings: GearSix,
};

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useAuth();
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);

  // Persist the collapsed preference across visits.
  useEffect(() => {
    setCollapsed(localStorage.getItem("titan.sidebar") === "collapsed");
  }, []);
  function toggleSidebar() {
    setCollapsed((c) => {
      localStorage.setItem("titan.sidebar", c ? "expanded" : "collapsed");
      return !c;
    });
  }

  if (loading || !me) {
    return (
      <div className="flex min-h-screen items-center justify-center font-mono text-sm text-ink-faint">
        Loading…
      </div>
    );
  }

  const items = NAV_ITEMS.filter((i) => !i.ownerOnly || me.role === "OWNER");

  return (
    <div className="flex min-h-screen">
      <aside
        className={`sticky top-0 flex h-screen flex-col border-r border-charcoal-700 bg-charcoal-800 py-6 transition-[width] duration-200 ease-studio-out ${
          collapsed ? "w-[72px] px-3" : "w-60 px-4"
        }`}
      >
        <div className={`flex items-center ${collapsed ? "justify-center" : "justify-between px-2"}`}>
          <div className="flex items-center gap-2.5">
            <BrandMark size={34} />
            {!collapsed && <BrandWordmark stacked />}
          </div>
        </div>

        <button
          onClick={toggleSidebar}
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          className={`press mt-4 flex items-center gap-2 rounded-lg px-2.5 py-2 text-ink-faint hover:bg-charcoal hover:text-ink ${
            collapsed ? "justify-center" : ""
          }`}
        >
          <SidebarSimple size={18} />
          {!collapsed && <span className="text-xs font-medium">Collapse</span>}
        </button>

        <nav className="mt-3 flex flex-1 flex-col gap-1 overflow-y-auto overflow-x-hidden">
          {items.map((item) => {
            const active = pathname === item.href;
            const Icon = ICONS[item.icon] ?? SquaresFour;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={`press flex items-center gap-2.5 rounded-lg py-2 text-sm transition-studio duration-studio ease-studio-out ${
                  collapsed ? "justify-center px-2" : "px-3"
                } ${
                  active
                    ? "bg-lime/10 font-semibold text-lime"
                    : "font-medium text-ink-muted hover:bg-charcoal hover:text-ink"
                }`}
              >
                <Icon size={18} weight={active ? "fill" : "regular"} />
                {!collapsed && <span className="truncate">{item.label}</span>}
              </Link>
            );
          })}
        </nav>

        <div className={`border-t border-charcoal-700 pt-4 ${collapsed ? "text-center" : ""}`}>
          {!collapsed && (
            <>
              <p className="truncate px-3 text-xs font-medium text-ink-muted">{me.email}</p>
              <p className="px-3 font-mono text-[10px] uppercase tracking-wider text-lime-dim">
                {me.role}
              </p>
            </>
          )}
          <button
            onClick={logout}
            title="Sign out"
            className={`press mt-2 flex w-full items-center gap-2.5 rounded-lg py-2 text-left text-sm font-medium text-ink-muted hover:bg-charcoal hover:text-ink ${
              collapsed ? "justify-center px-2" : "px-3"
            }`}
          >
            <SignOut size={18} />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-10 py-8">{children}</main>
    </div>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <Shell>{children}</Shell>
    </AuthProvider>
  );
}
