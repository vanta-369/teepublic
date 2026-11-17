"use client";

// Connect account: the Google accounts the extension can write listings with.
// They are simply the accounts signed into THIS Chrome - the extension reads
// which address sits at each gemini.google.com/u/<N>/ slot. No password,
// cookie or token is read or stored; signing in happens on Google's own page.

import { useCallback, useEffect, useRef, useState } from "react";
import type { GeminiAccount } from "@teepublic/shared";
import { EmptyState } from "@/components/dashboard/DashBits";
import {
  addGeminiAccount,
  getExtensionId,
  isExtensionAvailable,
  listGeminiAccounts,
} from "@/lib/bridge";

export function GeminiAccountsPanel() {
  const [connected, setConnected] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<GeminiAccount[]>([]);
  const [busy, setBusy] = useState<"refresh" | "add" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Set after "Connect account" opens Google's sign-in, so coming back to this
  // tab picks up the new account without another click.
  const awaitingSignIn = useRef(false);

  const load = useCallback(async (refresh: boolean) => {
    if (!isExtensionAvailable() || !getExtensionId()) {
      setConnected(false);
      return [];
    }
    try {
      const list = await listGeminiAccounts(refresh);
      setAccounts(list);
      setConnected(true);
      setError(null);
      return list;
    } catch (e) {
      setError((e as Error).message);
      if (!refresh) setConnected(false);
      return [];
    }
  }, []);

  const refresh = useCallback(async () => {
    setBusy("refresh");
    await load(true);
    setBusy(null);
  }, [load]);

  useEffect(() => {
    void load(false).then((list) => {
      // Nothing known yet: look for accounts already signed into this browser.
      if (list.length === 0 && isExtensionAvailable() && getExtensionId()) void refresh();
    });
  }, [load, refresh]);

  useEffect(() => {
    function onFocus() {
      if (!awaitingSignIn.current) return;
      awaitingSignIn.current = false;
      void refresh();
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refresh]);

  async function add() {
    setBusy("add");
    setError(null);
    try {
      await addGeminiAccount();
      awaitingSignIn.current = true;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (connected === false) {
    const stale = !!error && /unknown message type/i.test(error);
    return (
      <EmptyState
        title={stale ? "Extension needs updating" : "Extension not connected"}
        subtitle={
          stale
            ? "Your installed extension is an older build. Update it, then reload this page."
            : "Connect the Higgstee extension in desktop Chrome first."
        }
        actionLabel={stale ? "Update extension" : "Connect extension"}
        actionHref={stale ? "/download-extension" : "/dashboard/extension"}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="surface p-5">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="max-w-xl">
            <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Google account</h2>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              Connect a Google account to generate listings without an API key. Higgstee never sees your password.
            </p>
          </div>
          <button className="btn-primary" disabled={busy !== null} onClick={() => void add()}>
            Connect account
          </button>
        </div>
      </div>

      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}

      {connected === null || (busy === "refresh" && accounts.length === 0) ? (
        <div className="text-sm text-zinc-500">Checking for connected accounts…</div>
      ) : accounts.length === 0 ? (
        <div className="surface-soft border-dashed p-8 text-center">
          <h3 className="font-semibold text-zinc-900 dark:text-zinc-100">No account connected</h3>
          <p className="mt-1.5 text-sm text-zinc-500 dark:text-zinc-400">Press Connect account and sign in to Google.</p>
        </div>
      ) : (
        <div className="surface divide-y divide-ink-700/60">
          {accounts.map((a) => (
            <div key={a.index} className="flex items-center gap-3 p-4">
              <span className="chip-ok">Connected</span>
              <p className="min-w-0 flex-1 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">{a.email}</p>
            </div>
          ))}
        </div>
      )}

      <button
        className="text-xs text-zinc-500 hover:text-accent-500"
        disabled={busy !== null}
        onClick={() => void refresh()}
      >
        {busy === "refresh" ? "Checking…" : "Don't see your account? Check again"}
      </button>
    </div>
  );
}

export default GeminiAccountsPanel;
