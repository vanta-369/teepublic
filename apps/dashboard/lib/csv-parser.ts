// Parser for a TeePublic earnings export → `SaleRow[]`.
//
// Three things about the real export make a naive `header: true` parse wrong,
// and all three are handled here:
//
//  1. The header is NOT the first line. TeePublic prepends a payout disclaimer
//     and a "Read more on Earnings: <url>" line, so the real header sits on
//     line 3. We parse headerless, then FIND the header row by scoring each row
//     against the alias table.
//
//  2. `Product` and `Product Type` are the opposite of what the names suggest.
//     `Product` holds the category ("T-Shirt", "Sticker", "Mug"); `Product
//     Type` holds the variant/SKU string ("Classic T-Shirt, Male Fit | XL,
//     Light Blue"). Grouping on the column literally called "Product Type"
//     yields hundreds of one-off categories. The recognised-layout table below
//     maps `productType` → `Product` for this export specifically.
//
//  3. It ends with blank rows and a `TOTAL ITEMS / TOTAL SALES / TOTAL
//     EARNINGS` footer. Those are dropped silently rather than reported as
//     broken rows.
//
// Everything else stays alias-driven: TeePublic has renamed columns across
// versions and sellers hand-edit these files, so the mapping is always
// resolved, always shown, and always overridable.
//
// Accepts .csv and .xlsx/.xls — the export may be either.

import Papa from "papaparse";
import * as XLSX from "xlsx";

import type { CanonicalField, ColumnMap, ParseResult, SaleRow } from "./dashboard-types";
import { toDayKey } from "./formatters";

/**
 * Header aliases per canonical field, most-specific first. Matching runs on a
 * normalised header (lowercased, non-alphanumerics stripped), so "Your
 * Earnings", "your_earnings" and "YOUR EARNINGS ($)" collapse to one key.
 */
const ALIASES: Record<CanonicalField, string[]> = {
  date: [
    "orderdate", "saledate", "purchasedate", "transactiondate", "datesold",
    "createdat", "soldon", "date", "day", "period", "timestamp",
  ],
  earnings: [
    // "totalearnings" first: it is TeePublic's bottom-line payout column and
    // the one its own TOTAL EARNINGS footer sums. "designerearnings" is the
    // pre-fee figure — close, but not what the seller is paid.
    "totalearnings", "yourearnings", "netearnings", "designerearnings",
    "artistearnings", "sellerearnings", "earnings", "earning", "artistmargin",
    "commission", "royalty", "royalties", "profit", "payout", "margin",
  ],
  retail: [
    "retailprice", "saleprice", "listprice", "grossrevenue", "totalsales",
    "revenue", "gross", "ordertotal", "producttotal", "price", "amount",
  ],
  quantity: ["totalitems", "quantity", "qty", "units", "unitssold", "itemcount", "count", "pieces"],
  design: [
    "designname", "artworkname", "designtitle", "title", "design", "artwork",
    "productname", "itemname", "name",
  ],
  designId: ["designid", "artworkid", "designnumber"],
  productType: [
    // NOTE: bare "product" outranks "producttype" here because of the TeePublic
    // inversion described at the top of this file. A file that has only
    // "Product Type" still matches on the later alias.
    "product", "productcategory", "itemtype", "category", "garment",
    "producttype", "type", "style",
  ],
  status: ["orderstatus", "status", "state"],
  country: ["buyercountry", "shipcountry", "shippingcountry", "country", "region", "market"],
  orderId: ["ordernumber", "orderid", "transactionid", "invoiceid", "invoice", "order"],
  currency: ["currencycode", "isocurrency", "currency"],
};

/** Fields the dashboard cannot run without. */
const REQUIRED: CanonicalField[] = ["date", "earnings"];

/** Statuses that mean "this line did not result in a sale". */
const CANCELLED_RX = /^(cancel|refund|void|charge ?back|return)/i;

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Layouts we recognise outright. A known export beats generic alias scoring,
 * because only a hard-coded map can express "the column named `Product Type` is
 * NOT the product type".
 */
const KNOWN_LAYOUTS: {
  name: string;
  /** Normalised headers that must all be present. */
  signature: string[];
  /** Canonical field → normalised header. */
  map: Partial<Record<CanonicalField, string>>;
}[] = [
  {
    name: "TeePublic earnings report",
    signature: ["orderdate", "designid", "totalearnings", "product", "producttype"],
    map: {
      date: "orderdate",
      earnings: "totalearnings",
      design: "title",
      designId: "designid",
      productType: "product",
      quantity: "totalitems",
      orderId: "ordernumber",
      status: "orderstatus",
      // Deliberately unmapped: this export carries no retail price, no buyer
      // country and no currency column (amounts are USD).
    },
  },
];

/**
 * Resolve each canonical field to a header. A header is claimed by at most one
 * field, so a file with both "Product" and "Product Type" doesn't map both to
 * `productType` and leave `design` empty.
 */
function resolveColumns(headers: string[]): { map: ColumnMap; layout: string | null } {
  const map: ColumnMap = {
    date: null, earnings: null, retail: null, quantity: null, design: null,
    designId: null, productType: null, status: null, country: null,
    orderId: null, currency: null,
  };
  const normed = headers.map((h) => ({ raw: h, key: norm(h) }));
  const byKey = new Map(normed.map((h) => [h.key, h.raw]));

  const known = KNOWN_LAYOUTS.find((l) => l.signature.every((s) => byKey.has(s)));
  if (known) {
    for (const [field, key] of Object.entries(known.map)) {
      map[field as CanonicalField] = byKey.get(key) ?? null;
    }
    return { map, layout: known.name };
  }

  const claimed = new Set<string>();
  // Two passes: exact alias matches first, then substring. Without the split, a
  // substring hit on an early field ("total" → retail) can steal the column an
  // exact match on a later field wanted.
  for (const exact of [true, false]) {
    for (const field of Object.keys(ALIASES) as CanonicalField[]) {
      if (map[field]) continue;
      for (const alias of ALIASES[field]) {
        const hit = normed.find(
          (h) => !claimed.has(h.raw) && (exact ? h.key === alias : h.key.includes(alias)),
        );
        if (hit) {
          map[field] = hit.raw;
          claimed.add(hit.raw);
          break;
        }
      }
    }
  }
  return { map, layout: null };
}

/**
 * Currency-ish string → number. Handles `$1,234.56`, `1.234,56 €`, `(4.20)`
 * for negatives (refunds — spreadsheet apps write them this way), and bare
 * numbers. Returns null when there is no number in there at all.
 */
export function parseAmount(input: unknown): number | null {
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  if (input === null || input === undefined) return null;

  let s = String(input).trim();
  if (!s) return null;

  const parenNegative = /^\((.*)\)$/.test(s);
  if (parenNegative) s = s.slice(1, -1);

  const negative = parenNegative || s.includes("-");
  s = s.replace(/[^0-9.,]/g, "");
  if (!s) return null;

  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma > -1 && lastDot > -1) {
    // Both present — whichever comes last is the decimal separator.
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma > -1) {
    // Only commas. "1,234" is thousands; "1,23" is a decimal comma. Group
    // separators always leave exactly 3 digits behind them.
    const tail = s.length - lastComma - 1;
    s = tail === 3 ? s.replace(/,/g, "") : s.replace(",", ".");
  }

  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -Math.abs(n) : n;
}

/** ISO 4217 code guessed from a symbol or code anywhere in the raw cell. */
function detectCurrency(sample: string): string | null {
  if (/\$/.test(sample)) return "USD";
  if (/€/.test(sample)) return "EUR";
  if (/£/.test(sample)) return "GBP";
  if (/¥/.test(sample)) return "JPY";
  const code = /\b(USD|EUR|GBP|CAD|AUD|JPY|SEK|CHF|NZD|PLN)\b/i.exec(sample);
  return code ? code[1].toUpperCase() : null;
}

type DateOrder = "mdy" | "dmy";

/**
 * Decide, once, for the whole column, whether slash/dash dates are MM/DD or
 * DD/MM. Per-row guessing would let one file parse some rows each way. A day
 * > 12 anywhere is proof; with no proof we default to MM/DD (TeePublic reports
 * in US format) and warn.
 */
function detectDateOrder(samples: string[]): { order: DateOrder; ambiguous: boolean } {
  for (const s of samples) {
    const m = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})$/.exec(s.trim());
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a > 12 && b <= 12) return { order: "dmy", ambiguous: false };
    if (b > 12 && a <= 12) return { order: "mdy", ambiguous: false };
  }
  return { order: "mdy", ambiguous: true };
}

function parseDate(input: unknown, order: DateOrder): Date | null {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;

  // SheetJS hands back Excel serial day numbers for date-formatted cells.
  if (typeof input === "number" && Number.isFinite(input)) {
    if (input < 1 || input > 60000) return null;
    // Excel's epoch is 1899-12-30 (its phantom 1900 leap day is why it's the
    // 30th, not the 31st).
    const d = new Date(Date.UTC(1899, 11, 30 + Math.floor(input)));
    return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
  }

  const s = String(input ?? "").trim();
  if (!s) return null;

  // `YYYY-MM-DD[ HH:MM:SS ±ZZZZ]`. We take the DATE PART VERBATIM and build a
  // local midnight from it — deliberately ignoring the offset. TeePublic
  // timestamps the sale in US Eastern, and the calendar day it reports is the
  // Eastern day. Converting to the viewer's zone would shuffle late-evening
  // sales into the next/previous day and stop the totals matching TeePublic's
  // own monthly statement.
  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (iso) {
    const d = new Date(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const slash = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2,4})/.exec(s);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let year = Number(slash[3]);
    if (year < 100) year += year < 70 ? 2000 : 1900;
    let month = order === "mdy" ? a : b;
    let dayOfMonth = order === "mdy" ? b : a;
    // Per-row override: if the column's order gives an impossible month but the
    // other order works, that row is unambiguous — trust it.
    if (month > 12 && dayOfMonth <= 12) [month, dayOfMonth] = [dayOfMonth, month];
    if (month < 1 || month > 12 || dayOfMonth < 1 || dayOfMonth > 31) return null;
    const d = new Date(year, month - 1, dayOfMonth);
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const fallback = new Date(s);
  return Number.isNaN(fallback.getTime()) ? null : fallback;
}

/** Every alias, flattened — used to score candidate header rows. */
const ALL_ALIASES = new Set(Object.values(ALIASES).flat());

/**
 * Find the header row in a headerless grid, skipping any preamble.
 *
 * Scored rather than assumed: TeePublic's disclaimer line is a single quoted
 * cell, and a "Read more…" line is one or two cells, so requiring ≥3 non-empty
 * cells plus ≥2 recognised column names lands on the real header. Returns -1
 * when nothing looks like a header.
 */
function findHeaderRow(grid: unknown[][]): number {
  const limit = Math.min(grid.length, 25);
  let best = -1;
  let bestScore = 0;

  for (let i = 0; i < limit; i++) {
    const cells = grid[i].map((c) => String(c ?? "").trim());
    const filled = cells.filter(Boolean);
    if (filled.length < 3) continue;

    const score = filled.filter((c) => ALL_ALIASES.has(norm(c))).length;
    if (score >= 2 && score > bestScore) {
      bestScore = score;
      best = i;
    }
  }
  return best;
}

/** Read a File (.csv/.xlsx/.xls) into a raw grid of cells. */
async function readGrid(file: File): Promise<unknown[][]> {
  const isExcel = /\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name);

  if (isExcel) {
    const buf = await file.arrayBuffer();
    // `cellDates` yields real Dates where the cell is date-formatted;
    // `parseDate` handles serial numbers too.
    const wb = XLSX.read(buf, { type: "array", cellDates: true });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    if (!sheet) return [];
    return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: "", blankrows: false });
  }

  const text = await file.text();
  // Headerless on purpose — the header row is found by `findHeaderRow`, since
  // it is not line 1 in a real TeePublic export.
  const parsed = Papa.parse<unknown[]>(text, {
    header: false,
    skipEmptyLines: "greedy",
    // Keep values as strings: `parseAmount` handles currency symbols and
    // European separators better than papaparse's dynamic typing, which reads
    // "1.234,56" as 1.234.
    dynamicTyping: false,
  });
  return parsed.data ?? [];
}

/**
 * Parse an export into `SaleRow[]`.
 *
 * @param overrides Optional user corrections from the mapping UI; any field set
 *   here wins over the auto-detected header.
 */
export async function parseSalesFile(
  file: File,
  overrides?: Partial<ColumnMap>,
): Promise<ParseResult> {
  const grid = await readGrid(file);
  const warnings: string[] = [];
  const skipped: { row: number; reason: string }[] = [];

  const emptyMap = resolveColumns([]).map;
  const fail = (message: string, headers: string[] = [], map = emptyMap): ParseResult => ({
    rows: [], headers, columnMap: map, skipped, currency: "USD",
    warnings: [message], layout: null, preambleLines: 0, cancelledCount: 0,
  });

  if (!grid.length) return fail("The file has no rows.");

  const headerIdx = findHeaderRow(grid);
  if (headerIdx < 0) {
    return fail(
      "Couldn't find a header row in this file. Is it the earnings export from TeePublic → Dashboard → Earnings?",
    );
  }

  const headers = grid[headerIdx].map((c) => String(c ?? "").trim());
  const resolved = resolveColumns(headers);
  const columnMap = { ...resolved.map, ...overrides } as ColumnMap;

  const missing = REQUIRED.filter((f) => !columnMap[f]);
  if (missing.length) {
    return {
      ...fail(
        `Couldn't find ${missing.length > 1 ? "" : "a "}${missing.join(" or ")} column${
          missing.length > 1 ? "s" : ""
        }. Pick the right one below and the charts will fill in.`,
        headers,
        columnMap,
      ),
      layout: resolved.layout,
      preambleLines: headerIdx,
    };
  }

  // Index each canonical field once, so the row loop is a plain array lookup.
  const colIndex = {} as Record<CanonicalField, number>;
  for (const field of Object.keys(columnMap) as CanonicalField[]) {
    const header = columnMap[field];
    colIndex[field] = header ? headers.indexOf(header) : -1;
  }
  const get = (row: unknown[], field: CanonicalField): unknown => {
    const i = colIndex[field];
    return i >= 0 ? row[i] : undefined;
  };

  const body = grid.slice(headerIdx + 1);

  // Column-wide decisions, made before the row loop.
  const dateSamples = body.slice(0, 200).map((r) => String(get(r, "date") ?? ""));
  const { order, ambiguous } = detectDateOrder(dateSamples);
  if (ambiguous && dateSamples.some((s) => /^\d{1,2}[/\-.]\d{1,2}[/\-.]/.test(s))) {
    warnings.push(
      "Dates are ambiguous (no day above 12 in the file) — read as MM/DD/YYYY, TeePublic's format.",
    );
  }

  let currency =
    body.map((r) => String(get(r, "currency") ?? "").trim())
      .find((c) => /^[A-Za-z]{3}$/.test(c))?.toUpperCase() ??
    body.map((r) => detectCurrency(String(get(r, "earnings") ?? ""))).find(Boolean) ??
    null;
  if (!currency) currency = "USD";

  const rows: SaleRow[] = [];
  let cancelledCount = 0;

  body.forEach((row, i) => {
    const rawDate = get(row, "date");
    const dateBlank = String(rawDate ?? "").trim() === "";

    // Trailing blank rows and the TOTAL ITEMS / TOTAL SALES / TOTAL EARNINGS
    // footer both have no date. They are structure, not broken data — drop them
    // silently rather than reporting them as skipped rows.
    if (dateBlank) return;

    const date = parseDate(rawDate, order);
    if (!date) {
      skipped.push({ row: headerIdx + i + 2, reason: "unreadable date" });
      return;
    }
    const earnings = parseAmount(get(row, "earnings"));
    if (earnings === null) {
      skipped.push({ row: headerIdx + i + 2, reason: "unreadable earnings" });
      return;
    }

    const str = (field: CanonicalField): string | null => {
      const v = get(row, field);
      const s = v === null || v === undefined ? "" : String(v).trim();
      return s || null;
    };

    const status = str("status");
    const cancelled = status ? CANCELLED_RX.test(status) : false;
    if (cancelled) cancelledCount++;

    const qty = parseAmount(get(row, "quantity"));

    rows.push({
      day: toDayKey(date),
      date,
      earnings,
      retail: parseAmount(get(row, "retail")),
      // A missing/zero quantity still represents one sold line.
      quantity: qty && qty > 0 ? Math.round(qty) : 1,
      design: str("design") ?? "Unknown design",
      designId: str("designId"),
      productType: str("productType") ?? "Other",
      status,
      cancelled,
      country: str("country"),
      orderId: str("orderId"),
      currency,
    });
  });

  if (skipped.length) {
    warnings.push(
      `${skipped.length} row${skipped.length === 1 ? "" : "s"} skipped (unreadable date or earnings).`,
    );
  }

  // Oldest → newest, so every downstream consumer can assume sorted input.
  rows.sort((a, b) => a.date.getTime() - b.date.getTime());

  return {
    rows,
    headers,
    columnMap,
    skipped,
    currency,
    warnings,
    layout: resolved.layout,
    preambleLines: headerIdx,
    cancelledCount,
  };
}

export { resolveColumns };
