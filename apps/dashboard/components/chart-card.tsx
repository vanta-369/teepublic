"use client";

import * as React from "react";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

/**
 * Shared frame for every chart on the dashboard.
 *
 * The Chart/Table toggle isn't decoration — it's the accessibility twin each
 * chart is required to ship. Colour and position are never the only route to a
 * value: the table view is the WCAG-clean equivalent, and it's what carries the
 * numbers we deliberately don't direct-label on the plot.
 *
 * `isStale` holds the previous render at reduced opacity during a refetch
 * instead of swapping in a skeleton, so the layout never jumps.
 */
export function ChartCard({
  title,
  description,
  chart,
  table,
  action,
  isStale = false,
  className,
}: {
  title: string;
  description?: string;
  chart: React.ReactNode;
  table: React.ReactNode;
  action?: React.ReactNode;
  isStale?: boolean;
  className?: string;
}) {
  const id = React.useId();

  return (
    <Card className={cn("viz-root", className)}>
      <Tabs defaultValue="chart">
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div className="min-w-0">
            <CardTitle className="text-base">{title}</CardTitle>
            {description && <CardDescription className="mt-1">{description}</CardDescription>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {action}
            <TabsList aria-label={`${title} view`}>
              <TabsTrigger value="chart">Chart</TabsTrigger>
              <TabsTrigger value="table">Table</TabsTrigger>
            </TabsList>
          </div>
        </CardHeader>

        <CardContent>
          <div
            className={cn("transition-opacity duration-200", isStale && "opacity-50")}
            aria-busy={isStale || undefined}
          >
            <TabsContent value="chart" id={`${id}-chart`} className="mt-0">
              {chart}
            </TabsContent>
            <TabsContent value="table" id={`${id}-table`} className="mt-0">
              <div className="max-h-[320px] overflow-y-auto">{table}</div>
            </TabsContent>
          </div>
        </CardContent>
      </Tabs>
    </Card>
  );
}

/** One row inside a chart tooltip: value leads, series name follows. */
export function TooltipRow({
  color,
  name,
  value,
}: {
  color: string;
  name: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
        {/* A short stroke keys the series — at tooltip density a filled box is
            data-weight ink doing a label's job. */}
        <span className="h-0.5 w-3 rounded-full" style={{ background: color }} aria-hidden />
        {name}
      </span>
      <span className="text-xs font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">
        {value}
      </span>
    </div>
  );
}

/** The tooltip shell. Children are rendered as text — never `innerHTML`, since
 *  series and category names come straight from the user's CSV headers. */
export function TooltipShell({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 shadow-card">
      <p className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

/** Shared Recharts axis/grid chrome — recessive, solid hairlines, never dashed. */
export const AXIS_TICK = {
  fill: "var(--viz-muted)",
  fontSize: 11,
  style: { fontVariantNumeric: "tabular-nums" as const },
};

export const GRID_PROPS = {
  stroke: "var(--viz-grid)",
  strokeWidth: 1,
  vertical: false,
} as const;
