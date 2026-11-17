// Design pictures for the dashboard's earnings tables (DESIGN_IMAGES).
//
// An earnings export names a design only by its numeric TeePublic id, and the
// CDN path of its picture can't be derived from that id. So the worker GETs the
// design's PUBLIC page (www.teepublic.com/t-shirt/<id>, which redirects to the
// full listing URL) and reads its og:image. Inbound only - nothing is sent but
// the id in the URL - and the answer goes back to the dashboard on this device.
//
// Cached in chrome.storage.local (id -> image URL, both public) so a report is
// looked up once, not on every dashboard visit. "" is cached too (no picture),
// but only for a day, in case the page was just briefly unavailable.

import { designImageFromHtml } from "../lib/listingCore";
import { sleep } from "../lib/delays";

/** The only network call in this file: an anonymous GET of a public teepublic.com page. */
const getPublic = (path: string) => fetch(`https://www.teepublic.com${path}`, { credentials: "omit" });

const KEY = "teepublic.designImages";
const MAX_PER_REQUEST = 60;
const MISS_TTL_MS = 24 * 60 * 60 * 1000;

interface Entry { url: string; at: number }
type Cache = Record<string, Entry>;

const loadCache = async (): Promise<Cache> => ((await chrome.storage.local.get(KEY))[KEY] as Cache | undefined) ?? {};

async function lookup(id: string): Promise<string | null> {
  try {
    const res = await getPublic(`/t-shirt/${id}`);
    if (res.status === 404) return "";
    if (!res.ok) return null; // rate limit / challenge: don't cache, try again next time
    return designImageFromHtml(await res.text());
  } catch {
    return null;
  }
}

export async function resolveDesignImages(designIds: unknown): Promise<Record<string, string>> {
  const ids = [...new Set((Array.isArray(designIds) ? designIds : []).map(String))]
    .filter((id) => /^\d{4,12}$/.test(id));
  const cache = await loadCache();
  const now = Date.now();
  const out: Record<string, string> = {};
  const todo: string[] = [];
  for (const id of ids) {
    const hit = cache[id];
    if (hit && (hit.url || now - hit.at < MISS_TTL_MS)) out[id] = hit.url;
    else todo.push(id);
  }

  // A bounded slice per request; the dashboard asks again for the rest.
  const batch = todo.slice(0, MAX_PER_REQUEST);
  let next = 0;
  const worker = async () => {
    while (next < batch.length) {
      const id = batch[next++];
      const url = await lookup(id);
      if (url !== null) { out[id] = url; cache[id] = { url, at: Date.now() }; }
      await sleep(200 + Math.random() * 200); // gentle on TeePublic
    }
  };
  await Promise.all([worker(), worker(), worker()]);

  // Re-read before writing: another request may have filled entries meanwhile.
  const fresh = await loadCache();
  for (const id of batch) if (cache[id]) fresh[id] = cache[id];
  await chrome.storage.local.set({ [KEY]: fresh });
  return out;
}
