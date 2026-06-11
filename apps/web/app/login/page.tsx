"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ApiError, login } from "@/lib/api";
import { BrandMark, BrandWordmark } from "@/components/BrandMark";

export default function LoginPage() {
  const router = useRouter();
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
      router.replace("/dashboard");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden px-6">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-[-10%] h-[55vh] bg-[radial-gradient(55%_55%_at_50%_40%,rgba(124,58,237,0.14),transparent_70%)] blur-2xl"
      />
      <div className="relative w-full max-w-sm animate-reveal">
        <div className="mb-6 flex items-center gap-2.5">
          <BrandMark size={36} />
          <BrandWordmark />
        </div>

        <div className="rounded-2xl border border-charcoal-700 bg-charcoal-800 p-8 shadow-pop">
          <h1 className="text-3xl font-bold tracking-tight text-ink">
            Grow smarter <span className="text-lime">with data</span>
          </h1>
          <p className="mt-1.5 text-sm text-ink-muted">Operate every account from one screen.</p>

          <form onSubmit={onSubmit} className="mt-7 space-y-4">
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2.5 text-ink outline-none transition-studio duration-studio ease-studio-out focus:border-lime"
                autoComplete="email"
              />
            </div>
            <div>
              <label className="font-mono text-xs uppercase tracking-wider text-ink-faint">
                Password
              </label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2.5 text-ink outline-none transition-studio duration-studio ease-studio-out focus:border-lime"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <p className="font-mono text-xs text-red-400" role="alert">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="press w-full rounded-lg bg-lime px-4 py-2.5 font-semibold text-white hover:bg-lime-dim disabled:opacity-60"
            >
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
