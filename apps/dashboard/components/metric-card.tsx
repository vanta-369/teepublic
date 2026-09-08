"use client";

import * as React from "react";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { Area, AreaChart, ResponsiveContainer } from "recharts";

import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatDelta } from "@/lib/formatters";

/**
 * Gradient → class, written out in full rather than interpolated.
 *
 * Two reasons this is a lookup and not `su-grad-${gradient}`: Tailwind
 * tree-shakes unused `@layer components` rules, so a class it never sees as a
 * literal can be dropped from the build; and the lime gradient needs a DARK
 * glyph (`su-icon` ships `text-white`, which measures 1.58:1 on lime and
 * disappears). The other four are dark enough for white at 2.97–17.8:1. Same
 * pairing `.su-navitem-active .su-navicon` uses.
 */
const GRADIENT_CLASS = {
  primary: "su-grad-primary !text-zinc-950",
  success: "su-grad-success",
  warn: "su-grad-warn",
  info: "su-grad-info",
  dark: "su-grad-dark",
} as const;

export interface MetricCardProps {
  /** Sentence case, no trailing colon. */
  label: string;
  /** Pre-formatted — the caller knows whether it's money, a count or a rate. */
  value: string;
  /** Signed fractional change vs the preceding window; null hides the delta. */
  delta?: number | null;
  /** Names the comparison period, e.g. "vs previous 30 days". */
  deltaLabel?: string;
  /** Whether a rise is good. Refund rate, for instance, is better going down. */
  goodDirection?: "up" | "down";
  /** Up to 12 points for the trend sparkline. Omit for a bare tile. */
  trend?: number[];
  icon?: React.ReactNode;
  /**
   * Brand gradient for the icon tile — the same `su-grad-*` set the dashboard
   * home uses, so a tile here matches a tile there.
   *
   * This is CHROME, not encoding: the gradient identifies the tile, it never
   * stands for a value. Data colour stays in the chart's validated palette, so
   * nothing on the page implies a magnitude through a brand hue.
   */
  gradient?: "primary" | "success" | "warn" | "info" | "dark";
  /** Optional secondary figure, set to the right of the main value. */
  aside?: React.ReactNode;
  /** Small muted text under the label, e.g. the period's date range. */
  caption?: string;
  className?: string;
}

export function MetricCard({
  label,
  value,
  delta = null,
  deltaLabel,
  goodDirection = "up",
  trend,
  icon,
  gradient,
  aside,
  caption,
  className,
}: MetricCardProps) {
  const direction = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const isGood = direction === "flat" ? null : direction === goodDirection;

  // The arrow is the point: direction never rides on colour alone, so the
  // delta stays readable under CVD and in forced-colors mode.
  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

  const sparkline = React.useMemo(
    () => (trend ?? []).slice(-12).map((v, i) => ({ i, v })),
    [trend],
  );

  return (
    <Card className={cn("viz-root p-5", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{label}</p>
          {caption && <p className="mt-0.5 truncate text-xs text-zinc-400">{caption}</p>}
        </div>
        {icon &&
          (gradient ? (
            // `su-icon` is 3rem on the dashboard home; shrink it for this
            // denser grid. `!` beats the class's own fixed height/width.
            //
            // The lime gradient needs a DARK glyph: `su-icon` ships `text-white`,
            // and white on lime measures 1.58:1 — the icon disappears. The other
            // four gradients are dark enough for white (2.97–17.8:1). This is the
            // same pairing `.su-navitem-active .su-navicon` uses (`color:#141414`).
            <span className={cn("su-icon !h-10 !w-10 shrink-0", GRADIENT_CLASS[gradient])}>
              {icon}
            </span>
          ) : (
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-ink-800 text-zinc-500 dark:text-zinc-400">
              {icon}
            </span>
          ))}
      </div>

      <div className="mt-2 flex items-end justify-between gap-3">
        {/* Proportional figures, not tabular: at this size equal-width digits
            make a number like 121 look loose. */}
        <p className="text-2xl font-semibold leading-tight text-zinc-900 dark:text-zinc-100">
          {value}
        </p>
        {aside && <div className="min-w-0 text-right">{aside}</div>}
      </div>

      <div className="mt-2 flex items-center gap-2 min-h-[1.25rem]">
        {delta !== null && (
          <span
            className="inline-flex items-center gap-1 text-xs font-semibold"
            style={{
              color:
                isGood === null
                  ? "var(--viz-muted)"
                  : isGood
                    ? "var(--viz-up)"
                    : "var(--viz-down)",
            }}
          >
            <Arrow className="h-3.5 w-3.5" aria-hidden />
            {formatDelta(delta)}
          </span>
        )}
        {deltaLabel && (
          <span className="text-xs text-zinc-500 dark:text-zinc-400 truncate">{deltaLabel}</span>
        )}
      </div>

      {sparkline.length > 1 && (
        <div className="mt-3 h-8" aria-hidden>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={sparkline} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
              <Area
                type="monotone"
                dataKey="v"
                stroke="var(--viz-series-1)"
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                fill="var(--viz-series-1)"
                fillOpacity={0.1}
                isAnimationActive={false}
                dot={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </Card>
  );
}
