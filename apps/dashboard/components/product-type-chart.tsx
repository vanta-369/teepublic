"use client";

import * as React from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { AXIS_TICK, ChartCard, TooltipRow, TooltipShell } from "@/components/chart-card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { Slice } from "@/lib/dashboard-types";
import { formatCurrency, formatCurrencyCompact, formatNumber, formatShare } from "@/lib/formatters";

/**
 * Earnings by product type.
 *
 * Horizontal bars because product names are long and ranking is the job.
 * Every bar is the SAME hue: product types are nominal (a mug isn't "more"
 * than a sticker), so shading them by value would double-encode bar length as
 * colour and burn the only free channel on information the chart already
 * shows. One series → one colour, and no legend.
 *
 * The value is direct-labelled at the bar tip rather than inside it, so a short
 * bar never clips its own label.
 */
export function ProductTypeChart({
  slices,
  currency,
  isStale,
}: {
  slices: Slice[];
  currency: string;
  isStale?: boolean;
}) {
  // Give each row a fixed band and let the container grow, rather than
  // squeezing many categories into a fixed height.
  const height = Math.max(200, slices.length * 40 + 32);

  return (
    <ChartCard
      title="Earnings by product type"
      description="Which products actually carry your revenue."
      isStale={isStale}
      chart={
        slices.length === 0 ? (
          <p className="py-10 text-center text-sm text-zinc-500 dark:text-zinc-400">
            No product-type column in this export.
          </p>
        ) : (
          <div style={{ height }} className="w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={slices}
                layout="vertical"
                // Room on the right for the tip labels so they never clip.
                margin={{ top: 4, right: 68, bottom: 4, left: 4 }}
              >
                <CartesianGrid stroke="var(--viz-grid)" strokeWidth={1} horizontal={false} />
                <XAxis
                  type="number"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={{ stroke: "var(--viz-axis)" }}
                  tickFormatter={(v: number) => formatCurrencyCompact(v, currency)}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={AXIS_TICK}
                  tickLine={false}
                  axisLine={false}
                  width={110}
                />
                <Tooltip
                  cursor={{ fill: "var(--viz-grid)", fillOpacity: 0.6 }}
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null;
                    const slice = payload[0].payload as Slice;
                    return (
                      <TooltipShell label={slice.name}>
                        <TooltipRow
                          color="var(--viz-series-1)"
                          name="Earnings"
                          value={formatCurrency(slice.earnings, currency)}
                        />
                        <TooltipRow
                          color="var(--viz-muted)"
                          name="Units"
                          value={formatNumber(slice.units)}
                        />
                        <TooltipRow
                          color="var(--viz-muted)"
                          name="Share"
                          value={formatShare(slice.share)}
                        />
                      </TooltipShell>
                    );
                  }}
                />
                <Bar
                  dataKey="earnings"
                  fill="var(--viz-series-1)"
                  maxBarSize={24}
                  radius={[0, 4, 4, 0]}
                  isAnimationActive={false}
                >
                  {/* Label ink is a text token, never the series colour. */}
                  <LabelList
                    dataKey="earnings"
                    position="right"
                    offset={8}
                    fill="var(--viz-muted)"
                    fontSize={11}
                    // Recharts types a LabelList value as RenderableText
                    // (string | number | undefined), not number.
                    formatter={(v: unknown) =>
                      typeof v === "number" ? formatCurrencyCompact(v, currency) : ""
                    }
                  />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        )
      }
      table={
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Product type</TableHead>
              <TableHead className="text-right">Earnings</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Share</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {slices.map((s) => (
              <TableRow key={s.name}>
                <TableCell className="font-medium text-zinc-900 dark:text-zinc-100">{s.name}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {formatCurrency(s.earnings, currency)}
                </TableCell>
                <TableCell className="text-right tabular-nums">{formatNumber(s.units)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatShare(s.share)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      }
    />
  );
}
