// The extension's Supabase client — the SAME auth as the dashboard. The user
// signs into the popup with the same email/password; the resulting session is
// shared between the popup and the background service worker via chrome.storage.
//
// IMPORTANT: chrome.storage.local holds ONLY the Supabase session (the auth
// tokens — a credential Supabase revalidates server-side on every call). It does
// NOT hold any plan/status/entitlement. Access is fetched live from the database
// every time (see access.ts). We never trust extension storage for entitlement.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_CONFIGURED } from "./config";

// A Storage adapter over chrome.storage.local, because there is no localStorage
// in a service worker. Used by supabase-js to persist/refresh the session.
const chromeStorage = {
  getItem: (key: string): Promise<string | null> =>
    chrome.storage.local.get(key).then((r) => (r[key] as string | undefined) ?? null),
  setItem: (key: string, value: string): Promise<void> =>
    chrome.storage.local.set({ [key]: value }),
  removeItem: (key: string): Promise<void> => chrome.storage.local.remove(key),
};

let client: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!SUPABASE_CONFIGURED) {
    throw new Error(
      "Supabase is not configured in the extension build. Rebuild with SUPABASE_URL and SUPABASE_ANON_KEY set.",
    );
  }
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: chromeStorage,
      storageKey: "teepublic.auth",
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
  });
  return client;
}

/** True if a Supabase session exists (does NOT imply access — check that live). */
export async function isSignedIn(): Promise<boolean> {
  if (!SUPABASE_CONFIGURED) return false;
  const { data } = await supabase().auth.getSession();
  return Boolean(data.session);
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await supabase().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

export async function signOut(): Promise<void> {
  if (!SUPABASE_CONFIGURED) return;
  await supabase().auth.signOut();
}
