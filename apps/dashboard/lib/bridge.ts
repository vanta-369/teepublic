// Sends messages from the dashboard (web page) to the Chrome extension
// using chrome.runtime.sendMessage(extensionId, msg).
// The extension's manifest.json declares this origin in "externally_connectable".

import type {
  DashboardToExtensionMessage,
  ExtensionToDashboardResponse,
  GeminiAccount,
  GeminiJobType,
  GeminiStateData,
  QueueBatch,
  QueueItem,
  QueueStateData,
  UploadDay,
  UploadQuota,
} from "@teepublic/shared";
import { EXTENSION_ID } from "./nav";

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

// The dashboard talks ONLY to the published Chrome Web Store extension. There is
// no per-browser override any more: an ID saved by an older version
// ("teepublic.extensionId" in localStorage) is ignored.
export function getExtensionId(): string {
  return EXTENSION_ID;
}

export function isExtensionAvailable(): boolean {
  return !!chromeRuntime()?.sendMessage;
}

const NOT_INSTALLED =
  "The Higgstee extension isn't installed or enabled in this Chrome. Add it from the Chrome Web Store (Extension page → Add to Chrome), then try again.";

const SIGNED_OUT =
  "The extension isn't signed in. Click the Higgstee icon in Chrome's toolbar, sign in in the side panel with your Higgstee email and password, then try again.";

export function sendToExtension(
  message: DashboardToExtensionMessage,
  extensionId?: string
): Promise<ExtensionToDashboardResponse> {
  return new Promise((resolve, reject) => {
    const id = extensionId ?? getExtensionId();
    const runtime = chromeRuntime();
    // chrome.runtime.sendMessage only exists on this page when an installed
    // extension lists the site in externally_connectable - i.e. ours.
    if (!runtime?.sendMessage) return reject(new Error(NOT_INSTALLED));

    try {
      runtime.sendMessage(id, message, (response) => {
        const err = runtime.lastError;
        if (err) {
          return reject(new Error(
            /receiving end does not exist|could not establish connection/i.test(err.message ?? "")
              ? NOT_INSTALLED
              : err.message,
          ));
        }
        if (!response) return reject(new Error(NOT_INSTALLED));
        // The extension keeps its own session, separate from this page's.
        if (!response.ok && response.error === "access denied: signed_out") {
          return resolve({ ...response, error: SIGNED_OUT });
        }
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

/* ── Daily upload quota ─────────────────────────────────────────────────────
 * Per project, counted in the extension (each upload attempt in the last 24h).
 */
export const fetchQuotas = (projectIds: string[], id?: string) =>
  request<Record<string, UploadQuota>>({ type: "QUOTA_GET", projectIds }, id).then((q) => q ?? {});
export const setQuotaLimit = (projectId: string, limit: number, id?: string) =>
  request<Record<string, UploadQuota>>({ type: "QUOTA_SET_LIMIT", projectId, limit }, id);
export const fetchHistory = (projectIds: string[], id?: string) =>
  request<Record<string, Record<string, UploadDay>>>({ type: "HISTORY_GET", projectIds }, id).then((h) => h ?? {});
export const setQuotaUsed = (projectId: string, used: number, id?: string) =>
  request<Record<string, UploadQuota>>({ type: "QUOTA_SET_USED", projectId, used }, id);

/* ── Earnings tables ────────────────────────────────────────────────────────
 * A picture per TeePublic design id. The extension reads each design's public
 * page on teepublic.com (cached there); "" = no picture. At most ~60 new ids
 * are looked up per call, so callers ask again for what's still missing.
 */
export const fetchDesignImages = (designIds: string[], id?: string) =>
  request<Record<string, string>>({ type: "DESIGN_IMAGES", designIds }, id).then((m) => m ?? {});

/* ── Gemini ─────────────────────────────────────────────────────────────────
 * Jobs run in the extension, on gemini.google.com, in Google accounts the user
 * signed into in this browser. Same model as the upload queue: the extension
 * owns the jobs, the dashboard sends them and polls their state. The design
 * goes from this page to the local extension to Google - never to a Higgstee
 * server.
 */

async function request<T>(message: DashboardToExtensionMessage, extensionId?: string): Promise<T> {
  const res = await sendToExtension(message, extensionId);
  if (!res.ok) throw new Error(res.error);
  return res.data as T;
}

/** Stored accounts, or with `refresh` a fresh scan of the browser's Google sign-ins. */
export const listGeminiAccounts = (refresh = false, id?: string) =>
  request<GeminiAccount[]>({ type: "LIST_ACCOUNTS", refresh }, id).then((a) => a ?? []);
export const addGeminiAccount = (id?: string) => control({ type: "ADD_ACCOUNT" }, id);
export const setGeminiAccountLabel = (index: number, label: string, id?: string) =>
  request<GeminiAccount[]>({ type: "SET_ACCOUNT_LABEL", index, label }, id);

export interface GeminiJobRequest {
  jobId: string;
  accountIndex: number;
  jobType: GeminiJobType;
  prompt: string;
  /** Raw base64, no data: prefix. */
  imageBase64?: string;
  imageMime?: string;
}

export const runGeminiJob = (job: GeminiJobRequest, id?: string) => control({ type: "RUN_GEMINI_JOB", ...job }, id);
export const fetchGeminiState = (id?: string) =>
  request<GeminiStateData>({ type: "GEMINI_STATE" }, id).then((s) => s ?? { accounts: [], jobs: [] });
/** A job's generated image and the design it was sent with (data URLs, or null). */
export const fetchGeminiJobImages = (jobId: string, id?: string) =>
  request<{ imageDataUrl: string | null; inputImageDataUrl: string | null }>({ type: "GEMINI_RESULT", jobId }, id)
    .then((r) => ({ imageDataUrl: r?.imageDataUrl ?? null, inputImageDataUrl: r?.inputImageDataUrl ?? null }));
export const retryGeminiJob = (jobId: string, id?: string) => control({ type: "GEMINI_JOB_RETRY", jobId }, id);
export const removeGeminiJob = (jobId: string, id?: string) => control({ type: "GEMINI_JOB_REMOVE", jobId }, id);

/* Queue thumbnails used to be mirrored into localStorage here so the Uploads
 * page could paint tiles for a batch it had just sent. They are gone: the
 * extension derives its own small previews from the artwork it was handed, and
 * the dashboard reads previews straight out of this device's IndexedDB. Nothing
 * about a listing needs a second copy in a 5 MB, origin-wide, string-only store.
 */
