// GET /api/designs/thumbs -> artwork lookups for the caller's designs.
//
// Powers the artwork thumbnails in the Sales & Earnings tables. Returns two
// lookups, because an earnings row can be tied to a design two different ways:
//
//   byId    - TeePublic's numeric design id -> artwork URL. EXACT. Built by
//             joining `upload_events` (which recorded the listing URL the
//             extension saw after publishing, and that URL carries the id the
//             export also reports) back onto the seller's designs.
//   thumbs  - normalised title -> artwork URL. Fallback for designs that were
//             never published through this app, so no upload event exists.
//
// Prefer byId at render time: titles drift (sellers edit listings on TeePublic,
// and TeePublic reuses one title across several design ids), ids don't.
//
// Kept separate from GET /api/designs (which does `select("*")`, pulling full
// listings, descriptions, tag arrays and colour configs) because the analytics
// page only needs artwork — a seller with hundreds of designs would otherwise
// download megabytes to render 8 thumbnails.
//
// Uses the session (anon) client, so RLS scopes every row to auth.uid().

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { titleKey } from "@/lib/designThumbs";
import { designIdFromUrl } from "@/lib/teepublic";

export const runtime = "nodejs";

export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });

  // Reads stay available in the expired/"limited" state, matching GET /api/designs.
  const { data, error } = await supabase
    .from("designs")
    .select("id, image_url, listing, original_name")
    .order("updated_at", { ascending: false });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });

  const rows = data ?? [];

  const thumbs = rows
    .map((r) => {
      const listing = r.listing as { title?: string } | null;
      // Fall back to the uploaded filename when a design has no generated
      // listing yet — sellers often name the file after the design.
      const title = listing?.title?.trim() || (r.original_name as string | null)?.trim() || "";
      return { title, imageUrl: (r.image_url as string) ?? "" };
    })
    .filter((t) => t.title && t.imageUrl);

  // ---------------------------------------------------------------------
  // byId: TeePublic design id -> artwork, via the upload history.
  // ---------------------------------------------------------------------
  // Two ways to get from an upload event back to the artwork, tried in order:
  //   1. `design_id` matches a `designs` row id outright.
  //   2. the event's title matches one. `upload_events.title` is the literal
  //      string the extension submitted, so this is an exact comparison of two
  //      values we wrote ourselves — not the lossy match against an export.
  const byDesignId = new Map<string, string>();
  const byTitle = new Map<string, string>();
  for (const r of rows) {
    const imageUrl = (r.image_url as string) ?? "";
    if (!imageUrl) continue;
    const id = r.id as string;
    if (id && !byDesignId.has(id)) byDesignId.set(id, imageUrl);

    const listing = r.listing as { title?: string } | null;
    const title = listing?.title?.trim() || (r.original_name as string | null)?.trim() || "";
    const key = titleKey(title);
    // Rows arrive newest-first, so the first hit is the most recent artwork.
    if (key && !byTitle.has(key)) byTitle.set(key, imageUrl);
  }

  const byId: { designId: string; imageUrl: string }[] = [];

  // A missing `upload_events` table (migration 0007 not applied) must not break
  // the page — the title fallback above still renders. Same for any query error.
  const { data: events } = await supabase
    .from("upload_events")
    .select("design_id, listing_url, title")
    .not("listing_url", "is", null)
    .order("published_at", { ascending: false });

  const seen = new Set<string>();
  for (const e of events ?? []) {
    const tpId = designIdFromUrl(e.listing_url as string | null);
    if (!tpId || seen.has(tpId)) continue; // newest event for an id wins

    const imageUrl =
      byDesignId.get((e.design_id as string | null) ?? "") ??
      byTitle.get(titleKey((e.title as string | null) ?? ""));
    if (!imageUrl) continue;

    seen.add(tpId);
    byId.push({ designId: tpId, imageUrl });
  }

  return NextResponse.json({ ok: true, thumbs, byId });
}
