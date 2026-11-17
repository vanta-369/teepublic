// Expand dropped files: any .zip is unzipped client-side (fflate) and its
// image / spreadsheet entries are pulled out. Used by both upload flows so a
// user can drop a single folder.zip of designs instead of selecting many files.

import { unzipSync } from "fflate";

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;
const SHEET_EXT = /\.(xlsx|xls|csv)$/i;

function mimeFor(name: string): string {
  const n = name.toLowerCase();
  if (n.endsWith(".png")) return "image/png";
  if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
  if (n.endsWith(".webp")) return "image/webp";
  if (n.endsWith(".csv")) return "text/csv";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  return "application/octet-stream";
}

export function isZip(file: File): boolean {
  return /\.zip$/i.test(file.name) || file.type === "application/zip" || file.type === "application/x-zip-compressed";
}

/** Unzip a .zip File into individual image/spreadsheet Files (dirs, hidden and
 *  macOS resource-fork entries skipped). */
async function unzipToFiles(zip: File): Promise<File[]> {
  const buf = new Uint8Array(await zip.arrayBuffer());
  const entries = unzipSync(buf, {
    filter: (f) => !f.name.startsWith("__MACOSX/") && !f.name.endsWith("/"),
  });
  const out: File[] = [];
  for (const [path, data] of Object.entries(entries)) {
    const base = path.split("/").pop() ?? path;
    if (!base || base.startsWith(".")) continue;       // hidden / dotfiles
    if (!IMAGE_EXT.test(base) && !SHEET_EXT.test(base)) continue;
    out.push(new File([data], base, { type: mimeFor(base) }));
  }
  return out;
}

/** Turn a dropped file list into its real image + spreadsheet files, expanding
 *  any zips. Non-zip files pass through unchanged. */
export async function expandDroppedFiles(
  files: File[],
): Promise<{ images: File[]; sheets: File[] }> {
  const images: File[] = [];
  const sheets: File[] = [];
  const add = (f: File) => {
    if (IMAGE_EXT.test(f.name)) images.push(f);
    else if (SHEET_EXT.test(f.name)) sheets.push(f);
  };
  for (const f of files) {
    if (isZip(f)) {
      try {
        for (const e of await unzipToFiles(f)) add(e);
      } catch {
        /* not a readable zip — ignore */
      }
    } else {
      add(f);
    }
  }
  // Stable, human order (1.png, 2.png, …, 10.png) by natural filename sort.
  const natural = (a: File, b: File) =>
    a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
  images.sort(natural);
  sheets.sort(natural);
  return { images, sheets };
}
