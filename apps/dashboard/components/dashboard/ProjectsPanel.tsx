"use client";

// Dashboard: each project (TeePublic account) with how many designs it has
// published. The counts come from the server (migration 0013), so every
// browser profile sees all projects. Rename / delete here; create on Create
// Product.

import * as React from "react";
import Link from "next/link";
import { deleteProject, listProjects, renameProject, type Project } from "@/lib/projects";
import { formatNumber } from "@/lib/formatters";

export function ProjectsPanel() {
  const [projects, setProjects] = React.useState<Project[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<{ id: string; name: string } | null>(null);

  const load = React.useCallback(async () => {
    try { setProjects(await listProjects()); setError(null); } catch (e) { setError((e as Error).message); }
  }, []);
  React.useEffect(() => { void load(); }, [load]);

  async function saveName() {
    if (!editing || !editing.name.trim()) return;
    try { await renameProject(editing.id, editing.name); setEditing(null); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  async function remove(p: Project) {
    if (!window.confirm(`Delete the project "${p.name}"? Its count (${p.uploadCount}) is removed. Your designs are not affected.`)) return;
    try { await deleteProject(p.id); await load(); } catch (e) { setError((e as Error).message); }
  }

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Projects</h2>
        <Link href="/dashboard/create" className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">
          New project on Create Product
        </Link>
      </div>

      {error && (
        <p className="su-card p-5 text-sm text-zinc-500 dark:text-zinc-400">
          Projects unavailable - {error}. If this is the first run, apply migration{" "}
          <code className="text-xs">0013_projects.sql</code> in Supabase.
        </p>
      )}

      {!error && projects !== null && projects.length === 0 && (
        <p className="su-card p-5 text-sm text-zinc-500 dark:text-zinc-400">
          No projects yet. Make one per TeePublic account when you start a batch on Create Product.
        </p>
      )}

      {!error && projects && projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((p) => (
            <div key={p.id} className="su-card p-5">
              {editing?.id === p.id ? (
                <form onSubmit={(e) => { e.preventDefault(); void saveName(); }} className="flex items-center gap-2">
                  <input
                    autoFocus
                    maxLength={40}
                    value={editing.name}
                    onChange={(e) => setEditing({ id: p.id, name: e.target.value })}
                    className="input py-1.5"
                  />
                  <button type="submit" className="btn-primary px-3 py-1.5 text-xs">Save</button>
                  <button type="button" className="btn-ghost px-3 py-1.5 text-xs" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : (
                <p className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={p.name}>{p.name}</p>
              )}
              <div className="mt-1 flex items-end gap-6">
                <div>
                  <p className="text-2xl font-bold text-zinc-900 dark:text-zinc-100">{formatNumber(p.uploadCount)}</p>
                  <p className="text-xs text-zinc-400">published</p>
                </div>
                <div>
                  <p className={`text-2xl font-bold ${p.failedCount > 0 ? "text-danger-500" : "text-zinc-400"}`}>{formatNumber(p.failedCount)}</p>
                  <p className="text-xs text-zinc-400">failed</p>
                </div>
              </div>
              {editing?.id !== p.id && (
                <div className="mt-3 flex gap-3 text-xs">
                  <button type="button" className="text-zinc-500 underline hover:text-zinc-300" onClick={() => setEditing({ id: p.id, name: p.name })}>Rename</button>
                  <button type="button" className="text-danger-500 underline hover:text-danger-400" onClick={() => void remove(p)}>Delete</button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
