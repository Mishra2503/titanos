"use client";

import { useState } from "react";
import { ApiError, login } from "@/lib/api";
import { BrandMark, BrandWordmark } from "@/components/BrandMark";

// Only allow same-origin, absolute-path redirects (e.g. the OAuth authorize URL).
// Never follow an external URL from ?next= (open-redirect protection).
function safeNext(next: string | null): string {
  if (next && next.startsWith("/") && !next.startsWith("//")) return next;
  return "/dashboard";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
      // A full navigation (not router.replace) ensures the freshly-set auth cookie
      // is sent on the next request - important when returning to the OAuth flow.
      const next = new URLSearchParams(window.location.search).get("next");
      window.location.href = safeNext(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-charcoal px-6">
      {/* Soft blue glow top-center */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-[40vh] bg-[radial-gradient(60%_60%_at_50%_0%,rgba(80,71,235,0.12),transparent_70%)]"
      />

      <div className="relative w-full max-w-sm animate-reveal">
        <div className="mb-8 flex flex-col items-center gap-3 text-center">
          <BrandMark size={44} />
          <div>
            <h1 className="font-heading text-2xl font-bold tracking-tight text-ink">
              Aifluencee Content Hub
            </h1>
            <p className="mt-1 text-sm text-ink-muted">Sign in to your workspace</p>
          </div>
        </div>

        <div className="rounded-2xl border border-charcoal-700 bg-charcoal-800 p-8 shadow-card">
          <form onSubmit={onSubmit} className="space-y-5">
            <div>
              <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-ink-faint">
                Email address
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl border border-charcoal-700 bg-charcoal px-4 py-3 text-sm text-ink outline-none transition-studio duration-studio ease-studio-out placeholder:text-ink-faint focus:border-lime focus:ring-2 focus:ring-lime/20"
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="text-xs font-semibold uppercase tracking-wider text-ink-faint">
                  Password
                </label>
                <span className="text-xs font-medium text-lime cursor-pointer hover:text-lime-dim">
                  Forgot password?
                </span>
              </div>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-xl border border-charcoal-700 bg-charcoal px-4 py-3 text-sm text-ink outline-none transition-studio duration-studio ease-studio-out placeholder:text-ink-faint focus:border-lime focus:ring-2 focus:ring-lime/20"
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="rounded-lg bg-red-400/10 px-3 py-2 text-xs font-medium text-red-400" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-sm font-semibold disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in →"}
            </button>
          </form>

          <p className="mt-6 text-center text-xs text-ink-faint">
            Invite-only workspace - contact your admin for access.
          </p>
        </div>
      </div>
    </main>
  );
}
