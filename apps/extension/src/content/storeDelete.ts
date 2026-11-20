// Bulk delete on the owner's TeePublic store page. Adds a checkbox overlay to
// every design card and one "Delete selected" button; then, one design at a
// time, does what the owner would do by hand: the card's menu -> Delete ->
// confirm. Nothing here talks to Higgstee's servers - the selection and the run
// state are design ids in chrome.storage.local, and the deleting is TeePublic's
// own menu item.
//
// A Delete that reloads the page destroys this script, so the run lives in
// storage and resumes on the next load, exactly like the bulk uploader.
// Every selector is in STORE (lib/selectors.ts).

import { STORE } from "../lib/selectors";
import { sleep } from "../lib/delays";
import { generation, onPageChange } from "./pageWatch";

const KEY = "teepublic.storeDelete";

interface RunState {
  active: boolean;
  /** The store page the run started on; a Delete that redirects elsewhere comes back here. */
  returnUrl: string;
  queue: string[];
  total: number;
  /** The design being deleted right now - checked on the next load if the page navigated. */
  current: string | null;
  done: string[];
  failed: { id: string; why: string }[];
  /** Navigations back to returnUrl; capped so a redirect loop can't spin forever. */
  navs: number;
}

const getState = async (): Promise<RunState | null> =>
  ((await chrome.storage.local.get(KEY))[KEY] as RunState | undefined) ?? null;
const setState = async (s: RunState | null): Promise<void> =>
  s ? chrome.storage.local.set({ [KEY]: s }) : chrome.storage.local.remove(KEY);

// ---------------------------------------------------------------------------
// Finding the design cards

/** Design id from a listing (/t-shirt/12345678-slug) or edit (/designs/12345678/edit) link. */
// The card scan asks about the same hrefs many times (once per ancestor it
// walks), and URL parsing isn't free - remember the answers.
const idMemo = new Map<string, string | null>();

export function idFromHref(href: string): string | null {
  let id = idMemo.get(href);
  if (id === undefined) {
    id = parseIdFromHref(href);
    if (idMemo.size > 5000) idMemo.clear();
    idMemo.set(href, id);
  }
  return id;
}

function parseIdFromHref(href: string): string | null {
  let path: string;
  try { path = new URL(href, location.href).pathname; } catch { return null; }
  const m = path.match(/^\/designs\/(\d{4,})(?:\/|$)/) ?? path.match(/^\/[a-z0-9-]+\/(\d{4,})-/i);
  return m ? m[1] : null;
}

function designLinks(root: ParentNode): { el: HTMLAnchorElement; id: string }[] {
  const out: { el: HTMLAnchorElement; id: string }[] = [];
  for (const el of Array.from(root.querySelectorAll<HTMLAnchorElement>("a[href]"))) {
    if (el.closest(".higgstee-sd")) continue;
    const id = idFromHref(el.getAttribute("href") ?? "");
    if (id) out.push({ el, id });
  }
  return out;
}

/** The card = the largest ancestor of the design's link that holds no OTHER design. */
function cardFor(link: HTMLElement, id: string): HTMLElement {
  let el = link;
  while (el.parentElement && el.parentElement !== document.body) {
    const p = el.parentElement;
    if (p.getBoundingClientRect().width > window.innerWidth * 0.6) break;
    if (designLinks(p).some((l) => l.id !== id)) break;
    el = p;
  }
  return el;
}

/** A fresh walk of the page - costly on big grids. The delete run uses it
 *  (it must see a card vanish at once); everything else uses findCards(). */
function scanCards(): Map<string, HTMLElement> {
  const cards = new Map<string, HTMLElement>();
  for (const { el, id } of designLinks(document)) {
    if (cards.has(id)) continue;
    const card = cardFor(el, id);
    const r = card.getBoundingClientRect();
    if (r.width >= 80 && r.height >= 80) cards.set(id, card);
  }
  return cards;
}

let cardsCache: { gen: number; cards: Map<string, HTMLElement> } | null = null;

/** The page's design cards, re-scanned only when pageWatch saw the DOM change. */
export function findCards(): Map<string, HTMLElement> {
  if (cardsCache?.gen !== generation) cardsCache = { gen: generation, cards: scanCards() };
  return cardsCache.cards;
}

const isVisible = (el: Element) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
const cardPresent = (id: string) => { const c = scanCards().get(id); return !!c && isVisible(c); };

// ---------------------------------------------------------------------------
// Selector matching - STORE lists use the same `tag:contains("Text")` form as TP/BULK

function matchAll(scope: ParentNode, candidates: readonly string[], visibleOnly = false): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const sel of candidates) {
    const m = sel.match(/^([a-zA-Z*]+):contains\("(.+?)"\)$/);
    let els: HTMLElement[];
    if (m) {
      const want = m[2].toLowerCase();
      // Own text only (short), so "Delete" never matches the whole menu wrapper.
      els = Array.from(scope.querySelectorAll<HTMLElement>(m[1])).filter((e) => {
        const t = (e.textContent ?? "").trim().toLowerCase();
        return t === want || (t.includes(want) && t.length <= want.length + 4);
      });
    } else {
      try { els = Array.from(scope.querySelectorAll<HTMLElement>(sel)); } catch { els = []; }
    }
    for (const e of els) {
      if (e.closest(".higgstee-sd")) continue;
      if (visibleOnly && !isVisible(e)) continue;
      if (!out.includes(e)) out.push(e);
    }
  }
  return out;
}

/** One click (not fullClick's dispatched click + el.click(), which would fire Delete twice). */
function clickOnce(el: HTMLElement): void {
  const r = el.getBoundingClientRect();
  const init = { bubbles: true, cancelable: true, view: window, button: 0,
                 clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
  for (const t of ["pointerdown", "mousedown", "pointerup", "mouseup"]) el.dispatchEvent(new MouseEvent(t, init));
  el.click();
}

// ---------------------------------------------------------------------------
// Deleting one design

/** TeePublic may ask with a native confirm(); the page's own window.confirm can
 *  only be answered from the page world, which the service worker does for us. */
async function autoConfirm(on: boolean): Promise<void> {
  try { await chrome.runtime.sendMessage({ type: "TP_AUTO_CONFIRM", on }); } catch { /* best effort */ }
}

async function accessOk(): Promise<string | null> {
  try {
    const res = (await chrome.runtime.sendMessage({ type: "ASSERT_ACCESS" })) as { ok?: boolean; error?: string } | undefined;
    return res?.ok === true ? null : (res?.error ?? "no response from the extension");
  } catch (e) {
    return (e as Error).message;
  }
}

/** The card's Delete item: in the card (hidden is fine - click() still fires),
 *  else a visible one in a menu that overlaps the card (a menu rendered outside it). */
function findDeleteItem(card: HTMLElement): HTMLElement | null {
  const inCard = matchAll(card, STORE.deleteItem)[0];
  if (inCard) return inCard;
  const c = card.getBoundingClientRect();
  return matchAll(document, STORE.deleteItem, true).find((e) => {
    const r = e.getBoundingClientRect();
    return r.left < c.right && r.right > c.left && r.top < c.bottom && r.bottom > c.top;
  }) ?? null;
}

async function deleteOne(id: string): Promise<{ ok: boolean; why?: string }> {
  const card = scanCards().get(id);
  if (!card) return { ok: false, why: "not on this page" };
  card.scrollIntoView({ block: "center" });
  await sleep(300);

  let item = findDeleteItem(card);
  if (!item) {
    for (const trigger of matchAll(card, STORE.menuTrigger, true)) {
      clickOnce(trigger);
      await sleep(500);
      item = findDeleteItem(card);
      if (item) break;
    }
  }
  if (!item) return { ok: false, why: "no Delete in this design's menu" };

  await autoConfirm(true);
  try {
    clickOnce(item);
    // A TeePublic confirmation modal, if one opens.
    for (const end = Date.now() + 4_000; Date.now() < end && cardPresent(id);) {
      const dialog = matchAll(document, STORE.confirmDialog, true).find((d) => !d.contains(card));
      const btn = dialog && matchAll(dialog, STORE.confirmButton, true)[0];
      if (btn) { clickOnce(btn); break; }
      await sleep(200);
    }
    for (const end = Date.now() + 15_000; Date.now() < end;) {
      if (!cardPresent(id)) return { ok: true };
      await sleep(300);
    }
    return { ok: false, why: "still in the store after Delete" };
  } finally {
    await autoConfirm(false);
  }
}

// ---------------------------------------------------------------------------
// The run (survives page loads)

const samePage = (url: string) => {
  try { const u = new URL(url); return u.pathname === location.pathname && u.search === location.search; } catch { return true; }
};

async function waitForCards(timeoutMs: number): Promise<void> {
  for (const end = Date.now() + timeoutMs; Date.now() < end && scanCards().size === 0;) await sleep(300);
}

async function runLoop(): Promise<void> {
  let s = await getState();
  if (!s?.active) return;

  if (!samePage(s.returnUrl)) {
    if (s.navs >= s.total + 3) { s.active = false; await setState(s); render(); return; }
    s.navs++;
    await setState(s);
    location.href = s.returnUrl;
    return;
  }
  await waitForCards(10_000);

  // The page navigated in the middle of a Delete: judge it now that it's reloaded.
  if (s.current) {
    const id = s.current;
    if (cardPresent(id)) s.failed.push({ id, why: "still in the store after Delete" });
    else s.done.push(id);
    s.current = null;
    await setState(s);
  }

  while (s?.active) {
    render();
    const denied = await accessOk();
    if (denied) {
      s.active = false;
      s.failed.push(...s.queue.map((id) => ({ id, why: `stopped: ${denied}` })));
      s.queue = [];
      await setState(s);
      break;
    }
    const id = s.queue.shift();
    if (!id) { s.active = false; await setState(s); break; }
    s.current = id;
    await setState(s); // before clicking - the Delete may reload the page
    const res = await deleteOne(id);
    s = await getState();
    if (!s) break; // stopped from another tab
    s.current = null;
    if (res.ok) s.done.push(id);
    else s.failed.push({ id, why: res.why ?? "failed" });
    await setState(s);
    await sleep(700 + Math.random() * 800);
    s = await getState();
  }
  render();
}

// ---------------------------------------------------------------------------
// UI: checkbox overlays + one floating bar

let selecting = false;
const selected = new Set<string>();
let bar: HTMLDivElement | null = null;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  e.textContent = text;
  return e;
}

const BTN = "border:0;border-radius:999px;padding:8px 14px;font:600 13px system-ui,sans-serif;cursor:pointer;";

function button(text: string, css: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const b = el("button", BTN + css + (disabled ? "opacity:.45;cursor:default;" : ""), text);
  b.disabled = disabled;
  b.addEventListener("click", (e) => { e.preventDefault(); onClick(); });
  return b;
}

function paintOverlays(): void {
  document.querySelectorAll(".higgstee-sd-pick").forEach((o) => o.remove());
  if (!selecting) return;
  for (const [id, card] of findCards()) {
    if (getComputedStyle(card).position === "static") card.style.position = "relative";
    const on = selected.has(id);
    const o = el("div",
      "position:absolute;inset:0;z-index:50;cursor:pointer;border-radius:12px;" +
      (on ? "background:rgba(220,38,38,.18);box-shadow:inset 0 0 0 3px #dc2626;" : "background:rgba(255,255,255,.05);box-shadow:inset 0 0 0 2px rgba(0,0,0,.15);"));
    o.className = "higgstee-sd higgstee-sd-pick";
    const box = el("div",
      "position:absolute;left:50%;top:40%;transform:translate(-50%,-50%);width:38px;height:38px;border-radius:50%;" +
      "display:flex;align-items:center;justify-content:center;font:700 22px system-ui;box-shadow:0 2px 8px rgba(0,0,0,.35);" +
      (on ? "background:#dc2626;color:#fff;" : "background:rgba(255,255,255,.92);color:transparent;border:2px solid #9ca3af;"),
      "✓");
    o.appendChild(box);
    o.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (selected.has(id)) selected.delete(id); else selected.add(id);
      paintOverlays();
      render();
    }, true);
    card.appendChild(o);
  }
}

async function startDelete(): Promise<void> {
  const cards = findCards();
  const ids = [...selected].filter((id) => cards.has(id));
  if (ids.length === 0) return;
  const n = ids.length;
  if (!window.confirm(`Delete ${n} design${n === 1 ? "" : "s"} from your TeePublic store?\n\nThis can't be undone.`)) return;
  const denied = await accessOk();
  if (denied) {
    window.alert(/context invalidated/i.test(denied)
      ? "Higgstee was updated. Refresh this page (F5), then select the designs again."
      : /signed_out/.test(denied)
      ? "The Higgstee extension isn't signed in.\n\nClick the Higgstee icon in Chrome's toolbar, sign in in the side panel, then press Delete again."
      : `Higgstee can't run right now: ${denied}`);
    return;
  }
  selecting = false;
  selected.clear();
  paintOverlays();
  await setState({ active: true, returnUrl: location.href, queue: ids, total: n, current: null, done: [], failed: [], navs: 0 });
  void runLoop();
}

async function render(): Promise<void> {
  if (!bar?.isConnected) {
    bar = el("div",
      "position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:2147483000;display:flex;gap:8px;align-items:center;" +
      "background:#111827;color:#fff;padding:8px;border-radius:999px;box-shadow:0 8px 30px rgba(0,0,0,.35);font:500 13px system-ui,sans-serif;");
    bar.className = "higgstee-sd";
    document.documentElement.appendChild(bar); // outside <body>, which TeePublic may replace
  }
  const s = await getState();
  // Explicit colour + font: TeePublic's own span styles otherwise win (dark on dark).
  const label = (t: string) => el("span", "padding:0 8px;white-space:nowrap;color:#fff;font:600 13px system-ui,sans-serif;", t);
  const parts: HTMLElement[] = [];

  if (s?.active) {
    const at = Math.min(s.done.length + s.failed.length + 1, s.total);
    parts.push(label(`Deleting ${at} of ${s.total}…`));
    parts.push(button("Stop", "background:#374151;color:#fff;", async () => {
      const cur = await getState();
      if (cur) { cur.active = false; cur.queue = []; await setState(cur); }
      render();
    }));
  } else if (s) {
    const failed = s.failed.length;
    const summary = label(`Deleted ${s.done.length}${failed ? ` · ${failed} not deleted` : ""}`);
    if (failed) summary.title = s.failed.map((f) => `${f.id}: ${f.why}`).join("\n");
    parts.push(summary);
    parts.push(button("Close", "background:#374151;color:#fff;", async () => { await setState(null); render(); }));
  } else if (selecting) {
    const n = selected.size;
    parts.push(label(`${n} selected`));
    parts.push(button("Select all", "background:#374151;color:#fff;", () => {
      for (const id of findCards().keys()) selected.add(id);
      paintOverlays(); render();
    }));
    parts.push(button("Clear", "background:#374151;color:#fff;", () => { selected.clear(); paintOverlays(); render(); }, n === 0));
    parts.push(button(`Delete ${n}`, "background:#dc2626;color:#fff;", () => void startDelete(), n === 0));
    parts.push(button("Cancel", "background:transparent;color:#d1d5db;", () => {
      selecting = false; selected.clear(); paintOverlays(); render();
    }));
  } else {
    parts.push(button("Select designs to delete", "background:#dc2626;color:#fff;", () => {
      selecting = true; paintOverlays(); render();
    }));
  }
  bar.replaceChildren(...parts);
}

/** A card shows the owner-only "N Sold" badge or an owner control. Looked for
 *  inside cards only - header/account-menu text exists on every store. */
function cardIsOwners(card: HTMLElement): boolean {
  for (const e of Array.from(card.querySelectorAll<HTMLElement>("*"))) {
    if (e.closest(".higgstee-sd") || e.children.length > 0) continue;
    if (STORE.ownerSoldBadge.test((e.textContent ?? "").trim())) return true;
  }
  return matchAll(card, STORE.ownerMarkers).length > 0;
}

/** Only on a store page the signed-in user owns. */
let ownerCache: { gen: number; owner: boolean } | null = null;

/** Only on a store page the signed-in user owns. Cached per page change - it
 *  reads every element of every card. */
function isOwnerStorePage(): boolean {
  if (ownerCache?.gen === generation) return ownerCache.owner;
  const cards = [...findCards().values()];
  const owner = cards.length > 0 && cards.some(cardIsOwners);
  ownerCache = { gen: generation, owner };
  return owner;
}

// ---------------------------------------------------------------------------
// Creation date on every card - read from the image URL already on the page
// (TeePublic's Cloudinary URLs carry /v<unix seconds>/), so no extra requests.

/** Upload time carried in one element's image address(es), or null. Looks at
 *  src / srcset / lazy-load data-* attributes, an inline background-image, and
 *  the <source>s of a surrounding <picture>. */
function stampOf(img: HTMLElement): Date | null {
  const own = [img.getAttribute("src"), img.getAttribute("srcset"), img.getAttribute("data-src"),
    img.getAttribute("data-srcset"), img.getAttribute("data-lazy"), img.getAttribute("style")];
  const pic = img.parentElement?.tagName === "PICTURE"
    ? Array.from(img.parentElement.querySelectorAll("source")).flatMap((s) => [s.getAttribute("srcset"), s.getAttribute("data-srcset")])
    : [];
  for (const u of [...own, ...pic]) {
    const m = u?.match(STORE.imageUploadStamp);
    if (m) return new Date(Number(m[1] ?? m[2]) * 1000);
  }
  return null;
}

function uploadDate(card: HTMLElement): { date: Date; img: HTMLElement } | null {
  for (const img of Array.from(card.querySelectorAll<HTMLElement>("img, source"))) {
    const date = stampOf(img);
    if (date) return { date, img: img.tagName === "SOURCE" ? (img.parentElement?.querySelector("img") ?? img) : img };
  }
  return null;
}

/** An element's text, minus the badges TeePublic lays OVER the picture ("0 Sold",
 *  "12 Sold" on the owner's own store). Counting those as text stopped the climb
 *  inside the picture's frame, where the date was clipped out of sight. */
function textBesidesBadges(e: Element): string {
  return (e.textContent ?? "").replace(/\d[\d,]*\s*sold/gi, "").trim();
}

/** The design image's box: the highest ancestor of the <img> (inside the card)
 *  that holds no text - so the title and price stay below it. */
function imageBox(img: HTMLElement, card: HTMLElement): HTMLElement {
  let box = img;
  while (box.parentElement && box.parentElement !== card && !textBesidesBadges(box.parentElement)) {
    box = box.parentElement;
  }
  return box;
}

function paintDates(): void {
  for (const card of findCards().values()) ensureDateRow(card);
  // Every other dated design picture on the page - whatever store it is and
  // however TeePublic built that card (the owner's own store view doesn't
  // always match the card scan above). Read from the address alone.
  for (const img of Array.from(document.querySelectorAll<HTMLElement>('img, [style*="background-image"]'))) {
    if (img.dataset.higgsteeDated || img.closest(".higgstee-sd")) continue;
    const r = img.getBoundingClientRect();
    if (r.width < 100 || r.height < 100) continue; // a real design picture, not an icon
    const date = stampOf(img);
    if (!date) continue;
    img.dataset.higgsteeDated = "1";
    const box = pictureBox(img);
    if (box.previousElementSibling?.classList.contains("higgstee-sd-date")) continue;
    box.before(dateRow(date));
  }
}

/** The picture's own wrapper: climb while the parent holds no text and is about
 *  the picture's size, so the date sits above the picture, not above the page. */
function pictureBox(img: HTMLElement): HTMLElement {
  const w = img.getBoundingClientRect().width;
  let box = img;
  for (let i = 0; i < 6; i++) {
    const p = box.parentElement;
    if (!p || p === document.body || textBesidesBadges(p)) break;
    if (p.getBoundingClientRect().width > w * 1.5) break;
    box = p;
  }
  return box;
}

/** The card's date row, ABOVE the design picture - made now if it isn't there
 *  yet. Null when the card has no dated image. */
function ensureDateRow(card: HTMLElement): HTMLElement | null {
  const existing = card.querySelector<HTMLElement>(".higgstee-sd-date");
  if (existing) return existing;
  const found = uploadDate(card);
  if (!found) return null;
  found.img.dataset.higgsteeDated = "1";
  const row = dateRow(found.date);
  const box = imageBox(found.img, card);
  if (box === card || !box.parentElement) card.prepend(row);
  else box.before(row);
  return row;
}

/** The lime-on-dark date pill, in a centred row. */
function dateRow(d: Date): HTMLElement {
  // "2026/11/04 23:25:09 GMT", side-panel palette (lime on near-black), centred
  // just above the design so nothing covers the artwork.
  const p = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getUTCFullYear()}/${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())} GMT`;
  const row = el("div", "display:flex;justify-content:center;margin:2px 0 8px;pointer-events:none;");
  row.className = "higgstee-sd higgstee-sd-date";
  const pill = el("span",
    "display:inline-block;white-space:nowrap;background:#141414;color:#D6FF66;border:1px solid rgba(214,255,102,.45);" +
    "border-radius:999px;padding:3px 10px;font:600 11px/1.3 ui-monospace,'SFMono-Regular',Consolas,monospace;letter-spacing:.02em;" +
    "box-shadow:0 0 12px rgba(214,255,102,.18),0 2px 6px rgba(0,0,0,.35);pointer-events:auto;",
    stamp);
  pill.title = `Created ${d.toLocaleString()} (your time)`;
  row.appendChild(pill);
  return row;
}

/** /designs* = the uploader's pages (and the "…has been deleted." redirect). */
const onDesignsPage = () => location.pathname.startsWith("/designs");

async function init(): Promise<void> {
  // After a Delete TeePublic redirects to /designs/<id>; mid-run that's just a
  // stop on the way back to the store page (runLoop navigates back).
  const s = await getState();
  if (s?.active) void runLoop();
  else if (s && !onDesignsPage()) void render();

  // TeePublic swaps pages in place (no reload, so this script isn't re-run) and
  // can replace <body> wholesale - watch the whole document, re-check the URL on
  // every change, and put the bar back whenever it was thrown away.
  // One shared, throttled watcher (pageWatch.ts) - not an observer per feature.
  const scan = () => {
    if (onDesignsPage()) {
      bar?.remove(); bar = null;
      selecting = false; selected.clear();
      return;
    }
    paintDates();
    const owner = isOwnerStorePage();
    if (!bar?.isConnected && owner) { bar = null; void render(); }
    // Navigated in place to someone else's store: take the bar away (unless a
    // run or its summary is showing - that state lives in storage).
    if (bar?.isConnected && !owner) {
      void getState().then((st) => { if (!st && !isOwnerStorePage()) { bar?.remove(); bar = null; selecting = false; selected.clear(); paintOverlays(); } });
    }
    // Infinite scroll / re-rendered cards: keep the overlays on every card.
    if (selecting && document.querySelectorAll(".higgstee-sd-pick").length !== findCards().size) paintOverlays();
  };
  onPageChange(scan);
}

void init();
