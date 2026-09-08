// The shape returned by the Supabase RPC public.get_my_access().
// This is the SINGLE source of truth for "can this account use the app right
// now" — the dashboard middleware/API and the Chrome extension all call the RPC
// and read this exact object. Nothing downstream re-derives access from cached
// plan/status values; it is always fetched live from the database.

export type AccountStatus =
  | "pending_verification"
  | "pending_approval"
  | "trialing"
  | "active"
  | "expired"
  | "suspended"
  | "cancelled";

export type PlanType = "none" | "trial" | "pro_monthly" | "pro_yearly";

export interface AccessState {
  user_id: string;
  email: string | null;
  status: AccountStatus;
  plan: PlanType;
  /** true ONLY for effective 'trialing' | 'active'. The one flag to gate on. */
  can_access: boolean;
  is_admin: boolean;
  email_verified: boolean;
  approved: boolean;
  /** ISO timestamp, or null if no trial. */
  trial_end: string | null;
  /** ISO timestamp the DB computed this at (server clock). */
  checked_at: string;
}
