// Access resolution for the dashboard. There is exactly ONE way to learn a
// user's entitlement: call the Supabase RPC public.get_my_access(), which
// resolves the EFFECTIVE status server-side (trials expire by the DB clock).
//
// Rules enforced everywhere:
//   * Every authenticated request calls get_my_access() — no cached plan/status.
//   * The database is always the source of truth. We never trust a value the
//     client sent us, nor a value we stored in a cookie/localStorage.

import type { NextResponse } from "next/server";
import { NextResponse as Res } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccessState, AccountStatus } from "@teepublic/shared";

export type { AccessState, AccountStatus } from "@teepublic/shared";

// Accepts either the server client or the edge-middleware client — both are
// SupabaseClient instances exposing .rpc() and .auth.getUser().
type AnySupabase = SupabaseClient;

/** Fetch the caller's live access state. Returns null if signed out / no profile. */
export async function getAccess(supabase: AnySupabase): Promise<AccessState | null> {
  const { data, error } = await supabase.rpc("get_my_access");
  if (error || !data) return null;
  return data as AccessState;
}

/**
 * Guard for route handlers. Always hits get_my_access() live.
 * Returns either { access } (allowed) or { response } to return immediately.
 *
 * @param allow  explicit status allow-list; defaults to gating on can_access
 *               (i.e. effective 'trialing' | 'active'). Admins always pass.
 */
export async function requireAccess(
  supabase: AnySupabase,
  opts: { allow?: AccountStatus[] } = {},
): Promise<{ access: AccessState } | { response: NextResponse }> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return { response: Res.json({ ok: false, error: "Not signed in." }, { status: 401 }) };
  }

  const access = await getAccess(supabase);
  if (!access) {
    return { response: Res.json({ ok: false, error: "No profile." }, { status: 403 }) };
  }

  const allowed = access.is_admin
    || (opts.allow ? opts.allow.includes(access.status) : access.can_access);

  if (!allowed) {
    return {
      response: Res.json(
        { ok: false, error: "access_denied", status: access.status },
        { status: 403 },
      ),
    };
  }
  return { access };
}
