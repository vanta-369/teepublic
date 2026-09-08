// Resolves artwork thumbnails for the rows of a TeePublic earnings export.
//
// WHY NOT BUILD AN IMAGE URL FROM THE DESIGN ID: the export gives a numeric
// TeePublic design id, but TeePublic's image CDN paths are not derivable from
// that id alone (they carry a per-asset slug/hash), and teepublic.com sits
// behind bot protection, so a pattern can't be probed at runtime either.
// Guessing one would render a table of broken images.
//
// So artwork comes from the seller's OWN designs library in Supabase Storage,
// matched to an export row two ways (see /api/designs/thumbs):
//
//   1. By TeePublic design id, resolved through the upload history. Exact.
//   2. By normalised title. The fallback for designs never published through
//      this app, so there is no upload event to join on.
//
// Id first, because a title is not an identity: sellers edit listings after
// upload, and TeePublic reuses one title across several design ids.

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
   * Artwork URL for one export row, or undefined when the library has no
   * match. Pass both the row's design id and its title — the id is tried
   * first and the title is the fallback.
   */
  get(designId: string | null | undefined, title: string): string | undefined;
  /** Number of designs the library could resolve artwork for. */
  readonly size: number;
}

/** Resolves nothing — the initial state, and what a failed load returns. */
export const EMPTY_THUMB_INDEX: DesignThumbIndex = {
  get: () => undefined,
  size: 0,
};

function buildIndex(
  byId: Map<string, string>,
  byTitle: Map<string, string>,
): DesignThumbIndex {
  return {
    get(designId, title) {
      const id = designId?.trim();
      if (id) {
        const hit = byId.get(id);
        if (hit) return hit;
      }
      return byTitle.get(titleKey(title));
    },
    // Ids and titles overlap, so this counts distinct artwork rather than
    // summing two maps that mostly describe the same designs.
    get size() {
      return new Set([...byId.values(), ...byTitle.values()]).size;
    },
  };
}

/** Fetch the caller's artwork lookups. */
export async function loadDesignThumbs(): Promise<DesignThumbIndex> {
  try {
    const res = await fetch("/api/designs/thumbs", { cache: "no-store" });
    if (!res.ok) return EMPTY_THUMB_INDEX;

    const json = (await res.json()) as {
      ok?: boolean;
      thumbs?: DesignThumb[];
      byId?: { designId: string; imageUrl: string }[];
    };
    if (!json.ok) return EMPTY_THUMB_INDEX;

    const byId = new Map<string, string>();
    for (const t of json.byId ?? []) {
      if (t.designId && t.imageUrl && !byId.has(t.designId)) byId.set(t.designId, t.imageUrl);
    }

    const byTitle = new Map<string, string>();
    for (const t of json.thumbs ?? []) {
      const key = titleKey(t.title);
      // Rows arrive newest-first, so the first hit for a title is the most
      // recent artwork — don't let an older duplicate overwrite it.
      if (key && !byTitle.has(key)) byTitle.set(key, t.imageUrl);
    }

    return buildIndex(byId, byTitle);
  } catch {
    // Thumbnails are decoration; a failed lookup must not break the dashboard.
    return EMPTY_THUMB_INDEX;
  }
}
