"use client";

// Dashboard: upload history per project - designs published and failed each
// day, the last 14 days as bars plus 7 / 30 day totals. The tally is kept by
// the extension in this Chrome profile (HISTORY_GET); nothing about it is on
// the server, so each profile shows the uploads it ran.

import * as React from "react";
import type { UploadDay } from "@teepublic/shared";
import { listProjects, type Project } from "@/lib/projects";
import { fetchHistory } from "@/lib/bridge";

const DAYS = 14;

function lastDays(n: number): string[] {
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(new Date(Date.now() - i * 86_400_000).toISOString().slice(0, 10));
  return out;
}

function total(days: Record<string, UploadDay>, n: number) {
  return lastDays(n).reduce((t, d) => ({ done: t.done + (days[d]?.done ?? 0), failed: t.failed + (days[d]?.failed ?? 0) }), { done: 0, failed: 0 });
}

export function UploadHistoryPanel() {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [history, setHistory] = React.useState<Record<string, Record<string, UploadDay>> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const list = await listProjects();
      setProjects(list);
      if (list.length) setHistory(await fetchHistory(list.map((p) => p.id)));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Upload history</h2>
        <button type="button" onClick={() => void load()} className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">Refresh</button>
      </div>

      {error && (
        <p className="su-card p-5 text-sm text-zinc-500 dark:text-zinc-400">
          History unavailable - {/unknown message type/i.test(error)
            ? "the extension in this Chrome is an older version. Reload it in chrome://extensions, then Refresh."
            : error}
        </p>
      )}

      {!error && projects && projects.length === 0 && (
        <p className="su-card p-5 text-sm text-zinc-500 dark:text-zinc-400">No projects yet - history starts with your first upload.</p>
      )}

      {!error && projects && projects.length > 0 && history && (
        <div className="grid gap-4 lg:grid-cols-2">
          {projects.map((p) => {
            const days = history[p.id] ?? {};
            const week = total(days, 7);
            const month = total(days, 30);
            const span = lastDays(DAYS);
            const max = Math.max(1, ...span.map((d) => (days[d]?.done ?? 0) + (days[d]?.failed ?? 0)));
            return (
              <div key={p.id} className="su-card p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={p.name}>{p.name}</p>
                  <p className="shrink-0 text-xs text-zinc-400">
                    7 days <b className="text-accent-600 dark:text-accent-400">{week.done}</b> / <b className="text-danger-500">{week.failed}</b>
                    <span className="mx-1.5">·</span>
                    30 days <b className="text-accent-600 dark:text-accent-400">{month.done}</b> / <b className="text-danger-500">{month.failed}</b>
                  </p>
                </div>
                {/* One bar per day: published (lime) on failed (red). */}
                <div className="mt-4 flex h-24 items-end gap-1">
                  {span.map((d) => {
                    const done = days[d]?.done ?? 0;
                    const failed = days[d]?.failed ?? 0;
                    return (
                      <div key={d} className="flex h-full flex-1 flex-col justify-end" title={`${d}: ${done} published, ${failed} failed`}>
                        {failed > 0 && <div className="rounded-t bg-danger-500/80" style={{ height: `${(failed / max) * 100}%` }} />}
                        <div className={done > 0 ? "bg-accent-500" : "bg-ink-700"} style={{ height: done > 0 ? `${(done / max) * 100}%` : 2, borderRadius: failed > 0 ? 0 : "4px 4px 0 0" }} />
                      </div>
                    );
                  })}
                </div>
                <div className="mt-1.5 flex justify-between text-[10px] text-zinc-500">
                  <span>{span[0].slice(5)}</span>
                  <span>today</span>
                </div>
                <div className="mt-3 flex gap-4 text-[11px] text-zinc-500">
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-accent-500" /> published</span>
                  <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-danger-500/80" /> failed</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
