"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [supabase] = useState(() => createClient());
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/reset-password`,
      });
    } catch {
      // Ignore — always show the neutral confirmation below.
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  return (
    <div className="surface p-6 w-full max-w-md">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Forgot password</h2>
        <p className="text-sm text-zinc-400 mt-1">We&apos;ll email you a reset link.</p>
      </div>

      {sent ? (
        <div className="space-y-4">
          <div className="chip-mute w-full justify-center py-2 text-center">
            If an account exists for {email || "that email"}, a reset link is on its way.
          </div>
          <Link href="/signin" className="btn-ghost w-full">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              className="input font-mono"
              placeholder="you@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="email"
              required
            />
          </div>
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Sending…" : "Send reset link"}
          </button>
          <Link href="/signin" className="text-center text-xs text-accent-400 hover:text-accent-300">
            Back to sign in
          </Link>
        </form>
      )}
    </div>
  );
}
