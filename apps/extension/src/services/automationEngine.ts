// The "brain" of the extension.
// - Consumes the queue, picks the next pending/queued item, and runs it.
// - Owns retry logic and inter-item delays; does NOT touch the DOM directly.
// - Delegates all in-page work to the content script via chrome.tabs.sendMessage.

import type { QueueItem } from "@teepublic/shared";
import { QueueStore, SettingsStore, BulkLogStore, ImageStore } from "./queueStore";
import { humanDelay } from "../lib/delays";

type EngineState = "idle" | "running" | "paused" | "stopped";

const QUICK_CREATE_URL = "https://www.teepublic.com/design/quick_create";
const BULK_UPLOAD_URL = "https://www.teepublic.com/designs/bulk_uploader";
const LOGIN_URL_FRAGMENTS = ["sign_in", "/login", "/users/sign_in", "/auth/", "/account/login"];

class AutomationEngine {
  private state: EngineState = "idle";
  private currentTabId: number | null = null;

  getState(): EngineState { return this.state; }

  async start() {
    if (this.state === "running") return;
    await SettingsStore.set({ paused: false });
    // Reset any items left in "running" (service worker was suspended mid-run,
    // browser closed, etc.) — without this, the loop would skip them forever.
    await resurrectStaleRunningItems();
    // A FAILED design that the user re-selected and pressed Start = "retry this".
    // Re-queue selected failed items so the loop will process them again.
    await requeueSelectedFailed();
    this.state = "running";
    void this.loop();
  }

  async pause() {
    await SettingsStore.set({ paused: true });
    this.state = "paused";
  }

  async retry(itemId: string) {
    await QueueStore.setItemStatus(itemId, "pending", { lastError: undefined });
    if (this.state !== "running") void this.start();
  }

  private async loop() {
    while (true) {
      const settings = await SettingsStore.get();
      if (settings.paused) { this.state = "paused"; return; }

      const batch = await QueueStore.get();
      if (!batch) { this.state = "idle"; return; }

      // BULK: dispatch all selected designs on /designs/bulk_uploader → click
      // Get Started → TeePublic opens each design on its OWN /designs/<id>/edit
      // page; fill + publish them one by one in upload order. (Single mode is
      // untouched.)
      if (settings.uploadMode === "bulk") {
        const pending = batch.items.filter((i) =>
          (i.status === "pending" || i.status === "queued") && i.selected !== false
        );
        if (pending.length === 0) { this.state = "idle"; return; }
        await this.runBulk(pending);
        this.state = "idle";
        return;
      }

      // SINGLE: one design at a time — upload its image → wait → fill → publish.
      const next = batch.items.find((i) =>
        (i.status === "pending" || i.status === "queued") && i.selected !== false
      );
      if (!next) { this.state = "idle"; return; }

      const total = batch.items.filter((i) => i.selected !== false).length;
      const remaining = batch.items.filter((i) =>
        (i.status === "pending" || i.status === "queued") && i.selected !== false
      ).length;
      BulkLogStore.append(`── ${total - remaining + 1}/${total}: ${next.metadata.filename} (${next.metadata.title}) ──`);

      await this.runOne(next);
      await humanDelay(settings.betweenItemsMinMs, settings.betweenItemsMaxMs);
    }
  }

  /** BULK: dispatch all files on /designs/bulk_uploader → GET STARTED → wait
   *  through "Waiting for your designs to process" → fill each design's listing,
   *  click NEXT DESIGN between them, and PUBLISH ALL on the last.
   *    1. dispatch all files (content waits for the upload to FINISH, then clicks
   *       GET STARTED).
   *    2. let the editing view render.
   *    3. one AUTOMATION_BULK_RUN drives fill → NEXT DESIGN → … → PUBLISH ALL;
   *       the content script reports each design's status via ITEM_STATUS, so the
   *       results survive PUBLISH ALL's navigation (and worker suspension).
   *  Single mode is untouched. */
  private async runBulk(items: QueueItem[]) {
    for (const it of items) {
      await QueueStore.setItemStatus(it.id, "running", { attempts: it.attempts + 1, lastError: undefined });
    }
    try {
      const tabId = await this.ensureBulkTab();
      this.currentTabId = tabId;
      const imageDataUrls: string[] = [];
      for (const it of items) imageDataUrls.push(await imageDataUrlFor(it));
      await ensureContentScriptReady(tabId);

      // 1. Dispatch all files. The content script waits for the upload to finish,
      //    replies with the valid ids (in upload order), then clicks GET STARTED.
      const disp = await sendToTab<{ ok: boolean; validIds?: string[]; error?: string }>(
        tabId, { type: "AUTOMATION_BULK_DISPATCH", items, imageDataUrls });
      const validIds = disp?.validIds ?? [];
      if (validIds.length === 0) {
        // Every design was too small / rejected / upload failed — statuses fired.
        await this.reconcileBulk(items);
        return;
      }
      const ordered = validIds.map((id) => items.find((i) => i.id === id)!).filter(Boolean);

      // 2. Let the editing view render after GET STARTED. TeePublic shows a
      //    "Waiting for your designs to process" page first; the content script
      //    waits through it. Re-ensure the script in case the DOM was swapped.
      await new Promise((r) => setTimeout(r, 3_000));
      await ensureContentScriptReady(tabId);

      // 3. Drive the whole edit → NEXT DESIGN → PUBLISH ALL loop in one call. The
      //    content script reports each design's status itself, so a dropped
      //    response (PUBLISH ALL navigation) or a suspended worker still leaves
      //    correct statuses behind.
      try {
        await sendToTab(tabId, { type: "AUTOMATION_BULK_RUN", items: ordered });
      } catch {
        // PUBLISH ALL navigation can close the message port — ignore.
      }

      await new Promise((r) => setTimeout(r, 2_500));
      await this.reconcileBulk(items);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      for (const it of items) {
        const b = await QueueStore.get();
        if (b?.items.find((i) => i.id === it.id)?.status === "succeeded") continue;
        await QueueStore.setItemStatus(it.id, "failed", { lastError: message });
      }
    }
  }

  /** After a bulk run: free images for succeeded designs; mark any still-running
   *  (no ITEM_STATUS arrived) as failed. */
  private async reconcileBulk(items: QueueItem[]) {
    const b = await QueueStore.get();
    for (const it of items) {
      const cur = b?.items.find((i) => i.id === it.id);
      if (cur?.status === "succeeded") { await ImageStore.remove(it.id); }
      else if (cur?.status === "running") { await QueueStore.setItemStatus(it.id, "failed", { lastError: "bulk: no result reported" }); }
    }
  }

  private async ensureBulkTab(): Promise<number> {
    if (this.currentTabId != null) {
      try {
        const tab = await chrome.tabs.get(this.currentTabId);
        if (tab && tab.url?.includes("teepublic.com")) {
          await navigateAndWait(this.currentTabId, BULK_UPLOAD_URL);
          await assertNotLoginPage(this.currentTabId);
          return this.currentTabId;
        }
      } catch { /* tab gone */ }
    }
    const tab = await chrome.tabs.create({ url: BULK_UPLOAD_URL, active: true });
    if (tab.id == null) throw new Error("failed to open TeePublic bulk uploader tab");
    this.currentTabId = tab.id;
    await waitForTabComplete(tab.id);
    await assertNotLoginPage(tab.id);
    return tab.id;
  }

  private async runOne(item: QueueItem) {
    // Safety net: never re-run a completed item, no matter how it got back
    // into the loop. The status check in the orchestrator should already
    // prevent this, but a stale snapshot or storage race could otherwise let
    // a succeeded item slip through.
    if (item.status === "succeeded" || item.publishedUrl) {
      console.info(`[teepublic] item ${item.id} already succeeded — skipping (status=${item.status}, publishedUrl=${item.publishedUrl ?? "(none)"})`);
      return;
    }

    const settings = await SettingsStore.get();
    await QueueStore.setItemStatus(item.id, "running", {
      attempts: item.attempts + 1,
      lastError: undefined,
    });

    try {
      const tabId = await this.ensureTeePublicTab();
      this.currentTabId = tabId;

      const imageDataUrl = await imageDataUrlFor(item);
      await ensureContentScriptReady(tabId);

      const result = await sendToTab<{ ok: boolean; error?: string; publishedUrl?: string }>(tabId, {
        type: "AUTOMATION_START_ITEM",
        item,
        imageDataUrl,
      });

      if (!result?.ok) throw new Error(result?.error ?? "automation failed");

      // Mark succeeded BEFORE logging — guarantees the next loop iteration
      // sees a non-pending status and won't pick this item again.
      await QueueStore.setItemStatus(item.id, "succeeded", { publishedUrl: result.publishedUrl });
      await ImageStore.remove(item.id); // free its (large) stored image
      console.info(`[teepublic-cs] item ${item.id} succeeded: ${result.publishedUrl} — moving on`);
    } catch (err) {
      // The content script's ITEM_STATUS / PUBLISHED_URL_DETECTED may already
      // have marked this item succeeded, OR may still be on its way (sendToTab
      // can reject the instant the publish navigation closes the message port,
      // before the new content script on /t-shirt/<slug> announces itself).
      // Poll for either signal — and as a final safety net inspect the tab URL
      // directly — before downgrading to "queued", otherwise the next loop
      // iteration would re-publish the same design.
      if (await waitForSucceededSignal(item.id, this.currentTabId, 10_000)) {
        console.info(`[teepublic] item ${item.id} confirmed succeeded after sendToTab rejected — keeping`);
        return;
      }
      // Skip a failed design (mark FAILED, don't re-queue) so the run finishes
      // the rest. Keep its stored image so the user can Retry it afterward.
      const message = err instanceof Error ? err.message : String(err);
      await QueueStore.setItemStatus(item.id, "failed", { lastError: message, attempts: item.attempts + 1 });
      console.info(`[teepublic] item ${item.id} FAILED — skipping, continuing: ${message}`);
    }
  }

  private async ensureTeePublicTab(): Promise<number> {
    // Reuse the existing automation tab if still on teepublic.com.
    if (this.currentTabId != null) {
      try {
        const tab = await chrome.tabs.get(this.currentTabId);
        if (tab && tab.url?.includes("teepublic.com")) {
          await navigateAndWait(this.currentTabId, QUICK_CREATE_URL);
          await assertNotLoginPage(this.currentTabId);
          return this.currentTabId;
        }
      } catch { /* tab gone */ }
    }
    const tab = await chrome.tabs.create({ url: QUICK_CREATE_URL, active: true });
    if (tab.id == null) throw new Error("failed to open TeePublic tab");
    this.currentTabId = tab.id;
    await waitForTabComplete(tab.id);
    await assertNotLoginPage(tab.id);
    return tab.id;
  }
}

export const engine = new AutomationEngine();

// ─── helpers ────────────────────────────────────────────────────────────────

function sendToTab<T>(tabId: number, message: unknown): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) return reject(new Error(err.message));
      resolve(response as T);
    });
  });
}

async function navigateAndWait(tabId: number, url: string): Promise<void> {
  await chrome.tabs.update(tabId, { url, active: true });
  await waitForTabComplete(tabId);
}

function waitForTabComplete(tabId: number, timeoutMs = 60_000): Promise<void> {
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err?: Error) => {
      if (done) return;
      done = true;
      chrome.tabs.onUpdated.removeListener(handler);
      clearTimeout(timer);
      err ? reject(err) : resolve();
    };
    const handler = (id: number, info: chrome.tabs.TabChangeInfo) => {
      if (id === tabId && info.status === "complete") finish();
    };
    chrome.tabs.onUpdated.addListener(handler);
    const timer = setTimeout(() => finish(new Error("tab navigation timed out")), timeoutMs);
    // The tab may already be complete before we attach the listener — check now.
    chrome.tabs.get(tabId, (tab) => {
      if (chrome.runtime.lastError) return finish(new Error(chrome.runtime.lastError.message));
      if (tab.status === "complete") finish();
    });
  });
}

async function assertNotLoginPage(tabId: number): Promise<void> {
  const tab = await chrome.tabs.get(tabId);
  const url = tab.url ?? "";
  if (LOGIN_URL_FRAGMENTS.some((f) => url.toLowerCase().includes(f))) {
    throw new Error(`TeePublic redirected to a login page (${url}). Please sign in to TeePublic in this Chrome profile, then click Retry.`);
  }
  if (!url.includes("teepublic.com")) {
    throw new Error(`unexpected URL after navigation: ${url}`);
  }
}

async function ensureContentScriptReady(tabId: number): Promise<void> {
  // First try the manifest-injected listener.
  if (await pingContentScript(tabId, 5_000)) return;

  // Fallback: inject programmatically. This handles cases where the page was
  // already loaded before the extension installed, or the manifest match missed.
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content/teepublic.js"],
    });
  } catch (err) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    throw new Error(`failed to inject content script (URL: ${tab?.url ?? "?"}): ${(err as Error).message}`);
  }

  if (await pingContentScript(tabId, 8_000)) return;

  const tab = await chrome.tabs.get(tabId).catch(() => null);
  throw new Error(`content script unreachable after injection (URL: ${tab?.url ?? "?"})`);
}

async function pingContentScript(tabId: number, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await sendToTab<{ ok: boolean }>(tabId, { type: "PING" });
      if (r?.ok) return true;
    } catch { /* not ready */ }
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}

// If the service worker was suspended mid-upload, the corresponding item
// stayed in "running" status forever. Reset such items to "queued" so the
// next .start() picks them up. Safe to run anytime — only touches items
// we know aren't actually being processed (we always re-mark "running"
// at the top of runOne).
// Reset any SELECTED "failed" items back to "pending" so pressing Start retries
// them. Failed items left UNSELECTED stay failed (skipped). Their image is still
// in ImageStore (kept on failure), so the retry has the artwork.
async function requeueSelectedFailed(): Promise<void> {
  const batch = await QueueStore.get();
  if (!batch) return;
  let changed = 0;
  for (const item of batch.items) {
    if (item.status === "failed" && item.selected !== false) {
      item.status = "pending";
      item.lastError = undefined;
      item.updatedAt = Date.now();
      changed++;
    }
  }
  if (changed > 0) {
    await QueueStore.set(batch);
    console.info(`[teepublic] re-queued ${changed} selected failed item(s) for retry`);
  }
}

async function resurrectStaleRunningItems(): Promise<void> {
  const batch = await QueueStore.get();
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
    console.info(`[teepublic] resurrected ${changed} stale running item(s)`);
  }
}

// Same product-listing URL families the content script considers "published".
// Keep this in sync with isPublishedListingUrl in content/teepublic.ts.
const PUBLISHED_LISTING_RX = /\/(t-shirt|hoodie|tank-top|crewneck-sweatshirt|long-sleeve-t-shirt|baseball-tee|kids[a-z-]*|sticker|case|phone-case|mug|coffee-mug|travel-mug|wall-art|pillow|tote|tapestry|pin|magnet|sock|hat|short|bag)\//i;
const EDIT_OR_CREATE_RX = /\/(designs?\/\d+\/edit|design\/quick_create)/;

// Poll for a success signal after sendToTab rejected. Returns true if the
// item is (or becomes) "succeeded" within `timeoutMs`. We watch two things:
//   1. The persisted item status — ITEM_STATUS / PUBLISHED_URL_DETECTED race
//      with our rejection, so wait briefly for either to land.
//   2. The tab's current URL — if it's already on a published listing then
//      the publish succeeded even if neither message ever arrives.
async function waitForSucceededSignal(itemId: string, tabId: number | null, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const batch = await QueueStore.get();
    const item = batch?.items.find((i) => i.id === itemId);
    if (item?.status === "succeeded") return true;

    if (tabId != null) {
      try {
        const tab = await chrome.tabs.get(tabId);
        const url = tab.url ?? "";
        if (PUBLISHED_LISTING_RX.test(url) && !EDIT_OR_CREATE_RX.test(url)) {
          await QueueStore.setItemStatus(itemId, "succeeded", { publishedUrl: url });
          console.info(`[teepublic] item ${itemId} confirmed succeeded by tab URL: ${url}`);
          return true;
        }
      } catch { /* tab gone — fall through and keep polling storage */ }
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

// Get a design's image as a data URL: prefer the locally-stored copy (kept in
// its own ImageStore key, out of the batch), else fetch the http(s) URL.
async function imageDataUrlFor(item: QueueItem): Promise<string> {
  const stored = await ImageStore.get(item.id);
  if (stored) return stored;
  if (item.imageUrl) return await fetchDesignAsDataUrl(item.imageUrl);
  throw new Error("no image available for this item");
}

async function fetchDesignAsDataUrl(imageUrl: string): Promise<string> {
  // imageUrl is an absolute, publicly-fetchable URL (Supabase Storage public
  // bucket), so fetch it directly — no host rewriting needed.
  const res = await fetch(imageUrl, { cache: "no-store" });
  if (!res.ok) throw new Error(`fetch design failed: ${res.status}`);
  const blob = await res.blob();
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("data URL conversion failed"));
    reader.readAsDataURL(blob);
  });
}
