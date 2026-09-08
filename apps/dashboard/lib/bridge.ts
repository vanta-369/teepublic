// Sends messages from the dashboard (web page) to the Chrome extension
// using chrome.runtime.sendMessage(extensionId, msg).
// The extension's manifest.json declares this origin in "externally_connectable".

import type {
  DashboardToExtensionMessage,
  ExtensionToDashboardResponse,
  QueueBatch,
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
const THUMBS_KEY = "teepublic.queueThumbs";

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
 *  limit. Local designs carry their image as a multi-MB base64 data URL, so a
 *  whole batch in one QUEUE_INIT can blow the cap. Instead: send QUEUE_INIT with
 *  images stripped (metadata only), then each image in its own QUEUE_IMAGE. */
export async function sendQueueToExtension(
  batch: QueueBatch,
  extensionId?: string,
): Promise<void> {
  const lightBatch: QueueBatch = {
    ...batch,
    items: batch.items.map((it) => ({ ...it, imageUrl: "" })),
  };
  const init = await sendToExtension({ type: "QUEUE_INIT", batch: lightBatch }, extensionId);
  if (!init.ok) throw new Error(init.error);

  // Remember where each item's artwork lives so the Uploads page can render
  // thumbnails for the queue it just sent. QUEUE_STATE comes back without
  // images (they stay in the extension's ImageStore), and this is the only side
  // that knows the original URL.
  rememberQueueThumbs(batch);

  for (const it of batch.items) {
    if (!it.imageUrl) continue;
    const res = await sendToExtension(
      { type: "QUEUE_IMAGE", itemId: it.id, imageUrl: it.imageUrl },
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

/* ── Thumbnail cache ───────────────────────────────────────────────────────
 * Only http(s) URLs are kept: blob: URLs die with the page that made them and
 * data: URLs are multi-MB, which would blow localStorage's ~5 MB budget.
 * Items without a usable URL simply render a placeholder tile.
 */

type ThumbMap = Record<string, string>;

function rememberQueueThumbs(batch: QueueBatch): void {
  if (typeof window === "undefined") return;
  const map: ThumbMap = {};
  for (const it of batch.items) {
    if (/^https?:/i.test(it.imageUrl)) map[it.id] = it.imageUrl;
  }
  try {
    window.localStorage.setItem(THUMBS_KEY, JSON.stringify(map));
  } catch {
    // Quota or private-mode failure — thumbnails are cosmetic, so ignore.
  }
}

export function getQueueThumbs(): ThumbMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(THUMBS_KEY);
    return raw ? (JSON.parse(raw) as ThumbMap) : {};
  } catch {
    return {};
  }
}
