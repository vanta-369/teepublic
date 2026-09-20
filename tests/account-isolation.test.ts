// One account cannot reach another's data.
//
// There are two stores to reason about and they isolate differently:
//
//   The aggregate counter is in Supabase and is isolated by RLS. The client
//   never names a user — it asks for "my row" and the server decides which that
//   is from the JWT. These tests prove the client cannot name a user even if it
//   wanted to; the policy that enforces it is asserted in schema.test.ts, and
//   the live check against a real project is in the remaining-risks list.
//
//   Designs, listings and artwork are in IndexedDB, which the browser scopes to
//   an origin within a profile. There is no account dimension because there is
//   no server: a second user on a second machine has a different database, and
//   two users sharing one OS account share a browser profile, which is a
//   property of the device, not of Higgstee. The test below pins the shape that
//   makes that true — no user id anywhere in a local key — so a later change
//   cannot quietly introduce a shared, cross-account local store.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

declare const __REPO_ROOT__: string;
const ROOT = __REPO_ROOT__;

interface Recorded {
  url: string;
  method: string;
  body: string;
  headers: Record<string, string>;
}

const requests: Recorded[] = [];

(globalThis as { fetch: typeof fetch }).fetch = (async (
  input: RequestInfo | URL,
  init?: RequestInit,
) => {
  requests.push({
    url: String(input),
    method: init?.method ?? "GET",
    body: String(init?.body ?? ""),
    headers: Object.fromEntries(new Headers(init?.headers).entries()),
  });
  return new Response(JSON.stringify({ total_upload_count: 12, updated_at: "2026-09-01T00:00:00Z" }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}) as typeof fetch;

// The browser Supabase client needs somewhere to keep its session.
const store = new Map<string, string>();
(globalThis as { window?: unknown }).window = {
  localStorage: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  },
  location: { origin: "https://www.higgstee.com" },
};
(globalThis as { document?: unknown }).document = { cookie: "" };

const { fetchUploadCount } = await import("../apps/dashboard/lib/uploadCount.ts");

const OTHER_USER = "99999999-8888-7777-6666-555555555555";

test.beforeEach(() => {
  requests.length = 0;
});

test("reading the upload count never names a user", async () => {
  const { total } = await fetchUploadCount();
  assert.equal(total, 12);

  assert.equal(requests.length, 1);
  const req = requests[0];
  // No user_id filter in the query string and no body to carry one: the row is
  // chosen by the server from the session, and RLS is what scopes it.
  assert.ok(!req.url.includes("user_id"), `request filters on a user: ${req.url}`);
  assert.equal(req.body, "");
  assert.ok(!req.url.includes(OTHER_USER));
});

test("no client code can request another account's counter", () => {
  const src = readFileSync(path.join(ROOT, "apps/dashboard/lib/uploadCount.ts"), "utf8");
  // If a user id ever appeared in this module it would mean the query had
  // started choosing a row instead of letting the server choose it.
  assert.doesNotMatch(src, /\.eq\(\s*["'`]user_id/);
  assert.doesNotMatch(src, /user_id\s*[:=]/);

  const counter = readFileSync(path.join(ROOT, "apps/extension/src/lib/uploadCounter.ts"), "utf8");
  // The extension knows its own user id (it calls getUser to force a token
  // refresh) but must never put it in the RPC call.
  assert.doesNotMatch(counter, /rpc\(\s*["'`]increment_upload_count["'`]\s*,/);
  assert.match(counter, /rpc\(\s*["'`]increment_upload_count["'`]\s*\)/);
});

test("the local store is keyed by design, never by account", () => {
  const localDb = readFileSync(path.join(ROOT, "apps/dashboard/lib/localDb.ts"), "utf8");
  // A user-scoped local key would imply several accounts sharing one database,
  // which is the shape that could leak between them.
  assert.doesNotMatch(localDb, /user_id|userId|auth\.uid/);
  assert.match(localDb, /DB_NAME = "higgstee-local"/);

  const imageDb = readFileSync(path.join(ROOT, "apps/extension/src/lib/imageDb.ts"), "utf8");
  assert.doesNotMatch(imageDb, /user_id|userId|auth\.uid/);
});

test("signing out is not asked to protect local data, because it cannot", () => {
  // Stated plainly so the Privacy Policy and the code agree: local data is
  // protected by the device and the browser profile, not by the Higgstee
  // session. Nothing in the local store consults auth state.
  for (const f of [
    "apps/dashboard/lib/designsStore.ts",
    "apps/dashboard/lib/spreadsheetStore.ts",
    "apps/dashboard/lib/salesReportStore.ts",
  ]) {
    const src = readFileSync(path.join(ROOT, f), "utf8");
    assert.doesNotMatch(src, /getUser\(|getSession\(|auth\./, `${f} consults auth state`);
  }
});
