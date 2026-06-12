"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { ApiError, apiFetch } from "@/lib/api";

type HealthLevel = "GREEN" | "YELLOW" | "RED";
interface AccountHealth {
  ig_account_id: string;
  level: HealthLevel;
  posts_24h: number;
  posts_7d: number;
  reasons: string[];
}
interface SafetyOverview {
  defaults: { daily_cap: number; hourly_cap: number; min_gap_minutes: number; jitter_seconds: number; enabled: boolean };
  accounts: AccountHealth[];
}
const HEALTH_STYLE: Record<HealthLevel, string> = {
  GREEN: "border-lime/40 bg-lime/10 text-lime",
  YELLOW: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  RED: "border-red-400/40 bg-red-400/10 text-red-400",
};
const HEALTH_LABEL: Record<HealthLevel, string> = {
  GREEN: "Safe",
  YELLOW: "Caution",
  RED: "Pause",
};

const MAX_ACCOUNTS = 10;

interface Capacity {
  used: number | null;
  total: number | null;
  remaining: number | null;
}

interface Connection {
  id: string;
  ig_user_id: string;
  username: string;
  account_type: string | null;
  status: "CONNECTED" | "NEEDS_REAUTH" | "WARMING";
  followers_count: number | null;
  token_expires_at: string | null;
  last_synced_at: string | null;
  capacity: Capacity | null;
}

const STATUS_STYLE: Record<Connection["status"], string> = {
  CONNECTED: "text-lime border-lime/40 bg-lime/10",
  NEEDS_REAUTH: "text-red-400 border-red-400/40 bg-red-400/10",
  WARMING: "text-amber-400 border-amber-400/40 bg-amber-400/10",
};

const STATUS_LABEL: Record<Connection["status"], string> = {
  CONNECTED: "Connected",
  NEEDS_REAUTH: "Needs re-auth",
  WARMING: "Warming",
};

export default function ConnectionsPage() {
  const [accounts, setAccounts] = useState<Connection[] | null>(null);
  const [safety, setSafety] = useState<SafetyOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiFetch<Connection[]>("/api/connections"));
      setSafety(await apiFetch<SafetyOverview>("/api/safety/health"));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load connections");
    }
  }, []);

  useEffect(() => {
    // Surface the OAuth callback result, then strip the query from the URL.
    const params = new URLSearchParams(window.location.search);
    if (params.get("connected")) {
      setBanner({ kind: "ok", msg: `Connected @${params.get("connected")}` });
    } else if (params.get("error")) {
      setBanner({ kind: "err", msg: params.get("error") as string });
    }
    if (params.toString()) window.history.replaceState({}, "", "/connections");
    void load();
  }, [load]);

  async function connect() {
    setBusy("connect");
    try {
      const { authorize_url } = await apiFetch<{ authorize_url: string }>(
        "/api/connections/oauth/start",
      );
      window.location.href = authorize_url;
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Could not start" });
      setBusy(null);
    }
  }

  async function refresh(id: string) {
    setBusy(id);
    try {
      await apiFetch(`/api/connections/${id}/refresh`, { method: "POST" });
      await load();
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Refresh failed" });
    } finally {
      setBusy(null);
    }
  }

  async function disconnect(id: string, username: string) {
    if (!confirm(`Disconnect @${username}? This removes the stored token and its queued posts.`))
      return;
    setBusy(id);
    try {
      await apiFetch(`/api/connections/${id}/disconnect`, { method: "POST" });
      await load();
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Disconnect failed" });
    } finally {
      setBusy(null);
    }
  }

  const atLimit = (accounts?.length ?? 0) >= MAX_ACCOUNTS;

  return (
    <div>
      <div className="flex items-start justify-between">
        <PageHeader
          title="Connect Instagram"
          subtitle={`Link up to ${MAX_ACCOUNTS} Instagram Business/Creator accounts via Meta's official OAuth.`}
        />
        <button
          onClick={connect}
          disabled={busy === "connect" || atLimit}
          className="btn-primary press disabled:opacity-50"
        >
          {busy === "connect" ? "Redirecting…" : atLimit ? "Limit reached" : "Connect account"}
        </button>
      </div>

      {banner && (
        <div
          className={`mb-6 animate-reveal rounded-lg border px-4 py-2.5 text-sm ${
            banner.kind === "ok"
              ? "border-lime/40 bg-lime/10 text-lime"
              : "border-red-400/40 bg-red-400/10 text-red-400"
          }`}
        >
          {banner.msg}
        </div>
      )}

      {error && <p className="font-mono text-sm text-red-400">{error}</p>}

      {accounts && accounts.length === 0 && (
        <div className="space-y-4">
          <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-10 text-center">
            <p className="text-sm text-ink-muted">
              No accounts connected yet. Click <strong className="text-ink">"Connect account"</strong> to link your first Instagram
              Business/Creator profile.
            </p>
          </div>
          <div className="rounded-lg border border-charcoal-700 bg-charcoal-800 px-4 py-3 text-xs text-ink-muted space-y-2">
            <p className="font-mono uppercase tracking-wider text-lime text-[10px]">OAuth setup checklist</p>
            <ol className="list-decimal list-inside space-y-1 text-[11px]">
              <li>In Meta Developer Console, add <span className="font-mono text-ink bg-charcoal-700 px-1 rounded">/api/connections/oauth/callback</span> as a Valid OAuth Redirect URI.</li>
              <li>Set <span className="font-mono text-ink bg-charcoal-700 px-1 rounded">INSTAGRAM_APP_ID</span> and <span className="font-mono text-ink bg-charcoal-700 px-1 rounded">INSTAGRAM_APP_SECRET</span> in your API <span className="font-mono">.env</span>.</li>
              <li>Set <span className="font-mono text-ink bg-charcoal-700 px-1 rounded">WEB_BASE_URL</span> to your frontend origin (e.g. <span className="font-mono text-ink">http://localhost:3000</span>).</li>
              <li>Your Instagram account must be a <strong className="text-ink">Business</strong> or <strong className="text-ink">Creator</strong> account linked to a Facebook Page.</li>
            </ol>
            <p className="text-[10px] text-ink-faint mt-1">If you see an &ldquo;Invalid or expired state&rdquo; error, your <span className="font-mono">SECRET_KEY</span> env var may be missing or mismatched.</p>
          </div>
        </div>
      )}

      {safety && (
        <div className="mb-4 rounded-lg border border-charcoal-700 bg-charcoal-800 px-4 py-2 text-xs text-ink-muted">
          <span className="font-mono uppercase tracking-wider text-lime">Anti-ban guardrails active</span>
          <span className="ml-2">
            Max <strong className="text-ink">{safety.defaults.daily_cap}</strong>/day ·{" "}
            <strong className="text-ink">{safety.defaults.hourly_cap}</strong>/hour ·{" "}
            <strong className="text-ink">{safety.defaults.min_gap_minutes} min</strong> minimum gap ·{" "}
            <strong className="text-ink">±{safety.defaults.jitter_seconds}s</strong> publish jitter
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts?.map((a) => {
          const cap = a.capacity;
          const health = safety?.accounts.find((h) => h.ig_account_id === a.id);
          const pct =
            cap && cap.total && cap.used != null
              ? Math.min(100, Math.round((cap.used / cap.total) * 100))
              : null;
          return (
            <div
              key={a.id}
              className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-5"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-charcoal-600 font-mono text-sm text-lime">
                  {a.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-ink">@{a.username}</p>
                  <p className="font-mono text-xs text-ink-faint">
                    {a.followers_count != null
                      ? `${a.followers_count.toLocaleString()} followers`
                      : "—"}
                  </p>
                </div>
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[a.status]}`}
                >
                  {STATUS_LABEL[a.status]}
                </span>
              </div>

              <div className="mt-4">
                <div className="flex justify-between font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                  <span>Daily publish capacity</span>
                  <span>
                    {cap && cap.used != null && cap.total != null
                      ? `${cap.used}/${cap.total}`
                      : "—"}
                  </span>
                </div>
                <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-charcoal-600">
                  <div
                    className="h-full rounded-full bg-lime transition-studio duration-studio ease-studio-out"
                    style={{ width: `${pct ?? 0}%` }}
                  />
                </div>
              </div>

              {health && (
                <div className={`mt-3 rounded-lg border px-2.5 py-1.5 text-[11px] ${HEALTH_STYLE[health.level]}`}>
                  <div className="flex items-center justify-between font-mono uppercase tracking-wider">
                    <span>Safety: {HEALTH_LABEL[health.level]}</span>
                    <span className="opacity-80">
                      {health.posts_24h}/24h · {health.posts_7d}/7d
                    </span>
                  </div>
                  {health.reasons[0] && (
                    <p className="mt-0.5 text-[10px] opacity-90">{health.reasons[0]}</p>
                  )}
                </div>
              )}

              <div className="mt-4 flex gap-2">
                <button
                  onClick={() => refresh(a.id)}
                  disabled={busy === a.id}
                  className="press flex-1 rounded-lg border border-charcoal-600 px-3 py-1.5 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  Refresh
                </button>
                <button
                  onClick={() => disconnect(a.id, a.username)}
                  disabled={busy === a.id}
                  className="press flex-1 rounded-lg border border-red-400/30 px-3 py-1.5 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                >
                  Disconnect
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
