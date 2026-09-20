// The user's TeePublic earnings export.
//
// THIS IS LOCAL-ONLY. It used to be stored twice: raw CSV text in a Supabase
// `sales_reports` row (so it followed the account across devices) and a capped
// copy in localStorage. The export is listing content — every row carries a
// design title, a product type and a price — so the server copy is gone and the
// localStorage copy with it. The file now lives in IndexedDB, which has no
// 5 MB ceiling, so the size cap that used to silently skip large exports is
// gone too.
//
// What that costs: an export uploaded on one machine is not visible on another.
// Re-drop the file there; parsing is instant and the file is the user's own.
//
// The stored form is always CSV TEXT. An .xlsx dropped on the page is converted
// to CSV before saving, so what comes back is re-parseable by the same
// `parseSalesFile` path as a fresh upload - one parser, one source of truth.

import * as XLSX from "xlsx";
import { DOC_SALES_REPORT, deleteDoc, getDoc, putDoc } from "@/lib/localDb";

export interface StoredReport {
  filename: string;
  content: string;
  rowCount: number;
  uploadedAt: string;
}

/** Legacy key: the pre-IndexedDB browser copy, migrated on first read. */
const LEGACY_LOCAL_KEY = "teepublic.salesreport";

/**
 * The report is only ever on this device now, so there is no "synced to
 * account" state to report. Kept as an explicit export because the Sales page
 * shows the user where their file lives.
 */
export function isServerStorageMissing(): boolean {
  return true;
}

function takeLegacyLocalCopy(): StoredReport | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LEGACY_LOCAL_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredReport;
    // Move it, don't copy it: leaving listing content in localStorage after
    // this migration would defeat the point of the migration.
    window.localStorage.removeItem(LEGACY_LOCAL_KEY);
    return parsed?.content ? parsed : null;
  } catch {
    return null;
  }
}

/** The saved report from this device, or null. */
export async function loadSalesReport(): Promise<StoredReport | null> {
  const stored = await getDoc<StoredReport>(DOC_SALES_REPORT).catch(() => null);
  if (stored?.content) return stored;

  const legacy = takeLegacyLocalCopy();
  if (legacy) {
    await putDoc(DOC_SALES_REPORT, legacy).catch(() => {});
    return legacy;
  }
  return null;
}

/**
 * Save the report to this device. The return shape is kept so callers can keep
 * telling the user plainly that the file stays here; `syncedToAccount` is
 * always false because there is no account copy by design.
 */
export async function saveSalesReport(input: {
  filename: string;
  content: string;
  rowCount: number;
}): Promise<{ syncedToAccount: boolean; error: string | null }> {
  const report: StoredReport = { ...input, uploadedAt: new Date().toISOString() };
  try {
    await putDoc(DOC_SALES_REPORT, report);
    return { syncedToAccount: false, error: null };
  } catch (err) {
    return {
      syncedToAccount: false,
      error: err instanceof Error ? err.message : "could not save to this device",
    };
  }
}

export async function clearSalesReport(): Promise<void> {
  await deleteDoc(DOC_SALES_REPORT).catch(() => {});
  if (typeof window !== "undefined") {
    try {
      window.localStorage.removeItem(LEGACY_LOCAL_KEY);
    } catch {
      /* ignore */
    }
  }
}

/**
 * Read a dropped file as the CSV text we persist.
 *
 * `.xlsx`/`.xls` are converted via SheetJS rather than stored as base64: the
 * text round-trips through the same parser as a real CSV and avoids inflating
 * a binary by a third just to store it.
 */
export async function fileToCsvText(file: File): Promise<string> {
  if (!/\.(xlsx|xlsm|xlsb|xls)$/i.test(file.name)) return file.text();

  const wb = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return "";
  // `sheet_to_csv` preserves the leading preamble rows TeePublic puts above the
  // real header - the parser needs them present so it can skip them itself.
  return XLSX.utils.sheet_to_csv(sheet);
}

/** Turn stored CSV text back into a File for `parseSalesFile`. */
export function reportToFile(report: StoredReport): File {
  // Always .csv: the stored content is CSV even when an .xlsx was uploaded, and
  // the parser picks its reader from the extension.
  const name = report.filename.replace(/\.(xlsx|xlsm|xlsb|xls)$/i, ".csv");
  return new File([report.content], name, { type: "text/csv" });
}
