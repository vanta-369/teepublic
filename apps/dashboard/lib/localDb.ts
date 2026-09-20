// The local-first store. Everything a user creates — artwork, listing copy,
// product configuration, the parsed spreadsheet, the earnings export — lives
// HERE, in this browser, in IndexedDB. None of it is sent to Higgstee.
//
// WHY INDEXEDDB AND NOT localStorage: localStorage is a synchronous, ~5 MB,
// string-only store shared by the whole origin. A single design PNG is several
// megabytes, so artwork in localStorage both blows the quota and takes every
// other key down with it. IndexedDB stores Blobs natively (no base64 inflation),
// has a quota measured in a share of free disk, and is asynchronous, so a big
// write never blocks the page. It also survives closing and reopening the
// browser, which is the durability the old server round-trip used to provide.
//
// SHAPE. Three object stores, kept deliberately separate:
//
//   designs  keyPath "id"  — listing copy + product config + image METADATA.
//                            Never the bytes: keeping a multi-MB Blob inside
//                            the row would make every metadata read (the
//                            products grid, the staging list) pull the whole
//                            library's artwork into memory.
//   images   keyPath "id"  — one Blob per design, read only when something
//                            actually needs pixels (a preview, a Gemini call,
//                            a marketplace upload).
//   docs     keyPath "key" — single-value documents: the spreadsheet batch and
//                            the earnings export. One row each, replaced in
//                            place.
//
// Everything here is browser-only. Server components must not import it.

export const DB_NAME = "higgstee-local";
export const DB_VERSION = 1;

export const STORE_DESIGNS = "designs";
export const STORE_IMAGES = "images";
export const STORE_DOCS = "docs";

export class LocalStoreUnavailableError extends Error {
  constructor(cause?: unknown) {
    super(
      "This browser blocked local storage, so Higgstee can't keep your designs on " +
        "this device. Private-browsing windows and blocked site data do this.",
    );
    this.name = "LocalStoreUnavailableError";
    this.cause = cause;
  }
}

let dbPromise: Promise<IDBDatabase> | null = null;

/** Open (and on first use create) the local database. */
export function openLocalDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new LocalStoreUnavailableError());
  }
  if (dbPromise) return dbPromise;

  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (e) {
      reject(new LocalStoreUnavailableError(e));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_DESIGNS)) {
        db.createObjectStore(STORE_DESIGNS, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_IMAGES)) {
        db.createObjectStore(STORE_IMAGES, { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains(STORE_DOCS)) {
        db.createObjectStore(STORE_DOCS, { keyPath: "key" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      // A second tab running a newer version needs this one to let go.
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(new LocalStoreUnavailableError(req.error));
    req.onblocked = () =>
      reject(new LocalStoreUnavailableError("another tab is holding an older version open"));
  }).catch((e) => {
    dbPromise = null; // let a later call retry rather than caching the failure
    throw e;
  });

  return dbPromise;
}

/** Close the cached handle. Used by tests and by "delete all my local data". */
export async function closeLocalDb(): Promise<void> {
  if (!dbPromise) return;
  try {
    (await dbPromise).close();
  } catch {
    /* already closed */
  }
  dbPromise = null;
}

function run<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (s: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return openLocalDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = work(tx.objectStore(store));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export function idbGet<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
  return run<T | undefined>(store, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export function idbGetAll<T>(store: string): Promise<T[]> {
  return run<T[]>(store, "readonly", (s) => s.getAll() as IDBRequest<T[]>);
}

export function idbGetAllKeys(store: string): Promise<IDBValidKey[]> {
  return run<IDBValidKey[]>(store, "readonly", (s) => s.getAllKeys());
}

export function idbPut<T>(store: string, value: T): Promise<IDBValidKey> {
  return run<IDBValidKey>(
    store,
    "readwrite",
    (s) => s.put(value as unknown as object) as IDBRequest<IDBValidKey>,
  );
}

export function idbDelete(store: string, key: IDBValidKey): Promise<undefined> {
  return run<undefined>(store, "readwrite", (s) => s.delete(key) as IDBRequest<undefined>);
}

export function idbClear(store: string): Promise<undefined> {
  return run<undefined>(store, "readwrite", (s) => s.clear() as IDBRequest<undefined>);
}

/** Write many records in ONE transaction — an all-or-nothing batch save. */
export function idbPutMany<T>(store: string, values: T[]): Promise<void> {
  if (values.length === 0) return Promise.resolve();
  return openLocalDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const s = tx.objectStore(store);
        for (const v of values) s.put(v as unknown as object);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

/** Replace a store's contents with exactly `values`, in one transaction. */
export function idbReplaceAll<T>(store: string, values: T[]): Promise<void> {
  return openLocalDb().then(
    (db) =>
      new Promise<void>((resolve, reject) => {
        const tx = db.transaction(store, "readwrite");
        const s = tx.objectStore(store);
        s.clear();
        for (const v of values) s.put(v as unknown as object);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

// ── Single-value documents ──────────────────────────────────────────────────

export const DOC_SPREADSHEET = "spreadsheet-batch";
export const DOC_SALES_REPORT = "sales-report";

export async function getDoc<T>(key: string): Promise<T | null> {
  const row = await idbGet<{ key: string; value: T }>(STORE_DOCS, key);
  return row ? row.value : null;
}

export async function putDoc<T>(key: string, value: T): Promise<void> {
  await idbPut(STORE_DOCS, { key, value });
}

export async function deleteDoc(key: string): Promise<void> {
  await idbDelete(STORE_DOCS, key);
}

// ── Image bytes ─────────────────────────────────────────────────────────────

interface ImageRow {
  id: string;
  blob: Blob;
  mime: string;
  size: number;
  savedAt: number;
}

/**
 * Store one design's artwork. Takes a Blob (what a File already is) so the
 * bytes are stored as bytes — base64 would inflate them by a third and force a
 * decode on every read.
 */
export async function putImage(id: string, blob: Blob): Promise<void> {
  await idbPut<ImageRow>(STORE_IMAGES, {
    id,
    blob,
    mime: blob.type || "image/png",
    size: blob.size,
    savedAt: Date.now(),
  });
}

export async function getImage(id: string): Promise<Blob | null> {
  const row = await idbGet<ImageRow>(STORE_IMAGES, id);
  return row?.blob ?? null;
}

export async function deleteImage(id: string): Promise<void> {
  await idbDelete(STORE_IMAGES, id);
}

export async function listImageIds(): Promise<string[]> {
  return (await idbGetAllKeys(STORE_IMAGES)).map(String);
}

/** Drop every stored image except the ids given. Keeps the store honest after
 *  designs are removed, without a second pass per deletion. */
export async function pruneImagesExcept(keepIds: Iterable<string>): Promise<void> {
  const keep = new Set(keepIds);
  const ids = await listImageIds();
  for (const id of ids) if (!keep.has(id)) await deleteImage(id);
}

// ── Conversions ─────────────────────────────────────────────────────────────

/** An object URL for rendering a preview. Callers must revoke it when done. */
export async function getImageObjectUrl(id: string): Promise<string | null> {
  const blob = await getImage(id);
  return blob ? URL.createObjectURL(blob) : null;
}

/** base64 of the blob's bytes, no `data:` prefix. */
export async function blobToBase64(blob: Blob): Promise<string> {
  // Deliberately not FileReader: this also has to run where there is no DOM
  // (a worker, a test), and FileReader's event API buys nothing here.
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  const CHUNK = 0x8000; // btoa takes an 8-bit string; chunk to avoid a stack blow-up
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function blobToDataUrl(blob: Blob): Promise<string> {
  return `data:${blob.type || "image/png"};base64,${await blobToBase64(blob)}`;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",");
  const mime = /data:([^;,]+)/.exec(head)?.[1] ?? "image/png";
  if (!/;base64/i.test(head)) {
    return new Blob([decodeURIComponent(body ?? "")], { type: mime });
  }
  const bin = atob(body ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

/**
 * The artwork as a data URL — the form the extension bridge and the Gemini
 * request need. Produced on demand and never persisted anywhere but memory.
 */
export async function getImageDataUrl(id: string): Promise<string | null> {
  const blob = await getImage(id);
  return blob ? blobToDataUrl(blob) : null;
}

// ── Wholesale erase, for "delete my local data" ─────────────────────────────

export async function clearAllLocalData(): Promise<void> {
  await idbClear(STORE_DESIGNS);
  await idbClear(STORE_IMAGES);
  await idbClear(STORE_DOCS);
}

/** Rough on-disk footprint of the local store, for the settings UI. */
export async function estimateLocalUsage(): Promise<{ usage: number; quota: number } | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
  const est = await navigator.storage.estimate();
  return { usage: est.usage ?? 0, quota: est.quota ?? 0 };
}
