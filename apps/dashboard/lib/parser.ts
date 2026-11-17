// Spreadsheet → DesignMetadata[]. Accepts xlsx (multi-sheet) and csv (single sheet).
//
// Multi-sheet xlsx layout (sheets are detected by column shape, NOT by name):
//   Sheet "metadata" — has a `title` column. One row per design.
//     filename | title | primary_tag | description | supporting_tags | adult_content
//   Sheet "colors"   — has any *_color / *_colors column. One row per design.
//     filename | t_shirt_color | hoodie_color | tank_color | ... | product_colors
//   Sheet "products" — has both `product` and `enabled` columns. Global on/off list.
//     product (e.g. "T-Shirt") | enabled (On/Off)
//
// CSV: treated as a single metadata sheet — no colors, no product enablement.

import * as XLSX from "xlsx";
import Papa from "papaparse";
import type { DesignMetadata, MatchResult } from "@teepublic/shared";
import { resolveProductColors } from "@teepublic/shared";
import { resolvePerProductColors } from "./colorPresets";

const COLUMN_ALIASES = {
  filename:      ["filename", "file", "image", "image_name", "design"],
  title:         ["title", "name"],
  description:   ["description", "desc"],
  primaryTag:    ["primary_tag", "primary tag", "primary", "category", "main_tag"],
  tags:          ["supporting_tags", "supporting tags", "tags", "keywords"],
  matureContent: ["adult_content", "adult content", "mature_content", "mature content", "mature", "adult", "nsfw"],
} as const;

export interface ParsedRow {
  rowNumber: number;
  raw: Record<string, unknown>;
  metadata: DesignMetadata;
  /** Per-slug audit of the Excel "requested" → TeePublic catalog resolution.
   *  Lets the dashboard UI show "Requested: White → Resolved: Oatmeal Heather
   *  (family)" badges and offer per-design overrides. */
  colorAudit?: Record<string, MatchResult>;
  /** Original requested colors (before catalog reconciliation), preserved so
   *  the UI can show both sides of the resolution. */
  requestedProductColors?: Record<string, string>;
}

function pick(row: Record<string, unknown>, aliases: readonly string[]): unknown {
  const lowered: Record<string, unknown> = {};
  for (const k of Object.keys(row)) lowered[k.toLowerCase().trim()] = row[k];
  for (const a of aliases) if (a in lowered) return lowered[a];
  return undefined;
}

function toBool(v: unknown): boolean {
  if (v == null) return false;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "yes" || s === "1" || s === "y" || s === "on";
}

function toList(v: unknown): string[] {
  if (v == null) return [];
  return String(v).split(/[,;]/).map((s) => s.trim()).filter(Boolean);
}

// Strip a known image extension and lowercase. "1.PNG" → "1", "TIGER" → "tiger".
export function stemName(name: string): string {
  return name.toLowerCase().trim().replace(/\.(png|jpe?g|webp|gif|tiff?|bmp)$/i, "");
}

function classifySheet(rows: Record<string, unknown>[]): "metadata" | "colors" | "products" | "unknown" {
  if (rows.length === 0) return "unknown";
  const cols = Object.keys(rows[0]).map((k) => k.toLowerCase().trim());
  if (cols.includes("title")) return "metadata";
  if (cols.some((c) => /_colors?$/.test(c))) return "colors";
  if (cols.includes("product") && cols.includes("enabled")) return "products";
  return "unknown";
}

function readColors(row: Record<string, unknown>): Record<string, string> {
  const colors: Record<string, string> = {};
  for (const [key, val] of Object.entries(row)) {
    const k = key.toLowerCase().trim();
    if (k === "filename") continue;
    if (!/_colors?$/.test(k)) continue;
    const slug = k.replace(/_colors?$/, "");
    const v = String(val ?? "").trim();
    if (v) colors[slug] = v;
  }
  return colors;
}

export function metadataFromRow(
  raw: Record<string, unknown>,
  productColors: Record<string, string>,
  enabledProducts: string[]
): DesignMetadata {
  return {
    filename:        String(pick(raw, COLUMN_ALIASES.filename) ?? "").trim(),
    title:           String(pick(raw, COLUMN_ALIASES.title) ?? "").trim(),
    description:     String(pick(raw, COLUMN_ALIASES.description) ?? "").trim(),
    primaryTag:      String(pick(raw, COLUMN_ALIASES.primaryTag) ?? "").trim() || undefined,
    tags:            toList(pick(raw, COLUMN_ALIASES.tags)),
    matureContent:   toBool(pick(raw, COLUMN_ALIASES.matureContent)),
    productColors,
    enabledProducts,
  };
}

export async function parseSpreadsheet(file: File): Promise<ParsedRow[]> {
  const name = file.name.toLowerCase();
  if (name.endsWith(".csv")) return parseCsv(file);
  return parseXlsx(file);
}

async function parseCsv(file: File): Promise<ParsedRow[]> {
  const text = await file.text();
  const result = Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });
  return result.data.map((raw, i) => ({
    rowNumber: i + 2,
    raw,
    metadata: metadataFromRow(raw, {}, []),
  }));
}

async function parseXlsx(file: File): Promise<ParsedRow[]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });

  let metadataRows: Record<string, unknown>[] = [];
  let colorsRows:   Record<string, unknown>[] = [];
  let productsRows: Record<string, unknown>[] = [];

  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[sheetName], { defval: "" });
    switch (classifySheet(rows)) {
      case "metadata": metadataRows = rows; break;
      case "colors":   colorsRows   = rows; break;
      case "products": productsRows = rows; break;
    }
  }

  // colors → keyed by filename stem
  const colorsByStem = new Map<string, Record<string, string>>();
  for (const row of colorsRows) {
    const filename = String(pick(row, COLUMN_ALIASES.filename) ?? "").trim();
    if (!filename) continue;
    colorsByStem.set(stemName(filename), readColors(row));
  }

  // global enabled products
  const enabledProducts: string[] = [];
  for (const row of productsRows) {
    const product = String(pick(row, ["product", "name"]) ?? "").trim();
    if (product && toBool(pick(row, ["enabled", "on", "active"]))) {
      enabledProducts.push(product);
    }
  }

  return metadataRows.map((raw, i) => {
    const filename = String(pick(raw, COLUMN_ALIASES.filename) ?? "").trim();
    const requested = colorsByStem.get(stemName(filename)) ?? {};
    // Resolve each cell using the same solid-preferring matcher the
    // AI-generate page's Basic Colors row uses: `hats_color = "white"` →
    // "Heather", `bags_color = "white"` → "Light Grey", instead of the
    // shared resolver's combo picks. Audit is still produced from the
    // shared resolver so the UI's "Requested → Resolved (reason)" badges
    // continue to work.
    const resolved = resolvePerProductColors(requested);
    const { audit } = resolveProductColors(requested);
    return {
      rowNumber: i + 2,
      raw,
      metadata: metadataFromRow(raw, resolved, enabledProducts),
      colorAudit: audit,
      requestedProductColors: requested,
    };
  });
}
