// Client-side access gate for browser-run features (AI generation). Uses the
// browser Supabase client, so every call carries the user's session and hits
// get_my_access() LIVE — no cached plan/status, no localStorage entitlement.
//
// HONEST LIMITATION: generation runs in the browser with the user's OWN Gemini
// key, so this gate (and the logging below) is client-enforced and best-effort.
// It enforces the paywall in the UI; it is NOT a server-side security boundary.
// A determined user could bypass it — but only to spend their own key/quota.

import { createClient } from "@/lib/supabase/client";
import type { AccessState } from "@teepublic/shared";

export class GenerationBlockedError extends Error {
  constructor(public status: string) {
    super(
      status === "signed_out"
        ? "Your session expired — sign in again to generate."
        : status === "unavailable"
          ? "Couldn't verify your account (network/service). Try again in a moment."
          : `Generation is locked for your account (${status}). Upgrade or contact an admin.`,
    );
    this.name = "GenerationBlockedError";
  }
}

/** Live access fetch. Throws on RPC/network failure so callers fail CLOSED. */
export async function getClientAccess(): Promise<AccessState | null> {
  const supabase = createClient();
  const { data, error } = await supabase.rpc("get_my_access");
  if (error) throw error;
  return (data as AccessState | null) ?? null;
}

/**
 * THE browser gate. Call immediately before any Gemini request (and between
 * items in a batch). Throws GenerationBlockedError if the DB says this account
 * may not generate — including when the RPC is unreachable (fail closed).
 */
export async function assertCanGenerate(): Promise<AccessState> {
  let access: AccessState | null;
  try {
    access = await getClientAccess();
  } catch {
    throw new GenerationBlockedError("unavailable"); // fail closed
  }
  if (!access) throw new GenerationBlockedError("signed_out");
  if (!(access.can_access || access.is_admin)) {
    throw new GenerationBlockedError(access.status);
  }
  return access;
}

/** Best-effort audit log of a generation event. Never throws. */
export async function logGeneration(
  status: "attempt" | "success" | "denied" | "failed",
  meta: Record<string, unknown> = {},
): Promise<void> {
  try {
    const supabase = createClient();
    await supabase.rpc("log_generation", { p_status: status, p_meta: meta });
  } catch {
    /* logging must never block generation */
  }
}
