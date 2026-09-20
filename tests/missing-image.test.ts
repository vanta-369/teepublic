// What happens when a design's artwork is not on this device.
//
// Since the extension can no longer fetch artwork from anywhere — no bucket, no
// URL, no server — a missing image is a genuine dead end. The product promise
// is that it is a SAFE dead end: the item fails with an instruction the user
// can act on, it keeps its place in the queue so Retry works after a re-import,
// and it is never mistaken for an upload.
//
// This drives the real queueStore (the single choke point every success path
// funnels through) and the real upload counter over a fake chrome.* and a
// recording fetch, so the assertions are about behaviour, not a stand-in.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, resetFakeChrome, seedSupabaseSession, storageArea } from "./helpers/fakeChrome.ts";
import { installFakeIndexedDb, resetFakeStorage } from "./helpers/fakeIndexedDb.ts";

installFakeChrome();
installFakeIndexedDb();

const requests: { url: string; method: string }[] = [];

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  requests.push({ url, method: init?.method ?? "GET" });
  if (url.includes("/auth/v1/user")) {
    return new Response(
      JSON.stringify({ id: "11111111-2222-3333-4444-555555555555", aud: "authenticated" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("/rest/v1/rpc/increment_upload_count")) {
    return new Response("1", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { QueueStore, ImageStore, storeImageWithThumbnail } = await import(
  "../apps/extension/src/services/queueStore.ts"
);

const { MISSING_IMAGE_MESSAGE, MissingImageError } = await import(
  "../apps/extension/src/services/automationEngine.ts"
);

type QueueItem = import("@teepublic/shared").QueueItem;
type QueueBatch = import("@teepublic/shared").QueueBatch;

function item(id: string): QueueItem {
  const now = Date.now();
  return {
    id,
    metadata: {
      filename: `${id}.png`,
      title: `Design ${id}`,
      description: "local only",
      tags: ["tag"],
      matureContent: false,
      productColors: { t_shirt: "White" },
      enabledProducts: ["T-Shirt"],
    },
    imageUrl: "",
    imageMime: "image/png",
    imageSizeBytes: 1024,
    status: "pending",
    selected: true,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

function batch(items: QueueItem[]): QueueBatch {
  return {
    id: "b1",
    createdAt: Date.now(),
    items,
    source: { spreadsheetName: "test", rowCount: items.length, matchedCount: items.length },
  };
}

const PNG = "data:image/png;base64,iVBORw0KGgo=";

test.beforeEach(async () => {
  resetFakeChrome();
  resetFakeStorage();
  requests.length = 0;
  seedSupabaseSession();
});

test("the message is exactly what the product promises", () => {
  assert.equal(MISSING_IMAGE_MESSAGE, "Image missing — import the batch again or select the image");
  assert.ok(new MissingImageError() instanceof Error);
  assert.equal(new MissingImageError().message, MISSING_IMAGE_MESSAGE);
});

test("an item with no stored artwork has no image to find", async () => {
  await QueueStore.set(batch([item("a1")]));
  // Nothing was ever stored for a1, and there is no second place to look.
  assert.equal(await ImageStore.get("a1"), null);
});

test("failing for a missing image keeps the item and does not count an upload", async () => {
  await QueueStore.set(batch([item("a1"), item("a2")]));
  await storeImageWithThumbnail("a2", PNG);

  // What the engine does when imageDataUrlFor throws MissingImageError.
  await QueueStore.setItemStatus("a1", "failed", {
    lastError: MISSING_IMAGE_MESSAGE,
    attempts: 1,
  });

  const stored = await QueueStore.get();
  const failed = stored!.items.find((i) => i.id === "a1")!;

  // The item is still there — not deleted, not skipped, still selected, so
  // pressing Start after a re-import picks it up again.
  assert.equal(stored!.items.length, 2, "the item is not removed from the queue");
  assert.equal(failed.status, "failed");
  assert.equal(failed.lastError, MISSING_IMAGE_MESSAGE, "the user is told what to do");
  assert.equal(failed.selected, true, "it stays selected for a retry");
  assert.equal(failed.publishedUrl, undefined);

  // Nothing was reported as published.
  assert.deepEqual(
    requests.filter((r) => r.url.includes("increment_upload_count")),
    [],
    "a missing image must never move the upload counter",
  );

  // And the other design's artwork is untouched — one bad item does not take
  // the batch down with it.
  assert.equal(await ImageStore.get("a2"), PNG);
});

test("a re-imported image makes the failed item runnable again", async () => {
  await QueueStore.set(batch([item("a1")]));
  await QueueStore.setItemStatus("a1", "failed", { lastError: MISSING_IMAGE_MESSAGE, attempts: 1 });
  assert.equal(await ImageStore.get("a1"), null);

  // The user re-imports the batch export, which puts the artwork back.
  await storeImageWithThumbnail("a1", PNG);

  assert.equal(await ImageStore.get("a1"), PNG, "the artwork is back, locally");
  const stored = await QueueStore.get();
  assert.equal(stored!.items.find((i) => i.id === "a1")!.status, "failed");
  assert.deepEqual(requests.filter((r) => r.url.includes("increment_upload_count")), []);
});

test("no request of any kind is made while an item fails for a missing image", async () => {
  await QueueStore.set(batch([item("a1")]));
  await QueueStore.setItemStatus("a1", "failed", { lastError: MISSING_IMAGE_MESSAGE, attempts: 1 });
  assert.deepEqual(requests, [], "the failure path is entirely local");
  assert.ok(!JSON.stringify(storageArea).includes("http"), "no URL was stored for the item");
});
