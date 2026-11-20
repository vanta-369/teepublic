// Service worker. Three responsibilities:
//   1. Receive QUEUE_INIT/QUEUE_START/etc from the dashboard (externally_connectable).
//   2. Persist queue + settings via QueueStore.
//   3. Drive the AutomationEngine.

import type { DashboardToExtensionMessage, QueueStateData } from "@teepublic/shared";
import { GEMINI_BROWSER_JOBS } from "@teepublic/shared";
import type { QueueBatch } from "@teepublic/shared";
import { QueueStore, SettingsStore, clearAllImageData, storeImageWithThumbnail } from "../services/queueStore";
import { engine } from "../services/automationEngine";
import { assertCanAccess, AccessDeniedError } from "../lib/access";
import { migrateLegacyImages } from "../lib/imageDb";
import { fetchCanvaExport } from "../services/canvaImport";
import {
  addAccount,
  enqueueJob,
  fetchGeneratedImage,
  getGeminiState,
  getJobImages,
  handleDone,
  handleProgress,
  handleTabRemoved,
  listAccounts,
  pump as pumpGeminiJobs,
  refreshAccounts,
  removeJob,
  retryJob,
  setAccountLabel,
  isJobTab,
} from "../services/geminiJobs";
import { attachViaDebugger } from "../services/geminiDebugger";
import { addHistory, getHistory, getQuotas, projectKey, recordAttempts, setLimit, setUsed } from "../services/uploadQuota";
import { countFailedUpload, countSuccessfulUpload } from "../lib/uploadCounter";
import { resolveDesignImages } from "../services/designImages";
import {
  bootSalesMonitor, checkSalesNow, getSalesState, markSalesSeen, onSalesError, onSnapshot, playSound, setSettings as setSalesSettings,
} from "../services/salesMonitor";

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
void chrome.action.setPopup({ popup: "" }).catch(() => {});
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

// Gemini jobs need no "running" reset like the queue above: a job's tab keeps
// working while the worker sleeps, and its GEMINI_JOB_DONE wakes it. pump()
// fails only jobs whose tab is gone or that ran out of time, and starts any
// queued work.
if (GEMINI_BROWSER_JOBS) void pumpGeminiJobs().catch((e) => console.warn("[gemini] pump on startup failed", e));

/** Dashboard messages that drive Gemini browser jobs - refused while the switch is off. */
const GEMINI_JOB_MESSAGES = new Set([
  "LIST_ACCOUNTS", "ADD_ACCOUNT", "SET_ACCOUNT_LABEL", "RUN_GEMINI_JOB",
  "GEMINI_STATE", "GEMINI_RESULT", "GEMINI_JOB_RETRY", "GEMINI_JOB_REMOVE",
]);

// Sales notifier: badge back + the offscreen document that watches the
// TeePublic sales page (services/salesMonitor.ts). Local only.
void bootSalesMonitor().catch((e) => console.warn("[sales] boot failed", e));
chrome.tabs.onRemoved.addListener((tabId) => { void handleTabRemoved(tabId); });

// Daily quota: count every upload ATTEMPT that ends "succeeded" or "failed",
// whichever path wrote it (engine, content script ITEM_STATUS, URL detection) -
// TeePublic counts failed uploads against its daily limit too. Keyed by
// id + attempt, so a retry counts again but a late failed→succeeded flip of
// the same attempt doesn't. A design whose artwork was missing never reached
// TeePublic, so it doesn't count.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !("teepublic.batch" in changes)) return;
  const oldBatch = changes["teepublic.batch"].oldValue as QueueBatch | undefined;
  const newBatch = changes["teepublic.batch"].newValue as QueueBatch | undefined;
  if (!newBatch) return;
  const before = new Map((oldBatch?.items ?? []).map((i) => [i.id, i.status]));
  const ended = (st?: string) => st === "succeeded" || st === "failed";
  const endedNow = newBatch.items.filter((i) =>
    ended(i.status) && before.has(i.id) && !ended(before.get(i.id)) && !i.lastError?.startsWith("Image missing"));
  if (endedNow.length) {
    const key = projectKey(newBatch.projectId);
    void recordAttempts(key, endedNow.map((i) => `${i.id}#${i.attempts ?? 0}`));
    void addHistory(key, endedNow.filter((i) => i.status === "succeeded").length, endedNow.filter((i) => i.status === "failed").length);
  }
});

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

      // Gemini browser jobs are switched off in this release (packages/shared/src/features.ts).
      if (!GEMINI_BROWSER_JOBS && GEMINI_JOB_MESSAGES.has(message.type)) {
        return sendResponse({ ok: false, error: "Google-account generation isn't available in this version of the extension." });
      }

      switch (message.type) {
        case "PING":
          return sendResponse({ ok: true, data: { version: chrome.runtime.getManifest().version } });

        case "CANVA_EXPORT_FETCH":
          return sendResponse({ ok: true, data: await fetchCanvaExport(message.url) });

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
          await engine.start({ accessJustConfirmed: true });
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

        // Daily quota per project - local counts only (services/uploadQuota.ts).
        case "QUOTA_GET":
          return sendResponse({ ok: true, data: await getQuotas((message.projectIds ?? []).map(projectKey)) });

        case "HISTORY_GET":
          return sendResponse({ ok: true, data: await getHistory((message.projectIds ?? []).map(projectKey)) });

        case "QUOTA_SET_LIMIT":
          await setLimit(projectKey(message.projectId), message.limit);
          return sendResponse({ ok: true, data: await getQuotas([projectKey(message.projectId)]) });

        case "QUOTA_SET_USED":
          await setUsed(projectKey(message.projectId), message.used);
          return sendResponse({ ok: true, data: await getQuotas([projectKey(message.projectId)]) });

        // ── Earnings tables: a picture per TeePublic design id ──────────────
        case "DESIGN_IMAGES": {
          const g = await guardAccess();
          if (!g.ok) return sendResponse(g);
          return sendResponse({ ok: true, data: await resolveDesignImages(message.designIds) });
        }

        // ── Gemini ──────────────────────────────────────────────────────────
        case "LIST_ACCOUNTS":
          return sendResponse({ ok: true, data: message.refresh ? await refreshAccounts() : await listAccounts() });

        case "ADD_ACCOUNT":
          await addAccount();
          return sendResponse({ ok: true });

        case "SET_ACCOUNT_LABEL":
          return sendResponse({ ok: true, data: await setAccountLabel(message.index, String(message.label ?? "")) });

        case "RUN_GEMINI_JOB": {
          const g = await guardAccess();
          if (!g.ok) return sendResponse(g);
          await enqueueJob(message);
          return sendResponse({ ok: true });
        }

        case "GEMINI_STATE":
          return sendResponse({ ok: true, data: await getGeminiState() });

        // One job's images per message, like QUEUE_IMAGE in reverse, so the
        // state poll never carries image bytes.
        case "GEMINI_RESULT":
          return sendResponse({ ok: true, data: await getJobImages(message.jobId) });

        case "GEMINI_JOB_RETRY": {
          const g = await guardAccess();
          if (!g.ok) return sendResponse(g);
          await retryJob(message.jobId);
          return sendResponse({ ok: true });
        }

        case "GEMINI_JOB_REMOVE":
          await removeJob(message.jobId);
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
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.target === "offscreen") return;
  (async () => {
    switch (message?.type) {
      // From the Gemini content script (content/gemini.ts).
      case "GEMINI_JOB_PROGRESS":   await handleProgress(message.jobId, message.step, sender.tab?.id); return sendResponse({ ok: true });
      case "GEMINI_JOB_DONE":       await handleDone(message, sender.tab?.id); return sendResponse({ ok: true });
      case "GEMINI_FETCH_IMAGE":    return sendResponse(await fetchGeneratedImage(message.url));
      case "GEMINI_ATTACH_DEBUGGER": {
        // Only for a tab running one of our jobs - never the user's own Gemini tabs.
        const tabId = sender.tab?.id;
        if (tabId == null || !(await isJobTab(tabId))) return sendResponse({ ok: false, step: "not-a-job-tab" });
        return sendResponse(await attachViaDebugger(tabId, message.imageDataUrl, message.fileName));
      }
      case "TP_AUTO_CONFIRM": {
        // Bulk delete (content/storeDelete.ts): the page's window.confirm lives in
        // the page world, out of the content script's reach. TeePublic tabs only.
        const tabId = sender.tab?.id;
        if (tabId == null || !sender.url?.startsWith("https://www.teepublic.com/")) return sendResponse({ ok: false });
        await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          args: [message.on === true],
          func: (on: boolean) => {
            const w = window as unknown as { confirm: (m?: string) => boolean; __higgsteeConfirm?: (m?: string) => boolean };
            if (on) { w.__higgsteeConfirm ??= w.confirm; w.confirm = () => true; }
            else if (w.__higgsteeConfirm) { w.confirm = w.__higgsteeConfirm; delete w.__higgsteeConfirm; }
          },
        });
        return sendResponse({ ok: true });
      }
      case "ENGINE_START": {
        const g = await guardAccess();
        if (!g.ok) return sendResponse(g);
        await engine.start({ accessJustConfirmed: true });
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
      // Sales notifier - from the offscreen document and the side panel.
      case "SALES_STATE":           return sendResponse({ ok: true, data: await getSalesState() });
      case "SALES_SNAPSHOT":        await onSnapshot(message.snapshot); return sendResponse({ ok: true });
      case "SALES_ERROR":           await onSalesError(String(message.error ?? "")); return sendResponse({ ok: true });
      case "SALES_SEEN":            await markSalesSeen(); return sendResponse({ ok: true });
      case "SALES_CHECK":           await checkSalesNow(); return sendResponse({ ok: true });
      case "SALES_TEST_SOUND":      await playSound(); return sendResponse({ ok: true });
      case "SALES_SETTINGS":
        try { await setSalesSettings(message.settings ?? {}); return sendResponse({ ok: true }); }
        catch (e) { return sendResponse({ ok: false, error: (e as Error).message }); }
      // The content script saw TeePublic's "reached your daily limit" banner.
      case "TEEPUBLIC_LIMIT_HIT":   await engine.onDailyLimitHit(Math.floor(Number(message.limit) || 0)); return sendResponse({ ok: true });
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
  // A "failed" while TeePublic's daily limit is showing is the cap, not the
  // design: keep it pending for when a slot frees.
  if (status === "failed" && engine.limitHitRecently()) {
    item.status = "pending";
    item.lastError = "TeePublic daily limit reached";
    item.updatedAt = Date.now();
    await QueueStore.set(batch);
    return;
  }
  // Don't re-fire if already in target state with same data.
  if (item.status === status && item.publishedUrl === publishedUrl) {
    return;
  }
  const changed = item.status !== status;
  item.status = status;
  if (publishedUrl) item.publishedUrl = publishedUrl;
  if (error)        item.lastError    = error;
  item.updatedAt    = Date.now();
  await QueueStore.set(batch);
  console.info(`[background] item ${itemId} → ${status}${publishedUrl ? " (" + publishedUrl + ")" : ""}`);

  // This path writes the batch directly, so it must count like
  // QueueStore.setItemStatus does (both counters dedupe by item id).
  if (changed && status === "succeeded") void countSuccessfulUpload({ itemId, projectId: batch.projectId });
  if (changed && status === "failed") void countFailedUpload({ itemId, projectId: batch.projectId });

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
