// Canva export URLs are temporary bearer links. Never persist or log them.
export const CANVA_EXPORT_HASH = "#canva-export=";
export const MAX_CANVA_EXPORT_BYTES = 32 * 1024 * 1024;

export function validateCanvaExportUrl(value: unknown): string {
  if (typeof value !== "string" || value.length > 12000) throw new Error("Invalid Canva export link.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "export-download.canva.com" ||
      url.username || url.password || (url.port && url.port !== "443")) {
    throw new Error("Expected an official Canva export link.");
  }
  return url.href;
}

export function parseCanvaExportHash(hash: string): { url: string; title: string } | null {
  if (!hash.startsWith(CANVA_EXPORT_HASH)) return null;
  if (hash.length > 24000) throw new Error("Canva export link is too long.");
  const data = JSON.parse(decodeURIComponent(hash.slice(CANVA_EXPORT_HASH.length)));
  return { url: validateCanvaExportUrl(data.url), title: typeof data.title === "string" ? data.title.slice(0, 120) : "Canva design" };
}
