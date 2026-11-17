import test from "node:test";
import assert from "node:assert/strict";
import { CANVA_EXPORT_HASH, MAX_CANVA_EXPORT_BYTES, parseCanvaExportHash, validateCanvaExportUrl } from "../packages/shared/src/canva";
import { fetchCanvaExport } from "../apps/extension/src/services/canvaImport";
import { importCanvaPages } from "../apps/dashboard/lib/canvaImport";
import { zipSync } from "fflate";

const exportUrl = "https://export-download.canva.com/example/pages.zip?token=test";

test("Canva import accepts only official HTTPS export links", () => {
  assert.equal(validateCanvaExportUrl(exportUrl), exportUrl);
  for (const value of ["http://export-download.canva.com/a", "https://export-download.canva.com.evil.test/a", "https://user@export-download.canva.com/a", "https://www.canva.com/design/a", "file:///a", "https://export-download.canva.com:444/a", null]) {
    assert.throws(() => validateCanvaExportUrl(value));
  }
  assert.equal(parseCanvaExportHash("#other"), null);
  assert.deepEqual(parseCanvaExportHash(CANVA_EXPORT_HASH + encodeURIComponent(JSON.stringify({ url: exportUrl, title: "My pages" }))), { url: exportUrl, title: "My pages" });
});

test("multi-page Canva ZIP imports every PNG in natural page order through the extension", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const zip = zipSync({ "10.png": new Uint8Array([10]), "2.png": new Uint8Array([2]), "1.png": new Uint8Array([1]), "metadata.txt": new Uint8Array([0]) });
  let calls = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    localStorage: { getItem: () => null },
    chrome: { runtime: { sendMessage: (id: string, message: unknown, callback: (response: unknown) => void) => {
      calls++;
      assert.equal(id, "obkkmfkhfofjemedkdmemdadbcodjdpn");
      assert.deepEqual(message, { type: "CANVA_EXPORT_FETCH", url: exportUrl });
      callback({ ok: true, data: { base64: Buffer.from(zip).toString("base64") } });
    } } },
  } });
  try {
    const pages = await importCanvaPages({ url: exportUrl, title: "Three pages" });
    assert.deepEqual(pages.map((page) => page.name), ["1.png", "2.png", "10.png"]);
    assert.deepEqual(pages.map((page) => page.type), ["image/png", "image/png", "image/png"]);
    assert.deepEqual([...new Uint8Array(await pages[2].arrayBuffer())], [10]);
    assert.equal(calls, 1);
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

test("Canva fetch rejects HTML, expiration, and oversized streams; returns ZIP bytes", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("expired", { status: 403 });
    await assert.rejects(fetchCanvaExport(exportUrl), /expired/);
    globalThis.fetch = async () => new Response("<html>Not an export</html>");
    await assert.rejects(fetchCanvaExport(exportUrl), /page ZIP/);
    globalThis.fetch = async () => new Response("", { headers: { "content-length": String(MAX_CANVA_EXPORT_BYTES + 1) } });
    await assert.rejects(fetchCanvaExport(exportUrl), /32 MB/);
    globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(MAX_CANVA_EXPORT_BYTES + 1));
      controller.close();
    } }));
    await assert.rejects(fetchCanvaExport(exportUrl), /32 MB/);
    const bytes = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2]);
    globalThis.fetch = async (url, options) => {
      assert.equal(url, exportUrl);
      assert.equal(options?.redirect, "error");
      assert.equal(options?.credentials, "omit");
      return new Response(bytes);
    };
    assert.equal((await fetchCanvaExport(exportUrl)).base64, Buffer.from(bytes).toString("base64"));
  } finally { globalThis.fetch = originalFetch; }
});
