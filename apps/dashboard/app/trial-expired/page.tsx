import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getAccess } from "@/lib/access";
import { SignOutButton } from "@/components/SignOutButton";

// Shown while status = expired | cancelled. The dashboard is "limited" here:
// the user keeps read-only access to their history (see the API GET routes),
// but generation / sync / extension are gated off until they upgrade.
//
// NOTE: the Upgrade button is intentionally inert — no payment provider is wired
// up yet. When one is, point it at startCheckout() (see docs/ARCHITECTURE.md §10).
export default async function TrialExpiredPage() {
  const supabase = await createClient();
  const access = await getAccess(supabase);
  const cancelled = access?.status === "cancelled";
  const endedOn = access?.trial_end
    ? new Date(access.trial_end).toLocaleDateString(undefined, {
        year: "numeric", month: "short", day: "numeric",
      })
    : null;

  return (
    <div className="min-h-[70vh] grid place-items-center px-4">
      <div className="w-full max-w-lg">
        <div className="surface p-7 text-center space-y-5">
          <div className="space-y-2">
            <span className="chip-warn">{cancelled ? "Access ended" : "Trial ended"}</span>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              {cancelled ? "Your access was cancelled" : "Your free trial has ended"}
            </h1>
            <p className="text-sm text-zinc-400">
              {cancelled
                ? "Upgrade to a Pro plan to restore full access to the uploader and extension."
                : <>Your trial{endedOn ? <> ended on <span className="text-zinc-300">{endedOn}</span></> : " has ended"}. Upgrade to keep uploading.</>}
            </p>
          </div>

          <div className="surface-soft p-4 text-left text-sm text-zinc-400 space-y-1.5">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">What still works</p>
            <p>You can still sign in and view your saved designs. New generation, spreadsheet sync, and the Chrome extension are locked until you upgrade.</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center pt-1">
            {/* Inert until a payment provider is connected. */}
            <button type="button" className="btn-primary opacity-70 cursor-not-allowed" title="Payments coming soon" disabled>
              Upgrade to Pro — coming soon
            </button>
            <Link href="/" className="btn-ghost">View my designs</Link>
            <SignOutButton className="btn-ghost" />
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-500">
          Need more time? Contact the workspace administrator to extend your trial.
        </p>
      </div>
    </div>
  );
}
