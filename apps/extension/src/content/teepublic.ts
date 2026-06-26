// Content script — runs inside the TeePublic upload page.
// Receives AUTOMATION_START_ITEM from the service worker, runs the upload steps,
// and replies with success or error. Stays a *thin* DOM driver: orchestration
// (queue, retries, delays-between-items) lives in the AutomationEngine.

import type { QueueItem } from "@teepublic/shared";
import { TP, BULK } from "../lib/selectors";
import { BulkLogStore } from "../services/queueStore";
import {
  firstMatching,
  setFileInput,
  setFileInputMultiple,
  typeInto,
  waitForSelector,
  findFieldByLabel,
  findFieldAfterLabel,
  findLabelElement,
  findRadioByLabel,
} from "../lib/dom";
import { humanDelay, sleep } from "../lib/delays";
import { configureProductTable, configureOtherProducts, configureNonApparelColors, applyEnabledProducts, applyProductColorPalette, findBlockingEmptyColors, fullClick } from "./colors";

console.info("[teepublic-cs] ready on", location.href);

// If this content script loads on a published-listing URL, the previous
// upload completed — the page navigated and destroyed the content script
// that was running runUpload, killing its sendResponse callback. Notify
// the background so it can mark whichever item is currently "running" as
// succeeded and advance the queue.
if (typeof location !== "undefined" && /\/(t-shirt|hoodie|tank-top|crewneck-sweatshirt|long-sleeve-t-shirt|baseball-tee|kids[a-z-]*|sticker|case|phone-case|mug|coffee-mug|travel-mug|wall-art|pillow|tote|tapestry|pin|magnet|sock|hat|short|bag)\//i.test(location.href)) {
  try {
    chrome.runtime.sendMessage({
      type: "PUBLISHED_URL_DETECTED",
      url: location.href,
    });
    console.info("[teepublic-cs] notified background: published URL detected on load");
  } catch (e) {
    console.warn("[teepublic-cs] PUBLISHED_URL_DETECTED send failed:", e);
  }
}


/** URLs we've already announced as publish-success during this content
 *  script's lifetime. Prevents duplicate success events from re-triggering
 *  the engine if TeePublic emits the same /t-shirt/ URL more than once. */
const publishSuccessFiredFor = new Set<string>();

/** Last itemId we sent ITEM_STATUS for. Stops back-to-back duplicate fires
 *  if the publish-detection path triggers twice (e.g. via the AlreadyPublished
 *  sentinel AND the urlChanged code path). Resets at the top of every runUpload. */
let lastFiredItemId: string | null = null;

/** Fire ITEM_STATUS to the background. Critical: this message is the
 *  resilient signal — it survives even when the page navigates and the
 *  sendResponse callback from AUTOMATION_START_ITEM gets destroyed. */
function fireItemStatus(itemId: string, status: "succeeded" | "failed", publishedUrl?: string, error?: string): void {
  if (itemId === lastFiredItemId) {
    log(`ITEM_STATUS for ${itemId} already fired — debounced`);
    return;
  }
  lastFiredItemId = itemId;
  try {
    chrome.runtime.sendMessage({
      type: "ITEM_STATUS",
      itemId,
      status,
      publishedUrl,
      error,
    });
    log(`sent ITEM_STATUS ${status} for ${itemId}${publishedUrl ? " → " + publishedUrl : ""}`);
  } catch (e) {
    console.warn("[teepublic-cs] ITEM_STATUS send failed:", e);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  (async () => {
    if (message?.type === "PING") {
      return sendResponse({ ok: true });
    }
    if (message?.type === "AUTOMATION_START_ITEM") {
      const result = await runUpload(message.item, message.imageDataUrl);
      return sendResponse(result);
    }
    if (message?.type === "AUTOMATION_BULK_DISPATCH") {
      // On /designs/bulk_uploader: pre-validate sizes, dispatch the valid files,
      // wait for GET STARTED, reply with the valid ids (in upload order), THEN
      // click GET STARTED (which navigates to design 1's /designs/<id>/edit).
      const result = await runBulkDispatch(message.items, message.imageDataUrls);
      sendResponse(result);
      if (result.ok && result.validIds.length > 0) {
        await sleep(500);
        await clickGetStarted();
      }
      return;
    }
    if (message?.type === "AUTOMATION_FILL_PUBLISH_DRAFT") {
      // On a /designs/<id>/edit bulk page: fill listing + colors and publish.
      // Publishing auto-advances TeePublic to the next design's /edit page.
      const result = await fillAndPublishDraft(message.item);
      return sendResponse(result);
    }
    return sendResponse({ ok: false, error: "unknown message" });
  })();
  return true;
});

// Find an input by CSS candidates first; if none match, fall back to a label
// search. `exclude` keeps subsequent lookups from re-finding a field we've
// already filled — important when the label fallback's "closest field"
// heuristic could otherwise pick the previous textarea twice.
async function findInput(
  candidates: string[],
  labelText: string,
  kind: "text" | "textarea" | "any",
  exclude: Set<Element>,
  timeoutMs = 5_000,
): Promise<HTMLInputElement | HTMLTextAreaElement> {
  try {
    const css = await firstMatching<HTMLInputElement | HTMLTextAreaElement>(candidates, timeoutMs);
    if (!exclude.has(css)) return css;
  } catch { /* fall through */ }
  return await findFieldByLabel(labelText, { kind, exclude, timeoutMs });
}

/** True if the current page URL is a published TeePublic listing (i.e. the
 *  design has already been published). Examples: /t-shirt/<id>-<slug>,
 *  /hoodie/<...>, /sticker/<...>. The /design/quick_create and
 *  /designs/<id>/edit URLs are NOT a published listing. */
function isPublishedListingUrl(url: string = location.href): boolean {
  if (/\/(designs?\/\d+\/edit|design\/quick_create)/.test(url)) return false;
  return /\/(t-shirt|hoodie|tank-top|crewneck-sweatshirt|long-sleeve-t-shirt|baseball-tee|kids[a-z-]*|sticker|case|phone-case|mug|coffee-mug|travel-mug|wall-art|pillow|tote|tapestry|pin|magnet|sock|hat|short|bag)\//i.test(url);
}

async function runUpload(
  item: QueueItem,
  imageDataUrl: string,
  skipUpload = false,  // bulk in-place: artwork already dispatched in the batch
  skipPublish = false, // bulk in-place: don't tick terms/publish per design (Publish All does it once)
): Promise<{ ok: boolean; error?: string; publishedUrl?: string }> {
  // Reset the duplicate-fire guard for this new item.
  if (item.id !== lastFiredItemId) lastFiredItemId = null;

  // Short-circuit: if the tab already sits on a published listing URL,
  // the design was published by an earlier run (or by TeePublic redirecting
  // a completed publish). Return success immediately so the engine can move
  // on instead of trying to refill the form on a page that has no upload UI.
  if (isPublishedListingUrl(location.href)) {
    log(`already on a published listing page (${location.href}) — treating as succeeded, skipping upload`);
    fireItemStatus(item.id, "succeeded", location.href);
    return { ok: true, publishedUrl: location.href };
  }

  try {
    // Echo the metadata that came in from the dashboard / Excel so the user
    // can verify their spreadsheet data made it all the way through.
    const m = item.metadata;
    log(`──── starting "${m.title}" ────`);
    log(`page url:     ${location.href}`);
    if (!location.pathname.includes("/design/quick_create")) {
      // Not a failure: TeePublic often redirects to /designs/<id>/edit. The
      // product enable/disable + (non-apparel) color logic keys off the DOM
      // (canvas-option inputs, div.canvas tiles, #primary_color_* containers),
      // not the URL, so it runs the same on either page.
      log(`note: on ${location.pathname} (not /design/quick_create) — color/toggle logic is DOM-keyed, continuing.`);
    }
    log(`title:        ${JSON.stringify(m.title)}`);
    log(`primary tag:  ${JSON.stringify(m.primaryTag ?? "")}`);
    log(`description:  ${m.description ? m.description.slice(0, 60) + (m.description.length > 60 ? "…" : "") : "(empty)"}`);
    log(`tags (${m.tags.length}): ${m.tags.join(", ") || "(none)"}`);
    log(`mature:       ${m.matureContent}`);
    log(`colors:       ${JSON.stringify(m.productColors)}`);
    log(`enabled:      ${m.enabledProducts?.length ?? 0} products`);

    // Track every field we've already filled so the next lookup can't reuse it.
    const filled = new Set<Element>();

    // ── 1. Upload the design file (ONE attempt — TeePublic caps ~50/day, so we
    //       never re-dispatch and burn extra daily slots). ──────────────────
    if (!skipUpload) {
      // Pre-validate size — TeePublic rejects artwork below 1500×1995, which
      // otherwise wastes a daily upload slot. Skip too-small files up front.
      const dim = await imageDimensions(imageDataUrl);
      if (dim && isBelowMinSize(dim)) {
        const err = `skipped ${m.filename}: ${dim.w}×${dim.h} below TeePublic minimum ${MIN_SHORT_SIDE}×${MIN_LONG_SIDE}`;
        log(err);
        fireItemStatus(item.id, "failed", undefined, err);
        return { ok: false, error: err };
      }
      const file = dataUrlToFile(imageDataUrl, m.filename || "design.png", item.imageMime || "image/png");
      const fileInput = await firstMatching<HTMLInputElement>([...TP.fileInput]);
      await setFileInput(fileInput, file);
      log("file dispatched — waiting for TeePublic to accept the artwork…");
      const outcome = await waitForUploadOutcome(30_000);
      if (outcome === "failed") {
        // Don't fill the listing onto a design with no artwork, and don't retry.
        const err = "artwork upload failed (TeePublic rejected the file — needs a transparent PNG ≥ 1500×1995px)";
        log(`✗ ${err} — skipping (no retry)`);
        fireItemStatus(item.id, "failed", undefined, err);
        return { ok: false, error: err };
      }
      // "ok" or "timeout" (form rendered) — proceed to fill the listing.
    } else {
      log("skipUpload: filling existing draft (no file dispatch)");
    }

    // ── 1b. Wait until the design is 100% loaded ────────────────────────
    // TeePublic renders the form fields + Item table + Configure Other Products
    // PROGRESSIVELY as the file uploads/processes. Trying to fill anything
    // before that produces phantom failures (textareas / rows that don't
    // exist yet). Block until ALL of them are present.
    await waitForFormReady();

    // Field order matches the page: Title → Description → Main Tag → Supporting Tags.

    // ── 2. Design Title ─────────────────────────────────────────────────
    const titleInput = await findInput([...TP.titleInput], "Design Title", "text", filled) as HTMLInputElement;
    await typeAndVerify(titleInput, item.metadata.title, "title");
    filled.add(titleInput);
    await humanDelay(600, 1200);

    // ── 3. Description ──────────────────────────────────────────────────
    if (item.metadata.description) {
      try {
        const descInput = await findInput([...TP.descriptionInput], "Description", "textarea", filled) as HTMLTextAreaElement;
        await typeAndVerify(descInput, item.metadata.description, "description");
        filled.add(descInput);
        await humanDelay(600, 1200);
      } catch (e) {
        log(`description input not found — skipping: ${(e as Error).message}`);
      }
    }

    // ── 4. Main Tag (uses metadata.primaryTag) ──────────────────────────
    if (item.metadata.primaryTag) {
      try {
        const mainTagInput = await findInput([...TP.mainTagInput], "Main Tag", "text", filled) as HTMLInputElement;
        await typeAndVerify(mainTagInput, item.metadata.primaryTag, "main tag");
        filled.add(mainTagInput);
        await humanDelay(600, 1200);
      } catch (e) {
        log(`main tag input not found — skipping: ${(e as Error).message}`);
      }
    }

    // ── 5. Supporting Tags ─────────────────────────────────────────────
    // First the same flow as Description / Main Tag (CSS → label fallback).
    // If both miss, use elimination: the only unfilled visible textarea on
    // the page IS Supporting Tags (TeePublic only has 2 textareas total).
    if (item.metadata.tags.length > 0) {
      let tagsInput: HTMLInputElement | HTMLTextAreaElement | null = null;
      scrollLabelIntoView("Supporting Tags");
      await sleep(300);
      // Tier 1: CSS / label-spatial. Search both textarea AND input — TeePublic
      // sometimes uses a chip-input rendered as a plain text input.
      try {
        tagsInput = await findInput([...TP.supportingTagsInput], "Supporting Tags", "any", filled, 3_000);
      } catch { /* fall through */ }

      // Tier 2: only-unfilled-textarea elimination.
      if (!tagsInput) {
        const remaining = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).filter((t) => {
          if (filled.has(t)) return false;
          const r = t.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        });
        if (remaining.length === 1) {
          tagsInput = remaining[0];
          log("supporting tags resolved by elimination (only unfilled textarea)");
        } else if (remaining.length > 1) {
          remaining.sort((a, b) => b.getBoundingClientRect().left - a.getBoundingClientRect().left);
          tagsInput = remaining[0];
          log(`supporting tags resolved by rightmost (${remaining.length} unfilled textarea candidates)`);
        }
      }

      // Tier 3: any field whose placeholder hints at tag/comma/keyword.
      if (!tagsInput) {
        const candidates = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).filter((t) => {
          if (filled.has(t)) return false;
          if (t.tagName === "INPUT") {
            const type = (t as HTMLInputElement).type;
            if (type && !["text", "search", ""].includes(type)) return false;
          }
          const r = t.getBoundingClientRect();
          if (r.width === 0 || r.height === 0) return false;
          const ph = (t.getAttribute("placeholder") ?? "").toLowerCase();
          return /tag|comma|keyword/i.test(ph);
        });
        if (candidates.length > 0) {
          tagsInput = candidates[0];
          log(`supporting tags resolved by placeholder hint <${tagsInput.tagName.toLowerCase()}>`);
        }
      }

      // Tier 4: spatial proximity to "Supporting Tags" label across both
      // textareas AND inputs.
      if (!tagsInput) {
        const labelEl = findLabelElement("Supporting Tags");
        if (labelEl) {
          const labelRect = labelEl.getBoundingClientRect();
          const fields = Array.from(document.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("input, textarea")).filter((t) => {
            if (filled.has(t)) return false;
            if (t.tagName === "INPUT") {
              const type = (t as HTMLInputElement).type;
              if (type && !["text", "search", ""].includes(type)) return false;
            }
            const r = t.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
          });
          let best: HTMLInputElement | HTMLTextAreaElement | null = null;
          let bestScore = Infinity;
          for (const f of fields) {
            const r = f.getBoundingClientRect();
            const dy = r.top - labelRect.bottom;
            if (dy < -50) continue;
            const dx = (r.left + r.width / 2) - (labelRect.left + labelRect.width / 2);
            const score = Math.abs(dx) * 2 + Math.max(0, dy);
            if (score < bestScore) { best = f; bestScore = score; }
          }
          if (best) {
            tagsInput = best;
            log(`supporting tags resolved by spatial proximity <${best.tagName.toLowerCase()}>`);
          }
        }
      }

      // Diagnostic dump if all four tiers miss.
      if (!tagsInput) {
        const allTa  = document.querySelectorAll("textarea").length;
        const visTa  = Array.from(document.querySelectorAll<HTMLTextAreaElement>("textarea")).filter((t) => { const r = t.getBoundingClientRect(); return r.width > 0 && r.height > 0; }).length;
        const allIn  = document.querySelectorAll('input').length;
        log(`supporting tags lookup state: ${allTa} textareas (${visTa} visible), ${allIn} inputs total, ${filled.size} already filled`);
      }

      if (tagsInput) {
        // Per-tag entry: type one tag, press Enter to commit it as a chip,
        // wait, then next. Mirrors the manual flow the user described.
        const enterInit = { key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true };
        for (const tag of item.metadata.tags) {
          await typeInto(tagsInput, tag, { clear: true, humanLike: true });
          await sleep(150);
          tagsInput.focus();
          tagsInput.dispatchEvent(new KeyboardEvent("keydown",  enterInit));
          tagsInput.dispatchEvent(new KeyboardEvent("keypress", enterInit));
          tagsInput.dispatchEvent(new KeyboardEvent("keyup",    enterInit));
          await humanDelay(300, 600);
        }
        log(`supporting tags: pressed Enter after each of ${item.metadata.tags.length} tags`);
        filled.add(tagsInput);
        await humanDelay(400, 800);
      } else {
        log(`supporting tags textarea not found — skipping (page may be missing the field)`);
      }
    }

    // Pause to let React fully settle the listing fields before touching colors.
    await humanDelay(1200, 2000);

    // ── 6. Mature Content radio (Yes/No) ────────────────────────────────
    try {
      const want = item.metadata.matureContent ? "Yes" : "No";
      const radio = await findMatureRadio(want);
      if (!radio.checked) {
        // Real radio buttons commit on click, but the *visible* control is
        // often a styled <label> wrapping a hidden <input>. Click the label
        // first if there is one, then ensure the input is also clicked.
        const wrap = radio.closest("label");
        if (wrap) await fullClick(wrap as HTMLElement);
        else      await fullClick(radio);
        if (!radio.checked) radio.checked = true;
        radio.dispatchEvent(new Event("input",  { bubbles: true }));
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        log(`mature → ${want}`);
        await humanDelay(200, 500);
      }
    } catch (e) {
      log(`mature radio not selected — skipping: ${(e as Error).message}`);
    }

    // ── 6.5. Wait for processing/checking-artwork to clear, then product
    //         table colors (per color.md). DO NOT touch the Product Colors
    //         palette — leave it at default.
    await waitForArtworkProcessingDone();

    // Honor the Excel "products" sheet — toggle OFF any apparel row the user
    // disabled (and toggle ON anything they enabled that the page defaulted off).
    // Must happen BEFORE color configuration so we don't waste effort picking
    // colors on rows we're about to disable.
    await applyEnabledProducts(item.metadata.enabledProducts ?? []);
    await humanDelay(200, 400);

    let configResult = await configureProductTable(item.metadata.productColors);
    if (!configResult.ok) {
      log(`⚠ ${configResult.unconfigured.length} rows still empty — retrying once: ${configResult.unconfigured.join(", ")}`);
      await sleep(500);
      configResult = await configureProductTable(item.metadata.productColors);
    }
    if (!configResult.ok) {
      // Abort BEFORE clicking Publish — per spec: log which rows are empty
      // and stop. The engine marks the item failed with a clear reason.
      const msg = `aborting: enabled rows still have empty Default Color: ${configResult.unconfigured.join(", ")}`;
      log(`✗ ${msg}`);
      return { ok: false, error: msg };
    }
    log(`product table configured (${configResult.configured.length} rows)`);
    await humanDelay(300, 700);

    // ── 6.5a. Non-apparel color dropdowns outside the <tr> table (Hats, …) ──
    // These live in #primary_color_<type> and only populate their options
    // once the matching canvas tile is activated. Color the ENABLED ones so
    // they don't block Publish with "must choose a primary color".
    try {
      const na = await configureNonApparelColors(item.metadata.productColors);
      log(`non-apparel colors: ${na.configured.length} configured, ${na.unconfigured.length} unconfigured`);
    } catch (e) {
      log(`non-apparel colors: failed — continuing: ${(e as Error).message}`);
    }
    await humanDelay(200, 400);

    // ── 6.55. Per-card "Configure Other Products" — Bags, Shorts, Hats… ──
    // The default apparel table only contains T-Shirt / Hoodie / etc. To set
    // a Default Color on Bags/Shorts/Hats we have to click each card in the
    // Configure Other Products grid; that swaps the apparel table at top
    // and reveals a fresh dd-select for that product.
    try {
      const other = await configureOtherProducts(item.metadata.productColors);
      log(`configure-other-products: ${other.configured.length} configured, ${other.unconfigured.length} unconfigured`);
    } catch (e) {
      log(`configure-other-products: failed — continuing: ${(e as Error).message}`);
    }
    await humanDelay(300, 600);

    // ── 6.6. Activate the global Product Colors palette ─────────────────
    // TeePublic blocks publish with "You must choose a primary color for
    // shorts/bags/…" when no palette color is selected for non-apparel
    // products. Clicking the "All" preset gives every product at least one
    // compatible color. Safe to run unconditionally — palette selections are
    // additive, and the user's per-design dropdown picks above are untouched.
    try {
      await applyProductColorPalette("all");
      await humanDelay(300, 600);
    } catch (e) {
      log(`product-colors palette click failed — continuing: ${(e as Error).message}`);
    }

    // ── 7. Terms & Conditions checkbox (single flow only — bulk ticks it once
    //       at "Publish All", so per-design fills skip it). ──────────────────
    if (!skipPublish) {
      try {
        let terms: HTMLInputElement | null = null;
        try { terms = await firstMatching<HTMLInputElement>([...TP.termsCheckbox], 4_000); }
        catch {
          // Fallback: any checkbox that lives near "agree" / "Terms" text.
          const cbs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
          terms = cbs.find((cb) => /agree|terms|conditions/i.test((cb.closest("label, div, p")?.textContent ?? ""))) ?? null;
        }
        if (terms && !terms.checked) {
          const wrap = terms.closest("label");
          if (wrap) await fullClick(wrap as HTMLElement);
          else      await fullClick(terms);
          if (!terms.checked) terms.checked = true;
          terms.dispatchEvent(new Event("input",  { bubbles: true }));
          terms.dispatchEvent(new Event("change", { bubbles: true }));
          log("terms checked");
          await humanDelay(200, 500);
        } else if (!terms) {
          log("terms checkbox not found — Publish may be blocked");
        }
      } catch (e) {
        log(`terms checkbox handling failed: ${(e as Error).message}`);
      }
    }

    // ── 7.5. Pre-publish guard — any product still ENABLED but with an empty
    // primary color will make TeePublic reject Publish ("You must choose a
    // primary color for X"). Catch it here and fail with a clear reason
    // instead of clicking Publish and silently bouncing.
    const blocking = findBlockingEmptyColors();
    if (blocking.length > 0) {
      const err = `enabled products with no color (would block publish): ${blocking.join(", ")}`;
      log(`✗ aborting before publish — ${err}`);
      return { ok: false, error: err };
    }

    // Bulk in-place: the design is fully filled + colors set; the bulk loop will
    // click "Next Design"/"Publish All". Stop here without publishing this one.
    if (skipPublish) {
      log("bulk: design filled in place (no per-design publish)");
      return { ok: true };
    }

    // ── 8. Publish — success is detected by URL change to /t-shirt/<id>-<slug>
    const beforeUrl = location.href;
    const publish = await findClickable([...TP.publishButton]);
    publish.click();
    log(`publish clicked`);

    log("waiting for /t-shirt/... URL...");
    const urlChanged = await waitForUrlChangeAwayFromEdit(beforeUrl, 30_000);
    if (urlChanged) {
      const finalUrl = location.href;
      if (publishSuccessFiredFor.has(finalUrl)) {
        log(`publish success already fired for ${finalUrl} — debounced`);
      } else {
        publishSuccessFiredFor.add(finalUrl);
        if (publishSuccessFiredFor.size > 64) {
          publishSuccessFiredFor.clear();
          publishSuccessFiredFor.add(finalUrl);
        }
        log(`published: ${finalUrl}`);
      }
      // Resilient success signal — survives the navigation that's about to
      // destroy this content script's sendResponse callback.
      fireItemStatus(item.id, "succeeded", finalUrl);
      return { ok: true, publishedUrl: finalUrl };
    }

    // URL didn't change in time — check for a validation modal (TeePublic
    // refuses to publish if any required field is missing).
    const validation = await waitForValidationOrOutcome(1_000);
    if (validation.kind === "validation-modal") {
      await dismissValidationModal();
      const err = `publish blocked: ${validation.text.slice(0, 200)}`;
      fireItemStatus(item.id, "failed", undefined, err);
      return { ok: false, error: err };
    }
    const err = "publish did not transition to /t-shirt within 30s";
    fireItemStatus(item.id, "failed", undefined, err);
    return { ok: false, error: err };
  } catch (err) {
    if (err instanceof AlreadyPublishedError) {
      log(`detected published listing URL during upload — treating as succeeded: ${err.publishedUrl}`);
      fireItemStatus(item.id, "succeeded", err.publishedUrl);
      return { ok: true, publishedUrl: err.publishedUrl };
    }
    const msg = err instanceof Error ? err.message : String(err);
    fireItemStatus(item.id, "failed", undefined, msg);
    return { ok: false, error: msg };
  }
}

// ─── BULK upload — TeePublic's real flow (one /edit page per design) ────────
// After GET STARTED, TeePublic opens each design on its OWN /designs/<id>/edit
// page and auto-advances to the next after each publish (no "Next Design" or
// "Publish All" buttons). So the ENGINE drives the navigation: this content
// script only (a) dispatches files + GET STARTED on /designs/bulk_uploader, and
// (b) fills + publishes ONE draft /edit page at a time. Order is deterministic
// (upload order) — no image/phash matching.

/** On /designs/bulk_uploader: pre-validate sizes, dispatch the valid files, wait
 *  for GET STARTED, and return the valid item ids in upload order. The handler
 *  clicks GET STARTED after this responds (it navigates to design 1's /edit). */
async function runBulkDispatch(
  items: QueueItem[],
  imageDataUrls: string[],
): Promise<{ ok: boolean; error?: string; validIds: string[] }> {
  log(`──── BULK dispatch: ${items.length} design(s) on ${location.pathname} ────`);
  const valid: { item: QueueItem; dataUrl: string }[] = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    const dim = await imageDimensions(imageDataUrls[i]);
    if (dim && isBelowMinSize(dim)) {
      const err = `skipped ${it.metadata.filename}: ${dim.w}×${dim.h} below TeePublic minimum ${MIN_SHORT_SIDE}×${MIN_LONG_SIDE}`;
      log(err);
      fireItemStatus(it.id, "failed", undefined, err);
      continue;
    }
    valid.push({ item: it, dataUrl: imageDataUrls[i] });
  }
  if (valid.length === 0) {
    log(`bulk aborted: no designs passed TeePublic's size check`);
    return { ok: false, error: "no designs passed TeePublic's size check", validIds: [] };
  }

  try {
    const input = await firstMatching<HTMLInputElement>([...BULK.multiFileInput], 15_000);
    const files = valid.map((v, i) =>
      dataUrlToFile(v.dataUrl, v.item.metadata.filename || `design_${i + 1}.png`, v.item.imageMime || "image/png"));
    await setFileInputMultiple(input, files);
    log(`dispatched ${files.length} files — waiting for GET STARTED…`);

    // Wait for GET STARTED to appear (tiles finished processing). Don't click
    // yet — the handler clicks it after this response is sent.
    try {
      await findClickable([...BULK.getStarted], 60_000);
    } catch {
      const err = "no designs passed TeePublic's size check (GET STARTED never appeared)";
      log(`bulk aborted: ${err}`);
      for (const v of valid) fireItemStatus(v.item.id, "failed", undefined, err);
      return { ok: false, error: err, validIds: [] };
    }
    return { ok: true, validIds: valid.map((v) => v.item.id) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log(`✗ bulk dispatch failed: ${msg}`);
    for (const v of valid) fireItemStatus(v.item.id, "failed", undefined, msg);
    return { ok: false, error: msg, validIds: [] };
  }
}

/** Click GET STARTED (navigates to design 1's /designs/<id>/edit page). */
async function clickGetStarted(): Promise<void> {
  try {
    const btn = await findClickable([...BULK.getStarted], 10_000);
    await fullClick(btn);
    log(`clicked GET STARTED`);
  } catch (e) {
    log(`GET STARTED click failed: ${(e as Error).message}`);
  }
}

/** On a /designs/<id>/edit bulk page: fill listing + colors then publish (which
 *  auto-advances TeePublic to the next design's /edit page). Reuses runUpload's
 *  fill/colors/BLOCKING via skipUpload+skipPublish, then terms + publish. */
async function fillAndPublishDraft(item: QueueItem): Promise<{ ok: boolean; error?: string }> {
  lastFiredItemId = null; // per-design isolation (runUpload makes its own filled set)
  log(`── bulk design: ${item.metadata.filename} (${location.pathname}) ──`);

  // If TeePublic rejected this draft (no form), skip & cancel and move on.
  const state = await waitForDesignFormOrError(45_000);
  if (state === "rejected") {
    log(`bulk: TeePublic rejected this design — Skip & Cancel`);
    fireItemStatus(item.id, "failed", undefined, "rejected by TeePublic (size/format)");
    await clickFirst([...BULK.skipDesign]);
    return { ok: false, error: "rejected by TeePublic" };
  }

  let fill: { ok: boolean; error?: string };
  try {
    fill = await runUpload(item, "", true, true); // skipUpload + skipPublish → fill + colors only
  } catch (e) {
    fill = { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
  if (!fill.ok) {
    log(`bulk: ${item.metadata.filename} fill FAILED: ${fill.error} — Skip & Cancel`);
    fireItemStatus(item.id, "failed", undefined, fill.error);
    await clickFirst([...BULK.skipDesign]);
    return { ok: false, error: fill.error };
  }
  log(`bulk: ${item.metadata.filename} filled, colors ok`);

  await acceptBulkTerms();
  await sleep(300);
  // Mark succeeded BEFORE clicking publish — publishing navigates to the next
  // design's /edit page and destroys this content script.
  fireItemStatus(item.id, "succeeded");
  try {
    const publish = await findClickable([...TP.publishButton, ...BULK.publishAll], 15_000);
    await fullClick(publish);
    log(`bulk: published ${item.metadata.filename}`);
  } catch (e) {
    log(`bulk: publish click failed: ${(e as Error).message}`);
    return { ok: false, error: `publish click failed: ${(e as Error).message}` };
  }
  return { ok: true };
}

/** Tick the Terms & Conditions checkbox once before Publish All. */
async function acceptBulkTerms(): Promise<void> {
  try {
    let terms: HTMLInputElement | null = null;
    try { terms = await firstMatching<HTMLInputElement>([...TP.termsCheckbox], 4_000); }
    catch {
      const cbs = Array.from(document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'));
      terms = cbs.find((cb) => /agree|terms|conditions/i.test((cb.closest("label, div, p")?.textContent ?? ""))) ?? null;
    }
    if (terms && !terms.checked) {
      const wrap = terms.closest("label");
      if (wrap) await fullClick(wrap as HTMLElement); else await fullClick(terms);
      if (!terms.checked) terms.checked = true;
      terms.dispatchEvent(new Event("input", { bubbles: true }));
      terms.dispatchEvent(new Event("change", { bubbles: true }));
      log("terms & conditions checked (bulk)");
    }
  } catch (e) { log(`bulk terms handling failed: ${(e as Error).message}`); }
}

/** Click the first matching control if present; returns whether it clicked. */
async function clickFirst(candidates: string[]): Promise<boolean> {
  try { await fullClick(await findClickable(candidates, 4_000)); return true; } catch { return false; }
}

// ─── BULK Phase 1: upload ONLY (no listing, no publish) ─────────────────────
// Dispatch one design's file, wait for processing to finish, and report the
// draft's edit URL + id so Phase 2 can navigate straight back to it (matched by
// filename — never by image).
async function runUploadOnly(
  item: QueueItem,
  imageDataUrl: string,
): Promise<{ ok: boolean; editUrl?: string; designId?: string; error?: string }> {
  try {
    if (isPublishedListingUrl(location.href)) {
      return { ok: false, error: "on a published listing page, not the uploader" };
    }
    const m = item.metadata;
    log(`upload-only: ${m.filename}`);
    const file = dataUrlToFile(imageDataUrl, m.filename || "design.png", item.imageMime || "image/png");
    const fileInput = await firstMatching<HTMLInputElement>([...TP.fileInput]);
    await setFileInput(fileInput, file);
    log("dispatched 1 file — waiting for processing…");
    await waitForFormReady();
    await waitForArtworkProcessingDone();

    const designId = (location.href.match(/\/designs\/(\d+)\/edit/) || [])[1] || readDesignIdFromDom();
    const editUrl = designId ? `https://www.teepublic.com/designs/${designId}/edit` : location.href;
    log(`upload-only done: ${m.filename} → draft ${designId ?? "(id?)"} (${editUrl})`);
    return { ok: true, editUrl, designId: designId ?? undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Best-effort read of the current design's numeric id from the DOM, for when
 *  the URL hasn't turned into /designs/<id>/edit yet. */
function readDesignIdFromDom(): string | null {
  const a = document.querySelector<HTMLAnchorElement>('a[href*="/designs/"][href*="/edit"]');
  const am = a?.href.match(/\/designs\/(\d+)\/edit/);
  if (am) return am[1];
  for (const inp of document.querySelectorAll<HTMLInputElement>('input[name*="design" i][name*="id" i], input[name="id"]')) {
    if (/^\d+$/.test(inp.value)) return inp.value;
  }
  const formAction = document.querySelector<HTMLFormElement>('form[action*="/designs/"]')?.action ?? "";
  const fm = formAction.match(/\/designs\/(\d+)/);
  return fm ? fm[1] : null;
}

// After dispatching the design file, watch for TeePublic to either accept the
// artwork ("Change Artwork" appears) or reject it ("UPLOAD FAILED, PLEASE TRY
// AGAIN"). Returns "timeout" if neither shows (the form may have rendered).
async function waitForUploadOutcome(timeoutMs: number): Promise<"ok" | "failed" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pageShowsText(/upload failed/i)) return "failed";
    if (pageShowsText(/change artwork/i)) return "ok";
    await sleep(400);
  }
  return "timeout";
}

/** True if a small, visible element on the page contains text matching `rx`. */
function pageShowsText(rx: RegExp): boolean {
  for (const el of document.querySelectorAll<HTMLElement>("button, a, p, span, div, h1, h2, h3, label")) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const t = (el.textContent ?? "").trim();
    if (t.length === 0 || t.length > 80) continue;
    if (rx.test(t)) return true;
  }
  return false;
}

// TeePublic rejects artwork below this; pre-checking avoids the failed-upload
// cascade. Orientation-agnostic so a valid landscape design isn't false-skipped.
const MIN_SHORT_SIDE = 1500;
const MIN_LONG_SIDE = 1995;

/** Read an image's pixel dimensions from a data/URL. Null if it can't load. */
function imageDimensions(src: string): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

function isBelowMinSize(d: { w: number; h: number }): boolean {
  return Math.min(d.w, d.h) < MIN_SHORT_SIDE || Math.max(d.w, d.h) < MIN_LONG_SIDE;
}

/** Wait for the current design's edit form to be ready, OR detect that
 *  TeePublic rejected the artwork ("UPLOAD FAILED"). Bounded so a rejected
 *  design never loops "form not ready" forever. */
async function waitForDesignFormOrError(timeoutMs: number): Promise<"ready" | "rejected" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (isPublishedListingUrl(location.href)) return "ready";
    const body = (document.body.textContent ?? "").toLowerCase();
    if (/upload failed/i.test(body) && !body.includes("change artwork")) return "rejected";
    const titleInput = document.querySelector<HTMLInputElement>(
      'input[name="design[design_title]"], input[name="title"], input[placeholder="Title"], input[placeholder*="title" i]'
    );
    if (body.includes("change artwork") && titleInput) return "ready";
    await sleep(400);
  }
  return "timeout";
}

// Watches for either TeePublic's "you must choose…" validation modal or the
// normal success/error indicators. Returns "validation-modal" when the modal
// appears, "outcome" otherwise (caller proceeds to await the real outcome).
async function waitForValidationOrOutcome(timeoutMs: number): Promise<{ kind: "validation-modal"; text: string } | { kind: "outcome" }> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    // Validation modals contain the phrase "you must choose a color" or
    // "you must choose at least".
    for (const el of document.querySelectorAll<HTMLElement>("body *")) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const text = (el.textContent ?? "").toLowerCase();
      if (text.length < 30 || text.length > 2000) continue;
      if (/you must choose (a |at least one )/i.test(text)) {
        return { kind: "validation-modal", text: el.textContent ?? "" };
      }
    }
    // Quick check for success/error too — if either appears, bail and let the
    // caller wait properly.
    if (document.querySelector(TP.successIndicator.join(", ")) ||
        document.querySelector(TP.errorIndicator.join(", "))) {
      return { kind: "outcome" };
    }
    await sleep(300);
  }
  return { kind: "outcome" };
}

interface TableReadiness {
  ready: boolean;
  ddSelectCount: number;
  placeholderCount: number;
  hasHeader: boolean;
}

/** True when the product-table portion of the upload form has rendered.
 *  Signal #1 (strongest): any dd-select wrapper still on the "Select
 *  Default Color" placeholder — that proves the color rows are mounted.
 *  Signal #2: a leaf element with exact text "Default Color" exists,
 *  catching the case where every wrapper happens to be pre-filled.
 *  Either signal alone is enough; we only require ≥1 dd-select on the
 *  whole page (otherwise the upload section isn't mounted at all). */
function checkTableReady(): TableReadiness {
  const wrappers = Array.from(document.querySelectorAll<HTMLElement>("div.dd-select"));
  if (wrappers.length === 0) {
    return { ready: false, ddSelectCount: 0, placeholderCount: 0, hasHeader: false };
  }
  const placeholders = wrappers.filter((w) => {
    const v = w.querySelector<HTMLInputElement>("input.dd-selected-value")?.value || "";
    return /select default color/i.test(v);
  });
  const hasHeader = Array.from(document.querySelectorAll<HTMLElement>("*")).some((el) => {
    if (el.children.length !== 0) return false;
    const t = (el.textContent || "").trim();
    return /^default color$/i.test(t);
  });
  const ready = placeholders.length > 0 || hasHeader;
  return { ready, ddSelectCount: wrappers.length, placeholderCount: placeholders.length, hasHeader };
}

/** Sentinel error: the URL changed to a published listing while we were
 *  waiting for the upload form. runUpload catches this and converts it to a
 *  success result. */
class AlreadyPublishedError extends Error {
  publishedUrl: string;
  constructor(url: string) { super(`already published: ${url}`); this.publishedUrl = url; }
}

/** Poll for the upload form to be ready. Throws AlreadyPublishedError if the
 *  URL changes to /t-shirt/<slug> (publish completed). Throws a generic
 *  error after 60s if the table never appears. */
async function waitForArtworkProcessingDone(timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  let lastLogAt = 0;
  while (Date.now() - start < timeoutMs) {
    // If the page is already published (URL turned into a listing), stop
    // waiting and let runUpload report success.
    if (isPublishedListingUrl(location.href)) {
      throw new AlreadyPublishedError(location.href);
    }
    const body = (document.body.textContent ?? "").toLowerCase();
    const processing = /processing\.{0,3}|checking artwork/i.test(body);
    const r = checkTableReady();
    if (!processing && r.ready) {
      log(`artwork processing done (took ${((Date.now() - start) / 1000).toFixed(1)}s) — ${r.ddSelectCount} dd-select(s), ${r.placeholderCount} placeholder(s), header=${r.hasHeader}`);
      return;
    }
    if (Date.now() - lastLogAt > 3_000) {
      log(`waiting for artwork processing… processing=${processing} tableReady=${r.ready} (dd-select count=${r.ddSelectCount}, placeholders=${r.placeholderCount}, header=${r.hasHeader})`);
      lastLogAt = Date.now();
    }
    await sleep(400);
  }
  throw new Error(`product table never appeared after 60s — page structure may have changed (dd-select count=${checkTableReady().ddSelectCount})`);
}

/** Poll location.href until it changes off /designs/<id>/edit. */
async function waitForUrlChangeAwayFromEdit(originalUrl: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const cur = location.href;
    if (cur !== originalUrl && !/\/designs\/\d+\/edit/.test(cur)) return true;
    // Also accept the /t-shirt/<slug> success URL pattern explicitly.
    if (/\/t-shirt\//.test(cur) || /\/(stickers?|hoodies?|tank-tops?|mugs?|phone-cases?)\//.test(cur)) return true;
    await sleep(400);
  }
  return false;
}

async function dismissValidationModal(): Promise<void> {
  // Find the OK button. TeePublic's validation modals show a single primary
  // button (often non-English text like "حسناً"). Click any visible button
  // inside the modal-shaped overlay.
  const buttons = Array.from(document.querySelectorAll<HTMLElement>('button, [role="button"]'));
  for (const btn of buttons) {
    const r = btn.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // Inside a modal-like positioned ancestor?
    const ancestorIsModal = !!btn.closest('[class*="modal" i], [class*="dialog" i], [role="dialog"], [role="alertdialog"]');
    if (!ancestorIsModal) continue;
    btn.click();
    await sleep(200);
    return;
  }
  // Fallback: press Escape on the document.
  document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  await sleep(200);
}

// Wait until the design is 100% loaded.
//
// Two-tier wait:
//   HARD (must satisfy, blocks up to 60s) — design preview rendered + the
//     visible form is interactable: Change Artwork button, Main Tag label,
//     Supporting Tags label, ≥ 2 textareas.
//   SOFT (preferred, capped at 20s extra) — Item table + Configure Other
//     Products visible. If they never appear in time we proceed anyway and
//     the colors step will skip whatever isn't ready.
//
// We deliberately DO NOT block on the persistent Upload Progress overlay —
// some of TeePublic's progress widgets stay on screen indefinitely.
async function waitForFormReady(): Promise<void> {
  // Minimum gate: the design is loaded (Change Artwork visible) AND we can
  // find an input that looks like the Title field. Everything else is
  // handled by the individual field finders, which have their own waits.
  //
  // The old logic required ≥ 2 textareas + Main Tag + Supporting Tags labels,
  // which blocked when the page only had 1 textarea visible at a time (some
  // fields mount lazily as you scroll). Result: upload would hang past the
  // listing-fill step and the item stayed in "RUNNING" forever.
  const start = Date.now();
  const MAX_WAIT = 45_000;
  let lastReport = 0;

  while (Date.now() - start < MAX_WAIT) {
    // If the URL flipped to a published listing during the wait, the design
    // was already published — exit cleanly.
    if (isPublishedListingUrl(location.href)) {
      throw new AlreadyPublishedError(location.href);
    }

    const bodyText = (document.body.textContent ?? "").toLowerCase();
    const hasChangeArtwork = bodyText.includes("change artwork");
    const titleInput = document.querySelector<HTMLInputElement>(
      'input[name="design[design_title]"], input[name="title"], input[placeholder="Title"], input[placeholder*="title" i]'
    );
    const ready = hasChangeArtwork && titleInput !== null;

    if (ready) {
      log(`form ready after ${((Date.now() - start) / 1000).toFixed(1)}s — Change Artwork visible, Title input mounted`);
      await sleep(400);
      return;
    }

    if (Date.now() - lastReport > 3000) {
      const blocking: string[] = [];
      if (!hasChangeArtwork) blocking.push("Change Artwork");
      if (!titleInput)       blocking.push("Title input");
      log(`form not ready — blocking on: ${blocking.join(", ")}`);
      lastReport = Date.now();
    }
    await sleep(400);
  }
  log(`form readiness exceeded ${MAX_WAIT / 1000}s — proceeding anyway`);
}

// Scroll a label-text node into the viewport so any virtualized/lazy-mounted
// fields below it actually render. No-op if the label isn't found yet.
function scrollLabelIntoView(labelText: string): void {
  const wanted = labelText.toLowerCase();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => (n.textContent?.toLowerCase().includes(wanted) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP),
  });
  const node = walker.nextNode();
  if (node?.parentElement) node.parentElement.scrollIntoView({ block: "center", behavior: "instant" as ScrollBehavior });
}

// Type into a field and verify the value committed. Retry with more delay
// if React rejected the synthetic input on the first pass.
async function typeAndVerify(
  el: HTMLInputElement | HTMLTextAreaElement,
  value: string,
  fieldName: string
): Promise<void> {
  await typeInto(el, value, { clear: true, humanLike: true });
  await sleep(200);
  if (el.value && el.value.trim().length > 0) {
    log(`${fieldName} filled: "${el.value.slice(0, 50)}${el.value.length > 50 ? "…" : ""}"`);
    return;
  }
  log(`${fieldName} value empty after first try — retrying slower`);
  await sleep(500);
  await typeInto(el, value, { clear: true, humanLike: false });
  el.dispatchEvent(new Event("input",  { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(300);
  log(`${fieldName} after retry: "${el.value.slice(0, 50)}${el.value.length > 50 ? "…" : ""}" ${el.value ? "✓" : "✗"}`);
}

// Try multiple section labels — TeePublic phrases the question different ways.
async function findMatureRadio(want: "Yes" | "No"): Promise<HTMLInputElement> {
  const sections = ["Mature Content", "mature content", "adult themes", "adult content"];
  for (const section of sections) {
    try { return await findRadioByLabel(section, want, 2_000); } catch { /* try next */ }
  }
  throw new Error(`mature "${want}" radio not found in any expected section`);
}

function dataUrlToFile(dataUrl: string, filename: string, fallbackMime: string): File {
  const [meta, b64] = dataUrl.split(",", 2);
  const mime = /data:([^;]+);base64/.exec(meta)?.[1] ?? fallbackMime;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], filename, { type: mime });
}

async function findClickable(candidates: string[], timeoutMs = 8_000): Promise<HTMLElement> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const sel of candidates) {
      const m = sel.match(/^([a-zA-Z*]+):contains\("(.+?)"\)$/);
      if (m) {
        const [, tag, text] = m;
        const hit = findByVisibleText(tag, text);
        if (hit) return hit;
      } else {
        const el = document.querySelector<HTMLElement>(sel);
        if (el) return el;
      }
    }
    await sleep(150);
  }
  throw new Error(`no clickable matched: ${candidates.join(" | ")}`);
}

/** Find a clickable element by its visible text. Tolerant: searches common
 *  clickable tags (not just the named one), matches the element's own text
 *  (exact, then "contains" for short labels) or an <input>'s value, and
 *  returns the nearest button-like ancestor so we click the control, not a
 *  text node inside it. */
function findByVisibleText(tag: string, text: string): HTMLElement | null {
  const want = text.trim().toLowerCase();
  const scope = tag === "*" || tag === "button" || tag === "a"
    ? "button, a, [role='button'], input[type='submit'], input[type='button'], div, span, label"
    : tag;
  const els = Array.from(document.querySelectorAll<HTMLElement>(scope))
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });

  const textOf = (e: HTMLElement) =>
    (e instanceof HTMLInputElement ? e.value : (e.textContent ?? "")).trim().toLowerCase();

  // 1. exact label
  let hit = els.find((e) => textOf(e) === want);
  // 2. short element that contains the label (avoids matching big wrappers)
  if (!hit) hit = els.find((e) => { const t = textOf(e); return t.includes(want) && t.length <= want.length + 16; });
  if (!hit) return null;
  return clickableAncestor(hit);
}

/** Walk up to the nearest button/link/role=button, else return the element. */
function clickableAncestor(el: HTMLElement): HTMLElement {
  let cur: HTMLElement | null = el;
  for (let i = 0; cur && i < 5; i++, cur = cur.parentElement) {
    const tag = cur.tagName.toLowerCase();
    if (tag === "button" || tag === "a" || cur.getAttribute("role") === "button" ||
        (tag === "input" && /submit|button/i.test((cur as HTMLInputElement).type))) {
      return cur;
    }
  }
  return el;
}

function log(msg: string) {
  console.info("[teepublic-cs]", msg);
  BulkLogStore.append(msg);
}
