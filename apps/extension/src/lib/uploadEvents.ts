// Reports a successful publish to Supabase (`public.upload_events`), which is
// what the dashboard's upload-volume stats count.
//
// Design rules for this module:
//
//  1. It NEVER throws and never blocks the run. Upload reporting is telemetry
//     about work that already succeeded — a network blip, a signed-out session
//     or a missing migration must not fail an item that genuinely published.
//     Every path here resolves.
//
//  2. It is NOT an access gate. `assertCanAccess()` already ran before the item
//     was uploaded; this only records the outcome afterwards.
//
//  3. Duplicates are expected and harmless. The engine can confirm one publish
//     through several paths (ITEM_STATUS, PUBLISHED_URL_DETECTED, the tab-URL
//     poll), and a service-worker restart can replay a status write. The
//     partial unique index on (user_id, listing_url) makes the second insert a
//     no-op, and we swallow the resulting 23505.

import { SUPABASE_CONFIGURED } from "./config";
import { supabase } from "./supabaseClient";

/** Postgres unique_violation — the dedupe index doing its job, not an error. */
const UNIQUE_VIOLATION = "23505";

export interface UploadEventInput {
  /** Queue item / design id. */
  designId: string;
  /** The published listing URL, when the content script captured one. */
  publishedUrl?: string;
  /** Listing title, for a human-readable history later. */
  title?: string;
}

export async function reportUploadEvent(input: UploadEventInput): Promise<void> {
  if (!SUPABASE_CONFIGURED) return;

  try {
    const client = supabase();

    // getUser() rather than getSession(): a service worker that was suspended
    // can hold an expired access token, and an expired token would make the
    // insert run anonymously and be rejected by RLS. getUser() forces the
    // refresh first — the same reasoning as fetchAccess() in access.ts.
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) return; // signed out — nothing to attribute the row to

    const { error } = await client.from("upload_events").insert({
      user_id: user.id,
      design_id: input.designId,
      platform: "teepublic",
      listing_url: input.publishedUrl ?? null,
      title: input.title ?? null,
    });

    if (error && error.code !== UNIQUE_VIOLATION) {
      console.warn(`[teepublic] upload event not recorded: ${error.message}`);
    }
  } catch (err) {
    console.warn("[teepublic] upload event not recorded:", err);
  }
}
