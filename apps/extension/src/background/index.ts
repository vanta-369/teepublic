// Service worker. Three responsibilities:
//   1. Receive QUEUE_INIT/QUEUE_START/etc from the dashboard (externally_connectable).
//   2. Persist queue + settings via QueueStore.
//   3. Drive the AutomationEngine.

import type { DashboardToExtensionMessage, QueueStateData } from "@teepublic/shared";
import type { QueueBatch } from "@teepublic/shared";
import { QueueStore, SettingsStore, clearAllImageData, storeImageWithThumbnail } from "../services/queueStore";
import { engine } from "../services/automationEngine";
import { assertCanAccess, AccessDeniedError } from "../lib/access";
import { migrateLegacyImages } from "../lib/imageDb";

console.info("[teepublic] background ready");

// Artwork used to live in chrome.storage.local as base64 data URLs. It now
// lives in IndexedDB (lib/imageDb.ts). Sweep anything left behind out of
// chrome.storage on every wake-up - one design at a time, so a large legacy
// batch never sits in memory at once. A no-op once the keys are gone.
void migrateLegacyImages()
  .then((moved) => moved && console.info(`[teepublic] moved ${moved} stored image(s) to IndexedDB`))
  .catch((e) => console.warn("[teepublic] image migration failed", e));

// Open the side panel when the toolbar icon is clicked (the UI is now a side
// panel, not a popup). Guarded so older Chrome without sidePanel won't throw.
chrome.sidePanel
  ?.setPanelBehavior?.({ openPanelOnActionClick: true })
  .catch((e) => console.warn("[teepublic] sidePanel setPanelBehavior failed", e));

// Live access gate for every message that STARTS automation. Always queries
// get_my_access() — no cached plan/status, no extension-storage entitlement.
// The DB is the source of truth; if we can't confirm access, we deny.
async function guardAccess(): Promise<{ ok: true } | { ok: false; error: string; status?: string }> {
  try {
    await assertCanAccess();
    return { ok: true };
  } catch (e) {
    if (e instanceof AccessDeniedError) {
      return { ok: false, error: `access denied: ${e.status}`, status: e.status };
    }
    return { ok: false, error: `access check failed: ${(e as Error).message}` };
  }
}

// Self-heal: any items left "running" from a previous SW lifetime get reset to
// "queued" so the next Start picks them up. Runs on every SW wake-up.
(async () => {
  const batch: QueueBatch | null = await QueueStore.get();
  if (!batch) return;
  let changed = 0;
  for (const item of batch.items) {
    if (item.status === "running") {
      item.status = "queued";
      item.lastError = "service worker resumed — retrying";
      item.updatedAt = Date.now();
      changed++;
    }
  }
  if (changed > 0) {
    await QueueStore.set(batch);
    console.info(`[teepublic] resurrected ${changed} stale running item(s) on SW startup`);
  }
})();

chrome.runtime.onInstalled.addListener(async () => {
  // Ensure defaults exist on first install.
  await SettingsStore.set({});
});

// Messages from the Higgstee dashboard (see externally_connectable).
chrome.runtime.onMessageExternal.addListener((message: DashboardToExtensionMessage, sender, sendResponse) => {
  (async () => {
    try {
      // Remember which Higgstee origin this dashboard is, so the side panel and
      // popup can open sign-in / upgrade tabs there. It is NOT an image source:
      // artwork arrives over QUEUE_IMAGE (or a batch import) and lives in this
      // device's IndexedDB.
      if (sender.origin) await SettingsStore.set({ dashboardOrigin: sender.origin });

      switch (message.type) {
        case "PING":
          return sendResponse({ ok: true, data: { version: chrome.runtime.getManifest().version } });

        case "QUEUE_INIT":
          await QueueStore.set(message.batch);
          await openQueuePage();
          return sendResponse({ ok: true });

        case "QUEUE_IMAGE":
          // Images arrive separately (after QUEUE_INIT) so no single message
          // exceeds Chrome's 64 MiB cap. Store each under its OWN key — NOT in
          // the batch — so we never rewrite all images when one arrives (that
          // O(N²) rewrite was filling storage → FILE_ERROR_NO_SPACE).
          //
          // This also generates the design's small grid preview, HERE in the
          // worker rather than in whichever page happens to be showing the
          // queue. The original is stored untouched — the preview is an extra
          // file. Awaited (not fire-and-forget) so the dashboard's sequential
          // send paces generation and the worker can't be suspended mid-encode.
          await storeImageWithThumbnail(message.itemId, message.imageUrl);
          return sendResponse({ ok: true });

        case "QUEUE_START": {
          const g = await guardAccess();
          if (!g.ok) return sendResponse(g);
          await engine.start();
          return sendResponse({ ok: true });
        }

        case "QUEUE_PAUSE":
          await engine.pause();
          return sendResponse({ ok: true });

        case "ITEM_RETRY": {
          const g = await guardAccess();
          if (!g.ok) return sendResponse(g);
          await engine.retry(message.itemId);
          return sendResponse({ ok: true });
        }

        // Read-back for the dashboard's Uploads page, which mirrors this queue.
        // Metadata only — item.imageUrl is already "" in the stored batch and
        // the (multi-MB base64) images stay in ImageStore.
        case "QUEUE_STATE": {
          const batch = await QueueStore.get();
          const settings = await SettingsStore.get();
          const data: QueueStateData = {
            batch: batch ? { ...batch, items: batch.items.map((i) => ({ ...i, imageUrl: "" })) } : null,
            paused: settings.paused === true,
            engine: engine.getState(),
          };
          return sendResponse({ ok: true, data });
        }

        case "QUEUE_ITEM_TOGGLE":
          await toggleItemSelected(message.itemId);
          return sendResponse({ ok: true });

        case "QUEUE_SELECT_ALL":
          await setAllSelected(message.value === true);
          return sendResponse({ ok: true });

        case "QUEUE_CLEAR":
          await QueueStore.set(null);
          await clearAllImageData();
          return sendResponse({ ok: true });

        default:
          return sendResponse({ ok: false, error: "unknown message type" });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  })();
  return true; // async response
});

// Internal messages from the popup / queue page.
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    switch (message?.type) {
      case "ENGINE_START": {
        const g = await guardAccess();
        if (!g.ok) return sendResponse(g);
        await engine.start();
        return sendResponse({ ok: true });
      }
      case "ENGINE_PAUSE":          await engine.pause(); return sendResponse({ ok: true });
      // Live access gate for the bulk content script, which self-drives across
      // page loads OUTSIDE the engine loop. It asks here on every page so the
      // service worker (not the page context) does the Supabase check. Fail-safe:
      // any error → not ok. Mirrors guardAccess used by ENGINE_START.
      case "ASSERT_ACCESS":         return sendResponse(await guardAccess());
      case "ITEM_RETRY": {
        const g = await guardAccess();
        if (!g.ok) return sendResponse(g);
        await engine.retry(message.itemId);
        return sendResponse({ ok: true });
      }
      case "ITEM_TOGGLE_SELECTED":  await toggleItemSelected(message.itemId); return sendResponse({ ok: true });
      case "ITEMS_SELECT_ALL":      await setAllSelected(message.value === true); return sendResponse({ ok: true });
      case "ITEMS_INVERT_SELECTED": await invertAllSelected(); return sendResponse({ ok: true });
      case "ITEMS_SET_SELECTED_MAP": await setSelectedMap(message.updates); return sendResponse({ ok: true });
      case "ITEM_STATUS":           await handleItemStatus(message.itemId, message.status, message.publishedUrl, message.error); return sendResponse({ ok: true });
      case "PUBLISHED_URL_DETECTED": await handlePublishedUrlDetected(message.url); return sendResponse({ ok: true });
      case "QUEUE_CLEAR":           await QueueStore.set(null); await clearAllImageData(); return sendResponse({ ok: true });
      default:                      return sendResponse({ ok: false, error: "unknown message" });
    }
  })();
  return true;
});

async function toggleItemSelected(itemId: string): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  const item = batch.items.find((i) => i.id === itemId);
  if (!item) return;
  item.selected = !(item.selected !== false); // toggle
  item.updatedAt = Date.now();
  await QueueStore.set(batch);
}

async function setAllSelected(value: boolean): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  const now = Date.now();
  for (const item of batch.items) {
    item.selected = value;
    item.updatedAt = now;
  }
  await QueueStore.set(batch);
}

/** Content script announces it loaded on a published-listing URL (the page
 *  navigated to /t-shirt/<slug> after a successful PUBLISH). The previous
 *  content script and its sendResponse are gone; this is the only signal
 *  available. Find whichever item is currently "running" and mark it
 *  succeeded with this URL. */
async function handlePublishedUrlDetected(url: string): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  const running = batch.items.find((i) => i.status === "running");
  if (!running) {
    console.info(`[background] PUBLISHED_URL_DETECTED ${url} but no running item to attribute it to`);
    return;
  }
  console.info(`[background] attributing published URL ${url} to running item ${running.id}`);
  await handleItemStatus(running.id, "succeeded", url);
}

/** Authoritative status update from the content script. Survives the
 *  page-navigation that destroys sendResponse callbacks. Idempotent: a
 *  succeeded item can't be downgraded to failed by a stale message. */
async function handleItemStatus(
  itemId: string,
  status: "succeeded" | "failed",
  publishedUrl?: string,
  error?: string,
): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  const item = batch.items.find((i) => i.id === itemId);
  if (!item) {
    console.warn(`[background] ITEM_STATUS for unknown item ${itemId}`);
    return;
  }
  // Don't downgrade succeeded items.
  if (item.status === "succeeded" && status !== "succeeded") {
    console.info(`[background] ignoring late ${status} for already-succeeded ${itemId}`);
    return;
  }
  // Don't re-fire if already in target state with same data.
  if (item.status === status && item.publishedUrl === publishedUrl) {
    return;
  }
  item.status = status;
  if (publishedUrl) item.publishedUrl = publishedUrl;
  if (error)        item.lastError    = error;
  item.updatedAt    = Date.now();
  await QueueStore.set(batch);
  console.info(`[background] item ${itemId} → ${status}${publishedUrl ? " (" + publishedUrl + ")" : ""}`);

  // Storage change broadcasts QUEUE_STATE_UPDATE automatically (popup +
  // queue page subscribe via chrome.storage.onChanged).
}

// Apply a page-scoped selection change (Select page / Invert page from the side
// panel): set item.selected for each listed id. Serialized through the store
// like every other selection mutation.
async function setSelectedMap(updates: Array<{ id: string; selected: boolean }>): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch || !Array.isArray(updates)) return;
  const map = new Map(updates.map((u) => [u.id, u.selected]));
  const now = Date.now();
  for (const item of batch.items) {
    if (map.has(item.id)) {
      item.selected = map.get(item.id)!;
      item.updatedAt = now;
    }
  }
  await QueueStore.set(batch);
}

async function invertAllSelected(): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  const now = Date.now();
  for (const item of batch.items) {
    item.selected = !(item.selected !== false);
    item.updatedAt = now;
  }
  await QueueStore.set(batch);
}

async function openQueuePage() {
  const url = chrome.runtime.getURL("queue/index.html");
  // Reuse an existing queue tab if present.
  const tabs = await chrome.tabs.query({ url });
  if (tabs.length > 0 && tabs[0].id != null) {
    await chrome.tabs.update(tabs[0].id, { active: true });
    return;
  }
  await chrome.tabs.create({ url, active: true });
}
