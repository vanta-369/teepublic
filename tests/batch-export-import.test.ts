// The export file is the ONLY way a batch moves between devices now, so it has
// to carry everything an upload needs: the listing copy, the product config and
// the artwork itself. Nothing may be left behind on a server to be fetched back
// later, because there is nothing on a server to fetch.
//
// This is the round trip, end to end, against the real modules:
//   stage designs + artwork in IndexedDB
//     → export (lib/batchTransfer.buildExportChunks)
//     → wipe IndexedDB, as a different machine or cleared site data would
//     → import (lib/batchTransfer.importExportFilesToLocal)
//     → assert every image, listing and setting is back, and that the batch is
//       upload-ready without any remote image access.
//
// `fetch` is replaced by a throwing stub for the whole file: if any step
// reaches for the network — Supabase, Higgstee, a Storage bucket, anything —
// the test fails instead of quietly succeeding on a developer machine that
// happens to be online.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeIndexedDb, resetFakeStorage } from "./helpers/fakeIndexedDb.ts";

installFakeIndexedDb();

const fetchCalls: string[] = [];
(globalThis as { fetch?: unknown }).fetch = (input: unknown) => {
  const url = typeof input === "string" ? input : String((input as { url?: string })?.url ?? input);
  fetchCalls.push(url);
  throw new Error(`network access is not allowed in the export/import path: ${url}`);
};

const { closeLocalDb } = await import("../apps/dashboard/lib/localDb.ts");

const { saveDesigns, saveDesignImage, getDesignImage, getDesignImageDataUrl, loadDesigns } =
  await import("../apps/dashboard/lib/designsStore.ts");

const { buildExportChunks, parseExportFile, importExportFilesToLocal } = await import(
  "../apps/dashboard/lib/batchTransfer.ts"
);

const { findImageBytes } = await import("../packages/shared/src/privacy.ts");

type QueueItem = import("@teepublic/shared").QueueItem;
type QueueBatch = import("@teepublic/shared").QueueBatch;

/** A recognisable PNG data URL, distinct per design so a mix-up is visible. */
function pngDataUrl(seed: number): string {
  const bytes = new Uint8Array(1024);
  bytes.set([0x89, 0x50, 0x4e, 0x47]); // PNG magic
  for (let i = 4; i < bytes.length; i++) bytes[i] = (i * 31 + seed) % 251;
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return `data:image/png;base64,${Buffer.from(bin, "binary").toString("base64")}`;
}

const DESIGNS = [
  {
    id: "d1",
    title: "Retro Cat Tee",
    description: "A description that must never reach a server.",
    primaryTag: "retro",
    tags: ["retro", "cat", "vintage"],
    matureContent: false,
    productColors: { t_shirt: "White", hoodie: "Black" },
    enabledProducts: ["T-Shirt", "Hoodie"],
  },
  {
    id: "d2",
    title: "Space Dog Mug",
    description: "Second listing, also local-only.",
    primaryTag: "space",
    tags: ["space", "dog"],
    matureContent: true,
    productColors: { mug: "White" },
    enabledProducts: ["Mug"],
  },
];

function persistedDesign(d: (typeof DESIGNS)[number], seed: number) {
  return {
    id: d.id,
    sessionId: "s1",
    serverFilename: `${d.id}.png`,
    originalName: `${d.id}.png`,
    mime: "image/png",
    size: 1024 + seed,
    listing: {
      title: d.title,
      description: d.description,
      primaryTag: d.primaryTag,
      tags: d.tags,
      matureContent: d.matureContent,
    },
    config: { preset: "light", productColors: d.productColors, enabledProducts: d.enabledProducts },
    status: "ready",
    updatedAt: Date.now(),
  } as Parameters<typeof saveDesigns>[0][number];
}

/** The dashboard's staging list: metadata on the item, artwork by id in IDB. */
function stagedItem(d: (typeof DESIGNS)[number], seed: number): QueueItem {
  const now = Date.now();
  return {
    id: d.id,
    metadata: {
      filename: `${d.id}.png`,
      title: d.title,
      description: d.description,
      primaryTag: d.primaryTag,
      tags: d.tags,
      matureContent: d.matureContent,
      productColors: d.productColors,
      enabledProducts: d.enabledProducts,
    },
    imageUrl: "",
    imageMime: "image/png",
    imageSizeBytes: 1024 + seed,
    status: "pending",
    selected: true,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function batchOf(items: QueueItem[]): QueueBatch {
  return {
    id: "b1",
    createdAt: Date.now(),
    items,
    source: { spreadsheetName: "staged export", rowCount: items.length, matchedCount: items.length },
  };
}

/** Round-trip each chunk through JSON exactly as the download/upload does. */
function toFiles(chunks: unknown[]): File[] {
  return chunks.map(
    (c, i) => new File([JSON.stringify(c)], `higgstee-batch-part${i + 1}.json`, { type: "application/json" }),
  );
}

async function stageEverything() {
  await saveDesigns(DESIGNS.map((d, i) => persistedDesign(d, i)));
  for (const [i, d] of DESIGNS.entries()) await saveDesignImage(d.id, pngDataUrl(i));
}

test.beforeEach(async () => {
  await closeLocalDb();
  resetFakeStorage();
  fetchCalls.length = 0;
});

test("a batch survives export → cleared device → import, with nothing fetched", async () => {
  await stageEverything();
  const originals = new Map<string, string>();
  for (const d of DESIGNS) originals.set(d.id, (await getDesignImageDataUrl(d.id))!);

  // ── export ────────────────────────────────────────────────────────────────
  const chunks = await buildExportChunks(
    batchOf(DESIGNS.map((d, i) => stagedItem(d, i))),
    undefined,
    (item) => getDesignImageDataUrl(item.id),
  );
  assert.equal(chunks.length, 1);

  // The artwork is in the file: complete PNG data URLs, in the top-level
  // `images` map, keyed by design id — and NOT on the items.
  for (const d of DESIGNS) {
    assert.equal(chunks[0].images[d.id], originals.get(d.id), `${d.id} artwork is inlined`);
    assert.match(chunks[0].images[d.id], /^data:image\/png;base64,/);
  }
  for (const it of chunks[0].batch.items) {
    assert.equal(it.imageUrl, "", "items carry no inline image");
  }
  const files = toFiles(chunks);

  // ── the device is wiped: new machine, cleared site data ───────────────────
  await closeLocalDb();
  resetFakeStorage();
  assert.equal(await getDesignImage("d1"), null, "IndexedDB really is empty");
  assert.deepEqual(await loadDesigns(), []);

  // ── import ────────────────────────────────────────────────────────────────
  const { items, images, errors } = await importExportFilesToLocal(files);
  assert.deepEqual(errors, []);
  assert.equal(images, 2, "both images were written to IndexedDB");
  assert.equal(items.length, 2);

  // Every design is matched to ITS OWN image from the `images` map by id, and
  // the bytes are byte-for-byte what was exported.
  for (const d of DESIGNS) {
    assert.equal(await getDesignImageDataUrl(d.id), originals.get(d.id), `${d.id} artwork restored`);
    assert.equal((await getDesignImage(d.id))?.type, "image/png");
  }

  // The complete listing and product configuration came back.
  for (const d of DESIGNS) {
    const it = items.find((i) => i.id === d.id)!;
    assert.equal(it.metadata.title, d.title);
    assert.equal(it.metadata.description, d.description);
    assert.equal(it.metadata.primaryTag, d.primaryTag);
    assert.deepEqual(it.metadata.tags, d.tags);
    assert.equal(it.metadata.matureContent, d.matureContent);
    assert.deepEqual(it.metadata.productColors, d.productColors);
    assert.deepEqual(it.metadata.enabledProducts, d.enabledProducts);
    assert.equal(it.metadata.filename, `${d.id}.png`);
    assert.equal(it.imageMime, "image/png");
  }

  // Upload-ready: fresh status, selected, no carried-over progress, and the
  // artwork resolves locally by id — which is exactly what sendQueueToExtension
  // and buildExportChunks ask for.
  for (const it of items) {
    assert.equal(it.status, "pending");
    assert.equal(it.selected, true);
    assert.equal(it.attempts, 0);
    assert.equal(it.lastError, undefined);
    assert.equal(it.publishedUrl, undefined);
    assert.equal(it.imageUrl, "", "staged items stay metadata-only");
    assert.ok(await getDesignImageDataUrl(it.id), "its artwork is resolvable offline");
  }

  // Nothing anywhere in the round trip touched the network.
  assert.deepEqual(fetchCalls, []);
});

test("an exported batch re-exports identically after import — no data is lost", async () => {
  await stageEverything();
  const first = await buildExportChunks(
    batchOf(DESIGNS.map((d, i) => stagedItem(d, i))),
    undefined,
    (item) => getDesignImageDataUrl(item.id),
  );

  await closeLocalDb();
  resetFakeStorage();
  const { items } = await importExportFilesToLocal(toFiles(first));

  const second = await buildExportChunks(batchOf(items), undefined, (item) =>
    getDesignImageDataUrl(item.id),
  );
  assert.deepEqual(second[0].images, first[0].images, "artwork is unchanged by a round trip");
  assert.deepEqual(
    second[0].batch.items.map((i) => i.metadata),
    first[0].batch.items.map((i) => i.metadata),
    "listing copy and product config are unchanged by a round trip",
  );
  assert.deepEqual(fetchCalls, []);
});

test("multi-part exports import as one batch, and re-importing a part is harmless", async () => {
  await stageEverything();
  const chunks = await buildExportChunks(
    batchOf(DESIGNS.map((d, i) => stagedItem(d, i))),
    1, // one design per file
    (item) => getDesignImageDataUrl(item.id),
  );
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].totalParts, 2);

  await closeLocalDb();
  resetFakeStorage();

  const files = toFiles(chunks);
  const { items } = await importExportFilesToLocal([...files, files[0]]);
  assert.deepEqual(items.map((i) => i.id).sort(), ["d1", "d2"], "parts merge, duplicates dedup");
  for (const d of DESIGNS) assert.ok(await getDesignImageDataUrl(d.id));
  assert.deepEqual(fetchCalls, []);
});

test("import writes artwork to IndexedDB and leaves no image bytes on the staged items", async () => {
  await stageEverything();
  const chunks = await buildExportChunks(
    batchOf(DESIGNS.map((d, i) => stagedItem(d, i))),
    undefined,
    (item) => getDesignImageDataUrl(item.id),
  );

  await closeLocalDb();
  resetFakeStorage();
  const { items } = await importExportFilesToLocal(toFiles(chunks));

  // Whatever the UI holds in memory after an import must be free of pixels —
  // it is what gets handed to the extension as QUEUE_INIT.
  assert.equal(findImageBytes(items), null, "no image bytes survive on the staged items");
});

test("a design whose image is absent from the file still imports its listing", async () => {
  await stageEverything();
  const chunks = await buildExportChunks(
    batchOf(DESIGNS.map((d, i) => stagedItem(d, i))),
    undefined,
    (item) => getDesignImageDataUrl(item.id),
  );
  // Simulate a file whose `images` map lost an entry. The listing must still
  // come back, and the missing artwork must NOT be fetched from anywhere.
  delete chunks[0].images.d2;

  await closeLocalDb();
  resetFakeStorage();
  const { items, images } = await importExportFilesToLocal(toFiles(chunks));

  assert.equal(images, 1);
  assert.equal(items.find((i) => i.id === "d2")!.metadata.title, "Space Dog Mug");
  assert.equal(await getDesignImage("d2"), null, "no artwork, and none invented");
  assert.deepEqual(fetchCalls, [], "a missing image is never fetched remotely");
});

test("parseExportFile rejects a file that is not a batch export", () => {
  assert.throws(() => parseExportFile({ hello: "world" }), /isn't a TeePublic batch export/);
  assert.throws(() => parseExportFile(null), /isn't a TeePublic batch export/);
});
