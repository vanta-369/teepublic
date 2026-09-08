import type { QueueBatch, QueueItem, QueueItemStatus } from "./types";

// Wire protocol between the dashboard (web page) and the Chrome extension.
// Sent via chrome.runtime.sendMessage(extensionId, ...) from the dashboard,
// received by the extension's onMessageExternal listener.

export type DashboardToExtensionMessage =
  | { type: "PING" }
  | { type: "QUEUE_INIT"; batch: QueueBatch }
  // Images travel separately: QUEUE_INIT carries metadata only (imageUrl="") and
  // each design's (possibly multi-MB base64) image is sent in its own message,
  // so no single message exceeds Chrome's 64 MiB runtime-message limit.
  | { type: "QUEUE_IMAGE"; itemId: string; imageUrl: string }
  | { type: "QUEUE_START" }
  | { type: "QUEUE_PAUSE" }
  | { type: "ITEM_RETRY"; itemId: string }
  // Read-back + control so the dashboard's Uploads page can mirror the
  // extension's queue. QUEUE_STATE answers with QueueStateData; the batch it
  // returns carries metadata only (imageUrl is "" — images live in the
  // extension's own ImageStore, never sent back over the wire).
  | { type: "QUEUE_STATE" }
  | { type: "QUEUE_ITEM_TOGGLE"; itemId: string }
  | { type: "QUEUE_SELECT_ALL"; value: boolean }
  | { type: "QUEUE_CLEAR" };

/** `data` payload of a successful QUEUE_STATE response. */
export interface QueueStateData {
  batch: QueueBatch | null;
  paused: boolean;
  /** Engine state in the current service-worker lifetime: idle/running/paused/stopped. */
  engine: string;
}

export type ExtensionToDashboardResponse =
  | { ok: true; data?: unknown }
  | { ok: false; error: string };

// Internal — runtime messages within the extension itself.
export type InternalMessage =
  | { type: "QUEUE_STATE_REQUEST" }
  | { type: "QUEUE_STATE_UPDATE"; batch: QueueBatch | null }
  | { type: "ITEM_STATUS"; itemId: string; status: QueueItemStatus; error?: string; publishedUrl?: string }
  | { type: "RUN_NEXT" }
  | { type: "AUTOMATION_START_ITEM"; item: QueueItem; imageDataUrl: string }
  | { type: "AUTOMATION_LOG"; itemId: string; message: string };
