"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Compact hover-driven bar chart — the small "Activity"-style tile.
 *
 * Recolored to this project's tokens. The upstream version is written against
 * shadcn's `--foreground` / `--muted-foreground` / `--background` variables,
 * which this codebase deliberately doesn't define (see the note at the top of
 * `components/ui/card.tsx`). The mapping used throughout:
 *
 *   foreground        → `zinc-900 dark:zinc-100`
 *   muted-foreground  → `zinc-500 dark:zinc-400`
 *   background        → `zinc-50  dark:zinc-900`   (tooltip ink, inverted)
 *   card surface      → `ink-900`, hairline `ink-700`
 *
 * The bars are monochrome on purpose: this is ONE series, so hue would encode
 * nothing. Emphasis comes from ink weight + scale on hover, which is why the
 * chart doesn't pull from `--viz-series-*` the way the recharts cards do.
 *
 * Value is never carried by colour alone — every bar has a text tooltip, and
 * the whole set is mirrored in an `sr-only` list for assistive tech, matching
 * the Chart/Table pairing `ChartCard` enforces on the analytics charts.
 */

export interface MiniChartPoint {
  /** Category name. The chart prints only its first character under the bar. */
  label: string;
  value: number;
}

const DEFAULT_DATA: MiniChartPoint[] = [
  { label: "Mon", value: 65 },
  { label: "Tue", value: 85 },
  { label: "Wed", value: 45 },
  { label: "Thu", value: 95 },
  { label: "Fri", value: 70 },
  { label: "Sat", value: 55 },
  { label: "Sun", value: 80 },
];

/** Tallest bar, in px. Kept in JS because the height is set inline per bar. */
const BAR_MAX_PX = 96;

export interface MiniChartProps {
  data?: MiniChartPoint[];
  /** Small caps heading next to the status dot. */
  title?: string;
  /** Suffix on the readout and tooltips. Pass "" for a bare count. */
  unit?: string;
  /** Hides the pulsing dot when the tile isn't showing live data. */
  live?: boolean;
  className?: string;
}

export function MiniChart({
  data = DEFAULT_DATA,
  title = "Activity",
  unit = "%",
  live = true,
  className,
}: MiniChartProps) {
  const [activeIndex, setActiveIndex] = React.useState<number | null>(null);
  const [displayValue, setDisplayValue] = React.useState<number | null>(null);
  const [isEngaged, setIsEngaged] = React.useState(false);

  // Upstream fires a bare setTimeout on mouse-leave to let the readout fade out
  // before it clears. Held in a ref so an unmount mid-fade doesn't setState on a
  // dead component.
  const clearTimer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxValue = React.useMemo(
    () => Math.max(1, ...data.map((d) => d.value)),
    [data],
  );

  React.useEffect(() => {
    if (activeIndex !== null && data[activeIndex]) {
      setDisplayValue(data[activeIndex].value);
    }
  }, [activeIndex, data]);

  React.useEffect(() => () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
  }, []);

  const engage = () => {
    if (clearTimer.current) clearTimeout(clearTimer.current);
    setIsEngaged(true);
  };

  const disengage = () => {
    setIsEngaged(false);
    setActiveIndex(null);
    if (clearTimer.current) clearTimeout(clearTimer.current);
    clearTimer.current = setTimeout(() => setDisplayValue(null), 150);
  };

  // Arrow keys walk the series, so the values are reachable without a pointer.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 1 : -1;
    const start = activeIndex ?? (step === 1 ? -1 : data.length);
    const next = Math.min(data.length - 1, Math.max(0, start + step));
    engage();
    setActiveIndex(next);
  };

  return (
    <div
      onMouseEnter={engage}
      onMouseLeave={disengage}
      onFocus={engage}
      onBlur={disengage}
      onKeyDown={onKeyDown}
      tabIndex={0}
      role="group"
      aria-label={`${title} chart. Use the arrow keys to step through values.`}
      className={cn(
        "group relative flex w-72 flex-col gap-4 rounded-2xl border border-ink-700 bg-ink-900 p-6",
        "shadow-card backdrop-blur-sm transition-all duration-500",
        "hover:border-zinc-900/20 dark:hover:border-zinc-100/20",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
        className,
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {live && <span className="h-2 w-2 animate-pulse rounded-full bg-success-500" aria-hidden />}
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            {title}
          </span>
        </div>

        {/* Fixed height so the readout appearing never nudges the header. */}
        <div className="relative flex h-7 items-center" aria-live="polite" aria-atomic>
          <span
            className={cn(
              "text-lg font-semibold tabular-nums transition-all duration-300 ease-out",
              isEngaged && displayValue !== null
                ? "text-zinc-900 opacity-100 dark:text-zinc-100"
                : "text-zinc-500 opacity-50 dark:text-zinc-400",
            )}
          >
            {displayValue !== null ? displayValue : ""}
            {unit && (
              <span
                className={cn(
                  "ml-0.5 text-xs font-normal text-zinc-500 transition-opacity duration-300 dark:text-zinc-400",
                  displayValue !== null ? "opacity-100" : "opacity-0",
                )}
              >
                {unit}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* Chart. Height is the tallest bar plus the label row underneath — the
          column is `justify-end`, so sizing it to the bar alone overflows. */}
      <div className="flex items-end gap-2" style={{ height: BAR_MAX_PX + 24 }} aria-hidden>
        {data.map((item, index) => {
          const heightPx = (item.value / maxValue) * BAR_MAX_PX;
          const isActive = activeIndex === index;
          const isAnyActive = activeIndex !== null;
          const isNeighbor =
            activeIndex !== null && (index === activeIndex - 1 || index === activeIndex + 1);

          return (
            <div
              key={`${item.label}-${index}`}
              className="relative flex h-full flex-1 flex-col items-center justify-end"
              onMouseEnter={() => setActiveIndex(index)}
            >
              {/* Bar */}
              <div
                className={cn(
                  "w-full origin-bottom cursor-pointer rounded-full transition-all duration-300 ease-out",
                  isActive
                    ? "bg-zinc-900 dark:bg-zinc-100"
                    : isNeighbor
                      ? "bg-zinc-900/30 dark:bg-zinc-100/30"
                      : isAnyActive
                        ? "bg-zinc-900/10 dark:bg-zinc-100/10"
                        : "bg-zinc-900/20 group-hover:bg-zinc-900/25 dark:bg-zinc-100/20 dark:group-hover:bg-zinc-100/25",
                )}
                style={{
                  height: `${heightPx}px`,
                  transform: isActive
                    ? "scaleX(1.15) scaleY(1.02)"
                    : isNeighbor
                      ? "scaleX(1.05)"
                      : "scaleX(1)",
                }}
              />

              {/* Label */}
              <span
                className={cn(
                  "mt-2 text-[10px] font-medium transition-all duration-300",
                  isActive
                    ? "text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-500/60 dark:text-zinc-400/60",
                )}
              >
                {item.label.charAt(0)}
              </span>

              {/* Tooltip */}
              <div
                className={cn(
                  "absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1",
                  "bg-zinc-900 text-xs font-medium text-zinc-50 transition-all duration-200",
                  "dark:bg-zinc-100 dark:text-zinc-900",
                  isActive
                    ? "translate-y-0 opacity-100"
                    : "pointer-events-none translate-y-1 opacity-0",
                )}
              >
                {item.value}
                {unit}
              </div>
            </div>
          );
        })}
      </div>

      {/* The values, in text, for anything that can't read the bars. */}
      <ul className="sr-only">
        {data.map((item, index) => (
          <li key={`${item.label}-${index}-sr`}>
            {item.label}: {item.value}
            {unit}
          </li>
        ))}
      </ul>

      {/* Subtle glow on hover. Constant per element, never scaled by value, so
          it decorates without implying a magnitude. */}
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-gradient-to-b from-zinc-900/[0.02] to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100 dark:from-zinc-100/[0.03]" />
    </div>
  );
}
