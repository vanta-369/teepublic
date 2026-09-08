// Aggregation for the analytics dashboard: `SaleRow[]` + a range → everything
// the charts, tiles and tables render, derived in one pass.
//
// The window is anchored to the LATEST sale in the file, not to `Date.now()`.
// An earnings export is a historical document — anchoring to today would show
// "Last 7 days: $0" for a file exported last month, which reads as a bug. The
// header states the resolved window so the anchor is never a surprise.

import type {
  BreakdownDesign,
  BreakdownSlice,
  DashboardData,
  DesignRollup,
  Metric,
  PeriodBreakdown,
  PeriodStat,
  RangeKey,
  RangeOption,
  SaleRow,
  Slice,
  TimePoint,
} from "./dashboard-types";
import { dayToDate, formatDayShort, formatMonth, toDayKey } from "./formatters";

export const RANGE_OPTIONS: RangeOption[] = [
  { key: "7d", label: "Last 7 days", days: 7 },
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "12m", label: "Last 12 months", days: 365 },
  { key: "all", label: "All time", days: null },
];

/** Beyond ~90 daily points the x-axis stops being readable — switch to months. */
const DAILY_LIMIT = 92;

const addDays = (date: Date, n: number): Date => {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
};

function metric(value: number, previous: number | null): Metric {
  // A 0 → n jump is an infinite percentage, not a "+100%". Report no delta
  // rather than a number that would misstate the change.
  const delta =
    previous === null || previous === 0 ? null : (value - previous) / Math.abs(previous);
  return { value, previous, delta };
}

const sum = (rows: SaleRow[], pick: (r: SaleRow) => number): number =>
  rows.reduce((acc, r) => acc + pick(r), 0);

/** Distinct orders, falling back to row count when the export has no order id. */
function countOrders(rows: SaleRow[]): number {
  const ids = new Set<string>();
  let unidentified = 0;
  for (const r of rows) {
    if (r.orderId) ids.add(r.orderId);
    else unidentified++;
  }
  return ids.size + unidentified;
}

/**
 * Bucket rows by day or month, emitting EVERY bucket in the window including
 * empty ones. Without the zero-fill a gap of no sales renders as a straight
 * line between two distant dates, which understates the volatility.
 */
function buildSeries(rows: SaleRow[], from: Date, to: Date, granularity: "day" | "month"): TimePoint[] {
  const buckets = new Map<string, TimePoint>();

  const keyOf = (d: Date) =>
    granularity === "day"
      ? toDayKey(d)
      : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const labelOf = (key: string) => (granularity === "day" ? formatDayShort(key) : formatMonth(key));

  if (granularity === "day") {
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) {
      const key = keyOf(d);
      buckets.set(key, { key, label: labelOf(key), earnings: 0, units: 0, orders: 0 });
    }
  } else {
    const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
    const end = new Date(to.getFullYear(), to.getMonth(), 1);
    while (cursor <= end) {
      const key = keyOf(cursor);
      buckets.set(key, { key, label: labelOf(key), earnings: 0, units: 0, orders: 0 });
      cursor.setMonth(cursor.getMonth() + 1);
    }
  }

  // Orders are counted per bucket, so the same order split across two lines
  // isn't double-counted within its own bucket.
  const ordersPerBucket = new Map<string, Set<string>>();
  for (const row of rows) {
    const key = keyOf(row.date);
    const bucket = buckets.get(key);
    if (!bucket) continue;
    bucket.earnings += row.earnings;
    bucket.units += row.quantity;
    if (row.orderId) {
      let set = ordersPerBucket.get(key);
      if (!set) ordersPerBucket.set(key, (set = new Set()));
      set.add(row.orderId);
    } else {
      bucket.orders += 1;
    }
  }
  for (const [key, set] of ordersPerBucket) {
    const bucket = buckets.get(key);
    if (bucket) bucket.orders += set.size;
  }

  return [...buckets.values()];
}

/**
 * Share-of-total by product type, biggest first. Anything past the 6th slot is
 * folded into "Other" — past ~7 classes adjacent categories stop being tellable
 * apart, and the full breakdown stays available in the chart's table view.
 */
function buildProductTypes(rows: SaleRow[], totalEarnings: number): Slice[] {
  const byType = new Map<string, { earnings: number; units: number }>();
  for (const row of rows) {
    const entry = byType.get(row.productType) ?? { earnings: 0, units: 0 };
    entry.earnings += row.earnings;
    entry.units += row.quantity;
    byType.set(row.productType, entry);
  }

  const all = [...byType.entries()]
    .map(([name, v]) => ({ name, ...v, share: totalEarnings ? v.earnings / totalEarnings : 0 }))
    .sort((a, b) => b.earnings - a.earnings);

  if (all.length <= 7) return all;
  const head = all.slice(0, 6);
  const tail = all.slice(6);
  head.push({
    name: `Other (${tail.length})`,
    earnings: tail.reduce((a, s) => a + s.earnings, 0),
    units: tail.reduce((a, s) => a + s.units, 0),
    share: tail.reduce((a, s) => a + s.share, 0),
  });
  return head;
}

/**
 * Roll up by DESIGN ID, not title.
 *
 * TeePublic reuses one title across several design ids — "Oklahoma Sooners …
 * Celebration" ships as 94501954, 94501770 and 94501618 — so grouping on the
 * title silently merges designs that are separate listings with separate
 * artwork. The title is still what's displayed; the id is what identifies.
 * Falls back to the title when an export has no id column.
 */
function buildTopDesigns(rows: SaleRow[], limit: number): DesignRollup[] {
  const byDesign = new Map<
    string,
    {
      design: string;
      designId: string | null;
      earnings: number;
      units: number;
      orders: Set<string>;
      looseOrders: number;
      types: Map<string, number>;
    }
  >();

  for (const row of rows) {
    const key = row.designId ?? row.design;
    let entry = byDesign.get(key);
    if (!entry) {
      entry = {
        design: row.design,
        designId: row.designId,
        earnings: 0, units: 0, orders: new Set(), looseOrders: 0, types: new Map(),
      };
      byDesign.set(key, entry);
    }
    entry.earnings += row.earnings;
    entry.units += row.quantity;
    if (row.orderId) entry.orders.add(row.orderId);
    else entry.looseOrders += 1;
    entry.types.set(row.productType, (entry.types.get(row.productType) ?? 0) + row.quantity);
  }

  return [...byDesign.entries()]
    .map(([key, e]) => {
      const topProductType =
        [...e.types.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "Other";
      return {
        key,
        design: e.design,
        designId: e.designId,
        earnings: e.earnings,
        units: e.units,
        orders: e.orders.size + e.looseOrders,
        topProductType,
        perUnit: e.units ? e.earnings / e.units : 0,
      };
    })
    .sort((a, b) => b.earnings - a.earnings)
    .slice(0, limit);
}

/** Resolve a range preset against the data's own latest date. */
export function resolveWindow(
  rows: SaleRow[],
  range: RangeKey,
): { from: Date; to: Date; previousFrom: Date; previousTo: Date } | null {
  if (!rows.length) return null;

  // `rows` is sorted oldest → newest by the parser.
  const earliest = rows[0].date;
  const latest = rows[rows.length - 1].date;
  const option = RANGE_OPTIONS.find((o) => o.key === range) ?? RANGE_OPTIONS[1];

  if (option.days === null) {
    const spanDays = Math.max(
      1,
      Math.round((latest.getTime() - earliest.getTime()) / 86_400_000) + 1,
    );
    return {
      from: earliest,
      to: latest,
      // "All time" has nothing before it to compare against; the equal-length
      // window sits entirely outside the data and yields no rows, which is
      // exactly right — the tiles then show no delta.
      previousFrom: addDays(earliest, -spanDays),
      previousTo: addDays(earliest, -1),
    };
  }

  const from = addDays(latest, -(option.days - 1));
  return {
    from,
    to: latest,
    previousFrom: addDays(from, -option.days),
    previousTo: addDays(from, -1),
  };
}

export function buildDashboardData(rows: SaleRow[], range: RangeKey): DashboardData {
  const currency = rows[0]?.currency ?? "USD";
  const empty: DashboardData = {
    totals: {
      earnings: metric(0, null), units: metric(0, null),
      orders: metric(0, null), perOrder: metric(0, null),
    },
    series: [], granularity: "day", productTypes: [], topDesigns: [],
    recentSales: [], currency, from: null, to: null, rowCount: 0, cancelledCount: 0,
  };

  const window = resolveWindow(rows, range);
  if (!window) return empty;
  const { from, to, previousFrom, previousTo } = window;

  // Compare on day keys, not timestamps: every row's date is local midnight, so
  // string comparison over `YYYY-MM-DD` is both correct and DST-proof.
  const fromKey = toDayKey(from);
  const toKey = toDayKey(to);
  const prevFromKey = toDayKey(previousFrom);
  const prevToKey = toDayKey(previousTo);

  const inWindow = rows.filter((r) => r.day >= fromKey && r.day <= toKey);

  // Cancelled lines earn 0 but still carry a quantity, so leaving them in would
  // inflate "units sold" and "orders" with sales that never happened. They are
  // excluded from every figure and reported separately.
  const current = inWindow.filter((r) => !r.cancelled);
  const cancelledCount = inWindow.length - current.length;
  const previous = rows.filter(
    (r) => r.day >= prevFromKey && r.day <= prevToKey && !r.cancelled,
  );

  const earnings = sum(current, (r) => r.earnings);
  const units = sum(current, (r) => r.quantity);
  const orders = countOrders(current);

  const prevEarnings = previous.length ? sum(previous, (r) => r.earnings) : null;
  const prevUnits = previous.length ? sum(previous, (r) => r.quantity) : null;
  const prevOrders = previous.length ? countOrders(previous) : null;
  const prevPerOrder = prevOrders ? (prevEarnings ?? 0) / prevOrders : null;

  const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1;
  const granularity: "day" | "month" = spanDays > DAILY_LIMIT ? "month" : "day";

  return {
    totals: {
      earnings: metric(earnings, prevEarnings),
      units: metric(units, prevUnits),
      orders: metric(orders, prevOrders),
      perOrder: metric(orders ? earnings / orders : 0, prevPerOrder),
    },
    series: buildSeries(current, from, to, granularity),
    granularity,
    productTypes: buildProductTypes(current, earnings),
    topDesigns: buildTopDesigns(current, 8),
    // Newest first — `rows` is ascending, so take from the end.
    recentSales: current.slice(-12).reverse(),
    currency,
    from,
    to,
    rowCount: current.length,
    cancelledCount,
  };
}

/**
 * The at-a-glance period strip: today, yesterday, last 7 days, this month,
 * previous month, all time.
 *
 * Anchored to the export's latest sale, not `Date.now()` — same rule as the
 * range filter. An earnings export is a historical document, so pinning
 * "today" to the wall clock would show a column of zeroes for a file
 * downloaded last week. The strip states the anchor date.
 */
export function buildPeriodSummary(rows: SaleRow[]): PeriodStat[] {
  if (!rows.length) return [];

  const anchor = rows[rows.length - 1].date;
  const anchorKey = toDayKey(anchor);
  const yesterdayKey = toDayKey(addDays(anchor, -1));
  const last7From = toDayKey(addDays(anchor, -6));

  const monthStart = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const prevMonthStart = new Date(anchor.getFullYear(), anchor.getMonth() - 1, 1);
  const prevMonthEnd = addDays(monthStart, -1);

  const shortDate = (d: Date) =>
    new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" }).format(d);

  const windows: { label: string; rangeLabel: string; from: string; to: string }[] = [
    { label: "Latest day", rangeLabel: shortDate(anchor), from: anchorKey, to: anchorKey },
    {
      label: "Day before",
      rangeLabel: shortDate(addDays(anchor, -1)),
      from: yesterdayKey, to: yesterdayKey,
    },
    {
      label: "Last 7 days",
      rangeLabel: `${shortDate(addDays(anchor, -6))} – ${shortDate(anchor)}`,
      from: last7From, to: anchorKey,
    },
    {
      label: "This month",
      rangeLabel: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(anchor),
      from: toDayKey(monthStart), to: anchorKey,
    },
    {
      label: "Previous month",
      rangeLabel: new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" }).format(prevMonthStart),
      from: toDayKey(prevMonthStart), to: toDayKey(prevMonthEnd),
    },
    {
      label: "All time",
      rangeLabel: `${shortDate(rows[0].date)} – ${shortDate(anchor)}`,
      from: toDayKey(rows[0].date), to: anchorKey,
    },
  ];

  return windows.map((w) => {
    const inWindow = rows.filter((r) => r.day >= w.from && r.day <= w.to);
    const live = inWindow.filter((r) => !r.cancelled);
    return {
      label: w.label,
      rangeLabel: w.rangeLabel,
      units: sum(live, (r) => r.quantity),
      earnings: sum(live, (r) => r.earnings),
      orders: countOrders(live),
      cancelled: inWindow.length - live.length,
      from: w.from,
      to: w.to,
    };
  });
}

/**
 * The full breakdown behind one period tile — what the detail dialog shows.
 *
 * Derived on demand rather than inside `buildPeriodSummary`: six windows that
 * mostly overlap ("this month" is a superset of "last 7 days") would mean
 * grouping the same rows six times on every parse, for panels the reader may
 * never open.
 *
 * Cancelled lines are excluded from every figure, exactly as the tiles do, and
 * reported separately per design so a refund-heavy design is still visible.
 */
export function buildPeriodBreakdown(
  rows: SaleRow[],
  from: string,
  to: string,
): PeriodBreakdown {
  const inWindow = rows.filter((r) => r.day >= from && r.day <= to);
  const live = inWindow.filter((r) => !r.cancelled);
  const cancelledRows = inWindow.filter((r) => r.cancelled);

  const units = sum(live, (r) => r.quantity);
  const earnings = sum(live, (r) => r.earnings);

  // Share is of UNITS, not earnings — the bar lists answer "what sold", and a
  // single high-margin item would otherwise dominate a list about volume.
  const sliceBy = (pick: (r: SaleRow) => string | null): BreakdownSlice[] => {
    const acc = new Map<string, { units: number; earnings: number }>();
    for (const r of live) {
      const name = pick(r);
      if (!name) continue;
      const hit = acc.get(name) ?? { units: 0, earnings: 0 };
      hit.units += r.quantity;
      hit.earnings += r.earnings;
      acc.set(name, hit);
    }
    return [...acc.entries()]
      .map(([name, v]) => ({ ...v, name, share: units > 0 ? v.units / units : 0 }))
      .sort((a, b) => b.units - a.units);
  };

  // Grouped by design ID, not title — the same rule `buildTopDesigns` follows,
  // since TeePublic reuses one title across several ids.
  const byDesign = new Map<string, BreakdownDesign>();
  for (const r of live) {
    const key = r.designId ?? r.design;
    const hit =
      byDesign.get(key) ??
      {
        key,
        design: r.design,
        designId: r.designId,
        productType: r.productType,
        units: 0,
        earnings: 0,
        cancelled: 0,
        perUnit: 0,
      };
    hit.units += r.quantity;
    hit.earnings += r.earnings;
    byDesign.set(key, hit);
  }
  // Cancelled lines attach to a design that may have no live sales at all, so
  // they get an entry of their own rather than being dropped.
  for (const r of cancelledRows) {
    const key = r.designId ?? r.design;
    const hit =
      byDesign.get(key) ??
      {
        key,
        design: r.design,
        designId: r.designId,
        productType: r.productType,
        units: 0,
        earnings: 0,
        cancelled: 0,
        perUnit: 0,
      };
    hit.cancelled += 1;
    byDesign.set(key, hit);
  }

  const designs = [...byDesign.values()]
    .map((d) => ({ ...d, perUnit: d.units > 0 ? d.earnings / d.units : 0 }))
    .sort((a, b) => b.earnings - a.earnings || b.units - a.units);

  return {
    units,
    earnings,
    orders: countOrders(live),
    cancelled: cancelledRows.length,
    perUnit: units > 0 ? earnings / units : 0,
    productTypes: sliceBy((r) => r.productType),
    countries: sliceBy((r) => r.country),
    designs,
  };
}

/** Re-exported so components can turn a bucket key back into a real date. */
export { dayToDate };
