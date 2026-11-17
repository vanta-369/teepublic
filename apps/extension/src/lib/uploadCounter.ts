// Records that ONE more listing was published, and nothing else about it.
//
// WHAT THIS REPLACED: `reportUploadEvent`, which inserted a row into
// `public.upload_events` carrying the design id, the listing title, the
// published listing URL, the platform and a timestamp — a full server-side
// history of what the user makes and where it went. The dashboard only ever
// rendered counts from it. So the row is gone and what remains is an atomic
// `+1` against a single integer per account (migration 0009).
//
// Design rules for this module:
//
//  1. It NEVER throws and never blocks the run. Counting is bookkeeping about
//     work that already succeeded — a network blip, a signed-out session or a
//     missing migration must not fail an item that genuinely published.
//
//  2. It is NOT an access gate. `assertCanAccess()` already ran before the item
//     was uploaded; this only records the outcome afterwards.
//
//  3. It counts each item at most once, ever. The engine can confirm one
//     publish through several paths (ITEM_STATUS, PUBLISHED_URL_DETECTED, the
//     tab-URL poll), a service-worker restart can replay a status write, and a
//     retry re-runs the whole item. The old dedupe key was the published
//     listing URL — which meant STORING the listing URL server-side to get it.
//     Dedupe now happens locally, against a set of item ids kept in
//     chrome.storage, so the server never learns anything but the total.
//
//  4. The user is derived on the server from auth.uid(). This code cannot name
//     a different account even if it wanted to.

import { SUPABASE_CONFIGURED } from "./config";
import { supabase } from "./supabaseClient";

/** Item ids already counted. Ids, not URLs or titles — nothing descriptive. */
const COUNTED_KEY = "teepublic.counted";

/** How many ids to remember. Comfortably more than any single batch, and small
 *  enough that the record stays a few KB. Oldest fall off first. */
const COUNTED_MAX = 5000;

async function readCounted(): Promise<string[]> {
  const all = await chrome.storage.local.get(COUNTED_KEY);
  const list = all[COUNTED_KEY];
  return Array.isArray(list) ? (list as string[]) : [];
}

/**
 * Claim an item id for counting. Returns false if it was already counted, so
 * the caller does nothing. The read-modify-write is not atomic across service
 * worker restarts, but the increment it guards is idempotent per item id in
 * every realistic interleaving: the duplicate confirmations this protects
 * against arrive milliseconds to seconds apart on the same worker.
 */
async function claim(itemId: string): Promise<boolean> {
  const counted = await readCounted();
  if (counted.includes(itemId)) return false;
  counted.push(itemId);
  while (counted.length > COUNTED_MAX) counted.shift();
  await chrome.storage.local.set({ [COUNTED_KEY]: counted });
  return true;
}

/** Forget a claim, so a failed increment can be retried on the next confirm. */
async function unclaim(itemId: string): Promise<void> {
  const counted = await readCounted();
  const i = counted.indexOf(itemId);
  if (i >= 0) {
    counted.splice(i, 1);
    await chrome.storage.local.set({ [COUNTED_KEY]: counted });
  }
}

/** Item ids counted as FAILED on their project. Ids only, like COUNTED_KEY. */
const FAILED_KEY = "teepublic.countedFailed";

async function readFailed(): Promise<string[]> {
  const all = await chrome.storage.local.get(FAILED_KEY);
  const list = all[FAILED_KEY];
  return Array.isArray(list) ? (list as string[]) : [];
}

async function writeFailed(list: string[]): Promise<void> {
  while (list.length > COUNTED_MAX) list.shift();
  await chrome.storage.local.set({ [FAILED_KEY]: list });
}

/** Drop every remembered id. Called when the queue is cleared. */
export async function resetCountedItems(): Promise<void> {
  await chrome.storage.local.remove([COUNTED_KEY, FAILED_KEY]);
}

export interface UploadCountedInput {
  /** Local queue item id. Used ONLY for local dedupe; never transmitted. */
  itemId: string;
  /** The batch's project (migration 0013). Sent alone - an id, nothing about
   *  the design. Without one, only the account total moves. */
  projectId?: string;
}

/**
 * Add one to this account's lifetime successful-upload count.
 *
 * Call it only after a publish is CONFIRMED. A failed or abandoned item must
 * not reach here — `QueueStore.setItemStatus` calls it on the transition into
 * `succeeded` and nowhere else.
 */
export async function countSuccessfulUpload(input: UploadCountedInput): Promise<void> {
  if (!SUPABASE_CONFIGURED) return;

  let claimed = false;
  try {
    claimed = await claim(input.itemId);
    if (!claimed) return; // already counted — a re-confirmation or a replay

    const client = supabase();

    // getUser() rather than getSession(): a service worker that was suspended
    // can hold an expired access token, and an expired token would make the
    // RPC run anonymously, so auth.uid() would be null and the call rejected.
    // getUser() forces the refresh first — the same reasoning as fetchAccess().
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) {
      await unclaim(input.itemId); // signed out — try again next time
      return;
    }

    // The account comes from auth.uid() on the server. With a project, the
    // project id is the only argument (its RPC bumps the total too); without
    // one, the no-argument total counter. No design id, title or URL.
    const { error } = input.projectId
      ? await client.rpc("increment_project_upload_count", { p_project: input.projectId })
      : await client.rpc("increment_upload_count");
    if (error) {
      await unclaim(input.itemId);
      console.warn(`[higgstee] upload count not recorded: ${error.message}`);
      return;
    }

    // It failed earlier and a retry published it: it is not a failure any more.
    if (input.projectId) {
      const failed = await readFailed();
      const i = failed.indexOf(input.itemId);
      if (i >= 0) {
        const { error: undoErr } = await client.rpc("record_project_upload_failure", { p_project: input.projectId, p_delta: -1 });
        if (!undoErr) { failed.splice(i, 1); await writeFailed(failed); }
      }
    }
  } catch (err) {
    if (claimed) await unclaim(input.itemId).catch(() => {});
    console.warn("[higgstee] upload count not recorded:", err);
  }
}

/**
 * Add one to the project's failed-uploads count (migration 0014). Each item is
 * counted once however many times it fails; countSuccessfulUpload takes it
 * back if a retry publishes it. Never throws; without a project it does
 * nothing (the account total only counts published designs).
 */
export async function countFailedUpload(input: UploadCountedInput): Promise<void> {
  if (!SUPABASE_CONFIGURED || !input.projectId) return;
  try {
    const failed = await readFailed();
    if (failed.includes(input.itemId) || (await readCounted()).includes(input.itemId)) return;

    const client = supabase();
    const { data: { user }, error: userErr } = await client.auth.getUser();
    if (userErr || !user) return;

    const { error } = await client.rpc("record_project_upload_failure", { p_project: input.projectId, p_delta: 1 });
    if (error) {
      console.warn(`[higgstee] failed count not recorded: ${error.message}`);
      return;
    }
    failed.push(input.itemId);
    await writeFailed(failed);
  } catch (err) {
    console.warn("[higgstee] failed count not recorded:", err);
  }
}
