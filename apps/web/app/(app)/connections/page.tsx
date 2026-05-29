"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import { ApiError, apiFetch } from "@/lib/api";

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
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<{ kind: "ok" | "err"; msg: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setAccounts(await apiFetch<Connection[]>("/api/connections"));
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
          title="Connections"
          subtitle={`Manage up to ${MAX_ACCOUNTS} Instagram Business/Creator accounts.`}
        />
        <button
          onClick={connect}
          disabled={busy === "connect" || atLimit}
          className="press rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-charcoal disabled:opacity-50"
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
        <div className="animate-reveal rounded-xl border border-dashed border-charcoal-600 bg-charcoal-800 px-6 py-12 text-center">
          <p className="text-sm text-ink-muted">
            No accounts connected yet. Click “Connect account” to link your first Instagram
            Business/Creator profile.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {accounts?.map((a) => {
          const cap = a.capacity;
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
