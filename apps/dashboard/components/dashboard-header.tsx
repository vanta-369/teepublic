"use client";

import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatDelta } from "@/lib/formatters";

/**
 * The dashboard's headline block.
 *
 * It carries the ONE hero figure for the view — total earnings for the selected
 * window — at display size, in the same sans as everything else (a display or
 * serif face here reads as off-brand decoration). Every other number on the
 * page is a stat tile or a chart, so the hierarchy has a single top.
 */
export function DashboardHeader({
  heroLabel,
  heroValue,
  delta,
  deltaLabel,
  windowLabel,
  rowCount,
  currency,
  extraBadges = [],
}: {
  heroLabel: string;
  heroValue: string;
  delta: number | null;
  deltaLabel: string;
  windowLabel: string;
  rowCount: number;
  currency: string;
  /** Extra context chips, e.g. the recognised layout or excluded lines. */
  extraBadges?: string[];
}) {
  const direction = delta === null || delta === 0 ? "flat" : delta > 0 ? "up" : "down";
  const Arrow = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;

  return (
    <div className="viz-root mb-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-zinc-400">{heroLabel}</p>
          {/* Proportional figures — tabular-nums would make this look loose.
              Brand accent, because this is THE number on the page; everything
              else stays in text tokens so the emphasis means something. */}
          <p className="mt-1 text-5xl font-bold leading-none tracking-tight text-accent-600 dark:text-accent-400">
            {heroValue}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {delta !== null && (
              <span
                className="inline-flex items-center gap-1 text-sm font-semibold"
                style={{
                  color:
                    direction === "flat"
                      ? "var(--viz-muted)"
                      : direction === "up"
                        ? "var(--viz-up)"
                        : "var(--viz-down)",
                }}
              >
                <Arrow className="h-4 w-4" aria-hidden />
                {formatDelta(delta)}
              </span>
            )}
            <span className="text-sm text-zinc-500 dark:text-zinc-400">{deltaLabel}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{windowLabel}</Badge>
          <Badge variant="secondary">
            {rowCount.toLocaleString()} sale {rowCount === 1 ? "line" : "lines"}
          </Badge>
          <Badge variant="secondary">{currency}</Badge>
          {extraBadges.map((b) => (
            <Badge key={b} variant="secondary">
              {b}
            </Badge>
          ))}
        </div>
      </div>
    </div>
  );
}
