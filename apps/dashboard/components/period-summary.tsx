"use client";

import * as React from "react";
import { List } from "lucide-react";

import { PeriodDetailDialog } from "@/components/period-detail-dialog";
import type { PeriodStat, SaleRow } from "@/lib/dashboard-types";
import type { DesignThumbIndex } from "@/lib/designThumbs";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * The at-a-glance period strip: units and earnings per period, no chart.
 *
 * These are stat tiles by design. Six single values don't need six plots, and
 * a grouped bar chart of "yesterday vs last 7 days vs this month" would be
 * comparing overlapping windows of different lengths — visually implying a
 * comparison that isn't valid. The one chart carries the shape over time; this
 * carries the headline numbers.
 *
 * Deliberately stripped back from the old `MetricCard` build-out: no gradient
 * icon tiles, no card chrome, just a rule under each label. Six saturated
 * gradient chips beside six large figures put the loudest ink on the page on
 * the part carrying no data at all. The list button is the only affordance,
 * and it opens the full breakdown for that window.
 */
export function PeriodSummary({
  periods,
  rows,
  currency,
  thumbs,
  className,
}: {
  periods: PeriodStat[];
  /** The same scoped rows the tiles were built from — the dialog re-filters
   *  these per window rather than the strip precomputing six breakdowns. */
  rows: SaleRow[];
  currency: string;
  /** Normalised title → artwork URL, for the breakdown table's thumbnails. */
  thumbs?: DesignThumbIndex;
  className?: string;
}) {
  const [openLabel, setOpenLabel] = React.useState<string | null>(null);

  if (!periods.length) return null;

  const active = periods.find((p) => p.label === openLabel) ?? null;

  return (
    <>
      <div className={cn("grid gap-x-8 gap-y-6 sm:grid-cols-2 xl:grid-cols-3", className)}>
        {periods.map((p) => (
          <PeriodTile
            key={p.label}
            stat={p}
            currency={currency}
            onOpen={() => setOpenLabel(p.label)}
          />
        ))}
      </div>

      <PeriodDetailDialog
        stat={active}
        rows={rows}
        currency={currency}
        thumbs={thumbs}
        onOpenChange={(open) => {
          if (!open) setOpenLabel(null);
        }}
      />
    </>
  );
}

function PeriodTile({
  stat,
  currency,
  onOpen,
}: {
  stat: PeriodStat;
  currency: string;
  onOpen: () => void;
}) {
  return (
    <div className="min-w-0">
      {/* Label row, and the rule beneath it — the tile's only structure. */}
      <div className="flex items-center justify-between gap-3 pb-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h3 className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {stat.label}
          </h3>
          <span className="shrink-0 text-xs text-zinc-500 dark:text-zinc-400">
            {stat.rangeLabel}
          </span>
        </div>

        <button
          type="button"
          onClick={onOpen}
          aria-label={`Sales breakdown for ${stat.label.toLowerCase()}`}
          className={cn(
            "shrink-0 rounded-lg border border-ink-700 p-1.5 text-zinc-500 transition-colors",
            "hover:bg-ink-800 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
          )}
        >
          <List className="h-4 w-4" aria-hidden />
        </button>
      </div>

      <div className="border-t border-ink-700 pt-3">
        <div className="flex items-baseline justify-between gap-4">
          {/* Proportional figures, not tabular: at this size equal-width digits
              make a number like 121 look loose. */}
          <span className="text-4xl font-light leading-none text-zinc-900 dark:text-zinc-100">
            {formatNumber(stat.units)}
          </span>

          <div className="min-w-0 text-right">
            <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
              {formatCurrency(stat.earnings, currency)}
            </div>
            {/* units · orders · (cancelled). Spelled out in `title` because a
                bare "47 · 36 · (1)" is unreadable without a legend. */}
            <div
              className="mt-0.5 text-xs tabular-nums text-zinc-500 dark:text-zinc-400"
              title={`${stat.units} units · ${stat.orders} orders · ${stat.cancelled} cancelled`}
            >
              {formatNumber(stat.units)} · {formatNumber(stat.orders)}
              {stat.cancelled > 0 && ` · (${formatNumber(stat.cancelled)})`}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
