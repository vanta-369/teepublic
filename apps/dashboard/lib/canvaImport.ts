import { parseCanvaExportHash } from "@teepublic/shared";
import { sendToExtension } from "./bridge";
import { expandDroppedFiles } from "./zip";
import { unzipSync } from "fflate";

export { parseCanvaExportHash };

let pendingExport: { url: string; title: string } | null = null;

export function getPendingCanvaExport() {
  const source = parseCanvaExportHash(window.location.hash);
  if (source) {
    pendingExport = source;
    window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
  }
  return pendingExport;
}

export async function importCanvaPages(source: { url: string; title: string }): Promise<File[]> {
  const response = await sendToExtension({ type: "CANVA_EXPORT_FETCH", url: source.url });
  if (!response.ok) throw new Error(response.error);
  const data = response.data as { base64?: string } | undefined;
  if (!data?.base64) throw new Error("Update the Higgstee extension to import Canva pages.");
  const bytes = Uint8Array.from(atob(data.base64), (c) => c.charCodeAt(0));
  let expandedSize = 0;
  let count = 0;
  const entries = unzipSync(bytes, { filter: (entry) => {
    expandedSize += entry.originalSize;
    if (expandedSize > 128 * 1024 * 1024 || ++count > 1000) {
      throw new Error("Canva export is too large when expanded. Grab fewer pages per batch.");
    }
    return /\.png$/i.test(entry.name) && !entry.name.startsWith("__MACOSX/");
  } });
  const pageFiles = Object.entries(entries).map(([name, content]) =>
    new File([content], name.split("/").pop() ?? name, { type: "image/png" }));
  const { images } = await expandDroppedFiles(pageFiles);
  if (!images.length) throw new Error("No page images were found in the Canva export.");
  // Preserve Canva's page filenames and order for spreadsheet matching.
  return images;
}

export function clearPendingCanvaExport() { pendingExport = null; }
