import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { SignOutButton } from "@/components/SignOutButton";

// Shown while account_status = suspended. A dead-end by design: no app access,
// only a path to contact support. Only an admin can lift a suspension
// (admin_reactivate_user / re-approve).
export default async function SuspendedPage() {
  const { user, profile } = await getSessionProfile();
  const email = user?.email ?? profile?.email ?? "your account";

  return (
    <div className="min-h-[70vh] grid place-items-center px-4">
      <div className="w-full max-w-lg">
        <div className="surface p-7 text-center space-y-5">
          <div className="space-y-2">
            <span className="chip-warn">Account suspended</span>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Your account is suspended
            </h1>
            <p className="text-sm text-zinc-400">
              Access for{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-200 break-all">{email}</span>{" "}
              has been paused by an administrator.
            </p>
          </div>

          <div className="surface-soft p-4 text-left text-sm text-zinc-400">
            <p>If you think this is a mistake, contact the workspace administrator to review your account. You&apos;ll regain access as soon as it&apos;s reinstated.</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <SignOutButton className="btn-primary" />
            <Link href="/login" className="btn-ghost">Back to sign in</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
