// Number/date formatting for the analytics dashboard.
//
// Two figure styles, deliberately: large standalone values (metric-card values,
// the hero figure) use the font's default PROPORTIONAL figures — `tabular-nums`
// gives every digit the width of a `0`, which makes a number like `121` look
// loose at display sizes. `tabular-nums` is applied only where numbers stack
// vertically and must align: table columns and axis ticks.

/** Currency, full precision — table cells and tooltips. */
export function formatCurrency(value: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // Unknown/blank ISO code — fall back to a plain number with the raw code.
    return `${value.toFixed(2)} ${currency}`.trim();
  }
}

/**
 * Currency, auto-compacted — metric-card values and axis ticks, where the
 * exact cents are noise and the magnitude is the point ($4.2K, $1.3M).
 */
export function formatCurrencyCompact(value: number, currency = "USD"): string {
  const abs = Math.abs(value);
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      notation: abs >= 10_000 ? "compact" : "standard",
      maximumFractionDigits: abs >= 10_000 ? 1 : 2,
      minimumFractionDigits: abs >= 10_000 ? 0 : 2,
    }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currency}`.trim();
  }
}

/** Whole numbers with thousands separators. */
export function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(value);
}

/** Counts, auto-compacted for stat tiles (1,284 / 12.9K). */
export function formatNumberCompact(value: number): string {
  if (Math.abs(value) < 10_000) return formatNumber(value);
  return new Intl.NumberFormat(undefined, {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value);
}

/** Signed percentage change, e.g. `+12.4%`. `null` renders as an em dash. */
export function formatDelta(delta: number | null): string {
  if (delta === null || !Number.isFinite(delta)) return "—";
  const pct = delta * 100;
  // Below 0.05% the rounded figure would read "+0.0%", which looks like a bug.
  if (Math.abs(pct) < 0.05) return "0%";
  return `${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(1)}%`;
}

/** 0–1 → `34.2%`, for share-of-total labels. */
export function formatShare(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

/** `YYYY-MM-DD` → `12 Mar`, for daily axis ticks and table cells. */
export function formatDayShort(day: string): string {
  const d = dayToDate(day);
  if (!d) return day;
  return new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(d);
}

/** `YYYY-MM-DD` → `12 Mar 2026`, for tooltips where the year matters. */
export function formatDayLong(day: string): string {
  const d = dayToDate(day);
  if (!d) return day;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** `YYYY-MM` → `Mar 2026`, for monthly buckets. */
export function formatMonth(month: string): string {
  const [y, m] = month.split("-").map(Number);
  if (!y || !m) return month;
  return new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" }).format(
    new Date(y, m - 1, 1),
  );
}

export function formatDateRange(from: Date | null, to: Date | null): string {
  if (!from || !to) return "No data";
  const fmt = new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
  return `${fmt.format(from)} – ${fmt.format(to)}`;
}

/** Local calendar day key. Local, not UTC — "today" must mean the user's today. */
export function toDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Inverse of `toDayKey`, parsed as LOCAL midnight (not the UTC that `new
 *  Date("2026-03-12")` would give, which shifts the day west of Greenwich). */
export function dayToDate(day: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}
