import { MAX_CANVA_EXPORT_BYTES, validateCanvaExportUrl } from "@teepublic/shared";

export async function fetchCanvaExport(value: unknown): Promise<{ base64: string }> {
  const url = validateCanvaExportUrl(value);
  const response = await fetch(url, {
    credentials: "omit", redirect: "error", referrerPolicy: "no-referrer",
    signal: AbortSignal.timeout(60000),
  });
  if (!response.ok) throw new Error("Canva export is unavailable or expired. Grab the pages again from Canva.");
  if (Number(response.headers.get("content-length")) > MAX_CANVA_EXPORT_BYTES) {
    throw new Error("This Canva export exceeds 32 MB. Export fewer pages per batch.");
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Canva returned an empty export.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value: chunk } = await reader.read();
    if (done) break;
    size += chunk.length;
    if (size > MAX_CANVA_EXPORT_BYTES) {
      await reader.cancel();
      throw new Error("This Canva export exceeds 32 MB. Export fewer pages per batch.");
    }
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  // This flow expects Canva's ZIP of page PNGs, never HTML or thumbnails.
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error("Canva did not return a page ZIP. Export again using the Higgstee Canva app.");
  }
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { base64: btoa(binary) };
}
