// HiggsTee side-panel UI. This is the presentation layer ONLY — all upload /
// bulk / publish logic stays in the background service worker and content
// script. We reuse the same stores (QueueStore/SettingsStore/ImageStore), the
// same engine messages, and the same live access gate (fetchAccess →
// get_my_access). Access is always resolved from the database, never cached.

import type { QueueBatch, QueueItem, AccessState } from "@teepublic/shared";
import { QueueStore, SettingsStore, ThumbStore, getDisplayImages } from "../services/queueStore";
import { fetchAccess } from "../lib/access";
import { supabase, signIn, signOut } from "../lib/supabaseClient";
import { SUPABASE_CONFIGURED } from "../lib/config";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
const esc = (s: string) =>
  (s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));

const PAGE_SIZE = 12;
const THEME_KEY = "higgstee.theme";

// ── UI state (not entitlement — that's always fetched live) ─────────────────
let batch: QueueBatch | null = null;
let access: AccessState | null = null;
let locked = false;
let filterStatus = "all";
let search = "";
let page = 0;

// Grid previews (the small ThumbStore copies, not the print-resolution
// originals); fetch each once and reuse, so re-renders (e.g. a selection toggle)
// never re-read storage or reload images.
const thumbCache = new Map<string, string>();

// ── Boot ────────────────────────────────────────────────────────────────────
async function boot(): Promise<void> {
  await applyStoredTheme();
  // The side panel uploads in SINGLE mode (quick_create — one design at a time).
  // Force it on boot so the stored setting always matches this UI.
  await SettingsStore.set({ uploadMode: "single" });
  wireHandlers();
  QueueStore.installCrossPageListener(() => { void renderQueue(); });
  // Previews are derived one per design as the dashboard streams the batch in,
  // which is AFTER the queue itself is stored. Fill each tile the moment its
  // preview lands, instead of leaving the grid blank until the next re-render.
  ThumbStore.installChangeListener((id, dataUrl) => {
    if (!dataUrl) return;
    thumbCache.set(id, dataUrl);
    const img = document.querySelector<HTMLImageElement>(`img[data-img-id="${CSS.escape(id)}"]`);
    if (img && img.dataset.loaded !== "1") {
      img.src = dataUrl;
      img.dataset.loaded = "1";
    }
  });
  chrome.runtime.onMessage.addListener((m) => {
    if (m?.type === "ACCESS_LOCKED") void refresh();
  });
  await refresh();
}

function setView(view: "loading" | "login" | "app"): void {
  document.body.dataset.view = view;
}

async function refresh(): Promise<void> {
  if (!SUPABASE_CONFIGURED) { setView("login"); showLoginError("This build has no Supabase config — rebuild with credentials."); return; }
  // Authoritative auth check: getUser() validates AND refreshes the token. If the
  // refresh token is dead we genuinely need a re-login → show the login screen,
  // never a misleading lock.
  let user = null;
  try { user = (await supabase().auth.getUser()).data.user; } catch { user = null; }
  if (!user) { setView("login"); return; }
  setView("app");
  await renderAccess();
  await renderQueue();
}

// ── Access / lock ────────────────────────────────────────────────────────────
async function renderAccess(): Promise<void> {
  let reason = "";
  try {
    access = await fetchAccess();
    if (!access) reason = "get_my_access() returned null — token likely stale/anon or profile missing";
  } catch (e) {
    access = null; // fail closed
    reason = "get_my_access() error: " + (e as Error).message;
  }
  const email = access?.email ?? (await sessionEmail()) ?? "";
  ($("account-email") as HTMLElement).textContent = email || "—";
  ($("account-name") as HTMLElement).textContent = email ? email.split("@")[0] : "account";
  ($("avatar") as HTMLElement).textContent = (email[0] ?? "?").toUpperCase();

  const canRun = !!access && (access.can_access || access.is_admin);
  ($("account-plan-text") as HTMLElement).textContent = access ? planLine(access) : "Couldn't verify — Sign out / in";
  if (!canRun) console.warn("[higgstee] LOCKED —", reason || `effective status: ${access?.status}`, access);
  else console.info("[higgstee] access OK —", access?.is_admin ? "admin" : access?.status);
  setLocked(!canRun);
}

function planLine(a: AccessState | null): string {
  if (!a) return "Couldn't verify plan";
  if (a.is_admin) return "Admin — full access";
  switch (a.status) {
    case "active": return `${planLabel(a.plan)} — active`;
    case "trialing": {
      const d = daysLeft(a.trial_end);
      return d != null ? `Free Trial — ${d} day${d === 1 ? "" : "s"} left` : "Free Trial — active";
    }
    case "pending_approval": return "Pending approval";
    case "pending_verification": return "Verify your email";
    case "suspended": return "Suspended";
    default: return "No active plan";
  }
}

function planLabel(plan: string): string {
  return { pro_monthly: "Monthly", pro_yearly: "Yearly", trial: "Free Trial", none: "No plan" }[plan] ?? plan;
}

function daysLeft(iso: string | null): number | null {
  if (!iso) return null;
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000));
}

// Toggle the lock overlay + disable every action (Start/Pause/Queue/Clear +
// selection). The engine and background message boundary enforce this too — the
// UI lock is UX, the server gate is the real boundary.
function setLocked(next: boolean): void {
  locked = next;
  $("view-app").classList.toggle("locked", next);
  ($("lock") as HTMLElement).hidden = !next;
  for (const id of ["act-start", "act-pause", "act-queue", "act-clear", "sel-all", "sel-page", "sel-invert"]) {
    (document.getElementById(id) as HTMLButtonElement).disabled = next;
  }
}

async function sessionEmail(): Promise<string | null> {
  try {
    const { data } = await supabase().auth.getSession();
    return data.session?.user?.email ?? null;
  } catch { return null; }
}

// ── Queue rendering ──────────────────────────────────────────────────────────
async function renderQueue(): Promise<void> {
  batch = await QueueStore.get();
  renderStats();
  renderGrid();
}

function renderStats(): void {
  const items = batch?.items ?? [];
  $("s-total").textContent  = String(items.length);
  $("s-picked").textContent = String(items.filter((i) => i.selected !== false).length);
  $("s-done").textContent   = String(items.filter((i) => i.status === "succeeded").length);
  $("s-fail").textContent   = String(items.filter((i) => i.status === "failed").length);
}

function filteredItems(): QueueItem[] {
  const items = batch?.items ?? [];
  const q = search.trim().toLowerCase();
  return items.filter((it) => {
    if (filterStatus !== "all" && it.status !== filterStatus) return false;
    if (q) {
      const hay = `${it.metadata?.title ?? ""} ${it.metadata?.filename ?? ""}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderGrid(): void {
  const items = filteredItems();
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  page = Math.min(Math.max(0, page), pageCount - 1);
  const start = page * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  const grid = $("grid");
  const existingIds = Array.from(grid.children).map((c) => (c as HTMLElement).dataset.id ?? "");
  const nextIds = pageItems.map((i) => i.id);
  const sameLayout =
    existingIds.length === nextIds.length && existingIds.every((id, i) => id === nextIds[i]);

  if (sameLayout) {
    // Same items on screen (e.g. a selection toggle) — update each card in place.
    // No DOM teardown and no thumbnail re-fetch, so nothing flickers or reloads.
    pageItems.forEach((item, i) => updateCard(grid.children[i] as HTMLElement, item));
  } else {
    // Layout actually changed (filter / search / page / queue change) — rebuild once.
    grid.innerHTML = pageItems.map(cardHtml).join("");
    wireCards(grid);
    void loadThumbnails(grid);
  }

  ($("empty") as HTMLElement).hidden = total > 0;
  renderPager(total, pageCount, start, pageItems.length);

  const whole = batch?.items ?? [];
  const picked = whole.filter((i) => i.selected !== false).length;
  $("sel-counter").textContent = `${picked} of ${whole.length} selected`;
}

// In-place card update: selection highlight + status badge only. Leaves the
// already-loaded <img> untouched so thumbnails never reload on a toggle.
function updateCard(el: HTMLElement, item: QueueItem): void {
  el.classList.toggle("selected", item.selected !== false);
  el.title = item.metadata?.title ?? "";
  if (el.dataset.status !== item.status) {
    el.dataset.status = item.status;
    el.querySelector(".sbadge")?.remove();
    const badge = statusBadge(item.status);
    if (badge) el.insertAdjacentHTML("beforeend", badge);
  }
}

// Compact tile: thumbnail + a selection checkbox (top-left) + a corner status
// badge (top-right). Done = green check, failed = red cross, actively uploading =
// small pulsing lime dot. Waiting items (pending/queued) get only a faint hollow
// ring so a full grid isn't a wall of dots.
//
// Selection and status are deliberately on OPPOSITE corners and in different
// shapes: they answer different questions ("will this upload?" vs "did it?") and
// used to be easy to confuse.
function statusBadge(status: string): string {
  switch (status) {
    case "succeeded": return `<div class="sbadge ok" title="Done">✓</div>`;
    case "failed":    return `<div class="sbadge fail" title="Failed">✕</div>`;
    case "running":   return `<div class="sbadge run" title="Uploading"></div>`;
    case "pending":
    case "queued":    return `<div class="sbadge wait" title="${esc(status)}"></div>`;
    default:          return "";
  }
}

function cardHtml(item: QueueItem): string {
  const selected = item.selected !== false;
  // Thumbnails come from this device's ImageStore only (loadThumbnails fills
  // them in) — never from a URL the browser would have to fetch.
  const src = `data-img-id="${esc(item.id)}"`;
  return `
    <div class="card ${selected ? "selected" : ""}" data-id="${esc(item.id)}" data-status="${esc(item.status)}" title="${esc(item.metadata?.title ?? "")}">
      <img class="thumb" ${src} alt="" onerror="this.style.opacity=0.25" />
      <div class="cmark" aria-hidden="true"></div>
      ${statusBadge(item.status)}
    </div>`;
}

// ONE batched storage read for the whole page of tiles. This used to await a
// separate chrome.storage read per tile, so each thumbnail cost its own IPC
// round trip carrying a multi-MB string, one after another.
async function loadThumbnails(grid: HTMLElement): Promise<void> {
  const imgs = Array.from(grid.querySelectorAll<HTMLImageElement>("img[data-img-id]"))
    .filter((img) => !!img.dataset.imgId && img.dataset.loaded !== "1");
  if (imgs.length === 0) return;

  const wanted = imgs.map((img) => img.dataset.imgId!).filter((id) => !thumbCache.has(id));
  if (wanted.length > 0) {
    for (const [id, dataUrl] of await getDisplayImages(wanted)) thumbCache.set(id, dataUrl);
  }
  for (const img of imgs) {
    const dataUrl = thumbCache.get(img.dataset.imgId!);
    if (dataUrl) {
      img.src = dataUrl;
      img.dataset.loaded = "1";
    }
  }
}

function renderPager(total: number, pageCount: number, start: number, shown: number): void {
  const pager = $("pager");
  if (total <= PAGE_SIZE) { pager.innerHTML = ""; return; }
  const from = total === 0 ? 0 : start + 1;
  pager.innerHTML = `
    <button id="pg-prev" class="btn btn-ghost" ${page === 0 ? "disabled" : ""}>‹ Prev</button>
    <span class="muted-sm">${from}–${start + shown} of ${total} · page ${page + 1}/${pageCount}</span>
    <button id="pg-next" class="btn btn-ghost" ${page >= pageCount - 1 ? "disabled" : ""}>Next ›</button>`;
  ($("pg-prev") as HTMLButtonElement).onclick = () => { page--; renderGrid(); };
  ($("pg-next") as HTMLButtonElement).onclick = () => { page++; renderGrid(); };
}

function wireCards(grid: HTMLElement): void {
  grid.querySelectorAll<HTMLElement>(".card").forEach((card) => {
    card.addEventListener("click", async () => {
      if (locked) return;
      const id = card.dataset.id;
      if (!id) return;
      card.classList.toggle("selected"); // optimistic — instant feedback
      await sendMsg({ type: "ITEM_TOGGLE_SELECTED", itemId: id });
      // storage change reconciles the true state via installCrossPageListener
    });
  });
}

// ── Selection controls ───────────────────────────────────────────────────────
function currentPageItems(): QueueItem[] {
  const items = filteredItems();
  const start = page * PAGE_SIZE;
  return items.slice(start, start + PAGE_SIZE);
}

async function selectAll(): Promise<void> {
  if (locked) return;
  const items = batch?.items ?? [];
  const allSelected = items.length > 0 && items.every((i) => i.selected !== false);
  await sendMsg({ type: "ITEMS_SELECT_ALL", value: !allSelected });
}

async function selectPage(): Promise<void> {
  if (locked) return;
  const updates = currentPageItems().map((it) => ({ id: it.id, selected: true }));
  if (updates.length) await sendMsg({ type: "ITEMS_SET_SELECTED_MAP", updates });
}

async function invertPage(): Promise<void> {
  if (locked) return;
  const updates = currentPageItems().map((it) => ({ id: it.id, selected: !(it.selected !== false) }));
  if (updates.length) await sendMsg({ type: "ITEMS_SET_SELECTED_MAP", updates });
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function start(): Promise<void> {
  if (locked) return;
  // Selected "failed" items count as eligible: pressing Start re-queues them for
  // retry (the engine calls requeueSelectedFailed() before the run begins).
  const eligible = (batch?.items ?? []).filter(
    (i) =>
      (i.status === "pending" || i.status === "queued" || i.status === "failed") &&
      i.selected !== false,
  );
  if (eligible.length === 0) {
    alert("Nothing to upload: no designs are selected. Select some designs (or failed ones to retry), then press Upload.");
    return;
  }
  const res = await sendMsg({ type: "ENGINE_START" });
  if (res && res.ok === false) {
    await refresh(); // access likely revoked → re-lock
    alert(`Couldn't start uploading: ${res.error ?? "unknown error"}`);
  }
}

async function dashboardOrigin(): Promise<string> {
  return ((await SettingsStore.get()).dashboardOrigin || "https://www.higgstee.com").replace(/\/+$/, "");
}

// ── Wiring ────────────────────────────────────────────────────────────────────
function wireHandlers(): void {
  // Login
  $("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const email = ($("login-email") as HTMLInputElement).value.trim();
    const pass = ($("login-pass") as HTMLInputElement).value;
    const btn = $("login-submit") as HTMLButtonElement;
    showLoginError("");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      await signIn(email, pass);
      ($("login-pass") as HTMLInputElement).value = "";
      await refresh();
    } catch (err) {
      showLoginError((err as Error).message);
    } finally {
      btn.disabled = false; btn.textContent = "Sign In";
    }
  });
  $("login-create").addEventListener("click", async () => {
    chrome.tabs.create({ url: `${await dashboardOrigin()}/login` });
  });

  // Header
  $("btn-theme").addEventListener("click", () => void toggleTheme());
  $("btn-refresh").addEventListener("click", () => void refresh());

  // Account dropdown
  const chip = $("account-chip");
  const menu = $("account-menu") as HTMLElement;
  chip.addEventListener("click", (e) => {
    e.stopPropagation();
    const open = menu.hidden;
    menu.hidden = !open;
    chip.setAttribute("aria-expanded", String(open));
  });
  document.addEventListener("click", () => { menu.hidden = true; chip.setAttribute("aria-expanded", "false"); });
  menu.addEventListener("click", (e) => e.stopPropagation());
  $("btn-signout").addEventListener("click", async () => {
    await signOut();
    setView("login");
  });

  // Toolbar
  ($("search") as HTMLInputElement).addEventListener("input", (e) => {
    search = (e.target as HTMLInputElement).value; page = 0; renderGrid();
  });
  ($("status-filter") as HTMLSelectElement).addEventListener("change", (e) => {
    filterStatus = (e.target as HTMLSelectElement).value; page = 0; renderGrid();
  });

  // Selection
  $("sel-all").addEventListener("click", () => void selectAll());
  $("sel-page").addEventListener("click", () => void selectPage());
  $("sel-invert").addEventListener("click", () => void invertPage());

  // Action bar
  $("act-start").addEventListener("click", () => void start());
  $("act-pause").addEventListener("click", () => void sendMsg({ type: "ENGINE_PAUSE" }));
  $("act-queue").addEventListener("click", () => chrome.tabs.create({ url: chrome.runtime.getURL("queue/index.html") }));
  $("act-clear").addEventListener("click", async () => {
    if (locked) return;
    if (confirm("Clear the queue? Any pending uploads will be discarded.")) {
      await sendMsg({ type: "QUEUE_CLEAR" });
    }
  });

  // Lock overlay
  $("lock-trial").addEventListener("click", async () => chrome.tabs.create({ url: await dashboardOrigin() }));
  $("lock-upgrade").addEventListener("click", async () => chrome.tabs.create({ url: await dashboardOrigin() }));
}

function showLoginError(msg: string): void {
  ($("login-error") as HTMLElement).textContent = msg;
}

// ── Theme ────────────────────────────────────────────────────────────────────
async function applyStoredTheme(): Promise<void> {
  const r = await chrome.storage.local.get(THEME_KEY);
  applyTheme(r[THEME_KEY] === "light" ? "light" : "dark");
}
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
}
async function toggleTheme(): Promise<void> {
  const next = document.documentElement.dataset.theme === "light" ? "dark" : "light";
  applyTheme(next);
  await chrome.storage.local.set({ [THEME_KEY]: next });
}

// Promise wrapper over chrome.runtime.sendMessage (ignores "no receiver").
function sendMsg(message: unknown): Promise<{ ok?: boolean; error?: string; status?: string } | undefined> {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res); });
    } catch { resolve(undefined); }
  });
}

void boot();
