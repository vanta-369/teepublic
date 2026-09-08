// TeePublic URL helpers.
//
// We link to the PUBLIC design page — the one any shopper sees:
//
//   https://www.teepublic.com/t-shirt/96179137-tommy-white-tank-baseball-slugger-47
//                             ^product  ^design id  ^slug built from the title
//
// Not the seller's `/designs/<id>/edit` page: that only opens for the account
// that owns the design, so it shows "You are not authorized to edit this
// design" whenever the signed-in TeePublic account isn't the one the earnings
// export came from.
//
// The `t-shirt` segment is used for every design regardless of what actually
// sold. TeePublic offers each design across its whole product catalogue, and
// the t-shirt is the canonical one — a design that only ever sold as a sticker
// still has a t-shirt page. Using the row's own product type would mean mapping
// a dozen CSV values ("Long Sleeve T-Shirt", "Kids", "Print", "Tank") onto URL
// segments, and any mistake there is a 404.
//
// NOTE ON VERIFICATION: teepublic.com sits behind bot protection that returns
// 403 to every automated request — including for a design id that certainly
// does not exist — so these URLs could not be probed from the build
// environment. The format is taken from a real, working listing URL, and the
// slug rule below is checked against it in the unit-style test in the repo's
// scratchpad probe.

const TEEPUBLIC_ORIGIN = "https://www.teepublic.com";

/**
 * Slugify a design title the way Rails' `parameterize` does — which is what
 * produced the reference URL: lowercase, then every run of non-alphanumerics
 * collapses to a single hyphen, with no leading or trailing hyphen.
 *
 *   "Tommy White Tank - Baseball Slugger 47"
 *     → "tommy-white-tank-baseball-slugger-47"
 *
 * Note the " - " becomes ONE hyphen, not three — that run-collapsing is the
 * part that's easy to get wrong.
 */
export function slugifyTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Public product-page URL for a design, or null when the id isn't a plain
 * number. The numeric guard matters: `designId` comes from a user-supplied CSV
 * cell and must never be interpolated into a URL unchecked.
 */
export function designUrl(
  designId: string | null | undefined,
  title?: string | null,
): string | null {
  if (!designId) return null;
  const id = String(designId).trim();
  if (!/^\d+$/.test(id)) return null;

  const slug = title ? slugifyTitle(title) : "";
  return `${TEEPUBLIC_ORIGIN}/t-shirt/${slug ? `${id}-${slug}` : id}`;
}

/**
 * Pull the numeric design id back out of a published listing URL — the inverse
 * of `designUrl`.
 *
 * This is the join that lets the dashboard show artwork. The extension records
 * the URL it observed after publishing (`upload_events.listing_url`), and the
 * id embedded in that URL is exactly what an earnings export's "Design ID"
 * column contains — so it maps an export row onto the seller's own design,
 * without matching on titles that drift as listings get edited.
 *
 *   https://www.teepublic.com/t-shirt/96179137-tommy-white-tank → "96179137"
 *
 * Returns null for anything that isn't a teepublic.com URL whose last path
 * segment starts with a number.
 */
export function designIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;

  let pathname: string;
  try {
    const u = new URL(url);
    // Host check, not a substring test: `listing_url` is written by the
    // extension from whatever page it landed on, and an id lifted from an
    // unrelated host would silently mis-attribute artwork.
    if (!/(^|\.)teepublic\.com$/i.test(u.hostname)) return null;
    pathname = u.pathname;
  } catch {
    return null; // not an absolute URL
  }

  // Product pages are /<product>/<id>[-<slug>] — the id leads the last segment.
  const last = pathname.split("/").filter(Boolean).pop();
  return last?.match(/^(\d+)(?:-|$)/)?.[1] ?? null;
}
