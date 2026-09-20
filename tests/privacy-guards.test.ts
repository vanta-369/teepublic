// The guards that stand between the app and Supabase.
//
// These are the load-bearing assertions for the promise "images and listing
// content never reach Higgstee". They exercise the real predicates from
// @teepublic/shared and the real fetch wrapper the dashboard's Supabase clients
// are constructed with.

import test from "node:test";
import assert from "node:assert/strict";

import {
  PRIVACY_VIOLATION,
  findImageBytes,
  findListingContent,
  bodyForInspection,
} from "../packages/shared/src/privacy.ts";
import { createGuardedFetch } from "../apps/dashboard/lib/supabase/guardedFetch.ts";

const SUPABASE = "https://test-project.supabase.co";

/** A data URL the size a real design would be, without building a real PNG. */
const FAKE_PNG_DATA_URL = `data:image/png;base64,${"A".repeat(200_000)}`;

// A JWT-shaped string: base64url segments separated by dots. Supabase auth
// bodies carry these legitimately and they must not trip the base64 heuristic.
const FAKE_JWT = `${"a".repeat(600)}.${"b".repeat(900)}.${"c".repeat(86)}`;

function captureFetch() {
  const calls: { url: string; body: unknown }[] = [];
  const base = async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: init?.body });
    return new Response("{}", { status: 200 });
  };
  return { calls, guarded: createGuardedFetch(base as typeof fetch) };
}

test("findImageBytes flags a data: URL anywhere in the payload", () => {
  assert.ok(findImageBytes({ image_url: FAKE_PNG_DATA_URL }));
  assert.ok(findImageBytes({ batch: { images: [{ url: FAKE_PNG_DATA_URL }] } }));
  assert.ok(findImageBytes([{ nested: { deep: FAKE_PNG_DATA_URL } }]));
});

test("findImageBytes flags a bare base64 blob and blob: URLs", () => {
  assert.ok(findImageBytes({ payload: "Q".repeat(5000) }));
  assert.ok(findImageBytes({ src: "blob:https://example.com/abc-123" }));
});

test("findImageBytes does NOT flag ids, hashes or JWTs", () => {
  assert.equal(findImageBytes({ user_id: "6f1e8b9a-1111-2222-3333-444455556666" }), null);
  assert.equal(findImageBytes({ sha: "e".repeat(64) }), null);
  assert.equal(findImageBytes({ refresh_token: FAKE_JWT, access_token: FAKE_JWT }), null);
  assert.equal(findImageBytes({}), null);
});

test("findListingContent flags listing fields, and only when populated", () => {
  assert.ok(findListingContent({ title: "Vintage Hockey Shirt" }));
  assert.ok(findListingContent({ listing: { description: "…" } }));
  assert.ok(findListingContent({ designs: [{ tags: ["retro"] }] }));
  assert.ok(findListingContent({ original_name: "1.png" }));

  // Absent or explicitly empty is not content.
  assert.equal(findListingContent({ title: "" }), null);
  assert.equal(findListingContent({ tags: [] }), null);
  assert.equal(findListingContent({ status: "active", plan: "trial" }), null);
});

test("bodyForInspection parses the string bodies supabase-js sends", () => {
  assert.deepEqual(bodyForInspection('{"a":1}'), { a: 1 });
  assert.deepEqual(bodyForInspection("[1,2]"), [1, 2]);
  assert.equal(bodyForInspection(""), undefined);
  assert.equal(bodyForInspection(undefined), undefined);
});

test("guarded fetch refuses a request carrying image bytes", async () => {
  const { calls, guarded } = captureFetch();
  await assert.rejects(
    () =>
      guarded(`${SUPABASE}/rest/v1/designs`, {
        method: "POST",
        body: JSON.stringify([{ id: "abc", image_url: FAKE_PNG_DATA_URL }]),
      }),
    (e: Error) => e.name === PRIVACY_VIOLATION,
  );
  assert.equal(calls.length, 0, "nothing may reach the network");
});

test("guarded fetch refuses a request carrying listing content", async () => {
  const { calls, guarded } = captureFetch();
  await assert.rejects(
    () =>
      guarded(`${SUPABASE}/rest/v1/designs`, {
        method: "POST",
        body: JSON.stringify([{ id: "abc", listing: { title: "Retro Cat Tee" } }]),
      }),
    (e: Error) => e.name === PRIVACY_VIOLATION,
  );
  assert.equal(calls.length, 0);
});

test("guarded fetch refuses a spreadsheet batch blob", async () => {
  const { guarded } = captureFetch();
  await assert.rejects(
    () =>
      guarded(`${SUPABASE}/rest/v1/spreadsheet_batches`, {
        method: "POST",
        body: JSON.stringify({
          user_id: "u1",
          data: { rows: [{ metadata: { title: "A shirt" } }], images: [] },
        }),
      }),
    (e: Error) => e.name === PRIVACY_VIOLATION,
  );
});

test("guarded fetch refuses an upload_events insert", async () => {
  const { guarded } = captureFetch();
  await assert.rejects(
    () =>
      guarded(`${SUPABASE}/rest/v1/upload_events`, {
        method: "POST",
        body: JSON.stringify({
          user_id: "u1",
          design_id: "d1",
          title: "Retro Cat Tee",
          listing_url: "https://www.teepublic.com/t-shirt/123",
        }),
      }),
    (e: Error) => e.name === PRIVACY_VIOLATION,
  );
});

test("guarded fetch allows the calls the app actually makes", async () => {
  const { calls, guarded } = captureFetch();

  // The access RPC: no body at all.
  await guarded(`${SUPABASE}/rest/v1/rpc/get_my_access`, { method: "POST", body: "{}" });
  // The upload counter: no arguments, by design.
  await guarded(`${SUPABASE}/rest/v1/rpc/increment_upload_count`, { method: "POST", body: "{}" });
  // Reading the aggregate count.
  await guarded(`${SUPABASE}/rest/v1/upload_stats?select=total_upload_count`, { method: "GET" });
  // An admin action, which names a user and nothing else.
  await guarded(`${SUPABASE}/rest/v1/rpc/admin_approve_user`, {
    method: "POST",
    body: JSON.stringify({ target: "6f1e8b9a-1111-2222-3333-444455556666", trial_days: 7 }),
  });

  assert.equal(calls.length, 4);
});

test("guarded fetch exempts auth traffic, which carries JWTs", async () => {
  const { calls, guarded } = captureFetch();
  await guarded(`${SUPABASE}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    body: JSON.stringify({ refresh_token: FAKE_JWT }),
  });
  await guarded(`${SUPABASE}/auth/v1/user`, { method: "GET" });
  assert.equal(calls.length, 2);
});
