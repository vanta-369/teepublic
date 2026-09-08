"use client";

import * as React from "react";
import { AlertTriangle, ChevronRight, FileSpreadsheet, Upload } from "lucide-react";

import { DashboardFilters } from "@/components/dashboard-filters";
import { DashboardHeader } from "@/components/dashboard-header";
import { EarningsChart } from "@/components/earnings-chart";
import { PeriodSummary } from "@/components/period-summary";
import { ProductTypeChart } from "@/components/product-type-chart";
import { RecentSalesTable } from "@/components/recent-sales-table";
import { TopDesignsTable } from "@/components/top-designs-table";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { parseSalesFile } from "@/lib/csv-parser";
import { RANGE_OPTIONS, buildDashboardData, buildPeriodSummary } from "@/lib/dashboard-data";
import { loadDesignThumbs, EMPTY_THUMB_INDEX, type DesignThumbIndex } from "@/lib/designThumbs";
import {
  clearSalesReport,
  fileToCsvText,
  isServerStorageMissing,
  loadSalesReport,
  reportToFile,
  saveSalesReport,
} from "@/lib/salesReportStore";
import type { CanonicalField, ColumnMap, ParseResult, RangeKey } from "@/lib/dashboard-types";
import { formatCurrency, formatDateRange, formatDayLong, toDayKey } from "@/lib/formatters";
import { cn } from "@/lib/utils";

const ACCEPT = ".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Fields the mapping control lets the user correct by hand. */
const MAPPABLE: { field: CanonicalField; label: string; required?: boolean }[] = [
  { field: "date", label: "Date", required: true },
  { field: "earnings", label: "Earnings", required: true },
  { field: "design", label: "Design name" },
  { field: "productType", label: "Product type" },
  { field: "quantity", label: "Quantity" },
  { field: "retail", label: "Retail price" },
  { field: "country", label: "Country" },
  { field: "orderId", label: "Order ID" },
];

export function Dashboard() {
  const [file, setFile] = React.useState<File | null>(null);
  const [result, setResult] = React.useState<ParseResult | null>(null);
  const [isParsing, setIsParsing] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [range, setRange] = React.useState<RangeKey>("30d");
  const [productType, setProductType] = React.useState<string | null>(null);
  const [dragging, setDragging] = React.useState(false);
  const [thumbs, setThumbs] = React.useState<DesignThumbIndex>(EMPTY_THUMB_INDEX);
  // When the saved report was stored, for the "saved" line.
  const [savedAt, setSavedAt] = React.useState<string | null>(null);
  // False when only the browser copy exists (migration 0008 not applied yet).
  const [syncedToAccount, setSyncedToAccount] = React.useState(true);
  // Distinguishes "still checking for a saved report" from "there isn't one",
  // so the empty state doesn't flash before a restore lands.
  const [isRestoring, setIsRestoring] = React.useState(true);
  const inputRef = React.useRef<HTMLInputElement>(null);

  // Artwork for the design tables, matched from the seller's own library by
  // TeePublic design id (falling back to title). Loaded once — it's independent
  // of which file or range is selected.
  React.useEffect(() => {
    let cancelled = false;
    void loadDesignThumbs().then((map) => {
      if (!cancelled) setThumbs(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Parse a file and show it.
   *
   * @param persist Save it to the account as the user's current report. False
   *   when re-parsing (a column re-map) or when restoring the already-saved
   *   report — neither is a new upload, and re-saving on every re-map would be
   *   a pointless round-trip.
   */
  const ingest = React.useCallback(
    async (next: File, overrides?: Partial<ColumnMap>, persist = true) => {
      setIsParsing(true);
      setError(null);
      try {
        const parsed = await parseSalesFile(next, overrides);
        setFile(next);
        setResult(parsed);
        // A re-map can drop the type the user had filtered to, which would leave
        // the dashboard showing an empty slice with no obvious cause.
        setProductType(null);

        if (persist && parsed.rows.length) {
          // Saved as CSV text even for .xlsx, so it re-parses through exactly
          // the same path on the next visit. This always writes locally first,
          // so a refresh works even when the account-level table isn't there.
          const { syncedToAccount } = await saveSalesReport({
            filename: next.name,
            content: await fileToCsvText(next),
            rowCount: parsed.rows.length,
          });
          setSavedAt(new Date().toISOString());
          setSyncedToAccount(syncedToAccount);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not read that file.");
      } finally {
        setIsParsing(false);
      }
    },
    [],
  );

  // Restore the saved report on first load. `persist: false` — this IS the
  // stored file, writing it back would just churn `uploaded_at`.
  React.useEffect(() => {
    let cancelled = false;
    (async () => {
      const report = await loadSalesReport();
      if (cancelled || !report) {
        if (!cancelled) setIsRestoring(false);
        return;
      }
      setSavedAt(report.uploadedAt);
      setSyncedToAccount(!isServerStorageMissing());
      await ingest(reportToFile(report), undefined, false);
      if (!cancelled) setIsRestoring(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ingest]);

  const onPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const picked = e.target.files?.[0];
    if (picked) void ingest(picked);
    // Reset so re-picking the same file still fires a change event.
    e.target.value = "";
  };

  const rows = result?.rows ?? [];

  const productTypes = React.useMemo(
    () => [...new Set(rows.map((r) => r.productType))].sort((a, b) => a.localeCompare(b)),
    [rows],
  );

  // The product-type filter narrows the rows BEFORE aggregation, so every tile,
  // chart and table below the filter row describes the same slice.
  const scopedRows = React.useMemo(
    () => (productType ? rows.filter((r) => r.productType === productType) : rows),
    [rows, productType],
  );

  const data = React.useMemo(() => buildDashboardData(scopedRows, range), [scopedRows, range]);

  // The period strip is intentionally NOT scoped by the range filter — its whole
  // job is the fixed set of windows (latest day, last 7, this month, all time).
  // It does respect the product-type filter, so the page still describes one slice.
  const periods = React.useMemo(() => buildPeriodSummary(scopedRows), [scopedRows]);

  const rangeLabel = RANGE_OPTIONS.find((o) => o.key === range)?.label ?? "Last 30 days";
  const comparisonLabel =
    range === "all" ? "across the whole export" : `vs previous ${rangeLabel.toLowerCase().replace("last ", "")}`;

  if (!result || rows.length === 0) {
    return (
      <EmptyState
        dragging={dragging}
        // Show the loading state while we're still checking for a saved report,
        // so the drop zone doesn't flash before a restore lands.
        isParsing={isParsing || isRestoring}
        error={error ?? result?.warnings[0] ?? null}
        onDragStateChange={setDragging}
        onFile={(f) => void ingest(f)}
        inputRef={inputRef}
        onPick={onPick}
        // When a file parsed but produced no rows, the mapping control is the
        // way out — surface it right here rather than behind an empty dashboard.
        mapping={
          result && file ? (
            <ColumnMapping
              result={result}
              onChange={(field, header) =>
                // persist:false — a re-map re-reads the same stored file.
                void ingest(file, { ...result.columnMap, [field]: header }, false)
              }
            />
          ) : null
        }
      />
    );
  }

  return (
    <div className="viz-root">
      <DashboardHeader
        heroLabel={`Total earnings · ${rangeLabel}`}
        heroValue={formatCurrency(data.totals.earnings.value, data.currency)}
        delta={data.totals.earnings.delta}
        deltaLabel={comparisonLabel}
        windowLabel={formatDateRange(data.from, data.to)}
        rowCount={data.rowCount}
        currency={data.currency}
        extraBadges={[
          ...(result.layout ? [result.layout] : []),
          ...(data.cancelledCount
            ? [`${data.cancelledCount} cancelled excluded`]
            : []),
        ]}
      />

      <DashboardFilters
        range={range}
        onRangeChange={setRange}
        productTypes={productTypes}
        productType={productType}
        onProductTypeChange={setProductType}
        onReplaceFile={() => inputRef.current?.click()}
        // Ranges count back from the newest sale in the file, not from today —
        // say so, so a month-old export doesn't look like it's showing zeroes.
        rangeSummary={
          data.to ? `Counting back from your latest sale, ${formatDayLong(toDayKey(data.to))}.` : ""
        }
      />

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        onChange={onPick}
        className="sr-only"
        aria-hidden
        tabIndex={-1}
      />

      {file && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-ink-700 bg-ink-800/50 px-4 py-2.5">
          <FileSpreadsheet
            className="h-4 w-4 shrink-0 text-accent-600 dark:text-accent-400"
            aria-hidden
          />
          <span className="min-w-0 flex-1 truncate text-sm text-zinc-700 dark:text-zinc-200">
            <span className="font-medium">{file.name}</span>
            <span className="text-zinc-400">
              {" · "}
              {rows.length.toLocaleString()} lines
              {savedAt ? ` · saved ${formatDayLong(toDayKey(new Date(savedAt)))}` : ""}
              {savedAt && (syncedToAccount ? " · on your account" : " · this browser only")}
            </span>
          </span>
          <Button variant="ghost" size="sm" onClick={() => inputRef.current?.click()}>
            Replace
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger-600 dark:text-danger-500"
            onClick={() => {
              void clearSalesReport();
              setResult(null);
              setFile(null);
              setSavedAt(null);
            }}
          >
            Remove
          </Button>
        </div>
      )}

      {result.warnings.length > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-warn-500/40 bg-warn-500/10 px-4 py-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warn-600 dark:text-warn-500" aria-hidden />
          <div className="min-w-0 text-sm text-zinc-700 dark:text-zinc-200">
            {result.warnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        </div>
      )}

      {/* The one chart. Units as columns, earnings as a line. */}
      <EarningsChart
        className="viz-glow mb-5"
        series={data.series}
        currency={data.currency}
        granularity={data.granularity}
        isStale={isParsing}
      />

      {/* `scopedRows`, not `rows` — a tile's breakdown must describe the same
          product-type slice the tile itself was built from. */}
      <PeriodSummary
        className="mb-5"
        periods={periods}
        rows={scopedRows}
        currency={data.currency}
        thumbs={thumbs}
      />

      <TopDesignsTable designs={data.topDesigns} currency={data.currency} thumbs={thumbs} />

      {/* Everything below is secondary — collapsed by default so the summary
          above stays the whole story unless the reader asks for more. */}
      <details className="group mt-5">
        <summary className="inline-flex cursor-pointer list-none items-center gap-2 text-sm font-medium text-zinc-600 hover:text-zinc-900 dark:text-zinc-300 dark:hover:text-zinc-100">
          <ChevronRight
            className="h-4 w-4 transition-transform group-open:rotate-90"
            aria-hidden
          />
          More detail — product mix, recent sales
        </summary>

        <div className="mt-4 space-y-5">
          <div className="grid gap-5 xl:grid-cols-2">
            <ProductTypeChart
              slices={data.productTypes}
              currency={data.currency}
              isStale={isParsing}
            />
            <RecentSalesTable sales={data.recentSales} currency={data.currency} />
          </div>
        </div>
      </details>
    </div>
  );
}

/** Drop target shown until a readable export has been loaded. */
function EmptyState({
  dragging,
  isParsing,
  error,
  onDragStateChange,
  onFile,
  inputRef,
  onPick,
  mapping,
}: {
  dragging: boolean;
  isParsing: boolean;
  error: string | null;
  onDragStateChange: (dragging: boolean) => void;
  onFile: (file: File) => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
  onPick: (e: React.ChangeEvent<HTMLInputElement>) => void;
  mapping: React.ReactNode;
}) {
  if (isParsing) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-28 w-full rounded-2xl" />
        <div className="grid gap-4 sm:grid-cols-3">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
        <Skeleton className="h-72 w-full rounded-2xl" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <Card
        onDragOver={(e) => {
          e.preventDefault();
          onDragStateChange(true);
        }}
        onDragLeave={() => onDragStateChange(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragStateChange(false);
          const dropped = e.dataTransfer.files?.[0];
          if (dropped) onFile(dropped);
        }}
        className={cn(
          "border-2 border-dashed p-10 text-center transition",
          dragging ? "border-accent-500 bg-accent-500/5" : "border-ink-700",
        )}
      >
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-xl bg-ink-800 text-zinc-500 dark:text-zinc-400">
          <FileSpreadsheet className="h-5 w-5" aria-hidden />
        </span>
        <h2 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
          Drop your TeePublic earnings export
        </h2>
        <p className="mx-auto mt-1.5 max-w-md text-sm text-zinc-500 dark:text-zinc-400">
          A .csv or .xlsx from TeePublic → Dashboard → Earnings. It&apos;s parsed in your browser
          and never uploaded anywhere.
        </p>

        <Button className="mt-5 gap-2" onClick={() => inputRef.current?.click()}>
          <Upload className="h-4 w-4" aria-hidden />
          Choose file
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          onChange={onPick}
          className="sr-only"
          aria-hidden
          tabIndex={-1}
        />

        {error && (
          <p className="mx-auto mt-4 max-w-md text-sm text-danger-600 dark:text-danger-500">{error}</p>
        )}
      </Card>
      {mapping}
    </div>
  );
}

/**
 * Manual column mapping. The alias detection in `csv-parser.ts` gets it right
 * for a stock export, but TeePublic renames columns between versions and people
 * hand-edit these files — so the mapping is always visible and always
 * overridable rather than being a hidden guess.
 */
function ColumnMapping({
  result,
  onChange,
}: {
  result: ParseResult;
  onChange: (field: CanonicalField, header: string | null) => void;
}) {
  return (
    <Card className="p-5">
      <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Column mapping</h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Detected from your file&apos;s headers. Change any of these if a column was matched wrong.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {MAPPABLE.map(({ field, label, required }) => (
          <label key={field} className="block">
            <span className="mb-1 block text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {label}
              {required && <span className="text-danger-500"> *</span>}
            </span>
            <select
              value={result.columnMap[field] ?? ""}
              onChange={(e) => onChange(field, e.target.value || null)}
              className="w-full rounded-lg border border-ink-700 bg-ink-800 px-2.5 py-2 text-sm text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-accent-500"
            >
              <option value="">— none —</option>
              {result.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
    </Card>
  );
}
