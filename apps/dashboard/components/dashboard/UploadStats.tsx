"use client";

import * as React from "react";
import Link from "next/link";

import { fetchUploadCount } from "@/lib/uploadCount";
import { countDesigns } from "@/lib/designsStore";
import { formatNumber } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Upload activity.
 *
 * TWO NUMBERS, FROM TWO PLACES, ON PURPOSE:
 *
 *   Published (all time) — the only figure Higgstee stores about a user's work:
 *     a single counter in `public.upload_stats`, incremented once per confirmed
 *     publish. It follows the account to any browser.
 *
 *   On this device — how many designs are in the local library, read straight
 *     out of IndexedDB. Designs never leave the machine, so this number is
 *     per-browser and no server can report it.
 *
 * This used to be four time-bucketed tiles (today / yesterday / last 7 / last
 * 30, with deltas) computed by an RPC over a per-publish event table. That
 * table is gone, so the buckets are gone with it — a date-stamped history of
 * every listing someone published is exactly what this redesign removes.
 */
export function UploadStats() {
  const [total, setTotal] = React.useState<number | null>(null);
  const [local, setLocal] = React.useState<number | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const { total: n } = await fetchUploadCount();
        if (!cancelled) setTotal(n);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load your upload count.");
        }
      }
      try {
        const n = await countDesigns();
        if (!cancelled) setLocal(n);
      } catch {
        if (!cancelled) setLocal(0); // local storage blocked — not fatal
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  if (error) {
    return (
      <div className="su-card mb-6 p-5">
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Upload count unavailable — {error}. If this is the first run, apply migration{" "}
          <code className="text-xs">0009_upload_stats.sql</code> in Supabase.
        </p>
      </div>
    );
  }

  if (total === null) {
    return (
      <div className="mb-6 grid gap-5 sm:grid-cols-2">
        {[0, 1].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  return (
    <div className="viz-root mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Upload activity</h2>
        <Link
          href="/dashboard/analytics"
          className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400"
        >
          Sales &amp; earnings
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="su-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            Published all time
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {formatNumber(total)}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            listings successfully published from your account
          </p>
        </div>

        <div className="su-card p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
            In your library on this device
          </p>
          <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
            {local === null ? "—" : formatNumber(local)}
          </p>
          <p className="mt-1 truncate text-xs text-zinc-400">
            designs stored in this browser only
          </p>
        </div>
      </div>

      <p className="mt-2 text-xs text-zinc-400">
        Higgstee stores the total count and nothing else about an upload — no titles, URLs or
        artwork.{" "}
        <Link href="/privacy" className="underline hover:text-zinc-500">
          How your data is handled
        </Link>
      </p>
    </div>
  );
}
