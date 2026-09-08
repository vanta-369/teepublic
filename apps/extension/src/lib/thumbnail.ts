// Grid-preview generation. Nothing here touches the artwork that gets UPLOADED.
//
// A TeePublic design is print resolution (TeePublic's minimum is 1500x1995 and
// real files are usually ~4500x5400). Painting one of those into a ~240px grid
// tile still forces Chrome to decode the whole thing: width * height * 4 bytes,
// i.e. ~97 MB of bitmap per design at 4500x5400. A page of them exhausted the
// renderer, which is what made "check my designs before uploading" crawl.
//
// So every image gets a SECOND, small copy stored beside it (ThumbStore), used
// only for display. The original in ImageStore is never modified, never
// re-encoded, and remains the only thing handed to TeePublic — see
// automationEngine.resolveImageDataUrl -> content/teepublic.dataUrlToFile.
//
// WebP is used because it keeps the alpha channel (designs are transparent
// PNGs) at a fraction of the size. Generation runs in the service worker via
// OffscreenCanvas; if anything is unsupported we return null and callers fall
// back to the full image, so a failure is slow, never broken.

/** Longest edge of a generated preview, in px. Grid tiles are ~240px, so 320
 *  still looks sharp on a HiDPI screen while decoding to ~0.4 MB instead of
 *  ~97 MB. */
export const THUMB_MAX_PX = 320;

/** Downscale a design data URL into a small preview data URL.
 *  Returns null if the environment can't encode one — callers then use the
 *  original. */
export async function makeThumbnail(dataUrl: string, maxPx = THUMB_MAX_PX): Promise<string | null> {
  try {
    if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap !== "function") return null;
    const blob = dataUrlToBlob(dataUrl);
    if (!blob) return null;

    const source = await createImageBitmap(blob);
    try {
      const scale = Math.min(1, maxPx / Math.max(source.width, source.height));
      const w = Math.max(1, Math.round(source.width * scale));
      const h = Math.max(1, Math.round(source.height * scale));

      const canvas = new OffscreenCanvas(w, h);
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.drawImage(source, 0, 0, w, h);

      const out = await canvas.convertToBlob({ type: "image/webp", quality: 0.82 });
      return await blobToDataUrl(out);
    } finally {
      // Free the full-resolution bitmap immediately — this is the big one.
      source.close();
    }
  } catch (e) {
    console.warn("[higgstee] thumbnail generation failed:", e);
    return null;
  }
}

/** Parse a base64 data URL into a Blob. Returns null for anything else (e.g. a
 *  plain http(s) URL, which the UI can already use as an <img> src directly). */
function dataUrlToBlob(dataUrl: string): Blob | null {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  if (!/^data:/i.test(meta) || !/;base64$/i.test(meta)) return null;
  const mime = meta.slice(5, meta.length - ";base64".length) || "image/png";

  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  // Chunked so a big buffer never blows the argument limit of fromCharCode.
  const CHUNK = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return `data:${blob.type || "image/webp"};base64,${btoa(binary)}`;
}
