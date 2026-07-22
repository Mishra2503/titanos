"use client";

import { useCallback, useEffect, useState } from "react";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  listAccessTokens,
  createAccessToken,
  revokeAccessToken,
  type AccessToken,
} from "@/lib/api";

type Banner = { kind: "ok" | "err"; msg: string } | null;

const inputCls =
  "w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50";

function Section({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="mb-5">
        <h2 className="text-base font-semibold text-ink">{title}</h2>
        {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function CopyBox({ value, onCopy }: { value: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <code className="min-w-0 flex-1 truncate rounded bg-charcoal px-2 py-1 font-mono text-xs text-ink">{value}</code>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(value);
          onCopy();
        }}
        className="press shrink-0 rounded-lg border border-charcoal-600 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
      >
        Copy
      </button>
    </div>
  );
}

export default function ConnectorsPage() {
  const [tokens, setTokens] = useState<AccessToken[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);
  const [mcpUrl, setMcpUrl] = useState("");

  const load = useCallback(async () => {
    try {
      setTokens(await listAccessTokens());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load tokens");
    }
  }, []);

  useEffect(() => {
    setMcpUrl(`${window.location.origin}/api/mcp`);
    void load();
  }, [load]);

  const [name, setName] = useState("");
  const [readonly, setReadonly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [newToken, setNewToken] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setNewToken(null);
    try {
      const scopes = readonly ? ["read"] : [];
      const res = await createAccessToken(name.trim(), scopes);
      setNewToken(res.token);
      setName("");
      setReadonly(false);
      setTokens(await listAccessTokens());
      setBanner({ kind: "ok", msg: "Token created - copy it now, it won't be shown again." });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Create failed" });
    } finally {
      setCreating(false);
    }
  }

  async function revoke(t: AccessToken) {
    if (!confirm(`Revoke "${t.name}"? Any connector using it stops working immediately.`)) return;
    setBusyId(t.id);
    try {
      await revokeAccessToken(t.id);
      setTokens(await listAccessTokens());
      setBanner({ kind: "ok", msg: `Revoked "${t.name}"` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Revoke failed" });
    } finally {
      setBusyId(null);
    }
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Connectors" />
        <p className="font-mono text-sm text-red-400">{error}</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="AI Connectors (MCP)"
        subtitle="Connect Titan OS to Claude, ChatGPT, or any LLM. Generate a token, add the connector, and drive your content ops from chat."
      />

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

      <div className="flex flex-col gap-5">
        {/* How to connect */}
        <Section title="Connection details" description="Point any MCP-compatible client at this URL and authenticate with a token below.">
          <div className="mb-4">
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-ink-faint">MCP endpoint URL</label>
            <CopyBox value={mcpUrl} onCopy={() => setBanner({ kind: "ok", msg: "URL copied" })} />
          </div>
          <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-ink-faint">Add to Claude Code</label>
          <CopyBox
            value={`claude mcp add --transport http titan-os ${mcpUrl} --header "Authorization: Bearer <your-token>"`}
            onCopy={() => setBanner({ kind: "ok", msg: "Command copied" })}
          />
          <p className="mt-3 text-xs text-ink-muted">
            For Claude web or ChatGPT, add a custom/remote connector with the URL above and header{" "}
            <code className="rounded bg-charcoal px-1 py-0.5 font-mono text-[11px]">Authorization: Bearer &lt;your-token&gt;</code>.
          </p>
        </Section>

        {/* Create token */}
        <Section title="Create a token" description="A token grants your own access. Read-only tokens can view data but cannot schedule, edit, or run AI actions.">
          <div className="flex flex-col gap-3 sm:max-w-md">
            <input
              placeholder="Token name (e.g. My laptop Claude)"
              className={inputCls}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <label className="flex items-center gap-2 text-sm text-ink-muted">
              <input type="checkbox" checked={readonly} onChange={(e) => setReadonly(e.target.checked)} />
              Read-only (no writes)
            </label>
            <button onClick={create} disabled={creating || !name.trim()} className="btn-primary press w-fit disabled:opacity-50">
              {creating ? "Creating…" : "Generate token"}
            </button>
          </div>

          {newToken && (
            <div className="mt-4 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
              <p className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                Copy this token now - it is shown once and cannot be retrieved again.
              </p>
              <div className="mt-2">
                <CopyBox value={newToken} onCopy={() => setBanner({ kind: "ok", msg: "Token copied" })} />
              </div>
            </div>
          )}
        </Section>

        {/* Existing tokens */}
        <Section title="Active tokens" description="Revoke a token to instantly cut off any connector using it.">
          {tokens !== null && tokens.length === 0 && (
            <p className="font-mono text-sm text-ink-faint">No tokens yet.</p>
          )}
          {tokens !== null && tokens.length > 0 && (
            <div className="overflow-hidden rounded-lg border border-charcoal-700">
              {tokens.map((t) => (
                <div key={t.id} className="flex items-center gap-3 border-b border-charcoal-700 px-4 py-3 last:border-0">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-ink">{t.name}</p>
                    <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                      {t.scopes.includes("read") && !t.scopes.includes("write") ? "read-only" : "full access"}
                      {" · "}
                      {t.last_used_at ? `last used ${new Date(t.last_used_at).toLocaleDateString()}` : "never used"}
                      {t.expires_at ? ` · expires ${new Date(t.expires_at).toLocaleDateString()}` : ""}
                    </p>
                  </div>
                  <button
                    onClick={() => revoke(t)}
                    disabled={busyId === t.id}
                    className="press rounded-lg border border-red-400/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                  >
                    Revoke
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
