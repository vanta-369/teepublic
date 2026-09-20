// The local-first store: designs, artwork, the spreadsheet batch and the
// earnings export living in IndexedDB on the user's device.
//
// These run the real lib/localDb.ts, lib/designsStore.ts, lib/spreadsheetStore.ts
// and lib/salesReportStore.ts against an in-memory IndexedDB (see
// helpers/fakeIndexedDb.ts). The "survives closing and reopening Chrome" case is
// modelled by closing the database handle and reopening it against storage that
// outlives the handle — which is the behaviour IndexedDB guarantees. It is a
// simulation of the browser, not the browser: the end-to-end version of this
// check is listed under remaining risks.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeIndexedDb, resetFakeStorage, rawRows } from "./helpers/fakeIndexedDb.ts";

installFakeIndexedDb();

const {
  closeLocalDb,
  clearAllLocalData,
  DB_NAME,
  STORE_DESIGNS,
  STORE_IMAGES,
  STORE_DOCS,
} = await import("../apps/dashboard/lib/localDb.ts");

const {
  loadDesigns,
  saveDesigns,
  saveDesignImage,
  getDesignImage,
  getDesignImageDataUrl,
  deleteDesign,
  countDesigns,
} = await import("../apps/dashboard/lib/designsStore.ts");

const { loadSpreadsheet, saveSpreadsheet, saveSheetImage, getSheetImage, sheetImageKey } =
  await import("../apps/dashboard/lib/spreadsheetStore.ts");

const { loadSalesReport, saveSalesReport, clearSalesReport } = await import(
  "../apps/dashboard/lib/salesReportStore.ts"
);

const { findImageBytes, findListingContent } = await import("../packages/shared/src/privacy.ts");

function pngBlob(size = 4096): Blob {
  const bytes = new Uint8Array(size);
  bytes.set([0x89, 0x50, 0x4e, 0x47]); // PNG magic, so it is recognisably an image
  for (let i = 4; i < size; i++) bytes[i] = i % 251;
  return new Blob([bytes], { type: "image/png" });
}

function design(id: string, title: string) {
  return {
    id,
    sessionId: "s1",
    serverFilename: `${id}.png`,
    originalName: `${id}.png`,
    mime: "image/png",
    size: 4096,
    listing: {
      title,
      description: "A description that must never reach a server.",
      primaryTag: "retro",
      tags: ["retro", "cat"],
      matureContent: false,
    },
    config: { preset: "light", productColors: { tshirt: "White" }, enabledProducts: ["tshirt"] },
    status: "ready",
    updatedAt: Date.now(),
  } as Parameters<typeof saveDesigns>[0][number];
}

test.beforeEach(async () => {
  await closeLocalDb();
  resetFakeStorage();
});

test("a design round-trips through local storage with its listing copy", async () => {
  await saveDesigns([design("a1", "Retro Cat Tee")]);
  await saveDesignImage("a1", pngBlob());

  const loaded = await loadDesigns();
  assert.equal(loaded.length, 1);
  assert.equal(loaded[0].listing?.title, "Retro Cat Tee");
  assert.deepEqual(loaded[0].listing?.tags, ["retro", "cat"]);
  assert.equal(loaded[0].config.productColors.tshirt, "White");

  const blob = await getDesignImage("a1");
  assert.ok(blob, "artwork is stored");
  assert.equal(blob!.size, 4096);
  assert.equal(blob!.type, "image/png");
});

test("artwork is stored as bytes, never inside the design row", async () => {
  await saveDesigns([design("a1", "Retro Cat Tee")]);
  await saveDesignImage("a1", pngBlob());

  const rows = rawRows(DB_NAME, STORE_DESIGNS);
  assert.equal(rows.length, 1);
  // The persisted design record must contain no image payload at all: not a
  // data URL, not base64, not a blob: URL.
  assert.equal(findImageBytes(rows[0]), null, "design row carries no image bytes");
  assert.ok(!("imageUrl" in rows[0]), "design row has no imageUrl field");

  // And the image record is a real Blob, not a base64 string.
  const imageRows = rawRows(DB_NAME, STORE_IMAGES) as { blob: Blob }[];
  assert.equal(imageRows.length, 1);
  assert.ok(imageRows[0].blob instanceof Blob);
});

test("a data URL is decoded to bytes before it is stored", async () => {
  const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
  await saveDesignImage("a1", dataUrl);

  const imageRows = rawRows(DB_NAME, STORE_IMAGES) as { blob: Blob }[];
  assert.ok(imageRows[0].blob instanceof Blob);
  assert.equal(imageRows[0].blob.type, "image/png");

  // It comes back as a data URL only on demand, for an explicit upload or an
  // explicit AI call.
  const back = await getDesignImageDataUrl("a1");
  assert.equal(back, dataUrl);
});

test("designs and artwork survive closing and reopening the browser", async () => {
  await saveDesigns([design("a1", "Retro Cat Tee"), design("a2", "Space Dog Mug")]);
  await saveDesignImage("a1", pngBlob(8192));
  await saveDesignImage("a2", pngBlob(2048));
  await saveSpreadsheet({
    spreadsheetName: "batch.xlsx",
    rows: [],
    images: [
      { stem: "1", originalName: "1.png", imageKey: sheetImageKey("1"), mime: "image/png", size: 10 },
    ],
  });
  await saveSheetImage("1", pngBlob(512));
  await saveSalesReport({ filename: "earnings.csv", content: "a,b\n1,2", rowCount: 1 });

  // Close the handle — the browser going away.
  await closeLocalDb();

  // …and open it fresh, as a later launch would.
  const designs = await loadDesigns();
  assert.deepEqual(
    designs.map((d) => d.listing?.title),
    ["Retro Cat Tee", "Space Dog Mug"],
  );
  assert.equal((await getDesignImage("a1"))?.size, 8192);
  assert.equal((await getDesignImage("a2"))?.size, 2048);

  const sheet = await loadSpreadsheet();
  assert.equal(sheet?.spreadsheetName, "batch.xlsx");
  assert.equal((await getSheetImage("1"))?.size, 512);

  const report = await loadSalesReport();
  assert.equal(report?.filename, "earnings.csv");
  assert.equal(report?.content, "a,b\n1,2");
});

test("saveDesigns is authoritative and reclaims artwork for removed designs", async () => {
  await saveDesigns([design("a1", "One"), design("a2", "Two")]);
  await saveDesignImage("a1", pngBlob());
  await saveDesignImage("a2", pngBlob());
  assert.equal(await countDesigns(), 2);

  await saveDesigns([design("a1", "One")]);

  assert.equal(await countDesigns(), 1);
  assert.ok(await getDesignImage("a1"));
  assert.equal(await getDesignImage("a2"), null, "orphaned artwork is deleted");
});

test("deleting a design deletes its artwork with it", async () => {
  await saveDesigns([design("a1", "One")]);
  await saveDesignImage("a1", pngBlob());

  await deleteDesign("a1");

  assert.equal(await countDesigns(), 0);
  assert.equal(await getDesignImage("a1"), null);
});

test("the spreadsheet batch stores an image key, never a URL or bytes", async () => {
  await saveSheetImage("1", pngBlob());
  await saveSpreadsheet({
    spreadsheetName: "batch.xlsx",
    rows: [],
    images: [
      { stem: "1", originalName: "1.png", imageKey: sheetImageKey("1"), mime: "image/png", size: 4096 },
    ],
  });

  const docs = rawRows(DB_NAME, STORE_DOCS) as { key: string; value: unknown }[];
  const batch = docs.find((d) => d.key === "spreadsheet-batch")!.value;
  assert.equal(findImageBytes(batch), null, "the stored batch carries no image bytes");
  assert.equal(
    JSON.stringify(batch).includes("data:image"),
    false,
    "and no inline data URL",
  );
});

test("removing an image from the batch frees its artwork", async () => {
  await saveSheetImage("1", pngBlob());
  await saveSheetImage("2", pngBlob());
  await saveSpreadsheet({ spreadsheetName: "b.xlsx", rows: [], images: [] });

  assert.equal(await getSheetImage("1"), null);
  assert.equal(await getSheetImage("2"), null);
});

test("the earnings export is stored locally and can be cleared", async () => {
  await saveSalesReport({ filename: "e.csv", content: "Design,Price\nCat Tee,12.00", rowCount: 1 });
  const loaded = await loadSalesReport();
  assert.ok(loaded?.content.includes("Cat Tee"));

  await clearSalesReport();
  assert.equal(await loadSalesReport(), null);
});

test("clearAllLocalData empties every store", async () => {
  await saveDesigns([design("a1", "One")]);
  await saveDesignImage("a1", pngBlob());
  await saveSalesReport({ filename: "e.csv", content: "x", rowCount: 0 });

  await clearAllLocalData();

  assert.equal(await countDesigns(), 0);
  assert.equal(await getDesignImage("a1"), null);
  assert.equal(await loadSalesReport(), null);
});

test("what is persisted locally is exactly what must NOT be persisted remotely", async () => {
  await saveDesigns([design("a1", "Retro Cat Tee")]);

  // Sanity check on the guards themselves: the locally stored row is full of
  // listing content, which is why these tests and the Supabase guard agree that
  // it can never be part of a request.
  const rows = rawRows(DB_NAME, STORE_DESIGNS);
  assert.ok(findListingContent(rows[0]), "the local row does hold listing content");
});
