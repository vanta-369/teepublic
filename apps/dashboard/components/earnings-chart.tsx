"use client";

import * as React from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AXIS_TICK, ChartCard, GRID_PROPS, TooltipRow, TooltipShell } from "@/components/chart-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { TimePoint } from "@/lib/dashboard-types";
import { formatCurrency, formatCurrencyCompact, formatDayLong, formatNumber } from "@/lib/formatters";

/**
 * THE chart for the page: units sold as columns, earnings as a line.
 *
 * A note on the two y-scales, because they are normally a mistake. Two axes on
 * one plot let the reader infer a correlation from where the marks happen to
 * line up, and that alignment is arbitrary — which is why the usual answer is
 * two charts. This is a deliberate exception: units and earnings are near
 * proportional by construction (each unit contributes its own royalty), so the
 * shapes genuinely track each other, and one compact chart was the explicit
 * ask. Both axes are pinned to zero and each is keyed to its series, so the
 * scales can't be silently mistaken for one another.
 *
 * If the two-scale reading ever gets in the way, the honest single-axis version
 * is earnings-only columns with units in the tooltip — the data is identical.
 */
export function EarningsChart({
  series,
  currency,
  granularity,
  isStale,
  className,
}: {
  series: TimePoint[];
  currency: string;
  granularity: "day" | "month";
  isStale?: boolean;
  className?: string;
}) {
  const bucketLabel = (key: string, label: string) =>
    granularity === "day" ? formatDayLong(key) : label;

  const totals = React.useMemo(
    () => ({
      units: series.reduce((a, p) => a + p.units, 0),
      earnings: series.reduce((a, p) => a + p.earnings, 0),
    }),
    [series],
  );

  return (
    <ChartCard
      title="Sales & earnings"
      description={`${formatNumber(totals.units)} units · ${formatCurrency(totals.earnings, currency)} across the selected range.`}
      isStale={isStale}
      className={className}
      action={<ChartLegend currency={currency} />}
      chart={
        // Height includes the x-axis band, so labels are never clipped into a
        // nested scrollbar.
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 12, right: 8, bottom: 4, left: 0 }}>
              <CartesianGrid {...GRID_PROPS} />
              <XAxis
                dataKey="label"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={{ stroke: "var(--viz-axis)" }}
                minTickGap={24}
              />
              {/* Units — left. Zero-anchored so bar heights stay proportional. */}
              <YAxis
                yAxisId="units"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={40}
                allowDecimals={false}
                domain={[0, "auto"]}
                tickFormatter={(v: number) => formatNumber(v)}
              />
              {/* Earnings — right, also zero-anchored. */}
              <YAxis
                yAxisId="earnings"
                orientation="right"
                tick={AXIS_TICK}
                tickLine={false}
                axisLine={false}
                width={58}
                domain={[0, "auto"]}
                tickFormatter={(v: number) => formatCurrencyCompact(v, currency)}
              />
              <Tooltip
                cursor={{ fill: "var(--viz-grid)", fillOpacity: 0.5 }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const point = payload[0].payload as TimePoint;
                  return (
                    <TooltipShell label={bucketLabel(point.key, point.label)}>
                      <TooltipRow
                        color="var(--viz-series-1)"
                        name="Units"
                        value={formatNumber(point.units)}
                      />
                      <TooltipRow
                        color="var(--viz-series-2)"
                        name="Earnings"
                        value={formatCurrency(point.earnings, currency)}
                      />
                      <TooltipRow
                        color="var(--viz-muted)"
                        name="Orders"
                        value={formatNumber(point.orders)}
                      />
                    </TooltipShell>
                  );
                }}
              />
              <Bar
                yAxisId="units"
                dataKey="units"
                fill="var(--viz-series-1)"
                // Capped, never filling the band — the leftover is air.
                maxBarSize={22}
                // 4px rounded cap, square at the baseline.
                radius={[4, 4, 0, 0]}
                isAnimationActive={false}
              />
              <Line
                yAxisId="earnings"
                type="monotone"
                dataKey="earnings"
                stroke="var(--viz-series-2)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                dot={false}
                // 8px marker with a 2px surface ring so it stays legible where
                // it crosses a column.
                activeDot={{
                  r: 4,
                  strokeWidth: 2,
                  stroke: "var(--viz-surface)",
                  fill: "var(--viz-series-2)",
                }}
                isAnimationActive={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{granularity === "day" ? "Day" : "Month"}</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Orders</TableHead>
              <TableHead className="text-right">Earnings</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {series.map((p) => (
              <TableRow key={p.key}>
                <TableCell>{bucketLabel(p.key, p.label)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(p.units)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(p.orders)}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(p.earnings, currency)}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}

/**
 * Two series means a legend is mandatory — identity never rests on colour
 * alone. Each key mirrors its mark (a filled rect for the columns, a stroke for
 * the line) and names the axis it is measured against, which is what keeps the
 * two scales from being read interchangeably.
 */
function ChartLegend({ currency }: { currency: string }) {
  return (
    <div className="flex items-center gap-3 text-xs text-zinc-500 dark:text-zinc-400">
      <span className="flex items-center gap-1.5">
        <span
          className="h-2.5 w-2.5 rounded-sm"
          style={{ background: "var(--viz-series-1)" }}
          aria-hidden
        />
        Units <span className="text-zinc-400">(left)</span>
      </span>
      <span className="flex items-center gap-1.5">
        <span
          className="h-0.5 w-3.5 rounded-full"
          style={{ background: "var(--viz-series-2)" }}
          aria-hidden
        />
        Earnings <span className="text-zinc-400">({currency}, right)</span>
      </span>
    </div>
  );
}
