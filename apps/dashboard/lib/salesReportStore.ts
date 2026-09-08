// Persistence for the user's earnings export.
//
// TWO LAYERS, on purpose:
//
//   1. Supabase (`sales_reports`) — follows the account across browsers and
//      devices. Requires migration 0008 to have been applied.
//   2. localStorage — always written, works with zero setup, survives a
//      refresh on this browser.
//
// Reads prefer the server and fall back to local. That means the page keeps
// working before the migration is applied (the common case right after
// pulling these changes), and transparently upgrades to cross-device once it
// is. A server write failing is never fatal: the local copy already succeeded,
// so the user still gets their file back on refresh.
//
// The stored form is always CSV TEXT. An .xlsx dropped on the page is converted
// to CSV before saving, so what comes back is re-parseable by the same
// `parseSalesFile` path as a fresh upload — one parser, one source of truth.

import * as XLSX from "xlsx";

export interface StoredReport {
  filename: string;
  content: string;
  rowCount: number;
  uploadedAt: string;
}

const LOCAL_KEY = "teepublic.salesreport";

/**
 * localStorage is ~5 MB per origin and stores UTF-16, so a big CSV can blow the
 * quota and take unrelated keys down with it. Refuse early rather than throw
 * mid-write; the server copy (when configured) has no such limit.
 */
const LOCAL_MAX_CHARS = 2_000_000;

/** Whether the server-side table is reachable. `null` until first checked. */
let serverAvailable: boolean | null = null;

/** True when the server rejected us because migration 0008 isn't applied. */
export function isServerStorageMissing(): boolean {
  return serverAvailable === false;
}

// ── local layer ────────────────────────────────────────────────────────────

function readLocal(): StoredReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReport;
    return parsed?.content ? parsed : null;
  } catch {
    return null;
  }
}

function writeLocal(report: StoredReport): void {
  if (typeof window === "undefined") return;
  try {
    if (report.content.length > LOCAL_MAX_CHARS) return;
    window.localStorage.setItem(LOCAL_KEY, JSON.stringify(report));
  } catch {
    // Quota exceeded or storage disabled (private mode). Not fatal.
  }
}

function clearLocal(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(LOCAL_KEY);
  } catch {
    /* ignore */
  }
}

// ── public API ─────────────────────────────────────────────────────────────

/** The saved report from the server, falling back to this browser's copy. */
export async function loadSalesReport(): Promise<StoredReport | null> {
  try {
    const res = await fetch("/api/sales-report", { cache: "no-store" });
    if (res.ok) {
      const json = (await res.json()) as { ok?: boolean; report?: StoredReport | null };
      if (json.ok) {
        serverAvailable = true;
        // A server copy wins, but an empty server with a local copy still
        // shows the local one — that's the pre-migration case.
        if (json.report) return json.report;
      }
    } else if (res.status !== 401) {
      // 401 just means signed out; anything else (404/500 from a missing
      // table) means server storage isn't usable.
      serverAvailable = false;
    }
  } catch {
    serverAvailable = false;
  }
  return readLocal();
}

/**
 * Save the report. Writes locally first so a refresh always works, then tries
 * the server. Returns a note when the server copy didn't happen, so the UI can
 * say "this browser only" rather than claiming a cross-device save.
 */
export async function saveSalesReport(input: {
  filename: string;
  content: string;
  rowCount: number;
}): Promise<{ syncedToAccount: boolean; error: string | null }> {
  const report: StoredReport = { ...input, uploadedAt: new Date().toISOString() };
  writeLocal(report);

  try {
    const res = await fetch("/api/sales-report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    const json = await res.json().catch(() => ({ ok: false, error: null }));
    if (json.ok) {
      serverAvailable = true;
      return { syncedToAccount: true, error: null };
    }
    serverAvailable = false;
    return { syncedToAccount: false, error: json.error ?? `HTTP ${res.status}` };
  } catch (err) {
    serverAvailable = false;
    return {
      syncedToAccount: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }
}

export async function clearSalesReport(): Promise<void> {
  clearLocal();
  await fetch("/api/sales-report", { method: "DELETE" }).catch(() => {});
}

/**
 * Read a dropped file as the CSV text we persist.
 *
 * `.xlsx`/`.xls` are converted via SheetJS rather than stored as base64: the
 * text round-trips through the same parser as a real CSV, stays human-readable
 * in the database, and avoids inflating a binary by a third just to store it.
 */
export async function fileToCsvText(file: File): Promise<string> {
  if (!/\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name)) return file.text();

  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return "";
  // `sheet_to_csv` preserves the leading preamble rows TeePublic puts above the
  // real header — the parser needs them present so it can skip them itself.
  return XLSX.utils.sheet_to_csv(sheet);
}

/** Turn stored CSV text back into a File for `parseSalesFile`. */
export function reportToFile(report: StoredReport): File {
  // Always .csv: the stored content is CSV even when an .xlsx was uploaded, and
  // the parser picks its reader from the extension.
  const name = report.filename.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, ".csv");
  return new File([report.content], name, { type: "text/csv" });
}
