// Sends messages from the dashboard (web page) to the Chrome extension
// using chrome.runtime.sendMessage(extensionId, msg).
// The extension's manifest.json declares this origin in "externally_connectable".

import type {
  DashboardToExtensionMessage,
  ExtensionToDashboardResponse,
  QueueBatch,
  QueueItem,
  QueueStateData,
} from "@teepublic/shared";

// Minimal shape of the chrome.runtime API we use. Declared locally (not as a
// global Window augmentation) to avoid colliding with @types/chrome, which is
// pulled in elsewhere in the monorepo.
type ChromeRuntime = {
  sendMessage: (
    extensionId: string,
    message: unknown,
    callback?: (response: ExtensionToDashboardResponse) => void
  ) => void;
  lastError?: { message: string };
};

function chromeRuntime(): ChromeRuntime | undefined {
  if (typeof window === "undefined") return undefined;
  return (window as unknown as { chrome?: { runtime?: ChromeRuntime } }).chrome?.runtime;
}

const STORAGE_KEY = "teepublic.extensionId";

export function getExtensionId(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(STORAGE_KEY);
}

export function setExtensionId(id: string) {
  window.localStorage.setItem(STORAGE_KEY, id.trim());
}

export function clearExtensionId() {
  window.localStorage.removeItem(STORAGE_KEY);
}

export function isExtensionAvailable(): boolean {
  return !!chromeRuntime()?.sendMessage;
}

export function sendToExtension(
  message: DashboardToExtensionMessage,
  extensionId?: string
): Promise<ExtensionToDashboardResponse> {
  return new Promise((resolve, reject) => {
    const id = extensionId ?? getExtensionId();
    if (!id) return reject(new Error("Extension ID not configured"));
    const runtime = chromeRuntime();
    if (!runtime?.sendMessage) return reject(new Error("chrome.runtime is unavailable — open this page in Chrome and install the extension"));

    try {
      runtime.sendMessage(id, message, (response) => {
        const err = runtime.lastError;
        if (err) return reject(new Error(err.message));
        if (!response) return reject(new Error("no response from extension (is it installed and the ID correct?)"));
        resolve(response);
      });
    } catch (e) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  });
}

/** Send a queue to the extension WITHOUT exceeding Chrome's 64 MiB per-message
 *  limit, and without ever holding the whole batch's artwork in memory.
 *
 *  QUEUE_INIT carries metadata only; each design's image follows in its own
 *  QUEUE_IMAGE message. The bytes come from `resolveImage`, which reads ONE
 *  design at a time out of this device's IndexedDB (lib/localDb.ts) — they are
 *  never part of the stored batch, and they never touch a Higgstee server.
 *
 *  This is the explicit-upload boundary described in the Privacy Policy: it
 *  runs only from a user pressing Send, and it hands the design to the local
 *  extension, which submits it to the marketplace the user chose.
 */
export type QueueImageResolver = (item: QueueItem) => Promise<string | null>;

export async function sendQueueToExtension(
  batch: QueueBatch,
  extensionId?: string,
  resolveImage?: QueueImageResolver,
): Promise<void> {
  const lightBatch: QueueBatch = {
    ...batch,
    items: batch.items.map((it) => ({ ...it, imageUrl: "" })),
  };
  const init = await sendToExtension({ type: "QUEUE_INIT", batch: lightBatch }, extensionId);
  if (!init.ok) throw new Error(init.error);

  for (const it of batch.items) {
    // Fall back to an inline URL for callers that already have one (the batch
    // import path), otherwise read the artwork from local storage on demand.
    const imageUrl = (await resolveImage?.(it)) ?? it.imageUrl;
    if (!imageUrl) continue;
    const res = await sendToExtension(
      { type: "QUEUE_IMAGE", itemId: it.id, imageUrl },
      extensionId,
    );
    if (!res.ok) throw new Error(`image for ${it.metadata.filename || it.id}: ${res.error}`);
  }
}

export async function pingExtension(extensionId?: string): Promise<boolean> {
  try {
    const r = await sendToExtension({ type: "PING" }, extensionId);
    return r.ok === true;
  } catch {
    return false;
  }
}

/* ── Live queue mirror ──────────────────────────────────────────────────────
 * The extension owns the queue; the dashboard only reads it and asks for
 * changes. Every call round-trips to the extension, so what the Uploads page
 * shows is the extension's real state, never a dashboard-side copy.
 */

/** Read the extension's current queue (metadata only — no images). */
export async function fetchQueueState(extensionId?: string): Promise<QueueStateData> {
  const res = await sendToExtension({ type: "QUEUE_STATE" }, extensionId);
  if (!res.ok) throw new Error(res.error);
  return (res.data ?? { batch: null, paused: false, engine: "idle" }) as QueueStateData;
}

async function control(message: DashboardToExtensionMessage, extensionId?: string): Promise<void> {
  const res = await sendToExtension(message, extensionId);
  if (!res.ok) throw new Error(res.error);
}

export const startQueue     = (id?: string) => control({ type: "QUEUE_START" }, id);
export const pauseQueue     = (id?: string) => control({ type: "QUEUE_PAUSE" }, id);
export const clearQueue     = (id?: string) => control({ type: "QUEUE_CLEAR" }, id);
export const retryQueueItem = (itemId: string, id?: string) => control({ type: "ITEM_RETRY", itemId }, id);
export const toggleQueueItem = (itemId: string, id?: string) => control({ type: "QUEUE_ITEM_TOGGLE", itemId }, id);
export const selectAllQueueItems = (value: boolean, id?: string) => control({ type: "QUEUE_SELECT_ALL", value }, id);

/* Queue thumbnails used to be mirrored into localStorage here so the Uploads
 * page could paint tiles for a batch it had just sent. They are gone: the
 * extension derives its own small previews from the artwork it was handed, and
 * the dashboard reads previews straight out of this device's IndexedDB. Nothing
 * about a listing needs a second copy in a 5 MB, origin-wide, string-only store.
 */
