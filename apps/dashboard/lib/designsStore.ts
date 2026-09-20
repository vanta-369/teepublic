// The user's design library — listing copy, product configuration and artwork.
//
// THIS IS LOCAL-ONLY. It was a Supabase table (`public.designs`) reached through
// /api/designs; every row carried the listing title, description, tags, colour
// config, filename and — because the browser reads a dropped file into a data
// URL — the artwork itself, base64-inflated, inside a Postgres column. None of
// that is needed to run an account, so none of it is sent any more. Metadata
// lives in IndexedDB's `designs` store, artwork in its `images` store, both on
// the user's own device (see lib/localDb.ts).
//
// The cost of that is real and deliberate: a design library no longer follows
// the account to another browser or machine. Moving work between devices is the
// export/import batch file on the Uploads page.

import type { GeneratedListing } from "@/lib/gemini";
import type { ColorProductConfigValue } from "@/components/ColorProductConfig";
import {
  DOC_SPREADSHEET,
  STORE_DESIGNS,
  dataUrlToBlob,
  deleteImage,
  getDoc,
  getImage,
  getImageDataUrl,
  getImageObjectUrl,
  idbDelete,
  idbGet,
  idbGetAll,
  idbPut,
  idbReplaceAll,
  pruneImagesExcept,
  putImage,
} from "@/lib/localDb";

/**
 * One design as it is stored locally.
 *
 * Note what is NOT here: the image bytes, and any URL that points at them. The
 * artwork is a separate IndexedDB record keyed by the same `id`, so reading the
 * library for a grid or a staging list never pulls megabytes of pixels into
 * memory. Use `getDesignImageObjectUrl` / `getDesignImageDataUrl` when you
 * actually need them.
 */
export interface PersistedDesign {
  id: string;
  sessionId: string;
  serverFilename: string;
  originalName: string;
  mime: string;
  size: number;
  listing: GeneratedListing | null;
  config: ColorProductConfigValue;
  status: string;
  /** Local ordering only — the library is sorted oldest-first, as before. */
  updatedAt: number;
}

export async function loadDesigns(): Promise<PersistedDesign[]> {
  const rows = await idbGetAll<PersistedDesign>(STORE_DESIGNS);
  return rows.sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0));
}

export async function getDesign(id: string): Promise<PersistedDesign | null> {
  return (await idbGet<PersistedDesign>(STORE_DESIGNS, id)) ?? null;
}

/**
 * Authoritative full-sync of the library, matching the old server behaviour:
 * the set passed in becomes the whole library, and anything missing is dropped
 * — including its artwork, so removing a design actually reclaims the disk.
 */
export async function saveDesigns(designs: PersistedDesign[]): Promise<void> {
  const now = Date.now();
  const rows = designs.map((d, i) => ({
    ...d,
    // Preserve the caller's order without making every save rewrite timestamps.
    updatedAt: d.updatedAt ?? now + i,
  }));
  await idbReplaceAll(STORE_DESIGNS, rows);
  await pruneImagesExcept(rows.map((r) => r.id));
}

/** Add or update one design without touching the rest of the library. */
export async function putDesign(design: PersistedDesign): Promise<void> {
  await idbPut<PersistedDesign>(STORE_DESIGNS, {
    ...design,
    updatedAt: design.updatedAt ?? Date.now(),
  });
}

export async function deleteDesign(id: string): Promise<void> {
  await idbDelete(STORE_DESIGNS, id);
  await deleteImage(id);
}

// ── Artwork ─────────────────────────────────────────────────────────────────

/** Store a design's artwork as bytes. Accepts a File/Blob or a data: URL. */
export async function saveDesignImage(id: string, source: Blob | string): Promise<void> {
  const blob = typeof source === "string" ? dataUrlToBlob(source) : source;
  await putImage(id, blob);
}

export function getDesignImage(id: string): Promise<Blob | null> {
  return getImage(id);
}

/** A preview URL for an `<img>`. The caller owns it and must revoke it. */
export function getDesignImageObjectUrl(id: string): Promise<string | null> {
  return getImageObjectUrl(id);
}

/**
 * The artwork as a data URL. This is the form handed to the extension (which
 * forwards it to the marketplace) and to Gemini — both only ever after an
 * explicit user action. It is produced on demand and never written anywhere
 * except the caller's memory.
 */
export function getDesignImageDataUrl(id: string): Promise<string | null> {
  return getImageDataUrl(id);
}

/** How many designs are in the local library. Used by the dashboard home tile. */
export async function countDesigns(): Promise<number> {
  return (await idbGetAll<PersistedDesign>(STORE_DESIGNS)).length;
}

/**
 * Titles the user has published or staged, for the earnings page's artwork
 * lookup. Reads the local library plus the local spreadsheet batch, so the
 * analytics tables can still show thumbnails without Higgstee ever learning a
 * title or seeing an image.
 */
export async function localDesignTitles(): Promise<{ id: string; title: string }[]> {
  const out: { id: string; title: string }[] = [];
  for (const d of await loadDesigns()) {
    const title = d.listing?.title?.trim() || d.originalName?.trim() || "";
    if (title) out.push({ id: d.id, title });
  }
  const sheet = await getDoc<{ rows?: { metadata?: { title?: string; filename?: string } }[] }>(
    DOC_SPREADSHEET,
  );
  for (const row of sheet?.rows ?? []) {
    const title = row.metadata?.title?.trim() || row.metadata?.filename?.trim() || "";
    if (title) out.push({ id: `sheet:${row.metadata?.filename ?? title}`, title });
  }
  return out;
}
