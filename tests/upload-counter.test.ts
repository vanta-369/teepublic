// What the extension sends after a successful publish.
//
// This runs the extension's REAL modules — queueStore's status transition, the
// upload counter, and the actual Supabase client the extension builds — over a
// fake chrome.* and a recording fetch. So the assertions are about the bytes
// that would genuinely go on the wire, not about a stand-in.

import test from "node:test";
import assert from "node:assert/strict";

import { installFakeChrome, resetFakeChrome, seedSupabaseSession } from "./helpers/fakeChrome.ts";
import { installFakeIndexedDb, resetFakeStorage } from "./helpers/fakeIndexedDb.ts";
import { findImageBytes, findListingContent } from "../packages/shared/src/privacy.ts";

installFakeChrome();
installFakeIndexedDb();

const USER_ID = "11111111-2222-3333-4444-555555555555";
const SUPABASE_HOST = "test-project.supabase.co";

interface Recorded {
  url: string;
  method: string;
  body: unknown;
}

const requests: Recorded[] = [];

/** Record every request and answer the endpoints supabase-js will hit. */
(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const method = init?.method ?? "GET";
  requests.push({ url, method, body: init?.body });

  if (url.includes("/auth/v1/user")) {
    return new Response(
      JSON.stringify({ id: USER_ID, aud: "authenticated", email: "seller@example.com" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  }
  if (url.includes("/rest/v1/rpc/increment_upload_count")) {
    return new Response("7", { status: 200, headers: { "Content-Type": "application/json" } });
  }
  return new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } });
}) as typeof fetch;

const { QueueStore } = await import("../apps/extension/src/services/queueStore.ts");
const { countSuccessfulUpload, resetCountedItems } = await import(
  "../apps/extension/src/lib/uploadCounter.ts"
);

function incrementCalls(): Recorded[] {
  return requests.filter((r) => r.url.includes("rpc/increment_upload_count"));
}

/** The counter is fired and forgotten, so give it a turn to land. */
function settle(): Promise<void> {
  return new Promise((r) => setTimeout(r, 25));
}

function batchWith(ids: string[]) {
  const now = Date.now();
  return {
    id: "batch-1",
    createdAt: now,
    items: ids.map((id) => ({
      id,
      metadata: {
        filename: `${id}.png`,
        title: `Retro design ${id}`,
        description: "Copy that must never reach a Higgstee server.",
        tags: ["retro", "cat"],
        matureContent: false,
        productColors: { tshirt: "White" },
        enabledProducts: ["tshirt"],
      },
      imageUrl: "",
      imageMime: "image/png",
      imageSizeBytes: 1024,
      status: "queued" as const,
      selected: true,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    })),
    source: { spreadsheetName: "test", rowCount: ids.length, matchedCount: ids.length },
  };
}

test.beforeEach(async () => {
  requests.length = 0;
  resetFakeChrome();
  resetFakeStorage();
  seedSupabaseSession(USER_ID);
});

test("a confirmed publish sends exactly one increment, with an empty body", async () => {
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "succeeded", {
    publishedUrl: "https://www.teepublic.com/t-shirt/12345-retro-cat",
  });
  await settle();

  const calls = incrementCalls();
  assert.equal(calls.length, 1, "one increment per publish");
  assert.equal(calls[0].method, "POST");

  // No arguments: the server derives the account from auth.uid().
  const body = JSON.parse(String(calls[0].body ?? "{}"));
  assert.deepEqual(body, {}, "the RPC takes no arguments");
});

test("the increment carries no design id, title or listing URL", async () => {
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "succeeded", {
    publishedUrl: "https://www.teepublic.com/t-shirt/12345-retro-cat",
  });
  await settle();

  for (const req of requests) {
    const raw = String(req.body ?? "");
    assert.ok(!raw.includes("item-1"), `design id leaked to ${req.url}`);
    assert.ok(!raw.includes("Retro design"), `title leaked to ${req.url}`);
    assert.ok(!raw.includes("teepublic.com/t-shirt"), `listing URL leaked to ${req.url}`);
    assert.ok(!raw.includes(".png"), `filename leaked to ${req.url}`);
  }
});

test("a failed upload does not move the counter", async () => {
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "running");
  await QueueStore.setItemStatus("item-1", "failed", { lastError: "publish button never enabled" });
  await settle();

  assert.equal(incrementCalls().length, 0);
});

test("a skipped item does not move the counter", async () => {
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "skipped");
  await settle();

  assert.equal(incrementCalls().length, 0);
});

test("duplicate success confirmations count once", async () => {
  // The engine confirms a publish through several paths: the content script's
  // ITEM_STATUS, the PUBLISHED_URL_DETECTED announcement from the freshly
  // loaded listing page, and the tab-URL poll fallback.
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "succeeded");
  await QueueStore.setItemStatus("item-1", "succeeded", { publishedUrl: "https://x/y" });
  await QueueStore.setItemStatus("item-1", "succeeded");
  await settle();

  assert.equal(incrementCalls().length, 1);
});

test("a retry of an item that already succeeded does not count twice", async () => {
  await QueueStore.set(batchWith(["item-1"]) as never);
  await QueueStore.setItemStatus("item-1", "succeeded");
  await settle();
  assert.equal(incrementCalls().length, 1);

  // Retry puts it back in the queue and it succeeds again — for example after
  // the user pressed Retry on a row the engine had already confirmed.
  await QueueStore.setItemStatus("item-1", "queued");
  await QueueStore.setItemStatus("item-1", "running");
  await QueueStore.setItemStatus("item-1", "succeeded");
  await settle();

  assert.equal(incrementCalls().length, 1, "still one");
});

test("a service-worker replay of the same success does not count twice", async () => {
  // The dedupe record lives in chrome.storage, so it outlives the module state
  // exactly as it outlives a suspended service worker.
  await countSuccessfulUpload({ itemId: "item-9" });
  await settle();
  await countSuccessfulUpload({ itemId: "item-9" });
  await settle();

  assert.equal(incrementCalls().length, 1);
});

test("distinct items each count once", async () => {
  await QueueStore.set(batchWith(["a", "b", "c"]) as never);
  for (const id of ["a", "b", "c"]) await QueueStore.setItemStatus(id, "succeeded");
  await settle();

  assert.equal(incrementCalls().length, 3);
});

test("a failed increment is retried on the next confirmation", async () => {
  const realFetch = globalThis.fetch;
  let failNext = true;
  (globalThis as { fetch: typeof fetch }).fetch = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const url = String(input);
    if (url.includes("rpc/increment_upload_count") && failNext) {
      failNext = false;
      requests.push({ url, method: "POST", body: init?.body });
      return new Response(JSON.stringify({ message: "network" }), { status: 500 });
    }
    return realFetch(input, init);
  }) as typeof fetch;

  try {
    await countSuccessfulUpload({ itemId: "item-r" });
    await settle();
    assert.equal(incrementCalls().length, 1, "attempted once");

    // The claim was released, so a later confirmation tries again.
    await countSuccessfulUpload({ itemId: "item-r" });
    await settle();
    assert.equal(incrementCalls().length, 2, "retried");
  } finally {
    (globalThis as { fetch: typeof fetch }).fetch = realFetch;
  }
});

test("clearing the counted record is safe: new items get new ids", async () => {
  await countSuccessfulUpload({ itemId: "item-1" });
  await settle();
  await resetCountedItems();
  await countSuccessfulUpload({ itemId: "item-2" });
  await settle();

  assert.equal(incrementCalls().length, 2);
});

test("no Supabase request from the extension ever carries artwork or listing copy", async () => {
  await QueueStore.set(batchWith(["item-1", "item-2"]) as never);
  await QueueStore.setItemStatus("item-1", "succeeded");
  await QueueStore.setItemStatus("item-2", "failed", { lastError: "nope" });
  await settle();

  const supabaseCalls = requests.filter((r) => r.url.includes(SUPABASE_HOST));
  assert.ok(supabaseCalls.length > 0, "the extension did talk to Supabase");

  for (const req of supabaseCalls) {
    if (req.url.includes("/auth/v1/")) continue; // auth tokens are not listing data
    const parsed = req.body ? JSON.parse(String(req.body)) : {};
    assert.equal(findImageBytes(parsed), null, `image bytes in ${req.url}`);
    assert.equal(findListingContent(parsed), null, `listing content in ${req.url}`);
  }
});
