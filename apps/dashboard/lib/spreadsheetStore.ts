// The "From spreadsheet" tab's working batch — parsed rows plus the images
// matched to them.
//
// THIS IS LOCAL-ONLY. It used to be a `public.spreadsheet_batches` row: one
// JSONB blob per user holding every row's title, description, tags, price,
// product configuration and filename, and — because matched images were data
// URLs — the artwork base64 inside the same column. The batch now lives in
// IndexedDB: the metadata in the `docs` store under a single key, each image's
// bytes as its own Blob in the `images` store.
//
// The tab still holds exactly one batch at a time, so saving replaces.

import type { ParsedRow } from "@/lib/parser";
import type { MatchedImage } from "@/lib/queue";
import {
  DOC_SPREADSHEET,
  dataUrlToBlob,
  deleteDoc,
  deleteImage,
  getDoc,
  getImage,
  getImageDataUrl,
  getImageObjectUrl,
  listImageIds,
  putDoc,
  putImage,
} from "@/lib/localDb";

export interface SpreadsheetBatch {
  spreadsheetName: string;
  rows: ParsedRow[];
  images: MatchedImage[];
}

/** Image records for this tab are namespaced so they can't collide with the
 *  AI-generated library, whose keys are design ids. */
export function sheetImageKey(stem: string): string {
  return `sheet:${stem}`;
}

export async function loadSpreadsheet(): Promise<SpreadsheetBatch | null> {
  const batch = await getDoc<SpreadsheetBatch>(DOC_SPREADSHEET);
  if (!batch) return null;
  return {
    spreadsheetName: batch.spreadsheetName ?? "",
    rows: batch.rows ?? [],
    images: batch.images ?? [],
  };
}

export async function saveSpreadsheet(batch: SpreadsheetBatch): Promise<void> {
  await putDoc<SpreadsheetBatch>(DOC_SPREADSHEET, batch);
  // Drop artwork for images that are no longer part of the batch, so removing
  // a design from the tab actually reclaims the disk it was using.
  const keep = new Set(batch.images.map((i) => i.imageKey));
  for (const id of await listImageIds()) {
    if (id.startsWith("sheet:") && !keep.has(id)) await deleteImage(id);
  }
}

export async function clearSpreadsheet(): Promise<void> {
  await deleteDoc(DOC_SPREADSHEET);
  for (const id of await listImageIds()) {
    if (id.startsWith("sheet:")) await deleteImage(id);
  }
}

// ── Artwork for a matched row ───────────────────────────────────────────────

export async function saveSheetImage(stem: string, source: Blob | string): Promise<string> {
  const key = sheetImageKey(stem);
  await putImage(key, typeof source === "string" ? dataUrlToBlob(source) : source);
  return key;
}

export function getSheetImage(stem: string): Promise<Blob | null> {
  return getImage(sheetImageKey(stem));
}

export function getSheetImageObjectUrl(stem: string): Promise<string | null> {
  return getImageObjectUrl(sheetImageKey(stem));
}

export function getSheetImageDataUrl(stem: string): Promise<string | null> {
  return getImageDataUrl(sheetImageKey(stem));
}
