"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AuthProvider, useAuth } from "@/context/AuthContext";
import { NAV_ITEMS } from "@/lib/nav";

function Shell({ children }: { children: React.ReactNode }) {
  const { me, loading, logout } = useAuth();
  const pathname = usePathname();

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
      <aside className="flex w-60 flex-col border-r border-charcoal-700 bg-charcoal-800 px-4 py-6">
        <div className="px-2">
          <p className="font-mono text-xs uppercase tracking-[0.3em] text-lime">Titan OS</p>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`press rounded-lg px-3 py-2 text-sm transition-studio duration-studio ease-studio-out ${
                  active
                    ? "bg-charcoal-600 text-ink"
                    : "text-ink-muted hover:bg-charcoal-700 hover:text-ink"
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="border-t border-charcoal-700 pt-4">
          <p className="truncate px-3 text-xs text-ink-muted">{me.email}</p>
          <p className="px-3 font-mono text-[10px] uppercase tracking-wider text-lime-dim">
            {me.role}
          </p>
          <button
            onClick={logout}
            className="press mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-charcoal-700 hover:text-ink"
          >
            Sign out
          </button>
        </div>
      </aside>
      <main className="flex-1 px-10 py-8">{children}</main>
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
