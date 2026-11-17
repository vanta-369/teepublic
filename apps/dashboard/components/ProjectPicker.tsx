"use client";

// The Project row on Create Product: pick which project (TeePublic account)
// this batch is for, or make a new one. The choice is remembered per browser
// profile by the parent. Under each project: its uploads in the last 24h
// against its daily limit, counted by the extension in this Chrome profile,
// with "Fix count" to correct it.

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import type { UploadQuota } from "@teepublic/shared";
import type { Project } from "@/lib/projects";
import { fetchQuotas, setQuotaLimit, setQuotaUsed } from "@/lib/bridge";

export function ProjectPicker({
  projects, chosenId, error, onChoose, onCreate,
}: {
  projects: Project[] | null;
  chosenId: string | null;
  /** Projects could not be loaded (e.g. migration 0013 not applied). */
  error: string | null;
  onChoose: (id: string) => void;
  onCreate: (name: string) => Promise<void>;
}) {
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // Quotas live in the extension; refresh every 30s so a running upload shows.
  const [quotas, setQuotas] = useState<Record<string, UploadQuota> | null>(null);
  const [quotaError, setQuotaError] = useState<string | null>(null);
  const ids = (projects ?? []).map((p) => p.id).join(",");
  const loadQuotas = useCallback(async () => {
    if (!ids) return;
    try { setQuotas(await fetchQuotas(ids.split(","))); setQuotaError(null); }
    catch (e) { setQuotaError(quotaProblem(e instanceof Error ? e.message : String(e))); }
  }, [ids]);
  useEffect(() => {
    void loadQuotas();
    const t = setInterval(() => void loadQuotas(), 30_000);
    return () => clearInterval(t);
  }, [loadQuotas]);
  const merge = (q: Record<string, UploadQuota>) => setQuotas((cur) => ({ ...(cur ?? {}), ...q }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setCreateError(null);
    try {
      await onCreate(name);
      setName("");
      setAdding(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : "Could not create the project.");
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return <p className="cp-error mb-4">Projects unavailable - apply migration 0013 in Supabase. Uploads still count toward your total.</p>;
  }

  return (
    <div className="mb-6">
      <p className="mb-2 text-[11px] font-medium uppercase tracking-wider text-zinc-500">
        Project <span className="normal-case tracking-normal">- the TeePublic account these designs are for</span>
      </p>
      <div className="flex flex-wrap items-start gap-3">
        {projects === null && <span className="text-sm text-zinc-500">Loading projects…</span>}
        {projects?.map((p) => (
          <div key={p.id} className="flex w-56 flex-col gap-2">
            <button
              type="button"
              onClick={() => onChoose(p.id)}
              aria-pressed={p.id === chosenId}
              className={clsx(
                "truncate rounded-full px-4 py-2 text-sm font-semibold transition",
                p.id === chosenId
                  ? "bg-accent-500 text-zinc-950"
                  : "bg-ink-800 text-zinc-700 hover:bg-ink-700 dark:text-zinc-200"
              )}
            >
              {p.name}
            </button>
            <QuotaCounter
              quota={quotas?.[p.id] ?? null}
              problem={quotaError}
              onRetry={() => void loadQuotas()}
              onLimit={async (n) => merge(await setQuotaLimit(p.id, n))}
              onFix={async (n) => merge(await setQuotaUsed(p.id, n))}
            />
          </div>
        ))}
        {!adding ? (
          projects !== null && (
            <button type="button" className="cp-pill !py-2" onClick={() => setAdding(true)}>+ New project</button>
          )
        ) : (
          <form onSubmit={submit} className="flex items-center gap-2">
            <input
              autoFocus
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Baseball"
              className="w-44 rounded-full bg-ink-800 px-4 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-500 focus:ring-2 focus:ring-accent-500/50 dark:text-zinc-100"
            />
            <button type="submit" className="cp-pill cp-pill-primary !py-2" disabled={!name.trim() || busy}>{busy ? "Adding…" : "Add"}</button>
            <button type="button" className="cp-link" onClick={() => { setAdding(false); setName(""); setCreateError(null); }}>Cancel</button>
          </form>
        )}
      </div>
      {createError && <p className="cp-error mt-2">{createError}</p>}
      {projects !== null && projects.length > 0 && !chosenId && (
        <p className="mt-2 text-sm text-zinc-500">Choose a project to start uploading designs.</p>
      )}
      {projects !== null && projects.length === 0 && !adding && (
        <p className="mt-2 text-sm text-zinc-500">Make your first project - one for each TeePublic account.</p>
      )}
    </div>
  );
}

/** "Uploads · last 24h": used / limit, a bar, what's left, when a slot frees,
 *  and the daily limit + Fix count controls. */
function QuotaCounter({
  quota, problem, onRetry, onLimit, onFix,
}: {
  quota: UploadQuota | null;
  /** Why the extension couldn't answer, in plain words. */
  problem: string | null;
  onRetry: () => void;
  onLimit: (limit: number) => Promise<void>;
  onFix: (used: number) => Promise<void>;
}) {
  if (problem) {
    return (
      <div className="rounded-xl bg-ink-800/60 p-3 text-[11px] text-zinc-500">
        <p>{problem}</p>
        <button type="button" onClick={onRetry} className="mt-1.5 font-semibold text-accent-600 hover:underline dark:text-accent-400">Retry</button>
      </div>
    );
  }
  if (!quota) return <p className="px-1 text-[11px] text-zinc-500">Loading counter…</p>;

  const { limit, used, remaining, nextFreeAt } = quota;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const full = remaining <= 0;

  async function fix() {
    const answer = window.prompt("How many designs did you already upload on this account in the last 24 hours?", String(used));
    if (answer == null) return;
    const n = Math.floor(Number(answer));
    if (!Number.isFinite(n) || n < 0) return;
    await onFix(n);
  }

  return (
    <div className="rounded-xl bg-ink-800/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">Uploads · last 24h</span>
        <span className="text-xs font-semibold tabular-nums text-zinc-800 dark:text-zinc-100">{used} / {limit}</span>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div className={clsx("h-full rounded-full transition-all", full ? "bg-red-500" : "bg-accent-500")} style={{ width: `${pct}%` }} />
      </div>
      {/* The free uploads left today, as a message. */}
      <p className={clsx("mt-2 rounded-lg px-2.5 py-1.5 text-xs font-semibold",
        full ? "bg-red-500/10 text-red-400" : "bg-accent-500/10 text-accent-600 dark:text-accent-400")}>
        {full
          ? `0 free - limit reached${nextFreeAt ? `, next slot ${fmtWait(nextFreeAt - Date.now())}` : ""}`
          : `${remaining} free upload${remaining === 1 ? "" : "s"} left`}
      </p>
      {!full && nextFreeAt && <p className="mt-1 text-[11px] text-zinc-500">next slot frees {fmtWait(nextFreeAt - Date.now())}</p>}
      <div className="mt-2.5 flex items-center justify-between gap-2">
        <label className="flex items-center gap-1.5 text-[11px] text-zinc-500">
          Daily limit
          <input
            type="number"
            min={0}
            max={1000}
            defaultValue={limit}
            key={limit}
            onBlur={(e) => { const n = Math.floor(Number(e.target.value)); if (Number.isFinite(n) && n !== limit) void onLimit(n); }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
            className="w-14 rounded-md bg-ink-700 px-1.5 py-0.5 text-xs text-zinc-800 outline-none focus:ring-2 focus:ring-accent-500/50 dark:text-zinc-100"
          />
        </label>
        <button
          type="button"
          onClick={() => void fix()}
          className="rounded-full px-2 py-0.5 text-[11px] font-semibold text-accent-600 hover:bg-accent-500/10 dark:text-accent-400"
          title="Set how many you already uploaded in the last 24h"
        >
          Fix count
        </button>
      </div>
    </div>
  );
}

function fmtWait(ms: number): string {
  if (ms <= 0) return "now";
  const m = Math.ceil(ms / 60_000);
  if (m < 60) return `in ${m} min`;
  const h = Math.floor(m / 60);
  return `in ${h}h ${m % 60}m`;
}

/** Turn the bridge's error into what to do about it. */
function quotaProblem(message: string): string {
  if (/unknown message type/i.test(message)) {
    return "The extension in this Chrome is an older version without the counter. Reload it in chrome://extensions (or update it), then Retry.";
  }
  if (/not installed|not configured/i.test(message)) {
    return "The extension isn't reachable. Install it, or paste your unpacked extension's ID on the Extension page (Advanced), then Retry.";
  }
  return `Counter unavailable: ${message}`;
}
