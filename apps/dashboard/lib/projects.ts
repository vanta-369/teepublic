// Projects: one per TeePublic account a seller runs (e.g. "Baseball").
//
// What reaches the server is a project's NAME and its published-designs COUNT
// (migration 0013) - nothing about the designs. RLS scopes every read and
// write to auth.uid(); the count is never written from here, only by the
// extension's increment_project_upload_count() after a confirmed publish.
//
// Which project this browser profile works on is a local choice (IndexedDB
// `docs`), because each profile is signed in to one TeePublic account.

import { createClient } from "@/lib/supabase/client";
import { deleteDoc, getDoc, putDoc } from "@/lib/localDb";

export interface Project {
  id: string;
  name: string;
  uploadCount: number;
  /** Designs whose upload failed (migration 0014); 0 before it is applied. */
  failedCount: number;
}

const CHOSEN_KEY = "chosenProject";

function toProject(row: { id: string; name: string; upload_count: number | string | null; failed_count?: number | string | null }): Project {
  return { id: row.id, name: row.name, uploadCount: Number(row.upload_count ?? 0), failedCount: Number(row.failed_count ?? 0) };
}

export async function listProjects(): Promise<Project[]> {
  const client = createClient();
  const withFailed = await client
    .from("projects")
    .select("id, name, upload_count, failed_count")
    .order("created_at", { ascending: true });
  if (!withFailed.error) return (withFailed.data ?? []).map(toProject);
  // Migration 0014 not applied yet: the projects still work, without failures.
  if (!/failed_count/.test(withFailed.error.message)) throw new Error(withFailed.error.message);
  const { data, error } = await client
    .from("projects")
    .select("id, name, upload_count")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toProject);
}

export async function createProject(name: string): Promise<Project> {
  const { data, error } = await createClient()
    .from("projects")
    .insert({ name: name.trim() })
    .select("id, name, upload_count")
    .single();
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "You already have a project with that name." : error.message);
  return toProject(data);
}

export async function renameProject(id: string, name: string): Promise<void> {
  const { error } = await createClient().from("projects").update({ name: name.trim() }).eq("id", id);
  if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "You already have a project with that name." : error.message);
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await createClient().from("projects").delete().eq("id", id);
  if (error) throw new Error(error.message);
  if ((await getChosenProjectId()) === id) await deleteDoc(CHOSEN_KEY);
}

/** The project this browser profile uploads for, or null. */
export async function getChosenProjectId(): Promise<string | null> {
  try { return (await getDoc<string>(CHOSEN_KEY)) ?? null; } catch { return null; }
}

export async function setChosenProjectId(id: string): Promise<void> {
  try { await putDoc(CHOSEN_KEY, id); } catch { /* local storage blocked - the choice just isn't remembered */ }
}

export async function clearChosenProjectId(): Promise<void> {
  try { await deleteDoc(CHOSEN_KEY); } catch { /* nothing remembered to clear */ }
}
