// Listing exporter. On any TeePublic page with design cards (a store, a search),
// a floating icon opens a panel that reads every design on the page - title,
// main tag, supporting tags, description - from each design's PUBLIC page, and
// lets you copy them or download an .xlsx. Everything stays in this tab: the
// pages are fetched from teepublic.com with the user's own session, parsed
// here, and nothing is stored or sent anywhere else.
// Parsing + the .xlsx writer: lib/listingCore.ts. Page selectors: LISTING.

import { findCards, idFromHref } from "./storeDelete";
import { parseListing, rowsToTable, tagsLine, toXlsx, type ListingRow } from "../lib/listingCore";
import { sleep } from "../lib/delays";
import { onPageChange } from "./pageWatch";

const LIME = "#D6FF66";
const INK = "#141414";
const FONT = "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif";

/** Read once per tab - reopening the panel or scrolling for more doesn't refetch. */
const cache = new Map<string, ListingRow>();
const errors = new Map<string, string>();

let fab: HTMLButtonElement | null = null;
let panel: HTMLDivElement | null = null;
let runToken = 0;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, css: string, text = ""): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  e.style.cssText = css;
  e.textContent = text;
  return e;
}

const BTN = `border-radius:999px;padding:7px 12px;font:600 12px ${FONT};cursor:pointer;white-space:nowrap;`;
const ghostBtn = BTN + `background:rgba(214,255,102,.08);color:${LIME};border:1px solid rgba(214,255,102,.35);`;
const primaryBtn = BTN + `background:${LIME};color:${INK};border:1px solid ${LIME};`;
const smallBtn = `border-radius:999px;padding:3px 9px;font:600 11px ${FONT};cursor:pointer;white-space:nowrap;` +
  `background:transparent;color:${LIME};border:1px solid rgba(214,255,102,.35);`;

function button(text: string, css: string, onClick: (b: HTMLButtonElement) => void): HTMLButtonElement {
  const b = el("button", css, text);
  b.type = "button";
  b.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); onClick(b); });
  return b;
}

async function copy(text: string, b: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = el("textarea", "position:fixed;left:-9999px;top:0;");
    ta.value = text;
    document.documentElement.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
  const was = b.textContent;
  b.textContent = "Copied ✓";
  setTimeout(() => { b.textContent = was; }, 1200);
}

// ---------------------------------------------------------------------------
// What's on the page

interface Target { id: string; url: string; image: string }

/** The design picture already shown on the card (no extra download). */
function cardImage(card: HTMLElement): string {
  const imgs = Array.from(card.querySelectorAll<HTMLImageElement>("img")).filter((i) => !i.closest(".higgstee-sd"));
  const pick = imgs.find((i) => /\/designs\//.test(i.currentSrc || i.src)) ?? imgs[0];
  return pick ? (pick.currentSrc || pick.src || "") : "";
}

function targets(): Target[] {
  const out: Target[] = [];
  for (const [id, card] of findCards()) {
    // Prefer the card's own listing link; an owner's /designs/<id>/edit link isn't the public page.
    const href = Array.from(card.querySelectorAll<HTMLAnchorElement>("a[href]"))
      .map((a) => a.getAttribute("href") ?? "")
      .find((h) => idFromHref(h) === id && !/^\/designs\//.test(safePath(h)));
    out.push({ id, url: location.origin + (href ? safePath(href) : `/t-shirt/${id}`), image: cardImage(card) });
  }
  return out;
}

function safePath(href: string): string {
  try { return new URL(href, location.href).pathname; } catch { return href; }
}

async function readOne(t: Target): Promise<void> {
  try {
    const res = await fetch(t.url, { credentials: "include" });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const row = parseListing(doc, html, t.id, res.url || t.url);
    row.image = t.image;
    if (!row.title && !row.mainTag) throw new Error("no listing on that page");
    cache.set(t.id, row);
    errors.delete(t.id);
  } catch (e) {
    errors.set(t.id, (e as Error).message);
  }
}

/** Three at a time, with a short pause - gentle on TeePublic. */
async function readAll(list: Target[], token: number, onProgress: () => void): Promise<void> {
  const todo = list.filter((t) => !cache.has(t.id));
  let next = 0;
  const worker = async () => {
    while (token === runToken && next < todo.length) {
      const t = todo[next++];
      await readOne(t);
      if (token !== runToken) return;
      onProgress();
      await sleep(250 + Math.random() * 250);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
}

// ---------------------------------------------------------------------------
// The panel

function chip(text: string, main = false): HTMLSpanElement {
  return el("span",
    `display:inline-block;margin:0 4px 4px 0;padding:2px 8px;border-radius:999px;font:600 11px ${FONT};` +
    (main ? `background:${LIME};color:${INK};` : "background:#2a2a2a;color:#e5e5e5;border:1px solid rgba(255,255,255,.08);"),
    text);
}

function thumb(t: Target, href: string): HTMLElement {
  const a = el("a", "flex:none;display:block;width:76px;height:76px;border-radius:10px;overflow:hidden;" +
    "background:#2a2a2a;border:1px solid rgba(255,255,255,.08);");
  a.href = href;
  a.target = "_blank";
  a.rel = "noopener";
  if (t.image) {
    const img = el("img", "width:100%;height:100%;object-fit:cover;display:block;");
    img.src = t.image;
    img.alt = "";
    img.loading = "lazy";
    a.appendChild(img);
    a.style.cursor = "zoom-in";
    a.addEventListener("mouseenter", () => showPreview(t.image, a));
    a.addEventListener("mouseleave", hidePreview);
  }
  return a;
}

// Hover preview: the same picture, big, beside the panel.
let preview: HTMLDivElement | null = null;
let previewAnchor: HTMLElement | null = null;

/** TeePublic's CDN serves s_313 on cards and s_630 at most (larger sizes 404, checked 2026-11). */
const largeImage = (url: string) => url.replace(/([,:])s_\d+(?=[,.])/, "$1s_630");

function showPreview(src: string, anchor: HTMLElement): void {
  hidePreview();
  if (!panel) return;
  const p = panel.getBoundingClientRect();
  const a = anchor.getBoundingClientRect();
  const room = p.left - 32;                                  // space left of the panel
  const size = Math.min(460, window.innerHeight - 32, room >= 220 ? room : window.innerWidth - 32);
  const left = room >= 220 ? p.left - size - 16 : Math.max(16, (window.innerWidth - size) / 2);
  const top = Math.min(Math.max(16, a.top + a.height / 2 - size / 2), window.innerHeight - size - 16);

  preview = el("div",
    `position:fixed;left:${left}px;top:${top}px;width:${size}px;height:${size}px;z-index:2147483002;pointer-events:none;` +
    `background:#fff;border:1px solid rgba(214,255,102,.45);border-radius:16px;overflow:hidden;` +
    `box-shadow:0 24px 70px rgba(0,0,0,.5),0 0 24px rgba(214,255,102,.15);`);
  preview.className = "higgstee-sd higgstee-le";
  const img = el("img", "width:100%;height:100%;object-fit:contain;display:block;");
  img.alt = "";
  img.src = src;                                            // small one shows instantly (cached)…
  const big = new Image();
  big.onload = () => { img.src = big.src; };                // …then swaps to the sharp one
  big.src = largeImage(src);
  preview.appendChild(img);
  document.documentElement.appendChild(preview);
  previewAnchor = anchor;
}

function hidePreview(): void {
  preview?.remove();
  preview = null;
  previewAnchor = null;
}

function rowView(t: Target, index: number): HTMLDivElement {
  const outer = el("div", "display:flex;gap:12px;align-items:flex-start;padding:12px;border:1px solid rgba(255,255,255,.07);" +
    "border-radius:12px;background:#1b1b1b;margin-bottom:8px;");
  const row = cache.get(t.id);
  outer.appendChild(thumb(t, row?.url ?? t.url));
  const box = el("div", "flex:1;min-width:0;");
  outer.appendChild(box);
  const top = el("div", "display:flex;gap:8px;align-items:flex-start;margin-bottom:8px;");
  const num = el("span", `flex:none;color:#a1a1a1;font:600 11px ${FONT};padding-top:2px;`, String(index + 1));
  top.appendChild(num);

  if (!row) {
    const err = errors.get(t.id);
    top.appendChild(el("span", `color:${err ? "#f87171" : "#a1a1a1"};font:500 12px ${FONT};`,
      err ? `Couldn't read design ${t.id}: ${err}` : `Reading design ${t.id}…`));
    box.appendChild(top);
    return outer;
  }

  const title = el("a", `flex:1;color:#f5f5f5;font:700 13px/1.35 ${FONT};text-decoration:none;`, row.title || "(no title)");
  title.href = row.url;
  title.target = "_blank";
  title.rel = "noopener";
  top.appendChild(title);
  top.appendChild(button("Copy title", smallBtn, (b) => void copy(row.title, b)));
  box.appendChild(top);

  const tags = el("div", "margin-bottom:6px;");
  if (row.mainTag) tags.appendChild(chip(row.mainTag, true));
  for (const tg of row.tags) tags.appendChild(chip(tg));
  if (!row.mainTag && row.tags.length === 0) tags.appendChild(el("span", `color:#a1a1a1;font:500 12px ${FONT};`, "No tags"));
  box.appendChild(tags);

  if (row.description) {
    box.appendChild(el("div",
      `color:#a1a1a1;font:400 12px/1.45 ${FONT};display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden;margin-bottom:8px;`,
      row.description));
  }

  const actions = el("div", "display:flex;gap:6px;flex-wrap:wrap;");
  actions.appendChild(button("Copy tags", smallBtn, (b) => void copy(tagsLine(row), b)));
  actions.appendChild(button("Copy supporting tags", smallBtn, (b) => void copy(row.tags.join(", "), b)));
  if (row.description) actions.appendChild(button("Copy description", smallBtn, (b) => void copy(row.description, b)));
  box.appendChild(actions);
  return outer;
}

function download(rows: ListingRow[]): void {
  const bytes = toXlsx(rowsToTable(rows));
  const blob = new Blob([bytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const slug = location.pathname.replace(/^\/+|\/+$/g, "").replace(/[^a-z0-9]+/gi, "-").slice(0, 40) || "teepublic";
  const day = new Date().toISOString().slice(0, 10);
  const a = el("a", "display:none;");
  a.href = URL.createObjectURL(blob);
  a.download = `teepublic-listings-${slug}-${day}.xlsx`;
  document.documentElement.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

function openPanel(): void {
  closePanel();
  const list = targets();
  const token = ++runToken;

  panel = el("div",
    `position:fixed;top:16px;right:16px;bottom:16px;width:min(460px,calc(100vw - 32px));z-index:2147483001;` +
    `display:flex;flex-direction:column;background:${INK};color:#f5f5f5;border:1px solid rgba(214,255,102,.25);` +
    `border-radius:16px;box-shadow:0 20px 60px rgba(0,0,0,.45),0 0 24px rgba(214,255,102,.08);font:500 13px ${FONT};`);
  panel.className = "higgstee-sd higgstee-le";

  const head = el("div", "display:flex;align-items:center;gap:10px;padding:14px 16px 10px;");
  head.appendChild(el("span", `color:${LIME};font:800 15px ${FONT};letter-spacing:.02em;`, "Listings"));
  const status = el("span", `flex:1;color:#a1a1a1;font:500 12px ${FONT};`);
  head.appendChild(status);
  head.appendChild(button("✕", `background:transparent;border:0;color:#a1a1a1;font:600 16px ${FONT};cursor:pointer;padding:2px 6px;`, closePanel));
  panel.appendChild(head);

  const done = () => list.map((t) => cache.get(t.id)).filter((r): r is ListingRow => !!r);
  const tools = el("div", "display:flex;gap:6px;flex-wrap:wrap;padding:0 16px 12px;border-bottom:1px solid rgba(255,255,255,.07);");
  tools.appendChild(button("Download Excel", primaryBtn, () => { const r = done(); if (r.length) download(r); }));
  tools.appendChild(button("Copy all titles", ghostBtn, (b) => void copy(done().map((r) => r.title).join("\n"), b)));
  tools.appendChild(button("Copy all tags", ghostBtn, (b) => void copy(done().map(tagsLine).join("\n"), b)));
  panel.appendChild(tools);

  const body = el("div", "flex:1;overflow:auto;padding:12px 16px;");
  body.addEventListener("scroll", hidePreview, { passive: true });
  panel.appendChild(body);
  document.documentElement.appendChild(panel);

  const paint = () => {
    if (token !== runToken || !panel) return;
    const read = list.filter((t) => cache.has(t.id) || errors.has(t.id)).length;
    const failed = list.filter((t) => !cache.has(t.id) && errors.has(t.id)).length;
    status.textContent = list.length === 0 ? "No designs on this page"
      : read < list.length ? `Reading ${read} of ${list.length}…`
      : `${list.length - failed} design${list.length - failed === 1 ? "" : "s"}${failed ? ` · ${failed} couldn't be read` : ""}`;
    const scroll = body.scrollTop;
    body.replaceChildren(...list.map(rowView));
    body.scrollTop = scroll;
    if (previewAnchor && !previewAnchor.isConnected) hidePreview(); // its row was redrawn
  };
  paint();
  void readAll(list, token, paint).then(paint);
}

function closePanel(): void {
  runToken++;
  hidePreview();
  panel?.remove();
  panel = null;
}

// ---------------------------------------------------------------------------
// The icon - only where there are design cards, never on the uploader's /designs pages

function showFab(): void {
  if (fab?.isConnected) return;
  fab = el("button",
    `position:fixed;right:22px;top:120px;z-index:2147483000;width:48px;height:48px;border-radius:50%;cursor:pointer;` +
    `display:flex;align-items:center;justify-content:center;background:${INK};border:1px solid rgba(214,255,102,.55);` +
    `box-shadow:0 0 16px rgba(214,255,102,.25),0 4px 14px rgba(0,0,0,.35);padding:0;`);
  fab.type = "button";
  fab.className = "higgstee-sd higgstee-le";
  fab.title = "Export listings on this page (Higgstee)";
  // Spreadsheet-with-arrow icon, drawn inline (no network, no innerHTML from the page).
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", LIME);
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  for (const d of ["M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z", "M14 3v6h6", "M8 13h8", "M8 17h5", "M17 15v5", "M14.5 17.5 17 20l2.5-2.5"]) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.appendChild(p);
  }
  fab.appendChild(svg);
  fab.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); if (panel) closePanel(); else openPanel(); });
  document.documentElement.appendChild(fab); // outside <body>, which TeePublic may replace
}

function scan(): void {
  const eligible = !location.pathname.startsWith("/designs") && findCards().size > 0;
  if (eligible) showFab();
  else { fab?.remove(); fab = null; }
}

onPageChange(scan); // the shared, throttled page watcher
