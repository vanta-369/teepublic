// Shared between dashboard (Next.js) and Chrome extension.
// Keep this file pure types + small enums. No runtime deps.

export type QueueItemStatus =
  | "pending"
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

export interface DesignMetadata {
  filename: string;                       // exactly as written in the sheet (may be extensionless)
  title: string;
  description: string;
  primaryTag?: string;                    // TeePublic primary/category tag
  tags: string[];                         // supporting tags
  matureContent: boolean;
  productColors: Record<string, string>;  // per-product color, e.g. { t_shirt: "White", hoodie: "black" }
  enabledProducts: string[];              // globally enabled product names from Sheet 3 (e.g. "T-Shirt", "Hoodie")
}

export interface QueueItem {
  id: string;
  metadata: DesignMetadata;
  imageUrl: string;
  imageMime: string;
  imageSizeBytes: number;
  status: QueueItemStatus;
  /** When false, the engine skips this item entirely. User picks which to
   *  upload in the extension popup before clicking Start. Default: true. */
  selected: boolean;
  attempts: number;
  lastError?: string;
  publishedUrl?: string;
  createdAt: number;
  updatedAt: number;
}

export interface QueueBatch {
  id: string;
  createdAt: number;
  items: QueueItem[];
  source: {
    spreadsheetName: string;
    rowCount: number;
    matchedCount: number;
  };
}

export interface ValidationIssue {
  row: number;
  field: string;
  level: "error" | "warning";
  message: string;
}

export interface DashboardOrigin {
  /** e.g. http://localhost:3030 — the dashboard origin the extension opens tabs
   *  at (sign in, upgrade) and validates messages against. Never an image or
   *  listing source: the extension reads artwork from its own IndexedDB only. */
  origin: string;
}
