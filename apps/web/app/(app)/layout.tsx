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
      <aside className="sticky top-0 flex h-screen w-60 flex-col border-r border-charcoal-700 bg-charcoal-800 px-4 py-6">
        <div className="flex items-center gap-2 px-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-lime font-serif text-sm italic text-white">
            T
          </span>
          <p className="font-mono text-xs font-semibold uppercase tracking-[0.3em] text-ink">
            Titan&nbsp;OS
          </p>
        </div>
        <nav className="mt-8 flex flex-1 flex-col gap-1 overflow-y-auto">
          {items.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`press rounded-lg px-3 py-2 text-sm transition-studio duration-studio ease-studio-out ${
                  active
                    ? "bg-lime/10 font-medium text-lime"
                    : "text-ink-muted hover:bg-charcoal hover:text-ink"
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
            className="press mt-2 w-full rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-charcoal hover:text-ink"
          >
            Sign out
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
