// The listing exporter's pure half: read one public TeePublic design page into
// a row, and write rows out as a real .xlsx. No chrome.*, no network - the
// content script (content/listingExport.ts) fetches and draws; tests pin this
// (tests/listing-export.test.ts). Nothing here ever reaches Higgstee's servers.

import { zipSync, strToU8 } from "fflate";
import { LISTING } from "./selectors";

export interface ListingRow {
  id: string;
  url: string;
  title: string;
  mainTag: string;
  /** Artist-applied tags other than the main tag, in page order. */
  tags: string[];
  description: string;
  /** The card's picture URL (TeePublic's CDN), filled in by the content script. */
  image?: string;
}

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();

/** "<Title> - <Main Tag> - <Product>" -> "<Title>" (the title itself may contain " - "). */
export function titleFromHeading(titleAttr: string, text: string): string {
  const parts = clean(titleAttr).split(" - ");
  if (parts.length >= 3) return parts.slice(0, -2).join(" - ");
  const product = parts.length === 2 ? parts[1] : "";
  const t = clean(text);
  return product && t.toLowerCase().endsWith(" " + product.toLowerCase()) ? t.slice(0, -product.length - 1) : t || parts[0];
}

/** The tag pills minus the main tag (case-insensitive), deduplicated, order kept. */
export function supportingTags(all: string[], mainTag: string): string[] {
  const seen = new Set([mainTag.toLowerCase()]);
  const out: string[] = [];
  for (const raw of all) {
    const t = clean(raw);
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
  }
  return out;
}

/** Main tag first, then the rest - the form TeePublic's tag field takes. */
export const tagsLine = (r: Pick<ListingRow, "mainTag" | "tags">) => [r.mainTag, ...r.tags].filter(Boolean).join(", ");

const first = (doc: ParentNode, sels: readonly string[]) => {
  for (const s of sels) { const e = doc.querySelector(s); if (e) return e; }
  return null;
};

/** Parse a fetched design page. `html` is the raw text (the main tag sits in a script). */
export function parseListing(doc: Document, html: string, id: string, url: string): ListingRow {
  const h1 = first(doc, LISTING.heading);
  const og = clean(doc.querySelector(LISTING.ogTitle)?.getAttribute("content")).replace(/ by [^ ]+$/, "");
  const title = (h1 && titleFromHeading(h1.getAttribute("title") ?? "", h1.textContent ?? "")) || og;

  const all: string[] = [];
  for (const sel of LISTING.tagLinks) {
    for (const a of Array.from(doc.querySelectorAll(sel))) all.push(a.getAttribute("data-gtm-result") ?? a.textContent ?? "");
    if (all.length) break;
  }

  const js = html.match(LISTING.primaryTagJs)?.[1];
  let mainTag = js ? clean(JSON.parse(`"${js}"`) as string) : "";
  if (!mainTag) {
    const h2 = clean(first(doc, LISTING.primaryTagHeading)?.textContent);
    const product = clean(h1?.getAttribute("title")).split(" - ").pop() ?? "";
    mainTag = product && h2.toLowerCase().endsWith(" " + product.toLowerCase()) ? h2.slice(0, -product.length - 1) : h2;
  }
  if (!mainTag) mainTag = clean(all[0]);
  // The page's main tag is lower-case in the script; use the pill's spelling when one matches.
  mainTag = all.map(clean).find((t) => t.toLowerCase() === mainTag.toLowerCase()) ?? mainTag;

  const description = clean(first(doc, LISTING.description)?.textContent)
    || clean(doc.querySelector(LISTING.ogDescription)?.getAttribute("content"));

  return { id, url, title, mainTag, tags: supportingTags(all, mainTag), description };
}

/** Just the tags (main first) from a design page's raw HTML - no DOM needed, so
 *  many pages can be read without building a document for each. */
export function tagsFromHtml(html: string): string[] {
  const all: string[] = [];
  const pill = /data-gtm-name="designersAppliedTags"[^>]*?data-gtm-result="([^"]*)"/g;
  for (let m: RegExpExecArray | null; (m = pill.exec(html));) {
    all.push(m[1].replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'"));
  }
  const js = html.match(LISTING.primaryTagJs)?.[1];
  let main = "";
  try { main = js ? clean(JSON.parse(`"${js}"`) as string) : ""; } catch { /* malformed: fall back below */ }
  if (!main) main = clean(all[0]);
  main = all.map(clean).find((t) => t.toLowerCase() === main.toLowerCase()) ?? main;
  return [main, ...supportingTags(all, main)].filter(Boolean);
}

/** The design's picture from its public page: og:image, minus TeePublic's
 *  watermark/banner flags, at card size (s_313; the CDN serves 313 and 630). */
export function designImageFromHtml(html: string): string {
  const m = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
    ?? html.match(/<meta[^>]+content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
  if (!m) return "";
  const url = m[1].replace(/&amp;/g, "&");
  if (!/^https:\/\/images\.teepublic\.com\//.test(url)) return "";
  return url.replace(/,(?:bnr_\d+|wmk)(?=[,.])/g, "").replace(/([,:])s_\d+(?=[,.])/, "$1s_313");
}

// ---------------------------------------------------------------------------
// .xlsx - the smallest valid workbook: one sheet, inline strings, a bold header.

// Characters XML 1.0 forbids (Excel refuses the file). Built from char codes on
// purpose: written as a regex literal, esbuild emits U+FFFE/U+FFFF verbatim into
// the bundle, and Chrome then refuses to load the content script ("isn't UTF-8").
const notXml = (c: number) => (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) || c === 0xfffe || c === 0xffff;
const xml = (s: string) =>
  Array.from(s).filter((ch) => !notXml(ch.codePointAt(0)!)).join("")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const col = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };

export const XLSX_HEADER = ["Design ID", "Title", "Main Tag", "Supporting Tags", "All Tags", "Description", "URL", "Image URL"];

/** `extra` appends columns after the standard ones. */
export function rowsToTable(rows: ListingRow[], extra?: { head: string[]; cells: (r: ListingRow) => string[] }): string[][] {
  return [
    [...XLSX_HEADER, ...(extra?.head ?? [])],
    ...rows.map((r) => [r.id, r.title, r.mainTag, r.tags.join(", "), tagsLine(r), r.description, r.url, r.image ?? "", ...(extra?.cells(r) ?? [])]),
  ];
}

export function toXlsx(table: string[][]): Uint8Array {
  const sheetRows = table.map((cells, r) =>
    `<row r="${r + 1}">` + cells.map((v, c) =>
      `<c r="${col(c)}${r + 1}" t="inlineStr"${r === 0 ? ' s="1"' : ""}><is><t xml:space="preserve">${xml(v ?? "")}</t></is></c>`).join("") + "</row>").join("");
  const widths = [12, 40, 20, 50, 60, 60, 45, 45].map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("");
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files: Record<string, string> = {
    "[Content_Types].xml": `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`,
    "_rels/.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    "xl/workbook.xml": `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Listings" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    "xl/_rels/workbook.xml.rels": `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
    "xl/styles.xml": `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="2"><xf/><xf fontId="1" applyFont="1"/></cellXfs></styleSheet>`,
    "xl/worksheets/sheet1.xml": `${head}<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><cols>${widths}</cols><sheetData>${sheetRows}</sheetData></worksheet>`,
  };
  return zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)])), { level: 6 });
}
