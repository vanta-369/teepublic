import type { QueueBatch, QueueItem } from "@teepublic/shared";
import { QueueStore, ThumbStore, getDisplayImages } from "../services/queueStore";
import { buildBatchExportChunks, applyBatchImport } from "../services/batchTransfer";

function $(id: string) { return document.getElementById(id) as HTMLElement; }

/** ids currently laid out in the DOM, in order. Any storage write re-renders,
 *  and a full innerHTML rebuild would drop every <img> and re-read every
 *  thumbnail from chrome.storage — which is what made the whole grid flash and
 *  shuffle each time one card was selected. So: rebuild only when the SET of
 *  items changes; otherwise patch the cards in place. */
let renderedIds: string[] = [];
/** Previews already pulled out of storage — a rebuild reuses these instead of
 *  hitting storage again for every card. These are the small ThumbStore copies
 *  (~30 KB each), not the print-resolution originals, so holding one per design
 *  costs a few MB instead of a few GB. */
const thumbCache = new Map<string, string>();

/** Cards rendered per page. The grid used to hold EVERY design at once: each
 *  <img> pointed at the full 4500x5400 artwork, which Chrome decodes to
 *  width * height * 4 bytes (~97 MB) regardless of the 240px tile it's painted
 *  into. Sixty designs was multiple GB of bitmap and froze the tab. Previews
 *  fixed the per-image cost; paging bounds the total. */
const PAGE_SIZE = 24;
let currentPage = 0; // 0-based
let lastBatch: QueueBatch | null = null;

function sameIds(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

function render(batch: QueueBatch | null) {
  lastBatch = batch;
  const list = $("list");
  const empty = $("empty");

  if (!batch || batch.items.length === 0) {
    list.innerHTML = "";
    renderedIds = [];
    empty.style.display = "block";
    setStats(0, 0, 0, 0, 0);
    setMeta("");
    renderPager(0, 1, 0, 0);
    return;
  }
  empty.style.display = "none";

  const total  = batch.items.length;
  const picked = batch.items.filter((i) => i.selected !== false).length;
  const done   = batch.items.filter((i) => i.status === "succeeded").length;
  const fail   = batch.items.filter((i) => i.status === "failed").length;
  const left   = picked - done - fail;
  setStats(total, picked, done, fail, Math.max(0, left));
  ($("progress") as HTMLElement).style.width = `${picked > 0 ? Math.round(((done + fail) / picked) * 100) : 0}%`;
  setMeta(`Source: ${escapeHtml(batch.source.spreadsheetName)} • ${total} items • ${picked} selected • batch ${batch.id}`);

  // Stats above stay whole-batch; only this slice is ever put in the DOM.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(Math.max(0, currentPage), pageCount - 1);
  const start = currentPage * PAGE_SIZE;
  const pageItems = batch.items.slice(start, start + PAGE_SIZE);

  const ids = pageItems.map((i) => i.id);
  if (sameIds(ids, renderedIds)) {
    // Same designs, same order — only their state can have changed. Patch each
    // card; the <img> elements are never touched, so nothing flickers.
    for (const item of pageItems) {
      const card = list.querySelector<HTMLElement>(`[data-toggle-id="${CSS.escape(item.id)}"]`);
      if (card) patchCard(card, item);
    }
    renderPager(total, pageCount, start, pageItems.length);
    return;
  }

  list.innerHTML = pageItems.map(cardHtml).join("");
  renderedIds = ids;
  void loadThumbnails(list);
  list.querySelectorAll<HTMLAnchorElement>("[data-published]").forEach((a) => { a.target = "_blank"; a.rel = "noreferrer"; });
  renderPager(total, pageCount, start, pageItems.length);
}

function renderPager(total: number, pageCount: number, start: number, shown: number): void {
  const pager = $("pager");
  if (total <= PAGE_SIZE) { pager.innerHTML = ""; pager.style.display = "none"; return; }
  pager.style.display = "flex";
  pager.innerHTML = `
    <button id="pg-prev" class="ghost-sm" ${currentPage === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="muted">${start + 1}–${start + shown} of ${total} · page ${currentPage + 1}/${pageCount}</span>
    <button id="pg-next" class="ghost-sm" ${currentPage >= pageCount - 1 ? "disabled" : ""}>Next ›</button>`;
  ($("pg-prev") as HTMLButtonElement).onclick = () => { currentPage--; render(lastBatch); };
  ($("pg-next") as HTMLButtonElement).onclick = () => { currentPage++; render(lastBatch); };
}

function cardHtml(item: QueueItem): string {
  const selected = item.selected !== false;
  // The cached local preview, or nothing until loadThumbnails reads it out of
  // ImageStore. item.imageUrl is not a fallback: artwork is never fetched.
  const src = thumbCache.get(item.id);
  return `
    <div class="card ${selected ? "" : "deselected"}" data-toggle-id="${item.id}">
      <div class="thumb">
        <img ${src ? `src="${escapeHtml(src)}"` : ""} data-img-id="${escapeHtml(item.id)}" alt="${escapeHtml(item.metadata.title)}" />
        <div class="select-mark">${selected ? "✓" : ""}</div>
      </div>
      <div class="row">
        <h3>${escapeHtml(item.metadata.title)}</h3>
        <span class="chip chip-${item.status}" data-status>${item.status}</span>
      </div>
      <div class="meta" data-meta>${escapeHtml(item.metadata.filename)} • try ${item.attempts}</div>
      <div>${item.metadata.tags.slice(0, 4).map((t) => `<span class="chip chip-pending">${escapeHtml(t)}</span>`).join(" ")}</div>
      <div class="err" data-err ${item.lastError ? "" : "hidden"}>${escapeHtml(item.lastError ?? "")}</div>
      <div class="actions" data-actions>${actionsHtml(item)}</div>
    </div>
  `;
}

function actionsHtml(item: QueueItem): string {
  const retry = item.status === "failed" || item.status === "queued"
    ? `<button data-retry="${item.id}">Retry</button>`
    : "";
  const published = item.publishedUrl
    ? `<a class="chip chip-succeeded" href="${escapeHtml(item.publishedUrl)}" data-published target="_blank" rel="noreferrer">View ↗</a>`
    : "";
  return retry + published;
}

/** Update one already-rendered card in place — status, error, attempts,
 *  selection. Writes only what actually differs so the DOM stays still. */
function patchCard(card: HTMLElement, item: QueueItem): void {
  const selected = item.selected !== false;
  card.classList.toggle("deselected", !selected);
  const mark = card.querySelector<HTMLElement>(".select-mark");
  if (mark) { const want = selected ? "✓" : ""; if (mark.textContent !== want) mark.textContent = want; }

  const status = card.querySelector<HTMLElement>("[data-status]");
  if (status && status.textContent !== item.status) {
    status.textContent = item.status;
    status.className = `chip chip-${item.status}`;
  }

  const meta = card.querySelector<HTMLElement>("[data-meta]");
  const metaText = `${item.metadata.filename} • try ${item.attempts}`;
  if (meta && meta.textContent !== metaText) meta.textContent = metaText;

  const err = card.querySelector<HTMLElement>("[data-err]");
  if (err) {
    if (err.textContent !== (item.lastError ?? "")) err.textContent = item.lastError ?? "";
    err.toggleAttribute("hidden", !item.lastError);
  }

  const actions = card.querySelector<HTMLElement>("[data-actions]");
  const html = actionsHtml(item);
  if (actions && actions.innerHTML !== html) actions.innerHTML = html;
}

/** Fill in the grid previews for the cards currently on screen.
 *  ONE batched storage read for the whole page — this used to await a separate
 *  chrome.storage read per card, so each tile cost its own IPC round trip
 *  carrying a multi-MB string, serially. */
async function loadThumbnails(list: HTMLElement): Promise<void> {
  const imgs = Array.from(list.querySelectorAll<HTMLImageElement>("img[data-img-id]"))
    .filter((img) => !!img.dataset.imgId && !img.getAttribute("src"));
  if (imgs.length === 0) return;

  const wanted = imgs.map((img) => img.dataset.imgId!).filter((id) => !thumbCache.has(id));
  if (wanted.length > 0) {
    for (const [id, dataUrl] of await getDisplayImages(wanted)) thumbCache.set(id, dataUrl);
  }
  for (const img of imgs) {
    const dataUrl = thumbCache.get(img.dataset.imgId!);
    if (dataUrl) img.src = dataUrl;
  }
}

/** One set of listeners on the container, so patching cards never loses them. */
function wireList(list: HTMLElement): void {
  list.addEventListener("click", (e) => {
    const target = e.target as HTMLElement;
    const retry = target.closest<HTMLButtonElement>("[data-retry]");
    if (retry) {
      e.stopPropagation();
      chrome.runtime.sendMessage({ type: "ITEM_RETRY", itemId: retry.dataset.retry });
      return;
    }
    if (target.closest("a")) return; // "View ↗" opens the listing
    const card = target.closest<HTMLElement>("[data-toggle-id]");
    const id = card?.dataset.toggleId;
    if (!card || !id) return;
    // Flip the card NOW — the storage round-trip patches it a moment later, and
    // waiting for that made the click feel like the whole list reloaded.
    const nowSelected = card.classList.contains("deselected");
    card.classList.toggle("deselected", !nowSelected);
    const mark = card.querySelector<HTMLElement>(".select-mark");
    if (mark) mark.textContent = nowSelected ? "✓" : "";
    chrome.runtime.sendMessage({ type: "ITEM_TOGGLE_SELECTED", itemId: id });
  });
}

function setStats(total: number, picked: number, done: number, fail: number, left: number) {
  $("s-total").textContent  = String(total);
  $("s-picked").textContent = String(picked);
  $("s-done").textContent   = String(done);
  $("s-fail").textContent   = String(fail);
  $("s-left").textContent   = String(left);
}
function setMeta(text: string) { $("meta").textContent = text; }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

async function init() {
  wireList($("list"));
  render(await QueueStore.get());
  QueueStore.installCrossPageListener(render);

  // Previews arrive one-by-one (the worker derives one per QUEUE_IMAGE) after the
  // batch renders. Fill each one in the moment it lands so the grid never shows
  // empty tiles until a manual page refresh. Watching the PREVIEW key rather than
  // the image key matters: storage change events carry the whole value, so this
  // used to push every full-resolution design into the tab as it streamed in.
  ThumbStore.installChangeListener((id, dataUrl) => {
    if (!dataUrl) return;
    thumbCache.set(id, dataUrl);
    const img = document.querySelector<HTMLImageElement>(`img[data-img-id="${CSS.escape(id)}"]`);
    if (img && !img.getAttribute("src")) img.src = dataUrl;
  });

  $("btn-start").onclick   = startUpload;
  $("btn-pause").onclick   = () => chrome.runtime.sendMessage({ type: "ENGINE_PAUSE" });
  $("btn-all").onclick     = () => chrome.runtime.sendMessage({ type: "ITEMS_SELECT_ALL", value: true });
  $("btn-none").onclick    = () => chrome.runtime.sendMessage({ type: "ITEMS_SELECT_ALL", value: false });
  $("btn-clear").onclick   = async () => {
    if (confirm("Clear the queue? Any pending uploads will be discarded.")) {
      await chrome.runtime.sendMessage({ type: "QUEUE_CLEAR" });
    }
  };

  $("btn-export").onclick = exportBatch;
  $("btn-import").onclick = () => ($("file-import") as HTMLInputElement).click();
  ($("file-import") as HTMLInputElement).onchange = importBatch;
}

/** Start the engine — but SURFACE why it didn't start. Previously the click just
 *  fire-and-forgot ENGINE_START, so an access denial or an empty selection looked
 *  like "nothing happens". */
async function startUpload(): Promise<void> {
  const batch = await QueueStore.get();
  // Selected "failed" items count as eligible: pressing Start re-queues them for
  // retry (the engine calls requeueSelectedFailed() before the run begins).
  const eligible = (batch?.items ?? []).filter(
    (i) =>
      (i.status === "pending" || i.status === "queued" || i.status === "failed") &&
      i.selected !== false,
  );
  if (eligible.length === 0) {
    alert("Nothing to upload: no designs are selected.\n\nSelect some designs (or failed ones to retry), then press Start.");
    return;
  }
  const res = (await chrome.runtime.sendMessage({ type: "ENGINE_START" })) as
    | { ok?: boolean; error?: string; status?: string }
    | undefined;
  if (res && res.ok === false) {
    alert(
      `Couldn't start uploading:\n\n${res.error ?? "unknown error"}\n\n` +
        "If this mentions access, open the extension's side panel and confirm you're " +
        "signed in with an active plan. If it started before and got stuck, reload the " +
        "extension at chrome://extensions and try again.",
    );
  }
}

/** Save the batch (listings + colors + images) to JSON files the user can carry
 *  to another Chrome profile — CHUNKED at 30 designs per file so a single string
 *  never exceeds JavaScript's ~512 MB limit ("Invalid string length"). */
async function exportBatch(): Promise<void> {
  const btn = $("btn-export") as HTMLButtonElement;
  const label = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Exporting…";
  try {
    const chunks = await buildBatchExportChunks();
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    for (const chunk of chunks) {
      const blob = new Blob([JSON.stringify(chunk)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `teepublic-batch-part${chunk.part}of${chunk.totalParts}-${chunk.batch.items.length}designs-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      await new Promise((r) => setTimeout(r, 400)); // let each download start
    }
    if (chunks.length > 1) {
      alert(`Exported ${chunks.length} files (30 designs each). Import ALL of them on the other profile — they merge into one queue.`);
    }
  } catch (e) {
    alert(e instanceof Error ? e.message : "Export failed.");
  } finally {
    btn.disabled = false;
    btn.textContent = label;
  }
}

/** Load one or more exported chunk files into this profile's queue. Files MERGE
 *  (dedup by id), so selecting all parts at once — or importing them one by one —
 *  rebuilds the whole batch. Use "Clear queue" first to start fresh. */
async function importBatch(ev: Event): Promise<void> {
  const input = ev.target as HTMLInputElement;
  const files = Array.from(input.files ?? []);
  input.value = ""; // allow re-importing the same files later
  if (files.length === 0) return;

  let totalItems = 0;
  let totalImages = 0;
  const errors: string[] = [];
  // Sort by "partNof M" in the filename so chunks import in order.
  files.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  for (const file of files) {
    try {
      const data = JSON.parse(await file.text());
      const { items, images } = await applyBatchImport(data);
      totalItems += items;
      totalImages += images;
    } catch (e) {
      errors.push(`${file.name}: ${e instanceof Error ? e.message : "failed"}`);
    }
  }
  render(await QueueStore.get());
  const summary = `Imported ${totalItems} design(s) (${totalImages} image(s)) from ${files.length} file(s).`;
  alert(errors.length ? `${summary}\n\nSkipped:\n${errors.join("\n")}` : `${summary} Review your selection, then press Start.`);
}

init();
