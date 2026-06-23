// Export / import the whole configured batch (listings + colors + the PNGs) as
// a single JSON file, so it can be moved into the extension running in ANOTHER
// Chrome profile (e.g. a second TeePublic account) and uploaded from there.
//
// Everything that defines a design already lives in two stores:
//   • QueueStore  → the batch (title, tags, description, productColors, …)
//   • ImageStore  → the artwork, as base64 data URLs
// so an export is just "batch + every item's image", and an import writes both
// back. Images are embedded as data URLs, making the file fully self-contained
// (no dependency on the source account's Supabase URLs).

import type { QueueBatch, QueueItem } from "@teepublic/shared";
import { QueueStore, ImageStore } from "./queueStore";

export const EXPORT_FORMAT = "teepublic-batch-export";
export const EXPORT_VERSION = 1;

export interface BatchExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  batch: QueueBatch;
  /** itemId → image data URL. One entry per item that has an image. */
  images: Record<string, string>;
}

/** Gather the current batch + all its images into one serializable object.
 *  Items whose image only exists as a remote URL are fetched and inlined so
 *  the file works even when the destination profile can't reach that URL. */
export async function buildBatchExport(): Promise<BatchExportFile> {
  const batch = await QueueStore.get();
  if (!batch || batch.items.length === 0) {
    throw new Error("Nothing to export — the queue is empty.");
  }

  const images: Record<string, string> = {};
  for (const item of batch.items) {
    let dataUrl = await ImageStore.get(item.id);
    if (!dataUrl && item.imageUrl) {
      dataUrl = await fetchAsDataUrl(item.imageUrl).catch(() => null);
    }
    if (dataUrl) images[item.id] = dataUrl;
  }

  return {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    batch,
    images,
  };
}

/** Validate + write an imported file into this profile's stores. Replaces the
 *  current queue. Every item is reset to a fresh, ready-to-upload state so the
 *  same designs can be published again from this profile's TeePublic account. */
export async function applyBatchImport(raw: unknown): Promise<{ items: number; images: number }> {
  const data = raw as Partial<BatchExportFile>;
  if (!data || data.format !== EXPORT_FORMAT || !data.batch || !Array.isArray(data.batch.items)) {
    throw new Error("This file isn't a TeePublic batch export.");
  }

  const now = Date.now();
  const batch: QueueBatch = {
    ...data.batch,
    items: data.batch.items.map((it: QueueItem) => ({
      ...it,
      // Fresh start in the destination account — don't carry over the source
      // profile's progress (succeeded/failed/published URL/attempts).
      status: "pending",
      selected: it.selected !== false,
      attempts: 0,
      lastError: undefined,
      publishedUrl: undefined,
      updatedAt: now,
    })),
  };

  // Replace, don't merge: clear the old images first so a re-import can't leave
  // orphaned artwork behind.
  await ImageStore.clearAll();
  await QueueStore.set(batch);

  const images = data.images ?? {};
  let imageCount = 0;
  for (const [itemId, dataUrl] of Object.entries(images)) {
    if (typeof dataUrl === "string" && dataUrl) {
      await ImageStore.set(itemId, dataUrl);
      imageCount++;
    }
  }

  return { items: batch.items.length, images: imageCount };
}

async function fetchAsDataUrl(url: string): Promise<string> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("data URL conversion failed"));
    reader.readAsDataURL(blob);
  });
}
