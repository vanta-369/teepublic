// Projects in the extension: which project (TeePublic account) this Chrome
// profile uploads for. The list is read from Supabase - id and name only, the
// same rows the dashboard shows (migration 0013); the choice is kept locally.

import { supabase } from "./supabaseClient";

export interface ProjectRef { id: string; name: string }

const CHOSEN_KEY = "teepublic.project";

export async function listMyProjects(): Promise<ProjectRef[]> {
  const { data, error } = await supabase()
    .from("projects")
    .select("id, name")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as ProjectRef[];
}

export async function getChosenProject(): Promise<string | null> {
  const all = await chrome.storage.local.get(CHOSEN_KEY);
  return typeof all[CHOSEN_KEY] === "string" ? (all[CHOSEN_KEY] as string) : null;
}

export async function setChosenProject(id: string | null): Promise<void> {
  if (id) await chrome.storage.local.set({ [CHOSEN_KEY]: id });
  else await chrome.storage.local.remove(CHOSEN_KEY);
}
