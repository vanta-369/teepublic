"use client";

// The controls behind the Privacy Policy's deletion promise.
//
// Designs, listings and the earnings export live in this browser, so there is
// no server-side "delete my data" button that could reach them — and signing
// out does not touch them either. This panel is where a user can see how much
// is stored on this device and erase all of it, which is the only place such a
// control can honestly live.

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Card } from "@/components/dashboard/DashBits";
import { clearAllLocalData, estimateLocalUsage, listImageIds } from "@/lib/localDb";
import { countDesigns } from "@/lib/designsStore";

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let value = n / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[i]}`;
}

export function LocalDataPanel() {
  const [designs, setDesigns] = useState<number | null>(null);
  const [images, setImages] = useState<number | null>(null);
  const [usage, setUsage] = useState<{ usage: number; quota: number } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setDesigns(await countDesigns());
      setImages((await listImageIds()).length);
      setUsage(await estimateLocalUsage());
      setError(null);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "This browser is blocking local storage, so nothing can be stored on this device.",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function eraseEverything() {
    setBusy(true);
    setNotice(null);
    try {
      await clearAllLocalData();
      await refresh();
      setNotice("Everything stored in this browser has been deleted.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear local data.");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card>
      <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Data on this device</h2>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Your designs, listing details and any earnings export are stored in this browser, not on
        Higgstee&apos;s servers. They stay on this computer and do not follow your account to
        another browser or machine.{" "}
        <Link href="/privacy" className="text-accent-500 hover:text-accent-400">
          How your data is handled
        </Link>
      </p>

      {error ? (
        <p className="mt-3 text-sm text-danger-600 dark:text-danger-500">{error}</p>
      ) : (
        <dl className="mt-4 grid gap-4 sm:grid-cols-3">
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Designs</dt>
            <dd className="mt-0.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {designs ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-400">Images</dt>
            <dd className="mt-0.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {images ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
              Space used
            </dt>
            <dd className="mt-0.5 text-xl font-bold text-zinc-900 dark:text-zinc-100">
              {usage ? formatBytes(usage.usage) : "—"}
            </dd>
          </div>
        </dl>
      )}

      {notice && <p className="mt-3 text-sm text-success-600 dark:text-success-500">{notice}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {confirming ? (
          <>
            <span className="text-sm text-zinc-600 dark:text-zinc-300">
              This permanently deletes every design, listing and export stored in this browser.
              Export anything you want to keep first.
            </span>
            <button
              type="button"
              className="btn-primary"
              disabled={busy}
              onClick={() => void eraseEverything()}
            >
              {busy ? "Deleting…" : "Yes, delete it all"}
            </button>
            <button type="button" className="btn-ghost" disabled={busy} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn-ghost" onClick={() => setConfirming(true)}>
              Delete all local data
            </button>
            <Link href="/dashboard/uploads" className="btn-ghost">
              Export a batch first
            </Link>
          </>
        )}
      </div>
    </Card>
  );
}
