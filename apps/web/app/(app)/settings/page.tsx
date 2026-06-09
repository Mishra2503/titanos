"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader } from "@/components/Placeholder";
import {
  ApiError,
  changePassword,
  getMe,
  getSafetyDefaults,
  getWorkspace,
  inviteUser,
  listUsers,
  logout as apiLogout,
  revokeUser,
  updateWorkspace,
  type Me,
  type SafetyDefaults,
  type Workspace,
  type WorkspaceUser,
} from "@/lib/api";

type Banner = { kind: "ok" | "err"; msg: string } | null;

const ROLE_STYLE: Record<WorkspaceUser["role"], string> = {
  OWNER: "border-lime/40 bg-lime/10 text-lime",
  EDITOR: "border-charcoal-600 bg-charcoal-700 text-ink-muted",
};

const STATUS_STYLE: Record<WorkspaceUser["status"], string> = {
  ACTIVE: "border-lime/40 bg-lime/10 text-lime",
  INVITED: "border-amber-400/40 bg-amber-400/10 text-amber-300",
  REVOKED: "border-red-400/40 bg-red-400/10 text-red-400",
};

function Section({
  title,
  description,
  children,
  ownerOnly,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
  ownerOnly?: boolean;
}) {
  return (
    <section className="animate-reveal rounded-xl border border-charcoal-700 bg-charcoal-800 p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description && <p className="mt-1 text-sm text-ink-muted">{description}</p>}
        </div>
        {ownerOnly && (
          <span className="shrink-0 rounded-full border border-charcoal-600 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-ink-faint">
            Owner only
          </span>
        )}
      </div>
      {children}
    </section>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b border-charcoal-700 py-2.5 last:border-0">
      <span className="font-mono text-xs uppercase tracking-wider text-ink-faint">{label}</span>
      <span className="text-sm text-ink">{value}</span>
    </div>
  );
}

const inputCls =
  "w-full rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-lime/50";

export default function SettingsPage() {
  const router = useRouter();
  const [me, setMe] = useState<Me | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [users, setUsers] = useState<WorkspaceUser[] | null>(null);
  const [safety, setSafety] = useState<SafetyDefaults | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [banner, setBanner] = useState<Banner>(null);

  const isOwner = me?.role === "OWNER";

  const load = useCallback(async () => {
    // Only the identity call is required to render the page. Every other section is
    // best-effort so a lagging/partial backend deploy degrades gracefully instead of
    // blanking the whole page.
    try {
      setMe(await getMe());
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Failed to load settings");
      return;
    }
    await Promise.allSettled([
      getWorkspace().then(setWorkspace),
      getSafetyDefaults().then(setSafety),
      listUsers().then(setUsers),
    ]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // --- Workspace rename ---
  const [wsName, setWsName] = useState("");
  const [savingWs, setSavingWs] = useState(false);
  useEffect(() => {
    if (workspace) setWsName(workspace.name);
  }, [workspace]);

  async function saveWorkspace() {
    if (!wsName.trim() || wsName.trim() === workspace?.name) return;
    setSavingWs(true);
    try {
      setWorkspace(await updateWorkspace(wsName.trim()));
      setBanner({ kind: "ok", msg: "Workspace name updated" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Update failed" });
    } finally {
      setSavingWs(false);
    }
  }

  // --- Password change ---
  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [savingPw, setSavingPw] = useState(false);

  async function savePassword() {
    if (pw.next.length < 8) {
      setBanner({ kind: "err", msg: "New password must be at least 8 characters" });
      return;
    }
    if (pw.next !== pw.confirm) {
      setBanner({ kind: "err", msg: "New passwords do not match" });
      return;
    }
    setSavingPw(true);
    try {
      await changePassword(pw.current, pw.next);
      setPw({ current: "", next: "", confirm: "" });
      setBanner({ kind: "ok", msg: "Password changed" });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Change failed" });
    } finally {
      setSavingPw(false);
    }
  }

  // --- Team ---
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<"OWNER" | "EDITOR">("EDITOR");
  const [inviting, setInviting] = useState(false);
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  async function sendInvite() {
    if (!inviteEmail.trim()) return;
    setInviting(true);
    setInviteToken(null);
    try {
      const res = await inviteUser(inviteEmail.trim(), inviteRole);
      setInviteToken(res.invite_token);
      setInviteEmail("");
      setUsers(await listUsers());
      setBanner({ kind: "ok", msg: `Invited ${res.user.email}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Invite failed" });
    } finally {
      setInviting(false);
    }
  }

  async function revoke(u: WorkspaceUser) {
    if (!confirm(`Revoke access for ${u.email}? They will be signed out and lose access.`)) return;
    setBusyUser(u.id);
    try {
      await revokeUser(u.id);
      setUsers(await listUsers());
      setBanner({ kind: "ok", msg: `Revoked ${u.email}` });
    } catch (err) {
      setBanner({ kind: "err", msg: err instanceof ApiError ? err.message : "Revoke failed" });
    } finally {
      setBusyUser(null);
    }
  }

  async function signOut() {
    await apiLogout().catch(() => {});
    router.replace("/login");
  }

  if (error) {
    return (
      <div>
        <PageHeader title="Settings" />
        <p className="font-mono text-sm text-red-400">{error}</p>
      </div>
    );
  }

  if (!me) {
    return (
      <div>
        <PageHeader title="Settings" />
        <p className="font-mono text-sm text-ink-faint">Loading…</p>
      </div>
    );
  }

  return (
    <div className="max-w-3xl">
      <PageHeader title="Settings" subtitle="Manage your account, team, workspace, and safety rails." />

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
        {/* Profile */}
        <Section title="Profile" description="Your account in this workspace.">
          <div className="rounded-lg border border-charcoal-700 bg-charcoal/50 px-4">
            <Field label="Email" value={me.email} />
            <Field
              label="Role"
              value={
                <span
                  className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${ROLE_STYLE[me.role]}`}
                >
                  {me.role}
                </span>
              }
            />
            <Field
              label="Status"
              value={
                <span className="rounded-full border border-lime/40 bg-lime/10 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-lime">
                  {me.status}
                </span>
              }
            />
          </div>
        </Section>

        {/* Change password */}
        <Section title="Password" description="Use at least 8 characters. You stay signed in on this device.">
          <div className="grid gap-3 sm:max-w-md">
            <input
              type="password"
              autoComplete="current-password"
              placeholder="Current password"
              className={inputCls}
              value={pw.current}
              onChange={(e) => setPw({ ...pw, current: e.target.value })}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="New password"
              className={inputCls}
              value={pw.next}
              onChange={(e) => setPw({ ...pw, next: e.target.value })}
            />
            <input
              type="password"
              autoComplete="new-password"
              placeholder="Confirm new password"
              className={inputCls}
              value={pw.confirm}
              onChange={(e) => setPw({ ...pw, confirm: e.target.value })}
            />
            <button
              onClick={savePassword}
              disabled={savingPw || !pw.current || !pw.next}
              className="press w-fit rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-charcoal disabled:opacity-50"
            >
              {savingPw ? "Saving…" : "Update password"}
            </button>
          </div>
        </Section>

        {/* Workspace */}
        {workspace && (
          <Section title="Workspace" description="Tenant settings for this account." ownerOnly>
            <div className="mb-4 rounded-lg border border-charcoal-700 bg-charcoal/50 px-4">
              <Field label="Plan" value={<span className="font-mono uppercase">{workspace.plan}</span>} />
              <Field label="Members" value={workspace.member_count} />
              <Field
                label="Connections"
                value={`${workspace.connection_count} / ${workspace.connection_limit}`}
              />
            </div>
            <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-ink-faint">
              Workspace name
            </label>
            <div className="flex gap-2 sm:max-w-md">
              <input
                className={inputCls}
                value={wsName}
                disabled={!isOwner}
                onChange={(e) => setWsName(e.target.value)}
              />
              <button
                onClick={saveWorkspace}
                disabled={!isOwner || savingWs || !wsName.trim() || wsName.trim() === workspace.name}
                className="press shrink-0 rounded-lg border border-charcoal-600 px-4 py-2 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
              >
                {savingWs ? "Saving…" : "Save"}
              </button>
            </div>
          </Section>
        )}

        {/* Team */}
        <Section
          title="Team members"
          description="Invite editors to draft content. Owners have full admin access."
          ownerOnly
        >
          {users !== null && (
            <div className="overflow-hidden rounded-lg border border-charcoal-700">
              {users.map((u) => (
                <div
                  key={u.id}
                  className="flex items-center gap-3 border-b border-charcoal-700 px-4 py-3 last:border-0"
                >
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-charcoal-600 font-mono text-xs text-lime">
                    {u.email.slice(0, 2).toUpperCase()}
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{u.email}</span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${ROLE_STYLE[u.role]}`}
                  >
                    {u.role}
                  </span>
                  <span
                    className={`rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${STATUS_STYLE[u.status]}`}
                  >
                    {u.status}
                  </span>
                  {isOwner && u.id !== me.id && u.status !== "REVOKED" && (
                    <button
                      onClick={() => revoke(u)}
                      disabled={busyUser === u.id}
                      className="press rounded-lg border border-red-400/30 px-2.5 py-1 text-xs text-red-400 hover:bg-red-400/10 disabled:opacity-50"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {isOwner && (
            <div className="mt-4">
              <label className="mb-1.5 block font-mono text-xs uppercase tracking-wider text-ink-faint">
                Invite a member
              </label>
              <div className="flex flex-col gap-2 sm:flex-row">
                <input
                  type="email"
                  placeholder="teammate@email.com"
                  className={inputCls}
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <select
                  className="rounded-lg border border-charcoal-600 bg-charcoal px-3 py-2 text-sm text-ink outline-none focus:border-lime/50"
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as "OWNER" | "EDITOR")}
                >
                  <option value="EDITOR">Editor</option>
                  <option value="OWNER">Owner</option>
                </select>
                <button
                  onClick={sendInvite}
                  disabled={inviting || !inviteEmail.trim()}
                  className="press shrink-0 rounded-lg bg-lime px-4 py-2 text-sm font-semibold text-charcoal disabled:opacity-50"
                >
                  {inviting ? "Inviting…" : "Send invite"}
                </button>
              </div>
              {inviteToken && (
                <div className="mt-3 rounded-lg border border-amber-400/40 bg-amber-400/10 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-amber-300">
                    Single-use invite token — shown once. Share it securely with the invitee.
                  </p>
                  <div className="mt-2 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded bg-charcoal px-2 py-1 font-mono text-xs text-ink">
                      {inviteToken}
                    </code>
                    <button
                      onClick={() => {
                        void navigator.clipboard.writeText(inviteToken);
                        setBanner({ kind: "ok", msg: "Invite token copied" });
                      }}
                      className="press shrink-0 rounded-lg border border-charcoal-600 px-2.5 py-1 text-xs text-ink-muted hover:text-ink"
                    >
                      Copy
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </Section>

        {/* Safety rails (read-only) */}
        {safety && (
          <Section
            title="Account safety rails"
            description="Anti-ban guardrails applied to every account at publish time. Configured server-side."
          >
            <div className="mb-4 flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${safety.enabled ? "bg-lime" : "bg-red-400"}`}
              />
              <span className="font-mono text-xs uppercase tracking-wider text-ink-muted">
                Guardrails {safety.enabled ? "active" : "disabled"}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { label: "Daily cap", value: `${safety.daily_cap}/day` },
                { label: "Hourly cap", value: `${safety.hourly_cap}/hr` },
                { label: "Min gap", value: `${safety.min_gap_minutes} min` },
                { label: "Publish jitter", value: `±${safety.jitter_seconds}s` },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-charcoal-700 bg-charcoal/50 p-3">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-ink-faint">
                    {s.label}
                  </p>
                  <p className="mt-1 text-lg font-semibold text-ink">{s.value}</p>
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Session */}
        <Section title="Session" description="Sign out of Titan OS on this device.">
          <button
            onClick={signOut}
            className="press rounded-lg border border-red-400/30 px-4 py-2 text-sm text-red-400 hover:bg-red-400/10"
          >
            Sign out
          </button>
        </Section>
      </div>
    </div>
  );
}
