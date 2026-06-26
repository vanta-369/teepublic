// Single-batch persistence in chrome.storage.local. Survives browser restart.
// The store does NOT contain business logic — it just reads/writes/notifies.

import type { QueueBatch, QueueItem, QueueItemStatus } from "@teepublic/shared";

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
  dashboardOrigin: "http://localhost:3030",
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
    return this.updateItem(itemId, { status, ...extra });
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
const IMG_PREFIX = "teepublic.img.";

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
    await chrome.storage.local.remove(IMG_PREFIX + itemId);
  },
  async clearAll(): Promise<void> {
    const all = await chrome.storage.local.get(null);
    const keys = Object.keys(all).filter((k) => k.startsWith(IMG_PREFIX));
    if (keys.length) await chrome.storage.local.remove(keys);
  },
};

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
