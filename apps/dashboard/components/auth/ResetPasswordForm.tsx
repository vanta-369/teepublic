"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// The Supabase browser client auto-detects the recovery token in the URL on
// load and establishes a temporary session, so updateUser() can set a new
// password. If the link is missing/expired, updateUser() errors and we say so.
export function ResetPasswordForm() {
  const [supabase] = useState(() => createClient());
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      setDone(true);
    } catch {
      setError("Couldn't update your password. The reset link may have expired — request a new one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface p-6 w-full max-w-md">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Set a new password</h2>
        <p className="text-sm text-zinc-400 mt-1">Choose a new password for your account.</p>
      </div>

      {done ? (
        <div className="space-y-4">
          <div className="chip-ok w-full justify-center py-2 text-center">Password updated.</div>
          <Link href="/signin" className="btn-primary w-full">Sign in</Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="password">New password</label>
            <input
              id="password"
              type="password"
              className="input font-mono"
              placeholder="at least 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="label" htmlFor="confirm">Confirm password</label>
            <input
              id="confirm"
              type="password"
              className="input font-mono"
              placeholder="re-enter password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              minLength={8}
              required
            />
          </div>
          {error && <div className="chip-err w-full justify-center py-2 text-center">{error}</div>}
          <button type="submit" className="btn-primary w-full" disabled={busy}>
            {busy ? "Updating…" : "Update password"}
          </button>
          <Link href="/forgot-password" className="text-center text-xs text-accent-400 hover:text-accent-300">
            Request a new link
          </Link>
        </form>
      )}
    </div>
  );
}
