"use client";

// Admin user management, driven entirely by the audited admin_* RPCs (each is
// SECURITY DEFINER + checks is_admin() server-side and writes activity_logs).
// Reads go through admin_list_users(), which returns each user's EFFECTIVE
// status (trials resolved by the DB clock) — the same truth the app enforces.
// Hard delete still uses the service-role /api/admin/users route.

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

interface AdminUser {
  id: string;
  email: string | null;
  full_name: string | null;
  is_admin: boolean;
  approved: boolean;
  approved_at: string | null;
  plan: string;
  account_status: string;
  effective_status: string;
  trial_end: string | null;
  suspended_at: string | null;
  created_at: string;
}

type Filter = "all" | "pending" | "trialing" | "active" | "expired" | "suspended";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all",       label: "All" },
  { key: "pending",   label: "Pending" },
  { key: "trialing",  label: "Trialing" },
  { key: "active",    label: "Active" },
  { key: "expired",   label: "Expired" },
  { key: "suspended", label: "Suspended" },
];

function fmtDate(d: string | null): string {
  return d ? new Date(d).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : "—";
}

function planLabel(plan: string): string {
  return { pro_monthly: "Pro Monthly", pro_yearly: "Pro Yearly", trial: "Trial", none: "—" }[plan] ?? plan;
}

function StatusChip({ status }: { status: string }) {
  const cls: Record<string, string> = {
    active: "chip-ok",
    trialing: "chip-ok",
    pending_approval: "chip-warn",
    pending_verification: "chip-warn",
    expired: "chip-warn",
    cancelled: "chip-mute",
    suspended: "chip-err",
  };
  return <span className={cls[status] ?? "chip-mute"}>{status.replace(/_/g, " ")}</span>;
}

function inFilter(status: string, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "pending") return status === "pending_approval" || status === "pending_verification";
  if (f === "expired") return status === "expired" || status === "cancelled";
  return status === f;
}

export function AdminUsers() {
  const supabase = useMemo(() => createClient(), []);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("all");

  const load = useCallback(async () => {
    setError(null);
    const { data, error } = await supabase.rpc("admin_list_users");
    if (error) {
      setError(error.message || "Failed to load users.");
      setLoading(false);
      return;
    }
    setUsers((data as AdminUser[]) ?? []);
    setLoading(false);
  }, [supabase]);

  useEffect(() => { load(); }, [load]);

  // Run an admin action: optional confirm, per-row busy, error surface, reload.
  async function run(
    id: string,
    fn: () => Promise<{ error: unknown }>,
    confirmMsg?: string,
  ): Promise<void> {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setBusyId(id);
    setError(null);
    try {
      const { error } = await fn();
      if (error) {
        setError((error as { message?: string }).message || "Action failed.");
        return;
      }
      await load(); // reload so effective_status recomputes
    } catch (e) {
      setError((e as Error).message || "Network error.");
    } finally {
      setBusyId(null);
    }
  }

  const approve = (u: AdminUser) =>
    run(u.id, async () => {
      const { error } = await supabase.rpc("admin_approve_user", { target: u.id, trial_days: 7 });
      return { error };
    });

  const extendTrial = (u: AdminUser) => {
    const raw = window.prompt(`Extend trial for ${u.email ?? "user"} by how many days?`, "7");
    if (raw == null) return;
    const days = Number(raw);
    if (!Number.isFinite(days) || days <= 0) { setError("Enter a positive number of days."); return; }
    return run(u.id, async () => {
      const { error } = await supabase.rpc("admin_extend_trial", { target: u.id, add_days: days });
      return { error };
    });
  };

  const grant = (u: AdminUser, plan: "pro_monthly" | "pro_yearly", months: number) =>
    run(
      u.id,
      async () => {
        const { error } = await supabase.rpc("admin_grant_plan", { target: u.id, new_plan: plan, months });
        return { error };
      },
      `Grant ${planLabel(plan)} to ${u.email ?? "this user"}?`,
    );

  const suspend = (u: AdminUser) =>
    run(
      u.id,
      async () => {
        const { error } = await supabase.rpc("admin_suspend_user", { target: u.id });
        return { error };
      },
      `Suspend ${u.email ?? "this user"}? They lose all access immediately.`,
    );

  const restore = (u: AdminUser) =>
    run(u.id, async () => {
      const { error } = await supabase.rpc("admin_reactivate_user", { target: u.id });
      return { error };
    });

  const revoke = (u: AdminUser) =>
    run(
      u.id,
      async () => {
        const { error } = await supabase.rpc("admin_revoke_access", { target: u.id });
        return { error };
      },
      `Remove access for ${u.email ?? "this user"}? Plan is cleared and any subscription cancelled.`,
    );

  const remove = (u: AdminUser) =>
    run(
      u.id,
      async () => {
        const res = await fetch("/api/admin/users", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: u.id }),
        });
        const d = await res.json().catch(() => ({}));
        return { error: !res.ok || !d.ok ? { message: d.error || "Delete failed." } : null };
      },
      `Permanently DELETE ${u.email ?? "this user"}? This removes their account and cannot be undone.`,
    );

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: users.length, pending: 0, trialing: 0, active: 0, expired: 0, suspended: 0 };
    for (const u of users) {
      (["pending", "trialing", "active", "expired", "suspended"] as Filter[]).forEach((f) => {
        if (inFilter(u.effective_status, f)) c[f]++;
      });
    }
    return c;
  }, [users]);

  const shown = useMemo(() => users.filter((u) => inFilter(u.effective_status, filter)), [users, filter]);

  if (loading) {
    return <div className="surface p-6 text-sm text-zinc-400">Loading users…</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={filter === f.key ? "btn-primary" : "btn-ghost"}
          >
            {f.label} <span className="opacity-60">({counts[f.key]})</span>
          </button>
        ))}
        <button className="btn-ghost ml-auto" onClick={load}>Refresh</button>
      </div>

      <div className="surface overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left border-b border-zinc-700/60">
              <th className="px-4 py-3 label">User</th>
              <th className="px-4 py-3 label">Plan</th>
              <th className="px-4 py-3 label">Status</th>
              <th className="px-4 py-3 label">Approved</th>
              <th className="px-4 py-3 label">Trial ends</th>
              <th className="px-4 py-3 label text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((u) => {
              const busy = busyId === u.id;
              const suspended = u.effective_status === "suspended";
              return (
                <tr key={u.id} className="border-b border-zinc-800/60 last:border-0 align-top">
                  <td className="px-4 py-3">
                    <div className="font-mono text-zinc-700 dark:text-zinc-200 break-all">{u.email ?? "—"}</div>
                    {u.full_name && <div className="text-xs text-zinc-500">{u.full_name}</div>}
                  </td>
                  <td className="px-4 py-3 text-zinc-400">{planLabel(u.plan)}</td>
                  <td className="px-4 py-3">
                    {u.is_admin ? <span className="chip-ok">admin</span> : <StatusChip status={u.effective_status} />}
                  </td>
                  <td className="px-4 py-3 text-zinc-400 font-mono">{fmtDate(u.approved_at)}</td>
                  {/* trial_end is only meaningful while the plan IS a trial. compute_access()
                      ignores it for pro_* plans, and admin_grant_plan upgrades a user without
                      clearing the old date — so rendering it unconditionally made paid accounts
                      look like expired trials. Every other consumer (sidebar chip, subscription
                      page, extension side panel) already guards on the status; this one did not. */}
                  <td className="px-4 py-3 text-zinc-400 font-mono">
                    {u.plan === "trial" ? fmtDate(u.trial_end) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {u.is_admin ? (
                      <div className="text-right text-xs text-zinc-500">—</div>
                    ) : (
                      <div className="flex flex-wrap justify-end gap-1.5 text-xs">
                        {!u.approved && (
                          <button className="btn-primary" disabled={busy} onClick={() => approve(u)}>
                            {busy ? "…" : "Approve"}
                          </button>
                        )}
                        {u.approved && !suspended && (
                          <>
                            <button className="btn-ghost" disabled={busy} onClick={() => extendTrial(u)}>Extend</button>
                            <button className="btn-ghost" disabled={busy} onClick={() => grant(u, "pro_monthly", 1)}>+Monthly</button>
                            <button className="btn-ghost" disabled={busy} onClick={() => grant(u, "pro_yearly", 12)}>+Yearly</button>
                            <button className="btn-ghost" disabled={busy} onClick={() => suspend(u)}>Suspend</button>
                            <button className="btn-ghost" disabled={busy} onClick={() => revoke(u)}>Remove</button>
                          </>
                        )}
                        {suspended && (
                          <button className="btn-primary" disabled={busy} onClick={() => restore(u)}>
                            {busy ? "…" : "Restore"}
                          </button>
                        )}
                        <button className="btn-ghost text-danger-500" disabled={busy} onClick={() => remove(u)}>Delete</button>
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-zinc-500">
                  No users in this view.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
