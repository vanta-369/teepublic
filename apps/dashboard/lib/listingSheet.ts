// The Create Product listing table: one row per uploaded design image, the
// same six columns as the old upload template's metadata sheet. It produces
// the same ParsedRow[] the spreadsheet parser did, so validation, the design
// cards and buildQueue are unchanged. Each row's `raw` holds the cell text
// (what the table shows) plus `__image`, the stem of the design image the row
// belongs to; `metadata` is derived from them on every edit.
//
// The filename cell is typed/pasted like the others, but it never decides which
// artwork a row uploads: metadata.filename is always the row's own image. A
// filename cell that differs from it is an error (sheetIssues) that blocks Save.

import type { DesignMetadata } from "@teepublic/shared";
import { metadataFromRow, stemName, type ParsedRow } from "./parser";
import { applyBasicColor } from "./colorPresets";
import { defaultEnabledProducts, enforceAdultRule } from "./productGroups";

/** Every product type starts in Black; the design card changes it per design. */
const defaultColors = () => applyBasicColor("Black");
/** A row with no colour / no products chosen yet gets the defaults (Black;
 *  every product except Kids). Anything already chosen is kept. */
const withDefaults = (row: ParsedRow): ParsedRow => {
  const m = row.metadata;
  const colors = Object.keys(m.productColors ?? {}).length > 0 ? m.productColors : defaultColors();
  const products = (m.enabledProducts ?? []).length > 0 ? m.enabledProducts : defaultEnabledProducts();
  return colors === m.productColors && products === m.enabledProducts
    ? row
    : { ...row, metadata: { ...m, productColors: colors, enabledProducts: products } };
};

export const SHEET_COLUMNS = ["filename", "title", "primary_tag", "description", "adult_content", "supporting_tags"] as const;
export type SheetColumn = (typeof SHEET_COLUMNS)[number];
export type SheetCells = Record<SheetColumn, string>;

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** The cell text for a row - from `raw` when the table wrote it, else rebuilt
 *  from the metadata (rows saved by the old spreadsheet flow). */
export function cellsOf(row: ParsedRow): SheetCells {
  const raw = row.raw as Partial<Record<SheetColumn, unknown>>;
  if (!SHEET_COLUMNS.every((c) => typeof raw[c] === "string")) return cellsFromMetadata(row.metadata);
  return Object.fromEntries(SHEET_COLUMNS.map((c) => [c, raw[c]])) as SheetCells;
}

/** The stem of the design image this row belongs to (not the typed filename). */
export function imageOf(row: ParsedRow): string {
  const img = (row.raw as { __image?: unknown }).__image;
  return typeof img === "string" ? img : stemName(row.metadata.filename);
}

export function cellsFromMetadata(m: DesignMetadata): SheetCells {
  return {
    filename:        m.filename,
    title:           m.title,
    primary_tag:     m.primaryTag ?? "",
    description:     m.description,
    adult_content:   m.matureContent ? "Yes" : "No",
    supporting_tags: m.tags.join(", "),
  };
}

function withCells(row: ParsedRow, cells: SheetCells, image = imageOf(row)): ParsedRow {
  return {
    ...row,
    raw: { ...cells, __image: image },
    // filename = the row's own image, whatever the cell says. Colors and enabled
    // products aren't table columns - keep what the design card set for this row.
    // An adult design never keeps Kids products (enforceAdultRule).
    metadata: enforceAdultRule(metadataFromRow({ ...cells, filename: image }, row.metadata.productColors ?? {}, row.metadata.enabledProducts ?? [])),
  };
}

export function setCell(row: ParsedRow, col: SheetColumn, value: string): ParsedRow {
  return withCells(row, { ...cellsOf(row), [col]: value });
}

/** After a design card edits the metadata directly, bring the cells back in line
 *  (the typed filename stays as it was). */
export function syncCellsFromMetadata(row: ParsedRow): ParsedRow {
  return { ...row, raw: { ...cellsFromMetadata(row.metadata), filename: cellsOf(row).filename, __image: imageOf(row) } };
}

/** Exactly one row per image, in filename order (1, 2, … 10 - not 1, 10, 2).
 *  A row whose image is still there keeps everything typed into it. */
export function syncRowsToImages(rows: ParsedRow[], images: Map<string, { originalName: string }>): ParsedRow[] {
  const byImage = new Map(rows.map((r) => [imageOf(r), r]));
  return [...images.entries()]
    .sort(([, a], [, b]) => collator.compare(a.originalName, b.originalName))
    .map(([stem], i): ParsedRow => {
      const prev = byImage.get(stem);
      if (prev) return { ...withCells(withDefaults(prev), cellsOf(prev), stem), rowNumber: i + 1 };
      // A new row starts with its image's name in the filename cell; whatever is
      // pasted over it is checked against the image by sheetIssues.
      const base: ParsedRow = { rowNumber: 0, raw: {}, metadata: metadataFromRow({ filename: stem }, defaultColors(), defaultEnabledProducts()) };
      return { ...withCells(base, { ...cellsOf(base), filename: stem, adult_content: "No" }, stem), rowNumber: i + 1 };
    });
}

/** Fill the table from an uploaded listings spreadsheet (parseSpreadsheet's
 *  rows). Each sheet row goes to the design whose name matches its filename
 *  (`1` or `1.png` for 1.png); designs with no sheet row keep what they had.
 *  Colours and products the design card already set are kept unless the sheet
 *  gives its own. Returns exactly one row per image, like syncRowsToImages. */
export function applySheetRows(
  rows: ParsedRow[],
  sheet: ParsedRow[],
  images: Map<string, { originalName: string }>,
): ParsedRow[] {
  const fromSheet = new Map<string, ParsedRow>();
  for (const s of sheet) {
    const stem = stemName(s.metadata.filename);
    if (stem && images.has(stem) && !fromSheet.has(stem)) fromSheet.set(stem, s);
  }
  const byImage = new Map(rows.map((r) => [imageOf(r), r]));
  const merged: ParsedRow[] = [...images.keys()].flatMap((stem) => {
    const s = fromSheet.get(stem);
    const prev = byImage.get(stem);
    if (!s) return prev ? [prev] : [];
    const colors = Object.keys(s.metadata.productColors ?? {}).length > 0 ? s.metadata.productColors : prev?.metadata.productColors;
    const products = (s.metadata.enabledProducts ?? []).length > 0 ? s.metadata.enabledProducts : prev?.metadata.enabledProducts;
    const metadata = { ...s.metadata, productColors: colors ?? {}, enabledProducts: products ?? [] };
    return [{ rowNumber: 0, raw: { ...cellsFromMetadata(s.metadata), __image: stem }, metadata }];
  });
  return syncRowsToImages(merged, images);
}

/** Clipboard text from Excel / Google Sheets -> rows of cells. Tabs split
 *  columns, newlines split rows; a cell that itself holds a line break or tab
 *  comes wrapped in quotes with inner quotes doubled. */
export function parseClipboardGrid(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let i = 0;
  const s = text.replace(/\r\n?/g, "\n");
  while (i <= s.length) {
    let cell = "";
    if (s[i] === '"') {
      // Quoted only if a closing quote is followed by a tab, a newline or the end.
      let j = i + 1;
      let buf = "";
      let closed = false;
      while (j < s.length) {
        if (s[j] === '"' && s[j + 1] === '"') { buf += '"'; j += 2; continue; }
        if (s[j] === '"') {
          if (j + 1 >= s.length || s[j + 1] === "\t" || s[j + 1] === "\n") { closed = true; j++; }
          break;
        }
        buf += s[j++];
      }
      if (closed) { cell = buf; i = j; }
    }
    if (i < s.length && s[i] !== "\t" && s[i] !== "\n") {
      let j = i;
      while (j < s.length && s[j] !== "\t" && s[j] !== "\n") j++;
      cell += s.slice(i, j);
      i = j;
    }
    row.push(cell);
    if (i >= s.length) { out.push(row); break; }
    if (s[i] === "\n") { out.push(row); row = []; }
    i++;
  }
  // Excel ends a copy with a newline - drop the empty row it leaves.
  while (out.length > 0 && out[out.length - 1].every((c) => c === "")) out.pop();
  return out;
}

/** A rectangle of cells: rows r0..r1, columns c0..c1 (indexes into SHEET_COLUMNS), inclusive. */
export interface CellRange { r0: number; r1: number; c0: number; c1: number }

/** Write a grid of values with its top-left at (r0, c0), like an Excel paste.
 *  Lines beyond the last image are dropped and counted. */
export function writeGrid(rows: ParsedRow[], r0: number, c0: number, grid: string[][]): { rows: ParsedRow[]; dropped: number } {
  const next = rows.slice();
  grid.forEach((line, k) => {
    const r = r0 + k;
    if (r >= next.length) return;
    let cells = cellsOf(next[r]);
    line.forEach((value, c) => {
      const target = SHEET_COLUMNS[c0 + c];
      if (target) cells = { ...cells, [target]: value.trim() };
    });
    next[r] = withCells(next[r], cells);
  });
  return { rows: next, dropped: Math.max(0, r0 + grid.length - rows.length) };
}

/** Paste clipboard text at a selection. One value onto a bigger selection fills
 *  every selected cell (Excel does the same); anything else starts at the
 *  selection's top-left and spreads down/right. */
export function pasteAt(rows: ParsedRow[], sel: CellRange, text: string): { rows: ParsedRow[]; dropped: number } {
  const grid = parseClipboardGrid(text);
  if (grid.length === 0) return { rows, dropped: 0 };
  if (grid.length === 1 && grid[0].length === 1 && (sel.r1 > sel.r0 || sel.c1 > sel.c0)) {
    const fill = Array.from({ length: sel.r1 - sel.r0 + 1 }, () => Array(sel.c1 - sel.c0 + 1).fill(grid[0][0]));
    return writeGrid(rows, sel.r0, sel.c0, fill);
  }
  return writeGrid(rows, sel.r0, sel.c0, grid);
}

/** Paste starting at one cell (the listing table's first version; kept for callers/tests). */
export function pasteIntoRows(
  rows: ParsedRow[], rowIndex: number, col: SheetColumn, text: string,
): { rows: ParsedRow[]; dropped: number } {
  return writeGrid(rows, rowIndex, SHEET_COLUMNS.indexOf(col), parseClipboardGrid(text));
}

/** Delete key: empty every selected cell. */
export function clearRange(rows: ParsedRow[], sel: CellRange): ParsedRow[] {
  const blank = Array.from({ length: sel.r1 - sel.r0 + 1 }, () => Array(sel.c1 - sel.c0 + 1).fill(""));
  return writeGrid(rows, sel.r0, sel.c0, blank).rows;
}

/** Ctrl+D: copy the top row of the selection into the rows below it. */
export function fillDown(rows: ParsedRow[], sel: CellRange): ParsedRow[] {
  if (sel.r1 <= sel.r0) return rows;
  const top = cellsOf(rows[sel.r0]);
  const line = SHEET_COLUMNS.slice(sel.c0, sel.c1 + 1).map((c) => top[c]);
  return writeGrid(rows, sel.r0 + 1, sel.c0, Array.from({ length: sel.r1 - sel.r0 }, () => line)).rows;
}

/** Copy a selection as Excel-compatible text (tabs, newlines, quoted when needed). */
export function rangeToTsv(rows: ParsedRow[], sel: CellRange): string {
  const quote = (v: string) => (/[\t\n"]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines: string[] = [];
  for (let r = sel.r0; r <= sel.r1 && r < rows.length; r++) {
    const cells = cellsOf(rows[r]);
    lines.push(SHEET_COLUMNS.slice(sel.c0, sel.c1 + 1).map((c) => quote(cells[c])).join("\t"));
  }
  return lines.join("\n");
}

/** Undo history: the table text keyed by design image. Restoring by image (not
 *  position) stays correct even if images were added or removed in between. */
export type CellsSnapshot = Map<string, SheetCells>;
export const snapshotCells = (rows: ParsedRow[]): CellsSnapshot => new Map(rows.map((r) => [imageOf(r), cellsOf(r)]));
export function restoreCells(rows: ParsedRow[], snap: CellsSnapshot): ParsedRow[] {
  return rows.map((r) => { const c = snap.get(imageOf(r)); return c ? withCells(r, c) : r; });
}

/** Ctrl+Enter: put one value in every selected cell (a whole column, a block…). */
export function fillRange(rows: ParsedRow[], sel: CellRange, value: string): ParsedRow[] {
  const grid = Array.from({ length: sel.r1 - sel.r0 + 1 }, () => Array(sel.c1 - sel.c0 + 1).fill(value));
  return writeGrid(rows, sel.r0, sel.c0, grid).rows;
}

/** The fill handle: drag the selection's corner down to `toRow` and the
 *  selected rows repeat into the new ones (one row -> copied into each). */
export function fillHandle(rows: ParsedRow[], sel: CellRange, toRow: number): ParsedRow[] {
  if (toRow <= sel.r1) return rows;
  const height = sel.r1 - sel.r0 + 1;
  const lines = Array.from({ length: toRow - sel.r1 }, (_, k) => {
    const src = cellsOf(rows[sel.r0 + ((sel.r1 + 1 + k - sel.r0) % height)]);
    return SHEET_COLUMNS.slice(sel.c0, sel.c1 + 1).map((c) => src[c]);
  });
  return writeGrid(rows, sel.r1 + 1, sel.c0, lines).rows;
}

export const COLUMN_LABELS: Record<SheetColumn, string> = {
  filename: "filename", title: "title", primary_tag: "primary tag",
  description: "description", adult_content: "adult content", supporting_tags: "supporting tags",
};

export interface SheetIssue { row: number; col: SheetColumn; message: string }

/** What blocks Save (and Send): every column filled on every row, adult content
 *  a yes/no, and the filename the same as THAT ROW's design image name (30 for
 *  30.png; "30.png" typed is fine too). `row` is the table row index (0-based). */
export function sheetIssues(rows: ParsedRow[], imageStems: Set<string>): SheetIssue[] {
  const issues: SheetIssue[] = [];
  rows.forEach((row, r) => {
    const cells = cellsOf(row);
    const image = imageOf(row);
    if (!imageStems.has(image)) {
      issues.push({ row: r, col: "filename", message: `design "${image}" has no image` });
    } else if (cells.filename.trim() && stemName(cells.filename) !== image) {
      issues.push({ row: r, col: "filename", message: `filename "${cells.filename}" is not this design's name "${image}"` });
    }
    for (const col of SHEET_COLUMNS) {
      const v = cells[col].trim();
      if (!v) issues.push({ row: r, col, message: `${COLUMN_LABELS[col]} is empty` });
      else if (col === "adult_content" && !/^(yes|no|y|n|true|false|1|0)$/i.test(v)) {
        issues.push({ row: r, col, message: `adult content must be Yes or No (not "${v}")` });
      }
    }
  });
  return issues;
}

/** Which step of Create Product (From spreadsheet) to show. Derived from the
 *  batch, never stored, so a reload lands on the same step. */
export type CreatePhase = "upload" | "listings" | "configure";
export function createPhase(imageCount: number, issueCount: number): CreatePhase {
  if (imageCount === 0) return "upload";
  return issueCount > 0 ? "listings" : "configure";
}

/** Column names of the TeePublic upload template, in order - the export's header row. */
export const EXPORT_HEADERS = ["filename", "title", "Primary_tag", "description", "adult_content", "supporting_tags"] as const;

/** The table as spreadsheet rows (header first), exactly as typed - for Export. */
export function rowsToSheetData(rows: ParsedRow[]): string[][] {
  return [[...EXPORT_HEADERS], ...rows.map((r) => SHEET_COLUMNS.map((c) => cellsOf(r)[c]))];
}

// ── Colors sheet (the template's Sheet2_Colors) ─────────────────────────────

/** The colour column a T-shirt pick drives: choosing a T-shirt colour sets every
 *  product to its own closest TeePublic colour (Black -> Baseball Tee "Black/White"). */
export const LEAD_COLOR_SLUG = "t_shirt";

/** Set one product's colour on a row. On the T-shirt column the other products
 *  follow with their matched colours; on any other column only that cell moves. */
export function setRowColor(row: ParsedRow, slug: string, label: string): ParsedRow {
  const current = row.metadata.productColors ?? {};
  const productColors = slug === LEAD_COLOR_SLUG
    ? { ...current, ...applyBasicColor(label), [slug]: label }
    : { ...current, [slug]: label };
  return { ...row, metadata: { ...row.metadata, productColors } };
}

/** The same colour for one product on every row (the column header's picker). */
export function setColumnColor(rows: ParsedRow[], slug: string, label: string): ParsedRow[] {
  return rows.map((r) => setRowColor(r, slug, label));
}

/** The colours as the template's Sheet2_Colors rows (header first), for Export. */
export function colorsToSheetData(rows: ParsedRow[], slugs: string[]): string[][] {
  return [
    ["filename", ...slugs.map((s) => `${s}_color`)],
    ...rows.map((r) => [imageOf(r), ...slugs.map((s) => r.metadata.productColors?.[s] ?? "")]),
  ];
}
