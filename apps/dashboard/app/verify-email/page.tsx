import Link from "next/link";
import { getSessionProfile } from "@/lib/auth";
import { SignOutButton } from "@/components/SignOutButton";

// Shown while account_status = pending_verification. Supabase blocks sign-in for
// unconfirmed emails when "Confirm email" is on, so most users won't linger here
// — but the page exists so the middleware always has somewhere valid to send them.
export default async function VerifyEmailPage() {
  const { user, profile } = await getSessionProfile();
  const email = user?.email ?? profile?.email ?? "your account";

  return (
    <div className="min-h-[70vh] grid place-items-center px-4">
      <div className="w-full max-w-lg">
        <div className="surface p-7 text-center space-y-5">
          <div className="space-y-2">
            <span className="chip-warn">Verify your email</span>
            <h1 className="text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
              Confirm your email address
            </h1>
            <p className="text-sm text-zinc-400">
              We sent a verification link to{" "}
              <span className="font-medium text-zinc-700 dark:text-zinc-200 break-all">{email}</span>.
              Click it, then come back and refresh.
            </p>
          </div>

          <div className="surface-soft p-4 text-left text-sm text-zinc-400 space-y-1.5">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">After you verify</p>
            <p>Your account moves to <span className="text-zinc-300">pending admin approval</span>. Once an admin approves you, your 7-day trial starts automatically.</p>
          </div>

          <div className="flex flex-wrap gap-2 justify-center pt-1">
            <Link href="/" className="btn-primary">I&apos;ve verified — continue</Link>
            <SignOutButton className="btn-ghost" />
          </div>
        </div>

        <p className="mt-5 text-center text-xs text-zinc-500">
          Didn&apos;t get the email? Check spam, or sign out and sign up again.
        </p>
      </div>
    </div>
  );
}
