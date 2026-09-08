"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Mode = "login" | "register";

// Single form used by both /signin (mode="login") and /signup (mode="register").
// Sign-up is a REQUEST ACCESS flow — there is no instant trial; access begins
// after email verification + admin approval.
//
// NOTE: we read ?next= from window (not useSearchParams) so this component is
// server-rendered and visible immediately, instead of being forced client-only
// behind a Suspense boundary that stays blank if hydration is disrupted.
export function AuthForm({ mode }: { mode: Mode }) {
  const isRegister = mode === "register";

  const [next, setNext] = useState("/dashboard");
  useEffect(() => {
    const n = new URLSearchParams(window.location.search).get("next");
    if (n) setNext(n);
  }, []);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (isRegister && password !== confirm) {
      setError("Passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Something went wrong. Try again.");
        return;
      }
      if (data.needsConfirmation) {
        setNotice(`Check ${email} for a confirmation link, then sign in to finish requesting access.`);
        setPassword("");
        setConfirm("");
        return;
      }
      // Full navigation so middleware re-evaluates with the fresh cookie.
      window.location.assign(next);
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface p-6 w-full max-w-md">
      <div className="mb-6">
        <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          {isRegister ? "Request access" : "Sign in"}
        </h2>
        <p className="text-sm text-zinc-400 mt-1">
          {isRegister
            ? "Create your Higgstee account — access starts after approval."
            : "Access your Higgstee dashboard."}
        </p>
      </div>

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
            spellCheck={false}
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label className="label" htmlFor="password">Password</label>
          <input
            id="password"
            type="password"
            className="input font-mono"
            placeholder={isRegister ? "at least 8 characters" : "••••••••"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={isRegister ? "new-password" : "current-password"}
            minLength={isRegister ? 8 : undefined}
            required
          />
        </div>

        {isRegister && (
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
        )}

        {!isRegister && (
          <div className="text-right -mt-1">
            <Link href="/forgot-password" className="text-xs text-accent-500 hover:text-accent-400">
              Forgot password?
            </Link>
          </div>
        )}

        {isRegister && (
          <p className="text-xs text-zinc-500">
            After signing up you&apos;ll verify your email, then an admin approves your
            account and your trial begins.
          </p>
        )}

        {notice && <div className="chip-mute w-full justify-center py-2 text-center">{notice}</div>}
        {error && <div className="chip-err w-full justify-center py-2 text-center">{error}</div>}

        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? "Working…" : isRegister ? "Request Access" : "Sign in"}
        </button>
      </form>

      <div className="mt-5 text-center text-xs text-zinc-400">
        {isRegister ? (
          <>
            Already have an account?{" "}
            <Link href="/signin" className="text-accent-400 hover:text-accent-300 underline underline-offset-2">
              Sign in
            </Link>
          </>
        ) : (
          <>
            No account yet?{" "}
            <Link href="/signup" className="text-accent-400 hover:text-accent-300 underline underline-offset-2">
              Request access
            </Link>
          </>
        )}
      </div>
    </div>
  );
}
