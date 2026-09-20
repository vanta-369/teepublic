// Export / import the configured batch (listings + colors + the PNGs) as JSON
// files, so it can be moved into the extension running in ANOTHER Chrome profile
// (e.g. a second TeePublic account) and uploaded from there.
//
// Everything that defines a design lives in two stores:
//   • QueueStore  → the batch (title, tags, description, productColors, …)
//   • ImageStore  → the artwork, as base64 data URLs
// so an export is "batch + every item's image", and an import writes both back.
//
// Images are big: a single JSON string of ALL of them can exceed JavaScript's
// max string length (~512 MB → "Invalid string length"). So we export in CHUNKS
// of 30 designs per file, and import MERGES the chunks back into one queue.

// The file format itself lives in @teepublic/shared so the dashboard's Uploads
// page reads and writes exactly the same files.
import type { QueueBatch, QueueItem, BatchExportFile } from "@teepublic/shared";
import { EXPORT_FORMAT, EXPORT_VERSION, CHUNK_SIZE } from "@teepublic/shared";
import { QueueStore, ImageStore, storeImageWithThumbnail } from "./queueStore";

export { EXPORT_FORMAT, EXPORT_VERSION, CHUNK_SIZE };
export type { BatchExportFile };

/** Gather the current batch into chunk files of CHUNK_SIZE designs each, with
 *  every item's image inlined from this profile's ImageStore (IndexedDB). That
 *  local copy is the ONLY source: there is no remote URL to fall back to, by
 *  design. An item with no stored artwork is exported metadata-only and simply
 *  has no entry in `images`. */
export async function buildBatchExportChunks(chunkSize = CHUNK_SIZE): Promise<BatchExportFile[]> {
  const batch = await QueueStore.get();
  if (!batch || batch.items.length === 0) {
    throw new Error("Nothing to export — the queue is empty.");
  }

  const items = batch.items;
  const totalParts = Math.ceil(items.length / chunkSize);
  const exportedAt = new Date().toISOString();
  const chunks: BatchExportFile[] = [];

  for (let p = 0; p < totalParts; p++) {
    const slice = items.slice(p * chunkSize, (p + 1) * chunkSize);
    const images: Record<string, string> = {};
    for (const item of slice) {
      const dataUrl = await ImageStore.get(item.id);
      if (dataUrl) images[item.id] = dataUrl;
    }
    chunks.push({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt,
      part: p + 1,
      totalParts,
      // Items are exported WITHOUT an inline image: the artwork travels once,
      // in `images`, keyed by item id — the same shape the dashboard writes.
      batch: { ...batch, items: slice.map((i) => ({ ...i, imageUrl: "" })) },
      images,
    });
  }
  return chunks;
}

/** Validate + MERGE an imported chunk into this profile's queue (dedup by item
 *  id, so multi-part exports accumulate and re-importing the same file is safe).
 *  Every item is reset to a fresh, ready-to-upload state. Use the queue page's
 *  "Clear queue" button first if you want to start from scratch. */
export async function applyBatchImport(raw: unknown): Promise<{ items: number; images: number; part?: number; totalParts?: number }> {
  const data = raw as Partial<BatchExportFile>;
  if (!data || data.format !== EXPORT_FORMAT || !data.batch || !Array.isArray(data.batch.items)) {
    throw new Error("This file isn't a TeePublic batch export.");
  }

  const now = Date.now();
  const incoming: QueueItem[] = data.batch.items.map((it: QueueItem) => ({
    ...it,
    // Artwork belongs in the ImageStore, keyed by id — never on the item. This
    // also guarantees that no URL from the file can become an image source.
    imageUrl: "",
    // Fresh start in the destination account — don't carry over the source
    // profile's progress (succeeded/failed/published URL/attempts).
    status: "pending",
    selected: it.selected !== false,
    attempts: 0,
    lastError: undefined,
    publishedUrl: undefined,
    updatedAt: now,
  }));

  // Merge into the existing queue (dedup by id) so importing several chunk files
  // one after another builds up the whole batch.
  const existing = await QueueStore.get();
  const byId = new Map<string, QueueItem>();
  if (existing) for (const it of existing.items) byId.set(it.id, it);
  for (const it of incoming) byId.set(it.id, it);
  const mergedBatch: QueueBatch = existing
    ? { ...existing, items: [...byId.values()] }
    : { ...data.batch, items: incoming };
  await QueueStore.set(mergedBatch);

  // The file's `images` map is the artwork source. An older file that inlined a
  // data URL on the item instead is still honoured — but only a data URL, never
  // an http(s) one.
  const images: Record<string, string> = { ...(data.images ?? {}) };
  for (const it of data.batch.items) {
    if (!images[it.id] && typeof it.imageUrl === "string" && it.imageUrl.startsWith("data:")) {
      images[it.id] = it.imageUrl;
    }
  }
  let imageCount = 0;
  for (const [itemId, dataUrl] of Object.entries(images)) {
    if (typeof dataUrl === "string" && dataUrl) {
      // Stores the original as-is and derives its grid preview, so an imported
      // batch is as light to browse as one sent from the dashboard.
      await storeImageWithThumbnail(itemId, dataUrl);
      imageCount++;
    }
  }

  return { items: incoming.length, images: imageCount, part: data.part, totalParts: data.totalParts };
}
