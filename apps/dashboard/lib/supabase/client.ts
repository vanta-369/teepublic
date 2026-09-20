// Supabase client for the browser ("use client" components).
// Uses the public URL + anon key, which are safe to expose to the client.

import { createBrowserClient } from "@supabase/ssr";
import { guardedFetch } from "./guardedFetch";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    // Structural enforcement of the local-first promise: this client cannot
    // send design artwork or listing content, whatever a caller asks it to do.
    { global: { fetch: guardedFetch } },
  );
}
