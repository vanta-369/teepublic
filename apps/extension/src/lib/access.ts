// The extension's access gate. THE rule: every gated action calls
// get_my_access() LIVE against the database. There is no caching, no TTL, no
// reading a stored plan/status — extension storage is never trusted for
// entitlement. If the DB says the account can't run automation, it can't.

import type { AccessState } from "@teepublic/shared";
import { supabase } from "./supabaseClient";

export class AccessDeniedError extends Error {
  constructor(public status: string) {
    super(`access denied: ${status}`);
    this.name = "AccessDeniedError";
  }
}

/** Fetch the caller's live access state, or null if signed out / not configured. */
export async function fetchAccess(): Promise<AccessState | null> {
  const client = supabase();
  // Validate + REFRESH the token against the auth server before the RPC.
  // getSession() alone can hand back a stale/expired access token (common in a
  // side panel that was closed while the auto-refresh timer wasn't running).
  // A stale token makes the RPC run anonymously → get_my_access() returns null →
  // a valid user (even an admin) would be wrongly LOCKED. getUser() forces a
  // refresh and the refreshed token is what the RPC then uses.
  const { data: { user }, error: userErr } = await client.auth.getUser();
  if (userErr || !user) return null; // genuinely signed out / refresh token dead
  const { data, error } = await client.rpc("get_my_access");
  if (error) throw new Error(error.message);
  return (data as AccessState | null) ?? null;
}

/**
 * THE gate. Call this at the start of every automation action. Queries the DB
 * live; throws AccessDeniedError if the account may not run right now. Admins
 * and effective trialing/active accounts pass; everything else is denied.
 */
export async function assertCanAccess(): Promise<AccessState> {
  const access = await fetchAccess();
  if (!access) throw new AccessDeniedError("signed_out");
  if (!(access.can_access || access.is_admin)) {
    throw new AccessDeniedError(access.status);
  }
  return access;
}
