// Design artwork storage for the extension, in IndexedDB.
//
// WHY IT MOVED OFF chrome.storage.local: that area is a key/value store backed
// by LevelDB and is not meant for multi-megabyte values. Every design was held
// there as a base64 data URL — a third larger than the file it came from — and
// a batch of a few hundred print-resolution PNGs was enough to hit
// FILE_ERROR_NO_SPACE. Worse, `chrome.storage.onChanged` hands listeners the
// WHOLE new value, so any page watching the area received every image as it
// streamed in. IndexedDB stores the bytes as a Blob (no base64 inflation), is
// designed for this size class, and hands out data only to code that asks.
//
// The extension's own origin (chrome-extension://<id>) owns this database. It
// is reachable from the service worker and from every extension page, which is
// all the callers there are; content scripts run in the page's origin and never
// touch it — they receive one design at a time over a message.
//
// Anything already sitting in the old chrome.storage keys is migrated lazily on
// read and swept in the background on start-up, then deleted from chrome.storage.

const DB_NAME = "higgstee-images";
const DB_VERSION = 1;
const STORE_ORIGINALS = "originals";
const STORE_THUMBS = "thumbs";

/** The chrome.storage key prefixes this replaces — kept for the migration. */
export const LEGACY_IMG_PREFIX = "teepublic.img.";
export const LEGACY_THUMB_PREFIX = "teepublic.thumb.";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_ORIGINALS)) {
        db.createObjectStore(STORE_ORIGINALS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_THUMBS)) {
        db.createObjectStore(STORE_THUMBS, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((e) => {
    dbPromise = null;
    throw e;
  });
  return dbPromise;
}

interface Row {
  id: string;
  /** The artwork. Stored as a Blob; callers convert to a data URL on demand. */
  blob: Blob;
  savedAt: number;
}

function tx<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(store, mode);
        const req = work(t.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        t.onabort = () => reject(t.error);
      }),
  );
}

// ── Conversions ─────────────────────────────────────────────────────────────
// The rest of the extension speaks data URLs (that is what arrives over the
// message bridge and what the content script turns into a File), so the
// conversion boundary lives here rather than leaking Blobs into every caller.

export function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const head = dataUrl.slice(0, comma);
  const body = dataUrl.slice(comma + 1);
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? "image/png";
  if (!/;base64/i.test(head)) return new Blob([decodeURIComponent(body)], { type: mime });
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  // A service worker has no FileReader in older Chrome builds, and FileReader
  // is event-based anyway; base64-encoding the buffer works everywhere.
  const buf = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < buf.length; i += CHUNK) {
    binary += String.fromCharCode(...buf.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || "image/png"};base64,${btoa(binary)}`;
}

// ── Reads / writes ──────────────────────────────────────────────────────────

async function put(store: string, id: string, dataUrl: string): Promise<void> {
  await tx<IDBValidKey>(store, "readwrite", (s) =>
    s.put({ id, blob: dataUrlToBlob(dataUrl), savedAt: Date.now() } satisfies Row),
  );
}

async function get(store: string, id: string): Promise<string | null> {
  const row = await tx<Row | undefined>(store, "readonly", (s) => s.get(id) as IDBRequest<Row | undefined>);
  return row ? blobToDataUrl(row.blob) : null;
}

async function del(store: string, id: string): Promise<void> {
  await tx<undefined>(store, "readwrite", (s) => s.delete(id) as IDBRequest<undefined>);
}

async function clear(store: string): Promise<void> {
  await tx<undefined>(store, "readwrite", (s) => s.clear() as IDBRequest<undefined>);
}

export const OriginalsDb = {
  put: (id: string, dataUrl: string) => put(STORE_ORIGINALS, id, dataUrl),
  get: (id: string) => get(STORE_ORIGINALS, id),
  delete: (id: string) => del(STORE_ORIGINALS, id),
  clear: () => clear(STORE_ORIGINALS),
};

export const ThumbsDb = {
  put: (id: string, dataUrl: string) => put(STORE_THUMBS, id, dataUrl),
  get: (id: string) => get(STORE_THUMBS, id),
  delete: (id: string) => del(STORE_THUMBS, id),
  clear: () => clear(STORE_THUMBS),
};

/** Several thumbnails in one transaction, for painting a grid. */
export async function getThumbsBatch(ids: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const db = await openDb();
  const rows = await new Promise<(Row | undefined)[]>((resolve, reject) => {
    const t = db.transaction(STORE_THUMBS, "readonly");
    const s = t.objectStore(STORE_THUMBS);
    const results: (Row | undefined)[] = [];
    for (const id of ids) {
      const req = s.get(id) as IDBRequest<Row | undefined>;
      req.onsuccess = () => results.push(req.result);
    }
    t.oncomplete = () => resolve(results);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  for (const row of rows) {
    if (row) out.set(row.id, await blobToDataUrl(row.blob));
  }
  return out;
}

// ── Migration off chrome.storage.local ──────────────────────────────────────

async function legacyKeys(): Promise<string[]> {
  const area = chrome.storage.local as chrome.storage.LocalStorageArea & {
    getKeys?: () => Promise<string[]>;
  };
  const keys =
    typeof area.getKeys === "function"
      ? await area.getKeys()
      : Object.keys(await chrome.storage.local.get(null));
  return keys.filter(
    (k) => k.startsWith(LEGACY_IMG_PREFIX) || k.startsWith(LEGACY_THUMB_PREFIX),
  );
}

/**
 * Move one design's artwork out of chrome.storage.local if it is still there.
 * Called on a read miss, so an in-flight batch from before this change keeps
 * working without waiting for the sweep below.
 */
export async function migrateOne(itemId: string): Promise<void> {
  const imgKey = LEGACY_IMG_PREFIX + itemId;
  const thumbKey = LEGACY_THUMB_PREFIX + itemId;
  const got = await chrome.storage.local.get([imgKey, thumbKey]);
  const doomed: string[] = [];
  if (typeof got[imgKey] === "string") {
    await OriginalsDb.put(itemId, got[imgKey] as string);
    doomed.push(imgKey);
  }
  if (typeof got[thumbKey] === "string") {
    await ThumbsDb.put(itemId, got[thumbKey] as string);
    doomed.push(thumbKey);
  }
  if (doomed.length) await chrome.storage.local.remove(doomed);
}

/**
 * Move every leftover image out of chrome.storage.local, one at a time so a
 * large legacy batch never holds more than a single design in memory. Safe to
 * call on every service-worker wake-up: once the keys are gone it is a no-op.
 */
export async function migrateLegacyImages(): Promise<number> {
  let moved = 0;
  for (const key of await legacyKeys()) {
    const isThumb = key.startsWith(LEGACY_THUMB_PREFIX);
    const id = key.slice((isThumb ? LEGACY_THUMB_PREFIX : LEGACY_IMG_PREFIX).length);
    const got = await chrome.storage.local.get(key);
    const value = got[key];
    if (typeof value === "string" && value) {
      await (isThumb ? ThumbsDb.put(id, value) : OriginalsDb.put(id, value));
      moved++;
    }
    await chrome.storage.local.remove(key);
  }
  return moved;
}

/** Remove every stored image and preview, including any legacy leftovers. */
export async function clearAllImages(): Promise<void> {
  await OriginalsDb.clear();
  await ThumbsDb.clear();
  const leftovers = await legacyKeys();
  if (leftovers.length) await chrome.storage.local.remove(leftovers);
}
