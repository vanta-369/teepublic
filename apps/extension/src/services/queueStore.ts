// Single-batch persistence in chrome.storage.local. Survives browser restart.
// The store does NOT contain business logic — it just reads/writes/notifies.
//
// One deliberate exception: `setItemStatus` fires the fire-and-forget upload
// report when an item reaches "succeeded". It lives here because this is the
// single choke point every success path funnels through — the engine's happy
// path, the content script's ITEM_STATUS / PUBLISHED_URL_DETECTED messages, the
// tab-URL fallback poll, and the bulk run. Reporting from each caller instead
// would mean four call sites and a fifth one missed on the next change. The
// reporting logic itself stays in lib/uploadEvents.ts; this is only the hook.

import type { QueueBatch, QueueItem, QueueItemStatus } from "@teepublic/shared";
import { reportUploadEvent } from "../lib/uploadEvents";
import { makeThumbnail } from "../lib/thumbnail";

const KEY = "teepublic.batch";
const SETTINGS_KEY = "teepublic.settings";

export type UploadMode = "single" | "bulk";

export interface ExtensionSettings {
  dashboardOrigin: string;        // where to fetch design files from
  betweenItemsMinMs: number;      // min wait between items
  betweenItemsMaxMs: number;      // max wait between items
  retryMax: number;               // attempts per item
  paused: boolean;
  uploadMode: UploadMode;         // "single" = quick_create one-at-a-time; "bulk" = bulk_uploader
}

const DEFAULT_SETTINGS: ExtensionSettings = {
  dashboardOrigin: "https://www.higgstee.com",
  betweenItemsMinMs: 8_000,
  betweenItemsMaxMs: 18_000,
  retryMax: 2,
  paused: false,
  uploadMode: "single",
};

type Listener = (batch: QueueBatch | null) => void;
const listeners = new Set<Listener>();

export const QueueStore = {
  async get(): Promise<QueueBatch | null> {
    const all = await chrome.storage.local.get(KEY);
    return (all[KEY] as QueueBatch | undefined) ?? null;
  },

  async set(batch: QueueBatch | null): Promise<void> {
    if (batch == null) {
      await chrome.storage.local.remove(KEY);
    } else {
      await chrome.storage.local.set({ [KEY]: batch });
    }
    for (const l of listeners) l(batch);
  },

  async updateItem(itemId: string, patch: Partial<QueueItem>): Promise<QueueBatch | null> {
    const batch = await this.get();
    if (!batch) return null;
    const idx = batch.items.findIndex((i) => i.id === itemId);
    if (idx < 0) return batch;
    batch.items[idx] = { ...batch.items[idx], ...patch, updatedAt: Date.now() };
    await this.set(batch);
    return batch;
  },

  async setItemStatus(itemId: string, status: QueueItemStatus, extra: Partial<QueueItem> = {}) {
    // Read the item BEFORE the write so we can tell a real transition from a
    // re-confirmation. Without this, every redundant "succeeded" write (there
    // are several by design) would attempt another insert.
    const before = (await this.get())?.items.find((i) => i.id === itemId);
    const batch = await this.updateItem(itemId, { status, ...extra });

    if (status === "succeeded" && before?.status !== "succeeded") {
      const item = batch?.items.find((i) => i.id === itemId);
      // Not awaited: the item has already published, and the upload loop must
      // not wait on (or be broken by) a network round-trip. reportUploadEvent
      // never rejects.
      void reportUploadEvent({
        designId: itemId,
        publishedUrl: item?.publishedUrl ?? extra.publishedUrl,
        title: item?.metadata?.title,
      });
    }

    return batch;
  },

  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  // Watch storage so popup/queue pages get live updates from the service worker.
  installCrossPageListener(fn: Listener) {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local" || !(KEY in changes)) return;
      fn((changes[KEY].newValue as QueueBatch | undefined) ?? null);
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

// ── Bulk-run state ─────────────────────────────────────────────────────────
// A bulk upload spans many full page navigations: bulk_uploader → design 1's
// /designs/<id>/edit → (publish auto-loads) design 2's /edit → … Each
// navigation destroys the content script, so the run is persisted HERE and the
// content script self-resumes off it on every /edit page load: read `items` +
// `index`, fill items[index] on THIS page, publish, advance the index, and let
// TeePublic load the next design.
const BULK_KEY = "teepublic.bulk";

export interface BulkState {
  active: boolean;
  items: QueueItem[];           // ordered, validated items in UPLOAD order
  index: number;                // next item to fill (0-based)
  lastDesignId: string | null;  // /edit id we last claimed — dedupes re-entry
  startedAt: number;
}

export const BulkStateStore = {
  async get(): Promise<BulkState | null> {
    const all = await chrome.storage.local.get(BULK_KEY);
    return (all[BULK_KEY] as BulkState | undefined) ?? null;
  },
  async set(state: BulkState | null): Promise<void> {
    if (state == null) await chrome.storage.local.remove(BULK_KEY);
    else await chrome.storage.local.set({ [BULK_KEY]: state });
  },
  async patch(p: Partial<BulkState>): Promise<BulkState | null> {
    const cur = await this.get();
    if (!cur) return null;
    const next = { ...cur, ...p };
    await chrome.storage.local.set({ [BULK_KEY]: next });
    return next;
  },
};

// ── Bulk run log ────────────────────────────────────────────────────────────
// The bulk flow spans page navigations, so its console logs are scattered
// across tabs. Mirror them into storage so the popup can offer a one-click
// "Copy log" for diagnostics.
const BULK_LOG_KEY = "teepublic.bulklog";
let _logChain: Promise<void> = Promise.resolve();

export const BulkLogStore = {
  append(line: string): void {
    _logChain = _logChain.then(async () => {
      const all = await chrome.storage.local.get(BULK_LOG_KEY);
      const arr = (all[BULK_LOG_KEY] as string[] | undefined) ?? [];
      arr.push(`${new Date().toISOString().slice(11, 19)} ${line}`);
      while (arr.length > 500) arr.shift();
      await chrome.storage.local.set({ [BULK_LOG_KEY]: arr });
    }).catch(() => { /* logging must never throw */ });
  },
  async get(): Promise<string[]> {
    const all = await chrome.storage.local.get(BULK_LOG_KEY);
    return (all[BULK_LOG_KEY] as string[] | undefined) ?? [];
  },
  async clear(): Promise<void> { await chrome.storage.local.remove(BULK_LOG_KEY); },
};

// ── Image storage ───────────────────────────────────────────────────────────
// Design images (multi-MB base64 data URLs for local uploads) are stored under
// their OWN key, NOT inside the batch. Keeping them out of the batch means we
// never rewrite all images when one changes — the O(N²) rewrite was bloating
// chrome.storage's LevelDB until it hit FILE_ERROR_NO_SPACE.
//
// ImageStore holds the ORIGINAL, full-resolution artwork — the exact bytes
// handed to TeePublic (automationEngine.resolveImageDataUrl → the content
// script's dataUrlToFile). It is NEVER resized or re-encoded. Grid previews are
// a separate, additional small copy in ThumbStore; see lib/thumbnail.ts.
const IMG_PREFIX = "teepublic.img.";
const THUMB_PREFIX = "teepublic.thumb.";

export const ImageStore = {
  async set(itemId: string, dataUrl: string): Promise<void> {
    await chrome.storage.local.set({ [IMG_PREFIX + itemId]: dataUrl });
  },
  async get(itemId: string): Promise<string | null> {
    const key = IMG_PREFIX + itemId;
    const all = await chrome.storage.local.get(key);
    return (all[key] as string | undefined) ?? null;
  },
  async remove(itemId: string): Promise<void> {
    // The preview is deliberately NOT removed with the original: a succeeded
    // item frees its (huge) artwork but should still show its tile in the grid,
    // and a ~30 KB preview costs nothing to keep.
    await chrome.storage.local.remove(IMG_PREFIX + itemId);
  },
  async clearAll(): Promise<void> {
    await removeByPrefix(IMG_PREFIX);
  },
};

// ── Preview (thumbnail) storage ─────────────────────────────────────────────
// A small WebP copy of each design, ~320px on its longest edge, used ONLY to
// paint grid tiles. Written by the background worker right after the original
// lands (and lazily backfilled by getDisplayImages for batches queued before
// previews existed). Never read by the upload path.
export const ThumbStore = {
  async set(itemId: string, dataUrl: string): Promise<void> {
    await chrome.storage.local.set({ [THUMB_PREFIX + itemId]: dataUrl });
  },
  async get(itemId: string): Promise<string | null> {
    const key = THUMB_PREFIX + itemId;
    const all = await chrome.storage.local.get(key);
    return (all[key] as string | undefined) ?? null;
  },
  async remove(itemId: string): Promise<void> {
    await chrome.storage.local.remove(THUMB_PREFIX + itemId);
  },
  async clearAll(): Promise<void> {
    await removeByPrefix(THUMB_PREFIX);
  },

  // Notify when a preview is written. Previews stream in one at a time (the
  // dashboard sends QUEUE_IMAGE per design, and each triggers one generation)
  // AFTER the batch is stored, so a page rendering tiles needs this to fill them
  // in live — the batch KEY that QueueStore watches never changes when an image
  // lands under its own key.
  installChangeListener(fn: (itemId: string, dataUrl: string | null) => void): () => void {
    const handler = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area !== "local") return;
      for (const key of Object.keys(changes)) {
        if (!key.startsWith(THUMB_PREFIX)) continue;
        fn(key.slice(THUMB_PREFIX.length), (changes[key].newValue as string | undefined) ?? null);
      }
    };
    chrome.storage.onChanged.addListener(handler);
    return () => chrome.storage.onChanged.removeListener(handler);
  },
};

/** Wipe every stored image AND preview. Called on "Clear queue". */
export async function clearAllImageData(): Promise<void> {
  await removeByPrefix(IMG_PREFIX, THUMB_PREFIX);
}

/** Remove every key under the given prefixes.
 *  Uses storage.getKeys() when the browser has it (Chrome 130+) so we don't have
 *  to pull every multi-MB image VALUE into memory just to learn its key name —
 *  the old get(null) did exactly that and could hang "Clear queue" on a big
 *  batch. Older Chrome falls back to the read-everything path. */
async function removeByPrefix(...prefixes: string[]): Promise<void> {
  const area = chrome.storage.local as chrome.storage.LocalStorageArea & {
    getKeys?: () => Promise<string[]>;
  };
  const keys = typeof area.getKeys === "function"
    ? await area.getKeys()
    : Object.keys(await chrome.storage.local.get(null));
  const doomed = keys.filter((k) => prefixes.some((p) => k.startsWith(p)));
  if (doomed.length) await chrome.storage.local.remove(doomed);
}

/** Resolve the images a grid should paint, for one page of item ids.
 *
 *  Previews first, in ONE batched storage read — the old code awaited a separate
 *  chrome.storage.local.get per tile, so every tile cost its own IPC round trip
 *  carrying a multi-MB string.
 *
 *  Anything without a preview yet (a batch queued before previews existed) is
 *  backfilled here: read the original ONE AT A TIME, downscale it once, store
 *  the result. That keeps at most a single full-resolution string in memory, and
 *  the page pays it only the first time it ever shows that design. */
export async function getDisplayImages(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;

  const stored = await chrome.storage.local.get(ids.map((id) => THUMB_PREFIX + id));
  const missing: string[] = [];
  for (const id of ids) {
    const thumb = stored[THUMB_PREFIX + id] as string | undefined;
    if (thumb) out.set(id, thumb);
    else missing.push(id);
  }

  for (const id of missing) {
    const full = await ImageStore.get(id);
    if (!full) continue;
    const thumb = await makeThumbnail(full);
    if (thumb) {
      await ThumbStore.set(id, thumb);
      out.set(id, thumb);
    } else {
      out.set(id, full); // couldn't downscale — correct, just heavy
    }
  }
  return out;
}

/** Store an original AND generate its preview. The single entry point for
 *  everything that adds artwork (the dashboard bridge, batch import), so no
 *  caller can add an image that the grid then has to paint at print resolution. */
export async function storeImageWithThumbnail(itemId: string, dataUrl: string): Promise<void> {
  await ImageStore.set(itemId, dataUrl);
  const thumb = await makeThumbnail(dataUrl);
  if (thumb) await ThumbStore.set(itemId, thumb);
}

export const SettingsStore = {
  async get(): Promise<ExtensionSettings> {
    const all = await chrome.storage.local.get(SETTINGS_KEY);
    return { ...DEFAULT_SETTINGS, ...((all[SETTINGS_KEY] as Partial<ExtensionSettings>) ?? {}) };
  },
  async set(patch: Partial<ExtensionSettings>) {
    const next = { ...(await this.get()), ...patch };
    await chrome.storage.local.set({ [SETTINGS_KEY]: next });
    return next;
  },
};
