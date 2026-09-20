// Supabase client for the Node runtime (route handlers + server components).
// Reads/writes the auth cookies through Next's cookie store so sessions persist.
// Env: NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY (see .env.local).

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { guardedFetch } from "./guardedFetch";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      // See lib/supabase/guardedFetch.ts - artwork and listing content can
      // never leave through this client.
      global: { fetch: guardedFetch },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll can be called from a Server Component, where writing cookies
            // throws. Safe to ignore — the middleware refreshes sessions there.
          }
        },
      },
    },
  );
}
