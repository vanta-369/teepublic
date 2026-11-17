import type { QueueBatch, QueueItem, QueueItemStatus } from "./types";
import type { GeminiErrorCode, GeminiJobType, GeminiListing } from "./gemini";

// Wire protocol between the dashboard (web page) and the Chrome extension.
// Sent via chrome.runtime.sendMessage(extensionId, ...) from the dashboard,
// received by the extension's onMessageExternal listener.

export type DashboardToExtensionMessage =
  | { type: "PING" }
  | { type: "CANVA_EXPORT_FETCH"; url: string }
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
  | { type: "QUEUE_CLEAR" }
  // Daily upload quota per project, kept in the extension. QUOTA_GET answers
  // Record<projectId, UploadQuota>; the setters answer the same for one project.
  | { type: "QUOTA_GET"; projectIds: string[] }
  | { type: "QUOTA_SET_LIMIT"; projectId: string; limit: number }
  | { type: "QUOTA_SET_USED"; projectId: string; used: number }
  // Per-project daily tally, kept in the extension: answers
  // Record<projectId, Record<"YYYY-MM-DD", UploadDay>>.
  | { type: "HISTORY_GET"; projectIds: string[] }
  // Picture of each TeePublic design id (the earnings tables). Answers
  // Record<designId, imageUrl> ("" = none found). The extension reads each
  // design's PUBLIC page on teepublic.com; nothing goes to a Higgstee server.
  | { type: "DESIGN_IMAGES"; designIds: string[] }
  // Gemini (see gemini.ts). LIST_ACCOUNTS answers GeminiAccount[]: the stored
  // list, or with `refresh` a fresh scan of gemini.google.com/u/<N>/app.
  | { type: "LIST_ACCOUNTS"; refresh?: boolean }
  | { type: "ADD_ACCOUNT" }
  | { type: "SET_ACCOUNT_LABEL"; index: number; label: string }
  // imageBase64 is raw base64 (no data: prefix), like lib/gemini.ts sends.
  | { type: "RUN_GEMINI_JOB"; jobId: string; accountIndex: number; jobType: GeminiJobType; prompt: string; imageBase64?: string; imageMime?: string }
  // Progress is read back like QUEUE_STATE: GEMINI_STATE answers GeminiStateData
  // (metadata only); a generated image is fetched on its own with GEMINI_RESULT.
  | { type: "GEMINI_STATE" }
  | { type: "GEMINI_RESULT"; jobId: string }
  | { type: "GEMINI_JOB_RETRY"; jobId: string }
  | { type: "GEMINI_JOB_REMOVE"; jobId: string };

/** One project's rolling-24h upload quota (QUOTA_GET). */
export interface UploadQuota {
  limit: number;
  /** Upload attempts (succeeded + failed) in the last 24h. */
  used: number;
  remaining: number;
  /** When the next slot frees (ms epoch), or null when nothing is used. */
  nextFreeAt: number | null;
}

/** One day of a project's upload history (HISTORY_GET), UTC date keys. */
export interface UploadDay { done: number; failed: number }

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
  | { type: "AUTOMATION_LOG"; itemId: string; message: string }
  // Gemini: background -> content script (gemini.google.com tab)...
  | { type: "GEMINI_READ_ACCOUNT" }
  // expectedEmail: the address stored for this index. Google renumbers /u/<N>/
  // when an account signs out, so a different address there means the job's
  // account is gone - NOT_SIGNED_IN - never "run it on whoever is at N now".
  | { type: "GEMINI_RUN"; jobId: string; jobType: GeminiJobType; prompt: string; imageDataUrl?: string; expectedEmail?: string }
  // ...and content script -> background. Like ITEM_STATUS, the result is a
  // fire-and-forget message rather than a sendResponse: a job outlives the
  // service worker's idle timeout, and progress pings keep it awake meanwhile.
  | { type: "GEMINI_JOB_PROGRESS"; jobId: string; step: string }
  | { type: "GEMINI_JOB_DONE"; jobId: string; ok: true; listing?: GeminiListing; imageDataUrl?: string }
  | { type: "GEMINI_JOB_DONE"; jobId: string; ok: false; code: GeminiErrorCode; error: string }
  | { type: "GEMINI_FETCH_IMAGE"; url: string }
  /** Content script → SW: attach the design via chrome.debugger (geminiDebugger.ts). */
  | { type: "GEMINI_ATTACH_DEBUGGER"; imageDataUrl: string; fileName: string }
  /** TeePublic store page -> SW: answer the page's native confirm() "yes" while
   *  bulk delete clicks a Delete the owner already confirmed (content/storeDelete.ts). */
  | { type: "TP_AUTO_CONFIRM"; on: boolean }
  // TeePublic's "reached your daily limit of N uploads" banner was seen.
  | { type: "TEEPUBLIC_LIMIT_HIT"; limit: number };
