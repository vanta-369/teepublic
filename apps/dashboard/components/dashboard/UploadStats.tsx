"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { createClient } from "@/lib/supabase/client";
import type { UploadStats as UploadStatsShape } from "@/lib/dashboard-types";
import { formatDelta, formatNumber } from "@/lib/formatters";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Upload volume at the top of the dashboard: today, yesterday, last 7 days,
 * last 30 days.
 *
 * Client-side on purpose. The counts come from the `get_upload_stats` RPC,
 * which buckets by the CALLER'S timezone — "today" has to mean the user's
 * today, and only the browser knows the zone. Rendering this on the server
 * would have to assume UTC, which rolls the day over mid-afternoon for users
 * in the Americas.
 */
export function UploadStats() {
  const [stats, setStats] = React.useState<UploadStatsShape | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
        const { data, error: rpcError } = await supabase.rpc("get_upload_stats", { p_tz: tz });
        if (cancelled) return;
        if (rpcError) {
          setError(rpcError.message);
          return;
        }
        setStats(data as UploadStatsShape);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load upload stats.");
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
          Upload stats unavailable — {error}. If this is the first run, apply migration{" "}
          <code className="text-xs">0007_upload_events.sql</code> in Supabase.
        </p>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="mb-6 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-[104px] rounded-2xl" />
        ))}
      </div>
    );
  }

  const tiles = [
    { label: "Uploaded today", value: stats.today, delta: null as number | null, sub: "designs published" },
    { label: "Yesterday", value: stats.yesterday, delta: null as number | null, sub: "designs published" },
    {
      label: "Last 7 days",
      value: stats.last7,
      delta: stats.prev7 ? (stats.last7 - stats.prev7) / stats.prev7 : null,
      sub: "vs previous 7 days",
    },
    {
      label: "Last 30 days",
      value: stats.last30,
      delta: stats.prev30 ? (stats.last30 - stats.prev30) / stats.prev30 : null,
      sub: "vs previous 30 days",
    },
  ];

  return (
    <div className="viz-root mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-zinc-400">Upload activity</h2>
        <Link href="/dashboard/analytics" className="text-xs font-medium text-accent-600 hover:underline dark:text-accent-400">
          Sales &amp; earnings
        </Link>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((tile) => {
          const direction = tile.delta === null || tile.delta === 0 ? "flat" : tile.delta > 0 ? "up" : "down";
          const Arrow =
            direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

          return (
            <div key={tile.label} className="su-card p-5">
              <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                {tile.label}
              </p>
              {/* Proportional figures — tabular-nums looks loose at this size. */}
              <p className="mt-1 text-2xl font-bold text-zinc-900 dark:text-zinc-100">
                {formatNumber(tile.value)}
              </p>
              <div className="mt-1 flex items-center gap-1.5">
                {tile.delta !== null && (
                  <span
                    className="inline-flex items-center gap-0.5 text-xs font-semibold"
                    // The arrow carries direction too, so this never reads on
                    // colour alone.
                    style={{
                      color:
                        direction === "flat"
                          ? "var(--viz-muted)"
                          : direction === "up"
                            ? "var(--viz-up)"
                            : "var(--viz-down)",
                    }}
                  >
                    <Arrow className="h-3 w-3" aria-hidden />
                    {formatDelta(tile.delta)}
                  </span>
                )}
                <span className="truncate text-xs text-zinc-400">{tile.sub}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="mt-2 text-xs text-zinc-400">
        {formatNumber(stats.total)} total published all-time.
      </p>
    </div>
  );
}
