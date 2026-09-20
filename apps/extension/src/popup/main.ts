import type { QueueBatch, QueueItem } from "@teepublic/shared";
import { QueueStore, SettingsStore, BulkLogStore, getDisplayImages, type UploadMode } from "../services/queueStore";
import { fetchAccess } from "../lib/access";
import { signIn, signOut } from "../lib/supabaseClient";
import { SUPABASE_CONFIGURED } from "../lib/config";

function $(id: string) { return document.getElementById(id) as HTMLElement; }

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function tileHtml(item: QueueItem): string {
  const selected = item.selected !== false;
  // Image lives in ImageStore (its own key), not item.imageUrl — loadThumbnails
  // fills it in after render. There is deliberately no src fallback to
  // item.imageUrl: the only artwork this extension shows is the copy on this
  // device, never something the browser goes and fetches.
  const srcAttr = `data-img-id="${escapeHtml(item.id)}"`;
  return `
    <div class="tile ${selected ? "selected" : ""}" data-id="${item.id}" title="${escapeHtml(item.metadata.title)}">
      <img ${srcAttr} alt="${escapeHtml(item.metadata.title)}" onerror="this.style.opacity=0.2" />
      <div class="check">${selected ? "✓" : ""}</div>
      <div class="status ${item.status}">${item.status}</div>
    </div>
  `;
}

/** Previews already read out of storage. render() rebuilds the grid on EVERY
 *  queue change, and without this each rebuild re-read and re-decoded every
 *  visible image — during a run that is once per item status change. */
const thumbCache = new Map<string, string>();

/** Fill in tile previews (images aren't kept in the batch). One batched storage
 *  read per page, not one round trip per tile. */
async function loadThumbnails(grid: HTMLElement): Promise<void> {
  const imgs = Array.from(grid.querySelectorAll<HTMLImageElement>("img[data-img-id]"))
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

let lastBatch: QueueBatch | null = null;

const PAGE_SIZE = 12;
let currentPage = 0; // 0-based

function render(batch: QueueBatch | null) {
  lastBatch = batch;
  const total = batch?.items.length ?? 0;
  const picked = batch?.items.filter((i) => i.selected !== false).length ?? 0;
  const done = batch?.items.filter((i) => i.status === "succeeded").length ?? 0;
  const fail = batch?.items.filter((i) => i.status === "failed").length ?? 0;
  $("s-total").textContent  = String(total);
  $("s-picked").textContent = String(picked);
  $("s-done").textContent   = String(done);
  $("s-fail").textContent   = String(fail);
  ($("empty") as HTMLElement).style.display = batch ? "none" : "block";

  // Paginate: show PAGE_SIZE tiles per page. Stats above stay whole-batch.
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (currentPage > pageCount - 1) currentPage = pageCount - 1;
  if (currentPage < 0) currentPage = 0;
  const start = currentPage * PAGE_SIZE;
  const pageItems = batch ? batch.items.slice(start, start + PAGE_SIZE) : [];

  const grid = $("grid");
  grid.innerHTML = pageItems.map(tileHtml).join("");
  void loadThumbnails(grid);
  $("picked-summary").textContent = batch ? `${picked} of ${total} selected for upload` : "";

  // Toggle button label flips based on current state.
  const allSelected = total > 0 && picked === total;
  $("btn-toggle-all").textContent = allSelected ? "Deselect all" : "Select all";

  renderPager(total, pageCount, start, pageItems.length);
  wireTiles(grid);
}

function renderPager(total: number, pageCount: number, start: number, shown: number): void {
  const pager = $("pager");
  if (total <= PAGE_SIZE) { pager.innerHTML = ""; pager.style.display = "none"; return; }
  pager.style.display = "flex";
  const from = total === 0 ? 0 : start + 1;
  const to = start + shown;
  pager.innerHTML = `
    <button id="pg-prev" class="small" ${currentPage === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="muted-sm">${from}–${to} of ${total} · page ${currentPage + 1}/${pageCount}</span>
    <button id="pg-next" class="small" ${currentPage >= pageCount - 1 ? "disabled" : ""}>Next ›</button>
  `;
  ($("pg-prev") as HTMLButtonElement).onclick = () => { currentPage--; render(lastBatch); };
  ($("pg-next") as HTMLButtonElement).onclick = () => { currentPage++; render(lastBatch); };
}

function wireTiles(grid: HTMLElement) {
  grid.querySelectorAll<HTMLElement>(".tile").forEach((tile) => {
    tile.addEventListener("click", async (e) => {
      e.preventDefault();
      e.stopPropagation();
      const id = tile.dataset.id;
      if (!id) return;
      const wasSelected = tile.classList.contains("selected");
      tile.classList.toggle("selected", !wasSelected);
      const check = tile.querySelector<HTMLElement>(".check");
      if (check) check.textContent = !wasSelected ? "✓" : "";
      bumpPicked(!wasSelected ? +1 : -1);
      try {
        await chrome.runtime.sendMessage({ type: "ITEM_TOGGLE_SELECTED", itemId: id });
        setTimeout(async () => render(await QueueStore.get()), 250);
      } catch (err) {
        console.error("[popup] toggle failed:", err);
        tile.classList.toggle("selected", wasSelected);
        if (check) check.textContent = wasSelected ? "✓" : "";
        bumpPicked(wasSelected ? +1 : -1);
      }
    });
  });
}

function bumpPicked(delta: number): void {
  const el = $("s-picked");
  const n = parseInt(el.textContent || "0", 10) + delta;
  el.textContent = String(Math.max(0, n));
  const total = parseInt($("s-total").textContent || "0", 10);
  $("picked-summary").textContent = `${Math.max(0, n)} of ${total} selected for upload`;
  const allSelected = total > 0 && n === total;
  $("btn-toggle-all").textContent = allSelected ? "Deselect all" : "Select all";
}

// ── Access gate (popup UI) ───────────────────────────────────────────────────
// Always resolved LIVE from the database (fetchAccess → get_my_access RPC). The
// popup never trusts a stored plan/status; it re-queries on open and on any
// ACCESS_LOCKED broadcast from the background engine.
function setStartEnabled(enabled: boolean): void {
  const btn = document.getElementById("btn-start") as HTMLButtonElement | null;
  if (!btn) return;
  btn.disabled = !enabled;
  btn.title = enabled ? "" : "Locked — sign in and make sure your trial or plan is active.";
}

async function renderAccess(): Promise<void> {
  const form = $("auth-form");
  const statusEl = $("auth-status");
  const note = $("auth-note");
  const badge = $("auth-badge");
  const emailLabel = $("auth-email-label");
  const upgrade = $("auth-upgrade") as HTMLAnchorElement;

  form.hidden = true; statusEl.hidden = true; note.hidden = true;

  if (!SUPABASE_CONFIGURED) {
    note.hidden = false;
    note.textContent = "Sign-in unavailable: this build has no Supabase config.";
    setStartEnabled(false);
    return;
  }

  let access;
  try {
    access = await fetchAccess();
  } catch (e) {
    note.hidden = false;
    note.textContent = `Access check failed: ${(e as Error).message}`;
    setStartEnabled(false);
    return;
  }

  if (!access) { // signed out
    form.hidden = false;
    setStartEnabled(false);
    return;
  }

  statusEl.hidden = false;
  emailLabel.textContent = access.email ?? "";
  const canRun = access.can_access || access.is_admin;
  setStartEnabled(canRun);

  badge.className = "badge " + (canRun ? "ok" : access.status === "suspended" ? "err" : "warn");
  badge.textContent = access.is_admin ? "admin" : access.status;

  if (!canRun && !access.is_admin) {
    const origin = (await SettingsStore.get()).dashboardOrigin || "https://www.higgstee.com";
    upgrade.hidden = false;
    upgrade.href = origin.replace(/\/+$/, "") + "/trial-expired";
  } else {
    upgrade.hidden = true;
  }
}

function wireAuth(): void {
  $("auth-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = ($("auth-email") as HTMLInputElement).value.trim();
    const pass = ($("auth-pass") as HTMLInputElement).value;
    const err = $("auth-error");
    const btn = $("auth-signin") as HTMLButtonElement;
    err.textContent = "";
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await signIn(email, pass);
      ($("auth-pass") as HTMLInputElement).value = "";
      await renderAccess();
    } catch (e2) {
      err.textContent = (e2 as Error).message;
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  });

  ($("auth-signout") as HTMLButtonElement).onclick = async () => {
    await signOut();
    await renderAccess();
  };

  // The background engine broadcasts this when a trial expires / account is
  // suspended mid-run. Re-check live and update the UI.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "ACCESS_LOCKED") void renderAccess();
  });
}

async function init() {
  $("ext-id").textContent = `ID: ${chrome.runtime.id}`;
  wireAuth();
  void renderAccess();
  render(await QueueStore.get());
  QueueStore.installCrossPageListener(render);

  // Upload-mode toggle (Single = quick_create one-at-a-time; Bulk = bulk_uploader).
  const modeBtn = $("btn-mode");
  const paintMode = (mode: UploadMode) => {
    modeBtn.textContent = mode === "bulk" ? "Mode: Bulk" : "Mode: Single";
  };
  paintMode((await SettingsStore.get()).uploadMode);
  modeBtn.onclick = async () => {
    const cur = (await SettingsStore.get()).uploadMode;
    const next: UploadMode = cur === "bulk" ? "single" : "bulk";
    await SettingsStore.set({ uploadMode: next });
    paintMode(next);
  };

  // Copy the captured bulk run log to the clipboard for diagnostics.
  const logBtn = $("btn-log");
  logBtn.onclick = async () => {
    const lines = await BulkLogStore.get();
    const text = lines.join("\n") || "(no log captured yet)";
    try {
      await navigator.clipboard.writeText(text);
      logBtn.textContent = `Copied ${lines.length} lines`;
    } catch {
      logBtn.textContent = "Copy failed";
    }
    setTimeout(() => { logBtn.textContent = "Copy log"; }, 2000);
  };

  // Stable controls (independent of grid contents).
  $("btn-toggle-all").onclick = async () => {
    if (!lastBatch) return;
    const total = lastBatch.items.length;
    const picked = lastBatch.items.filter((i) => i.selected !== false).length;
    const nextValue = picked < total; // if not all selected → select all; if all → deselect
    // Optimistic UI
    const grid = $("grid");
    grid.querySelectorAll<HTMLElement>(".tile").forEach((t) => {
      t.classList.toggle("selected", nextValue);
      const c = t.querySelector<HTMLElement>(".check");
      if (c) c.textContent = nextValue ? "✓" : "";
    });
    $("s-picked").textContent = String(nextValue ? total : 0);
    $("picked-summary").textContent = `${nextValue ? total : 0} of ${total} selected for upload`;
    $("btn-toggle-all").textContent = nextValue ? "Deselect all" : "Select all";
    await chrome.runtime.sendMessage({ type: "ITEMS_SELECT_ALL", value: nextValue });
    setTimeout(async () => render(await QueueStore.get()), 250);
  };

  $("btn-invert").onclick = async () => {
    if (!lastBatch) return;
    // Optimistic flip every tile.
    const grid = $("grid");
    grid.querySelectorAll<HTMLElement>(".tile").forEach((t) => {
      const cur = t.classList.contains("selected");
      t.classList.toggle("selected", !cur);
      const c = t.querySelector<HTMLElement>(".check");
      if (c) c.textContent = !cur ? "✓" : "";
    });
    await chrome.runtime.sendMessage({ type: "ITEMS_INVERT_SELECTED" });
    setTimeout(async () => render(await QueueStore.get()), 250);
  };

  $("btn-start").onclick = () => chrome.runtime.sendMessage({ type: "ENGINE_START" });
  $("btn-pause").onclick = () => chrome.runtime.sendMessage({ type: "ENGINE_PAUSE" });
  $("btn-open").onclick  = () => chrome.tabs.create({ url: chrome.runtime.getURL("queue/index.html") });
  $("btn-clear").onclick = async () => {
    if (confirm("Clear the queue? Any pending uploads will be discarded.")) {
      await chrome.runtime.sendMessage({ type: "QUEUE_CLEAR" });
    }
  };
}

init();
