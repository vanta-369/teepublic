// Export / import a staged batch on the dashboard, in the SAME file format the
// extension's queue page uses (@teepublic/shared → BatchExportFile). A file
// exported here imports into the extension and vice-versa.
//
// Chunked at CHUNK_SIZE designs per file: images are base64 data URLs, and one
// JSON string holding all of them can blow JavaScript's ~512 MB string cap.

import type { QueueBatch, QueueItem, BatchExportFile } from "@teepublic/shared";
import { EXPORT_FORMAT, EXPORT_VERSION, CHUNK_SIZE } from "@teepublic/shared";

/** Split a batch into export files, inlining every item's artwork as a data URL.
 *  Remote (Supabase Storage) URLs are fetched so the file still works on a
 *  machine that can't reach them. */
export async function buildExportChunks(
  batch: QueueBatch,
  chunkSize = CHUNK_SIZE,
): Promise<BatchExportFile[]> {
  if (batch.items.length === 0) throw new Error("Nothing to export — no designs staged.");

  const totalParts = Math.ceil(batch.items.length / chunkSize);
  const exportedAt = new Date().toISOString();
  const chunks: BatchExportFile[] = [];

  for (let p = 0; p < totalParts; p++) {
    const slice = batch.items.slice(p * chunkSize, (p + 1) * chunkSize);
    const images: Record<string, string> = {};
    for (const item of slice) {
      if (!item.imageUrl) continue;
      const dataUrl = item.imageUrl.startsWith("data:")
        ? item.imageUrl
        : await fetchAsDataUrl(item.imageUrl).catch(() => null);
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
    imageUrl: it.imageUrl || images[it.id] || "",
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
