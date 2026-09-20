// Resolves artwork thumbnails for the rows of a TeePublic earnings export.
//
// WHY NOT BUILD AN IMAGE URL FROM THE DESIGN ID: the export gives a numeric
// TeePublic design id, but TeePublic's image CDN paths are not derivable from
// that id alone (they carry a per-asset slug/hash), and teepublic.com sits
// behind bot protection, so a pattern can't be probed at runtime either.
// Guessing one would render a table of broken images.
//
// So artwork comes from the seller's OWN design library — which now lives in
// THIS BROWSER's IndexedDB, not in Supabase Storage. Matching is by normalised
// title, because that is the only key the export and the local library share.
//
// WHAT THIS USED TO DO, AND WHY IT NO LONGER DOES: there was a second, exact
// lookup keyed by TeePublic design id, built by joining `upload_events` (a
// server-side row per publish, carrying the listing URL and title) onto the
// `designs` table. Both of those are gone: Higgstee no longer records which
// listing was published, what it was called or where it lives. Title matching
// is lossy where a seller has renamed a listing on TeePublic or reused one
// title across design ids; those rows fall back to a placeholder tile, which is
// the honest trade for not keeping a per-upload history on a server.

import { loadDesigns, getDesignImageObjectUrl } from "@/lib/designsStore";

export interface DesignThumb {
  title: string;
  imageUrl: string;
}

/**
 * Normalise a title for matching. TeePublic trims and collapses whitespace on
 * its side (the export contains e.g. "Hamilton Hammers Primary  Hockey Fan"
 * with a double space), and casing drifts as sellers edit listings — so match
 * on a squashed, lowercased form rather than the raw string.
 */
export function titleKey(title: string): string {
  return title.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Artwork lookup for the design tables. */
export interface DesignThumbIndex {
  /**
   * Artwork URL for one export row, or undefined when the local library has no
   * match. The design id is accepted for call-site compatibility and ignored —
   * there is no server-side id mapping any more.
   */
  get(designId: string | null | undefined, title: string): string | undefined;
  /** Number of designs the local library could resolve artwork for. */
  readonly size: number;
  /** Release every object URL this index created. */
  revoke(): void;
}

/** Resolves nothing — the initial state, and what a failed load returns. */
export const EMPTY_THUMB_INDEX: DesignThumbIndex = {
  get: () => undefined,
  size: 0,
  revoke: () => {},
};

/**
 * Build the caller's artwork lookup from local storage.
 *
 * Every entry is an object URL over a Blob held in IndexedDB. They stay valid
 * for the life of the document, so callers should hold the index for as long as
 * the tables are mounted and call `revoke()` on unmount.
 */
export async function loadDesignThumbs(): Promise<DesignThumbIndex> {
  try {
    const designs = await loadDesigns();
    const byTitle = new Map<string, string>();
    const created: string[] = [];

    // Newest first, so the most recent artwork wins a title collision.
    for (const d of [...designs].reverse()) {
      const title = d.listing?.title?.trim() || d.originalName?.trim() || "";
      const key = titleKey(title);
      if (!key || byTitle.has(key)) continue;
      const url = await getDesignImageObjectUrl(d.id);
      if (!url) continue;
      byTitle.set(key, url);
      created.push(url);
    }

    return {
      get: (_designId, title) => byTitle.get(titleKey(title)),
      get size() {
        return new Set(byTitle.values()).size;
      },
      revoke: () => created.forEach(URL.revokeObjectURL),
    };
  } catch {
    // Thumbnails are decoration; a failed lookup must not break the dashboard.
    return EMPTY_THUMB_INDEX;
  }
}
