// The extension's Gemini job runner (services/geminiJobs.ts) and the listing
// parser it relies on.
//
// Runs the REAL runner over the fake chrome.storage + IndexedDB used elsewhere,
// plus a fake chrome.tabs defined here: tabs "load" instantly at the URL they
// were opened with, and the "content script" in them answers like
// content/gemini.ts does. What this cannot cover is the DOM driving itself -
// that needs a signed-in Google account on the live gemini.google.com.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

declare const __REPO_ROOT__: string;

import { installFakeChrome, resetFakeChrome, seedSupabaseSession, storageArea } from "./helpers/fakeChrome.ts";
import { installFakeIndexedDb, resetFakeStorage } from "./helpers/fakeIndexedDb.ts";
import { parseGeminiListing } from "../packages/shared/src/gemini.ts";

const chrome = installFakeChrome() as unknown as Record<string, unknown>;
installFakeIndexedDb();

// ── Fake chrome.tabs ────────────────────────────────────────────────────────

interface FakeTab { id: number; url: string; active: boolean; status: "complete" }
const tabs = new Map<number, FakeTab>();
const opened: FakeTab[] = [];
const sent: { tabId: number; message: Record<string, unknown> }[] = [];
const removedListeners = new Set<(tabId: number) => void>();
let nextTabId = 1;
/** Which address the fake Gemini page shows at /u/<N>/. */
let emailAtIndex: (index: number) => string | null = () => null;
let accessAllowed = true;

chrome.tabs = {
  async create({ url, active }: { url: string; active: boolean }) {
    const tab: FakeTab = { id: nextTabId++, url, active, status: "complete" };
    tabs.set(tab.id, tab);
    opened.push(tab);
    return tab;
  },
  async get(id: number) {
    const tab = tabs.get(id);
    if (!tab) throw new Error(`No tab with id: ${id}`);
    return tab;
  },
  async update(id: number, { url }: { url: string }) {
    const tab = tabs.get(id)!;
    tab.url = url;
    return tab;
  },
  async remove(id: number) {
    if (!tabs.delete(id)) throw new Error(`No tab with id: ${id}`);
    for (const l of removedListeners) l(id);
  },
  async sendMessage(tabId: number, message: Record<string, unknown>) {
    sent.push({ tabId, message });
    const tab = tabs.get(tabId)!;
    if (message.type === "GEMINI_READ_ACCOUNT") {
      const index = Number(/\/u\/(\d+)\//.exec(tab.url)?.[1] ?? 0);
      const email = emailAtIndex(index);
      return { signedIn: !!email, email };
    }
    if (message.type === "GEMINI_RUN") return { ok: true };
    return undefined;
  },
  onUpdated: { addListener() {}, removeListener() {} },
  onRemoved: { addListener: (fn: (id: number) => void) => removedListeners.add(fn) },
};

// Jobs and scans open in a minimized window of their own; record that as a
// background tab so the assertions below read the same either way.
const windowsOpened: { state?: string; focused?: boolean }[] = [];
const openWindows = new Set<number>();
const realCreate = chrome.tabs.create;
chrome.tabs.create = async (props: { url: string; active: boolean; windowId?: number }) => {
  if (props.windowId != null && !openWindows.has(props.windowId)) throw new Error(`No window with id: ${props.windowId}`);
  return realCreate(props);
};
chrome.windows = {
  async create({ state, focused }: { url: string; state?: string; focused?: boolean }) {
    windowsOpened.push({ state, focused });
    const id = 1000 + windowsOpened.length;
    openWindows.add(id); // its blank holder tab is not a Gemini tab, so it isn't recorded
    return { id, tabs: [] };
  },
  async remove(id: number) {
    openWindows.delete(id);
  },
};

// ── Supabase: just enough for assertCanAccess() ─────────────────────────────

(globalThis as { fetch: typeof fetch }).fetch = (async (input: RequestInfo | URL) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  if (url.includes("/auth/v1/user")) return json({ id: "11111111-2222-3333-4444-555555555555", aud: "authenticated" });
  if (url.includes("/rest/v1/rpc/get_my_access")) {
    return json({ can_access: accessAllowed, is_admin: false, status: accessAllowed ? "active" : "expired" });
  }
  return json({});
}) as typeof fetch;

const jobs = await import("../apps/extension/src/services/geminiJobs.ts");
type StateJob = import("@teepublic/shared").GeminiJob;

const PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

async function until(cond: () => boolean | Promise<boolean>, what: string): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail(`timed out waiting for: ${what}`);
}

async function jobById(id: string): Promise<StateJob> {
  const job = (await jobs.getGeminiState()).jobs.find((j) => j.id === id);
  assert.ok(job, `job ${id} exists`);
  return job;
}

const runMessages = () => sent.filter((s) => s.message.type === "GEMINI_RUN");

test.beforeEach(() => {
  resetFakeChrome();
  resetFakeStorage();
  seedSupabaseSession();
  tabs.clear();
  opened.length = 0;
  sent.length = 0;
  accessAllowed = true;
  emailAtIndex = (i) => ["first@example.com", "second@example.com"][i] ?? "first@example.com";
});

// ── The listing parser ──────────────────────────────────────────────────────

test("parseGeminiListing reads JSON wrapped in prose or a code fence", () => {
  const fenced = 'Here you go:\n```json\n{"title":"Retro Cat Tee","tags":["#retro","cat lover"],"description":"A cat."}\n```\nEnjoy!';
  assert.deepEqual(parseGeminiListing(fenced), { title: "Retro Cat Tee", tags: ["retro", "cat lover"], description: "A cat." });
});

test("parseGeminiListing copes with braces inside strings and skips non-listing objects", () => {
  const text = 'Note {not json} then {"other":1} then {"title":"Curly {brace} Club","tags":[],"description":"Has \\"quotes\\" and }"}';
  assert.deepEqual(parseGeminiListing(text), { title: "Curly {brace} Club", tags: [], description: 'Has "quotes" and }' });
});

test("parseGeminiListing refuses anything that is not the listing shape", () => {
  assert.equal(parseGeminiListing(""), null);
  assert.equal(parseGeminiListing("I can't help with that."), null);
  assert.equal(parseGeminiListing('{"title":"","tags":[],"description":"x"}'), null);
  assert.equal(parseGeminiListing('{"title":"x","tags":"a,b","description":"x"}'), null);
  assert.equal(parseGeminiListing('{"title":"x","tags":["a"]'), null); // cut off mid-answer
});

// ── Accounts ────────────────────────────────────────────────────────────────

test("the account scan reads /u/0, /u/1, ... and stops at the first repeat", async () => {
  const found = await jobs.refreshAccounts();
  assert.deepEqual(found, [
    { index: 0, email: "first@example.com", label: "first@example.com" },
    { index: 1, email: "second@example.com", label: "second@example.com" },
  ]);
  assert.deepEqual(opened.map((t) => t.url), [
    "https://gemini.google.com/u/0/app",
    "https://gemini.google.com/u/1/app",
    "https://gemini.google.com/u/2/app",
  ]);
  assert.ok(opened.every((t) => !t.active), "scan tabs open in the background");
  assert.ok(
    windowsOpened.length > 0 && windowsOpened.every((w) => w.state === "minimized" && w.focused === false),
    "scan tabs open in a minimized, unfocused window, out of the user's tab strip",
  );
  assert.equal(tabs.size, 0, "every scan tab is closed");
});

test("labels follow the email when Google renumbers accounts", async () => {
  await jobs.refreshAccounts();
  await jobs.setAccountLabel(1, "Shop B");
  // "first" signs out: "second" moves to /u/0.
  emailAtIndex = (i) => (i === 0 ? "second@example.com" : null);
  const found = await jobs.refreshAccounts();
  assert.deepEqual(found, [{ index: 0, email: "second@example.com", label: "Shop B" }]);
});

test("nothing that looks like a credential is stored for an account", async () => {
  await jobs.refreshAccounts();
  const stored = JSON.stringify(storageArea["teepublic.gemini.accounts"]);
  assert.doesNotMatch(stored, /password|token|cookie|SID/i);
  assert.deepEqual(Object.keys((storageArea["teepublic.gemini.accounts"] as object[])[0]).sort(), ["email", "index", "label"]);
});

// ── Jobs ────────────────────────────────────────────────────────────────────

test("jobs run on exactly their account: one at a time per account, accounts in parallel", async () => {
  await jobs.refreshAccounts();
  opened.length = 0;

  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "listing", prompt: "write it", imageBase64: PNG_B64, imageMime: "image/png" });
  await jobs.enqueueJob({ jobId: "b", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await jobs.enqueueJob({ jobId: "c", accountIndex: 1, jobType: "image", prompt: "draw it too" });
  await until(() => runMessages().length === 2, "two jobs started");

  assert.equal((await jobById("a")).status, "running");
  assert.equal((await jobById("b")).status, "queued", "account 0 is busy, so b waits");
  assert.equal((await jobById("c")).status, "running", "account 1 runs in parallel");
  assert.deepEqual(opened.map((t) => [t.url, t.active]), [
    ["https://gemini.google.com/u/0/app", false],
    ["https://gemini.google.com/u/1/app", false],
  ]);
  assert.equal(windowsOpened.length, 1, "the scan and both jobs share one hidden window");

  const runA = runMessages().find((s) => s.message.jobId === "a")!.message;
  assert.equal(runA.expectedEmail, "first@example.com");
  assert.equal(runA.jobType, "listing");
  assert.match(String(runA.imageDataUrl), /^data:image\/png;base64,/);
  assert.equal(runMessages().find((s) => s.message.jobId === "c")!.message.expectedEmail, "second@example.com");
});

test("a finished job stores its result, closes its tab and starts that account's next job", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "listing", prompt: "write it", imageBase64: PNG_B64 });
  await jobs.enqueueJob({ jobId: "b", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await until(() => runMessages().length === 1, "a started");
  const tabA = runMessages()[0].tabId;

  const listing = { title: "Retro Cat Tee", tags: ["retro"], description: "A cat." };
  await jobs.handleDone({ type: "GEMINI_JOB_DONE", jobId: "a", ok: true, listing }, tabA);

  const a = await jobById("a");
  assert.equal(a.status, "succeeded");
  assert.deepEqual(a.listing, listing);
  assert.equal(tabs.has(tabA), false, "the job's tab is closed");
  assert.ok(!("tabId" in a), "the state read does not expose tab ids");
  await until(() => runMessages().length === 2, "b started");
  assert.equal(runMessages()[1].message.jobId, "b");
  assert.equal(opened.at(-1)!.url, "https://gemini.google.com/u/0/app", "b stays on its own account");

  // The design a listing was written for stays available next to it.
  const images = await jobs.getJobImages("a");
  assert.match(String(images.inputImageDataUrl), /^data:image\/png;base64,/);
  assert.equal(images.imageDataUrl, null);
});

test("an image result is kept in IndexedDB, never in chrome.storage", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "img", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await until(() => runMessages().length === 1, "started");
  const generated = `data:image/png;base64,${PNG_B64}`;
  await jobs.handleDone({ type: "GEMINI_JOB_DONE", jobId: "img", ok: true, imageDataUrl: generated }, runMessages()[0].tabId);

  assert.equal((await jobById("img")).hasResultImage, true);
  assert.equal((await jobs.getJobImages("img")).imageDataUrl, generated);
  assert.doesNotMatch(JSON.stringify(storageArea), /base64/, "no image bytes in chrome.storage");
});

test("a failure is recorded with its code and the job is NOT moved to another account", async () => {
  await jobs.refreshAccounts();
  opened.length = 0; // the scan itself visits /u/1 and /u/2
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await jobs.enqueueJob({ jobId: "b", accountIndex: 0, jobType: "image", prompt: "draw more" });
  await until(() => runMessages().length === 1, "a started");

  await jobs.handleDone(
    { type: "GEMINI_JOB_DONE", jobId: "a", ok: false, code: "LIMIT_REACHED", error: "limit" },
    runMessages()[0].tabId,
  );
  const a = await jobById("a");
  assert.equal(a.status, "failed");
  assert.equal(a.errorCode, "LIMIT_REACHED");
  assert.equal(a.accountIndex, 0);
  await until(() => runMessages().length === 2, "b started");
  assert.ok(opened.every((t) => t.url === "https://gemini.google.com/u/0/app"), "account 1 was never used");
});

test("a result from a tab that is not the job's is ignored", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await until(() => runMessages().length === 1, "a started");
  await jobs.handleDone({ type: "GEMINI_JOB_DONE", jobId: "a", ok: true, imageDataUrl: `data:image/png;base64,${PNG_B64}` }, 999);
  assert.equal((await jobById("a")).status, "running");
});

test("closing a running job's tab fails the job", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await until(() => runMessages().length === 1, "a started");
  await jobs.handleTabRemoved(runMessages()[0].tabId);
  const a = await jobById("a");
  assert.equal(a.status, "failed");
  assert.equal(a.errorCode, "UNKNOWN");
});

test("retry re-queues a failed job on the same account, with its image", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "a", accountIndex: 1, jobType: "listing", prompt: "write it", imageBase64: PNG_B64 });
  await until(() => runMessages().length === 1, "a started");
  await jobs.handleDone({ type: "GEMINI_JOB_DONE", jobId: "a", ok: false, code: "TIMEOUT", error: "slow" }, runMessages()[0].tabId);
  await jobs.retryJob("a");
  await until(() => runMessages().length === 2, "a restarted");
  assert.equal(runMessages()[1].message.expectedEmail, "second@example.com");
  assert.match(String(runMessages()[1].message.imageDataUrl), /^data:image\/png/);
});

test("without live access a job fails and no Gemini tab is opened", async () => {
  await jobs.refreshAccounts();
  opened.length = 0;
  accessAllowed = false;
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "image", prompt: "draw it" });
  await until(async () => (await jobById("a")).status === "failed", "a failed");
  assert.match(String((await jobById("a")).error), /Access denied/);
  assert.equal(opened.length, 0);
});

test("removing a job deletes its images and closes its tab", async () => {
  await jobs.refreshAccounts();
  await jobs.enqueueJob({ jobId: "a", accountIndex: 0, jobType: "listing", prompt: "write it", imageBase64: PNG_B64 });
  await until(() => runMessages().length === 1, "a started");
  const tabA = runMessages()[0].tabId;
  await jobs.removeJob("a");
  assert.equal(tabs.has(tabA), false);
  assert.deepEqual(await jobs.getJobImages("a"), { imageDataUrl: null, inputImageDataUrl: null });
  assert.equal((await jobs.getGeminiState()).jobs.length, 0);
});

test("bad job requests are refused", async () => {
  await assert.rejects(jobs.enqueueJob({ jobId: "x", accountIndex: -1, jobType: "image", prompt: "p" }), /accountIndex/);
  await assert.rejects(jobs.enqueueJob({ jobId: "x", accountIndex: 0, jobType: "video" as never, prompt: "p" }), /jobType/);
  await assert.rejects(jobs.enqueueJob({ jobId: "x", accountIndex: 0, jobType: "image", prompt: "  " }), /prompt/);
  await jobs.enqueueJob({ jobId: "dup", accountIndex: 0, jobType: "listing", prompt: "p", imageBase64: PNG_B64 });
  await assert.rejects(
    jobs.enqueueJob({ jobId: "dup", accountIndex: 0, jobType: "listing", prompt: "p", imageBase64: "AAAA", imageMime: "image/jpeg" }),
    /already exists/,
  );
  assert.equal((await jobs.getJobImages("dup")).inputImageDataUrl, `data:image/png;base64,${PNG_B64}`, "the rejected duplicate left the first image alone");
});

test("the image fetch helper only fetches from Google's image host", async () => {
  for (const url of ["https://evil.example.com/a.png", "http://lh3.googleusercontent.com/a", "https://www.higgstee.com/x", "not a url"]) {
    const res = await jobs.fetchGeneratedImage(url);
    assert.equal(res.ok, false, url);
  }
});

// ── The release switch ─────────────────────────────────────────────────────
// Gemini browser jobs are OFF in the store package (owner's decision for 1.1.0):
// the switch, the build and the manifest must agree, so a release can never ask
// for the debugger permission or Gemini's hosts by accident.
test("Gemini browser jobs are switched off for the store release, everywhere at once", async () => {
  const { GEMINI_BROWSER_JOBS } = await import("../packages/shared/src/features.ts");
  assert.equal(GEMINI_BROWSER_JOBS, false);
  const manifest = JSON.parse(readFileSync(path.join(__REPO_ROOT__, "apps/extension/manifest.json"), "utf8"));
  assert.ok(!manifest.permissions.includes("debugger"), "debugger permission in the store manifest");
  assert.ok(!JSON.stringify(manifest).includes("gemini.google.com"), "gemini.google.com in the store manifest");
  const build = readFileSync(path.join(__REPO_ROOT__, "apps/extension/build.mjs"), "utf8");
  assert.match(build, /GEMINI_BROWSER_JOBS \? \{[\s\S]*"content\/gemini"/, "build.mjs builds the Gemini scripts only when the switch is on");
});
