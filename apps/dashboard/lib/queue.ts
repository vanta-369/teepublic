import { nanoid } from "nanoid";
import type { QueueBatch, QueueItem } from "@teepublic/shared";
import type { ParsedRow } from "./parser";
import { stemName } from "./parser";

export interface MatchedImage {
  stem: string;              // lowercased, extension-stripped key
  originalName: string;      // as the user uploaded it
  /** IndexedDB key of the artwork on THIS device (see lib/spreadsheetStore).
   *  Deliberately not a URL and never the bytes: the batch record is metadata,
   *  and the pixels are read only when a preview or an upload needs them. */
  imageKey: string;
  mime: string;
  size: number;
}

export function buildQueue(
  validRows: ParsedRow[],
  images: Map<string, MatchedImage>,         // keyed by stem
  source: { spreadsheetName: string; rowCount: number },
): QueueBatch {
  const now = Date.now();
  const items: QueueItem[] = validRows
    .map((row): QueueItem | null => {
      const img = images.get(stemName(row.metadata.filename));
      if (!img) return null;
      return {
        id: nanoid(10),
        metadata: { ...row.metadata, filename: img.originalName },
        // Filled in only at send time, one design at a time, from local
        // storage - see sendQueueToExtension's resolver. Keeping it empty here
        // means a 200-design batch never holds 200 images in memory at once.
        imageUrl: "",
        imageMime: img.mime,
        imageSizeBytes: img.size,
        status: "pending",
        selected: true,         // default: pre-selected; user deselects in popup
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      };
    })
    .filter((x): x is QueueItem => x !== null);

  return {
    id: nanoid(12),
    createdAt: now,
    items,
    source: {
      spreadsheetName: source.spreadsheetName,
      rowCount: source.rowCount,
      matchedCount: items.length,
    },
  };
}
