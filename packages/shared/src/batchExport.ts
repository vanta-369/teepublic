// The on-disk shape of an exported batch — written and read by BOTH the
// extension's queue page and the dashboard's Uploads page, so a file exported
// from one imports cleanly into the other.
//
// Images are big: a single JSON string holding all of them can exceed
// JavaScript's max string length (~512 MB → "Invalid string length"), so an
// export is split into CHUNK_SIZE-design files and an import MERGES them.

import type { QueueBatch } from "./types";

export const EXPORT_FORMAT = "teepublic-batch-export";
export const EXPORT_VERSION = 1;
/** Designs per export file — keeps each JSON well under the ~512 MB string cap. */
export const CHUNK_SIZE = 30;

export interface BatchExportFile {
  format: typeof EXPORT_FORMAT;
  version: number;
  exportedAt: string;
  part: number;        // 1-based
  totalParts: number;
  batch: QueueBatch;   // this chunk's items only
  /** itemId → image data URL. One entry per item in this chunk that has an image. */
  images: Record<string, string>;
}
