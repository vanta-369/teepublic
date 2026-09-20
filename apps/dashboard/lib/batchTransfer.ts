// Export / import a staged batch on the dashboard, in the SAME file format the
// extension's queue page uses (@teepublic/shared → BatchExportFile). A file
// exported here imports into the extension and vice-versa.
//
// Chunked at CHUNK_SIZE designs per file: images are base64 data URLs, and one
// JSON string holding all of them can blow JavaScript's ~512 MB string cap.

import type { QueueBatch, QueueItem, BatchExportFile } from "@teepublic/shared";
import { EXPORT_FORMAT, EXPORT_VERSION, CHUNK_SIZE } from "@teepublic/shared";
import { saveDesignImage } from "@/lib/designsStore";

/** Split a batch into export files, inlining every item's artwork as a data URL.
 *
 *  `resolveImage` reads the bytes from this device's IndexedDB. Artwork is not
 *  carried on the queue item any more (it has no URL to fetch and no server to
 *  fetch it from), so the export file IS the way to move designs between
 *  machines - which is why it is also the only thing that now crosses devices. */
export async function buildExportChunks(
  batch: QueueBatch,
  chunkSize = CHUNK_SIZE,
  resolveImage?: (item: QueueItem) => Promise<string | null>,
): Promise<BatchExportFile[]> {
  if (batch.items.length === 0) throw new Error("Nothing to export — no designs staged.");

  const totalParts = Math.ceil(batch.items.length / chunkSize);
  const exportedAt = new Date().toISOString();
  const chunks: BatchExportFile[] = [];

  for (let p = 0; p < totalParts; p++) {
    const slice = batch.items.slice(p * chunkSize, (p + 1) * chunkSize);
    const images: Record<string, string> = {};
    for (const item of slice) {
      // Two local sources, in order: this device's IndexedDB, then an image
      // already inlined on the item as a data URL. There is deliberately no
      // third, remote source — artwork never leaves the device, so there is no
      // URL to fetch it back from.
      const local = await resolveImage?.(item).catch(() => null);
      const inline = item.imageUrl?.startsWith("data:") ? item.imageUrl : null;
      const dataUrl = local ?? inline;
      if (dataUrl) images[item.id] = dataUrl;
    }
    chunks.push({
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt,
      part: p + 1,
      totalParts,
      // Items are exported WITHOUT their (possibly huge) inline image — the
      // artwork travels once, in `images`, keyed by item id.
      batch: { ...batch, items: slice.map((i) => ({ ...i, imageUrl: "" })) },
      images,
    });
  }
  return chunks;
}

/** Trigger a browser download per chunk. */
export async function downloadExportChunks(chunks: BatchExportFile[]): Promise<void> {
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  for (const chunk of chunks) {
    const blob = new Blob([JSON.stringify(chunk)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `teepublic-batch-part${chunk.part}of${chunk.totalParts}-${chunk.batch.items.length}designs-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    await new Promise((r) => setTimeout(r, 400)); // let each download start
  }
}

/** Read one export file into queue items, with each item's artwork put back on
 *  `imageUrl` as a data URL. Items come back in a fresh, ready-to-upload state —
 *  the source profile's progress is not carried over. */
export function parseExportFile(raw: unknown): QueueItem[] {
  const data = raw as Partial<BatchExportFile>;
  if (!data || data.format !== EXPORT_FORMAT || !data.batch || !Array.isArray(data.batch.items)) {
    throw new Error("This file isn't a TeePublic batch export.");
  }
  const images = data.images ?? {};
  const now = Date.now();
  return data.batch.items.map((it: QueueItem) => ({
    ...it,
    // The `images` map is the artwork source; an older file that inlined a data
    // URL on the item is still honoured. An http(s) URL is not — it would be a
    // remote image source, and there is no longer any such thing.
    imageUrl: images[it.id] || (it.imageUrl?.startsWith("data:") ? it.imageUrl : ""),
    status: "pending" as const,
    selected: it.selected !== false,
    attempts: 0,
    lastError: undefined,
    publishedUrl: undefined,
    updatedAt: now,
  }));
}

/** Read several export files (the parts of one export) and merge them, dedup by
 *  item id so re-importing the same part is harmless. */
export async function importExportFiles(
  files: File[],
): Promise<{ items: QueueItem[]; errors: string[] }> {
  const byId = new Map<string, QueueItem>();
  const errors: string[] = [];
  // "partNofM" is in the filename — import in numeric order.
  const ordered = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const file of ordered) {
    try {
      for (const item of parseExportFile(JSON.parse(await file.text()))) byId.set(item.id, item);
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  return { items: [...byId.values()], errors };
}

/** Import export files and land them on THIS device: each design's inlined
 *  artwork is moved into IndexedDB (keyed by design id) and the inline copy is
 *  dropped, so the staged list stays metadata-only and the artwork survives a
 *  reload. Nothing here touches the network — the `images` map in the file is
 *  the only image source, which is what makes an imported batch upload-ready
 *  offline and without Supabase. */
export async function importExportFilesToLocal(
  files: File[],
): Promise<{ items: QueueItem[]; images: number; errors: string[] }> {
  const { items, errors } = await importExportFiles(files);
  const staged: QueueItem[] = [];
  let images = 0;
  for (const it of items) {
    if (it.imageUrl?.startsWith("data:")) {
      try {
        await saveDesignImage(it.id, it.imageUrl);
        images++;
      } catch (e) {
        errors.push(`${it.metadata.title || it.id}: ${e instanceof Error ? e.message : "image not saved"}`);
      }
    }
    staged.push({ ...it, imageUrl: "" });
  }
  return { items: staged, images, errors };
}
