// Types for the earnings/sales analytics dashboard.
//
// The source is a TeePublic earnings CSV export. TeePublic has shipped several
// column namings over the years and localises some of them, so nothing here
// assumes an exact header set — `csv-parser.ts` maps whatever arrived onto the
// canonical `SaleRow` below, and records how it did that in `ColumnMap` so the
// UI can show (and let the user correct) the mapping.

/** The canonical shape every parsed CSV row is normalised into. */
export interface SaleRow {
  /** Local calendar day, `YYYY-MM-DD`. The single key every rollup groups on. */
  day: string;
  /** Parsed timestamp (local midnight when the CSV only carried a date). */
  date: Date;
  /** Seller earnings for the row, in `currency`. Negative for refunds. */
  earnings: number;
  /** Buyer-facing price, when the export includes it. */
  retail: number | null;
  /** Units on the line. Defaults to 1 when the export has no quantity column. */
  quantity: number;
  /** Design/artwork title. `"Unknown"` when absent. */
  design: string;
  /**
   * TeePublic's numeric design id. This — not the title — is the identity of a
   * design: the same title is routinely reused across several ids (e.g.
   * "Oklahoma Sooners … Celebration" ships as 94501954, 94501770 and 94501618),
   * so rolling up by title silently merges distinct designs.
   */
  designId: string | null;
  /** Product type — "T-Shirt", "Sticker", "Mug"… `"Other"` when absent. */
  productType: string;
  /** Order status verbatim from the export ("Processed", "Cancelled", …). */
  status: string | null;
  /** True when `status` marks the line as cancelled/refunded. */
  cancelled: boolean;
  /** ISO-ish country string when present. */
  country: string | null;
  /** Order/transaction reference when present. */
  orderId: string | null;
  /** ISO 4217 code detected from the file, or the export's own column. */
  currency: string;
}

/** Which canonical field each field was read from, for the mapping UI. */
export type CanonicalField =
  | "date"
  | "earnings"
  | "retail"
  | "quantity"
  | "design"
  | "designId"
  | "productType"
  | "status"
  | "country"
  | "orderId"
  | "currency";

/** Canonical field → the CSV header it was resolved to (null = not found). */
export type ColumnMap = Record<CanonicalField, string | null>;

export interface ParseResult {
  rows: SaleRow[];
  columnMap: ColumnMap;
  /** Headers as they appeared in the file, for the manual re-map control. */
  headers: string[];
  /** Rows papaparse produced that we could not use, with the reason. */
  skipped: { row: number; reason: string }[];
  currency: string;
  /** Non-fatal problems worth surfacing (ambiguous dates, missing earnings…). */
  warnings: string[];
  /** Name of the recognised export layout, when one matched. */
  layout: string | null;
  /** Preamble lines skipped before the header row was found. */
  preambleLines: number;
  /** Cancelled/refunded lines, excluded from the rollups. */
  cancelledCount: number;
}

/** Preset ranges for the filter row. `all` means "every row in the file". */
export type RangeKey = "7d" | "30d" | "90d" | "12m" | "all";

export interface RangeOption {
  key: RangeKey;
  label: string;
  /** Length in days, or null for `all`. Drives the comparison window too. */
  days: number | null;
}

/** One point on the earnings / sales time series. */
export interface TimePoint {
  /** Bucket key — a day (`YYYY-MM-DD`) or a month (`YYYY-MM`). */
  key: string;
  /** Pre-formatted axis label for the bucket. */
  label: string;
  earnings: number;
  units: number;
  orders: number;
}

/** A share-of-total slice: product type, country, etc. */
export interface Slice {
  name: string;
  earnings: number;
  units: number;
  /** 0–1 share of the filtered total earnings. */
  share: number;
}

/** A design rolled up across every sale in the filtered window. */
export interface DesignRollup {
  /** Grouping key: the design id when the export has one, else the title. */
  key: string;
  design: string;
  /** TeePublic design id, when present. */
  designId: string | null;
  earnings: number;
  units: number;
  orders: number;
  /** Best-selling product type for this design, for the table's context column. */
  topProductType: string;
  /** Mean earnings per unit — surfaces which designs sell on higher-margin items. */
  perUnit: number;
}

/** A headline number plus its change against the preceding equal-length window. */
export interface Metric {
  value: number;
  /** Same measure over the immediately preceding window; null when unavailable. */
  previous: number | null;
  /** Signed fractional change vs `previous` (0.12 = +12%); null when unavailable. */
  delta: number | null;
}

/** Everything the dashboard renders, derived in one pass. */
export interface DashboardData {
  totals: {
    earnings: Metric;
    units: Metric;
    orders: Metric;
    perOrder: Metric;
  };
  /** Daily for ranges up to 90d, monthly beyond — keeps the axis readable. */
  series: TimePoint[];
  granularity: "day" | "month";
  productTypes: Slice[];
  topDesigns: DesignRollup[];
  recentSales: SaleRow[];
  currency: string;
  /** Inclusive bounds of the filtered window, for the header subtitle. */
  from: Date | null;
  to: Date | null;
  rowCount: number;
  /** Cancelled lines inside the window, excluded from every figure above. */
  cancelledCount: number;
}

/** One tile in the period-summary strip (Today / Yesterday / Last 7 days / …). */
export interface PeriodStat {
  label: string;
  /** Human range under the label, e.g. "24 Jul – 30 Jul". */
  rangeLabel: string;
  units: number;
  earnings: number;
  orders: number;
  cancelled: number;
  /** Inclusive window bounds as `YYYY-MM-DD` day keys. Carried so the tile's
   *  breakdown dialog can re-filter the raw rows instead of the strip having
   *  to precompute six full breakdowns nobody may ever open. */
  from: string;
  to: string;
}

/** One row of a share-of-total bar list inside the period breakdown. */
export interface BreakdownSlice {
  name: string;
  units: number;
  earnings: number;
  /** 0–1 share of the window's units. */
  share: number;
}

/** A design's line in the period breakdown table. */
export interface BreakdownDesign {
  key: string;
  design: string;
  designId: string | null;
  productType: string;
  units: number;
  earnings: number;
  /** Cancelled/refunded lines for this design inside the window. */
  cancelled: number;
  /** Mean earnings per unit. */
  perUnit: number;
}

/** Everything the period-detail dialog renders for one window. */
export interface PeriodBreakdown {
  units: number;
  earnings: number;
  orders: number;
  cancelled: number;
  /** Mean earnings per unit across the window; 0 when nothing sold. */
  perUnit: number;
  productTypes: BreakdownSlice[];
  countries: BreakdownSlice[];
  designs: BreakdownDesign[];
}

/**
 * The only upload statistic the server holds: a lifetime count per account.
 * The previous shape (today / yesterday / last7 / last30 / prev7 / prev30)
 * was computed from a per-publish event table that no longer exists - see
 * lib/uploadCount.ts and supabase/migrations/0009_upload_stats.sql.
 */
export interface UploadCountStats {
  total: number;
  updatedAt: string | null;
}
