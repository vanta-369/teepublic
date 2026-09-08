// Supabase connection details, injected at build time by build.mjs (esbuild
// `define`) from the SUPABASE_URL / SUPABASE_ANON_KEY env vars. The anon key is
// public and safe to embed in the extension bundle — it grants nothing beyond
// what RLS + get_my_access() already allow.
//
// Build with:  SUPABASE_URL=... SUPABASE_ANON_KEY=... npm run build:extension
// (falls back to the dashboard's NEXT_PUBLIC_* vars if those are set instead).

declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

export const SUPABASE_URL: string = __SUPABASE_URL__;
export const SUPABASE_ANON_KEY: string = __SUPABASE_ANON_KEY__;

export const SUPABASE_CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
