"use client";

import * as React from "react";

import { DesignTitleLink } from "@/components/design-title-link";
import { DesignThumb } from "@/components/top-designs-table";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { buildPeriodBreakdown } from "@/lib/dashboard-data";
import type { BreakdownSlice, PeriodStat, SaleRow } from "@/lib/dashboard-types";
import type { DesignThumbIndex } from "@/lib/designThumbs";
import { formatCurrency, formatNumber, formatShare } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * The full sales breakdown behind one period tile.
 *
 * WHAT THIS DOES *NOT* SHOW, and why: the reference layout this was modelled on
 * is an Amazon Merch report, which breaks a window down by fit type and by
 * garment colour. A TeePublic earnings export carries neither column — see
 * `SaleRow` in `lib/dashboard-types.ts`. Inventing those panels would mean
 * inventing the data, so the two slots are filled by the dimensions this export
 * actually has: product type and country. The country panel hides itself when
 * the export omitted the column, which several TeePublic layouts do.
 *
 * The breakdown is derived only while the dialog is open — `buildPeriodSummary`
 * deliberately keeps the six windows cheap.
 */
export function PeriodDetailDialog({
  stat,
  rows,
  currency,
  thumbs,
  onOpenChange,
}: {
  /** The window to explain. `null` closes the dialog. */
  stat: PeriodStat | null;
  rows: SaleRow[];
  currency: string;
  thumbs?: DesignThumbIndex;
  onOpenChange: (open: boolean) => void;
}) {
  const breakdown = React.useMemo(
    () => (stat ? buildPeriodBreakdown(rows, stat.from, stat.to) : null),
    [rows, stat],
  );

  return (
    <Dialog open={stat !== null} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Sales · {stat?.label ?? ""}</DialogTitle>
          <DialogDescription className="mt-1">{stat?.rangeLabel}</DialogDescription>
        </DialogHeader>

        {stat && breakdown && (
          <DialogBody>
            {/* Headline figures. Four tiles, each a plain number — the point of
                this panel is the detail below, so the summary stays quiet. */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <StatTile label="Units" value={formatNumber(breakdown.units)} />
              <StatTile label="Orders" value={formatNumber(breakdown.orders)} />
              <StatTile
                label="Cancelled"
                value={formatNumber(breakdown.cancelled)}
                muted={breakdown.cancelled === 0}
              />
              <StatTile
                label="Earnings"
                value={formatCurrency(breakdown.earnings, currency)}
                sub={`${formatCurrency(breakdown.perUnit, currency)} per unit`}
                accent
              />
            </div>

            {breakdown.units === 0 && breakdown.cancelled === 0 ? (
              <p className="mt-6 text-sm text-zinc-500 dark:text-zinc-400">
                No sales in this window.
              </p>
            ) : (
              <>
                <div
                  className={cn(
                    "mt-6 grid gap-6",
                    breakdown.countries.length > 0 && "sm:grid-cols-2",
                  )}
                >
                  <SliceList
                    title="Top products"
                    slices={breakdown.productTypes}
                    currency={currency}
                  />
                  {/* Hidden entirely when the export had no country column —
                      an empty panel reads as missing sales, not missing data. */}
                  {breakdown.countries.length > 0 && (
                    <SliceList
                      title="Top countries"
                      slices={breakdown.countries}
                      currency={currency}
                    />
                  )}
                </div>

                <h4 className="mb-2 mt-6 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                  Designs sold
                </h4>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Design</TableHead>
                      <TableHead>Product</TableHead>
                      <TableHead className="text-right">Units</TableHead>
                      <TableHead className="text-right">Cancelled</TableHead>
                      <TableHead className="text-right">Earnings</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {breakdown.designs.map((d) => (
                      <TableRow key={d.key}>
                        <TableCell className="max-w-[260px]">
                          <div className="flex items-center gap-3">
                            <DesignThumb
                              src={thumbs?.get(d.designId, d.design)}
                              alt={d.design}
                              designId={d.designId}
                            />
                            <div className="min-w-0 flex-1">
                              <DesignTitleLink design={d.design} designId={d.designId} />
                              {d.designId && (
                                <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                                  #{d.designId}
                                </div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge>{d.productType}</Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatNumber(d.units)}
                        </TableCell>
                        <TableCell
                          className={cn(
                            "text-right tabular-nums",
                            d.cancelled > 0
                              ? "text-zinc-900 dark:text-zinc-100"
                              : "text-zinc-400",
                          )}
                        >
                          {d.cancelled > 0 ? formatNumber(d.cancelled) : "—"}
                        </TableCell>
                        <TableCell className="text-right font-bold tabular-nums text-accent-600 dark:text-accent-400">
                          {formatCurrency(d.earnings, currency)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                <p className="mt-3 text-center text-xs text-zinc-500 dark:text-zinc-400">
                  {formatNumber(breakdown.designs.length)} unique{" "}
                  {breakdown.designs.length === 1 ? "design" : "designs"} sold
                </p>
              </>
            )}
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  );
}

function StatTile({
  label,
  value,
  sub,
  accent = false,
  muted = false,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="rounded-xl border border-ink-700 bg-ink-800/40 px-3 py-2.5">
      <div className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-1 text-xl font-semibold leading-none",
          accent
            ? "text-accent-600 dark:text-accent-400"
            : muted
              ? "text-zinc-400"
              : "text-zinc-900 dark:text-zinc-100",
        )}
      >
        {value}
      </div>
      {sub && <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400">{sub}</div>}
    </div>
  );
}

/**
 * A share-of-units bar list. Fill and track are two steps of ONE hue, so the
 * proportion reads without a second axis and without colour standing in for a
 * category — same treatment as the top-designs share meter.
 */
function SliceList({
  title,
  slices,
  currency,
}: {
  title: string;
  slices: BreakdownSlice[];
  currency: string;
}) {
  // Long tails get truncated; the remainder is rolled into one honest row
  // rather than silently dropped.
  const TOP = 5;
  const head = slices.slice(0, TOP);
  const tail = slices.slice(TOP);
  const rest =
    tail.length > 0
      ? {
          name: `${tail.length} more`,
          units: tail.reduce((s, x) => s + x.units, 0),
          earnings: tail.reduce((s, x) => s + x.earnings, 0),
          share: tail.reduce((s, x) => s + x.share, 0),
        }
      : null;

  return (
    <div className="min-w-0">
      <h4 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</h4>
      <ul className="space-y-2">
        {[...head, ...(rest ? [rest] : [])].map((s) => (
          <li key={s.name}>
            <div className="flex items-baseline justify-between gap-3 text-xs">
              <span className="truncate text-zinc-700 dark:text-zinc-200" title={s.name}>
                {s.name}
              </span>
              <span className="shrink-0 tabular-nums text-zinc-500 dark:text-zinc-400">
                {formatShare(s.share)} · {formatNumber(s.units)}
                <span className="ml-1.5 text-zinc-400">
                  {formatCurrency(s.earnings, currency)}
                </span>
              </span>
            </div>
            {/* Track and fill are SIBLINGS, not nested. `opacity` on a parent
                creates a compositing group that dims its children too, so a
                fill inside a 15%-opacity track renders at 15% as well and the
                meter reads as one flat bar. */}
            <div className="relative mt-1 h-1.5 w-full overflow-hidden rounded-full" aria-hidden>
              <div
                className="absolute inset-0 opacity-[0.15]"
                style={{ background: "var(--viz-series-1)" }}
              />
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${Math.max(2, s.share * 100)}%`,
                  background: "var(--viz-series-1)",
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
