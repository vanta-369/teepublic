// Gemini jobs: the queue, the accounts list, and the runner. Background-only.
//
// Like the AutomationEngine for TeePublic, this never touches a page: it opens
// a background gemini.google.com tab per job, hands the job to the content
// script (content/gemini.ts), and records what comes back. Unlike TeePublic it
// runs one job at a time PER ACCOUNT, so different accounts work in parallel.
//
// There is deliberately no account selection here: a job runs on exactly the
// accountIndex it was given, and fails (NOT_SIGNED_IN, LIMIT_REACHED, ...) if
// that account cannot run it. Nothing moves a job to another account.
//
// Persistence follows QueueStore: job metadata in chrome.storage.local (small),
// images in IndexedDB (GeminiDb). A job survives the service worker sleeping:
// its tab keeps running, and the tab's GEMINI_JOB_DONE message wakes the worker
// and is matched to the job by id and tab.

import {
  GEMINI_JOB_TIMEOUT_MS,
  type GeminiAccount,
  type GeminiErrorCode,
  type GeminiJob,
  type GeminiJobType,
  type GeminiStateData,
  type InternalMessage,
} from "@teepublic/shared";
import { GEMINI } from "../lib/geminiSelectors";
import { GeminiDb, blobToDataUrl } from "../lib/imageDb";
import { assertCanAccess, AccessDeniedError } from "../lib/access";

const ACCOUNTS_KEY = "teepublic.gemini.accounts";
const JOBS_KEY = "teepublic.gemini.jobs";

/** A job as stored: the shared shape plus the tab running it. */
interface StoredJob extends GeminiJob {
  tabId?: number;
}

/** A tab that has not finished loading in this long is a failed start. */
const TAB_LOAD_MS = 45_000;
/** Extra time past the content script's own timeout before the watchdog acts. */
const WATCHDOG_GRACE_MS = 60_000;
/** Safety stop for the account scan. Not a limit on accounts: Google itself
 *  caps how many can be signed in at once, well below this. */
const MAX_ACCOUNT_SCAN = 50;
const MAX_LABEL_LENGTH = 60;
const MAX_FETCHED_IMAGE_BYTES = 40 * 1024 * 1024;

const inputKey = (jobId: string) => `in:${jobId}`;
const outputKey = (jobId: string) => `out:${jobId}`;

// ── Storage ─────────────────────────────────────────────────────────────────

// Every read-modify-write of the job list goes through this chain, so two
// messages arriving together (a DONE and a PROGRESS) cannot overwrite each other.
let chain: Promise<unknown> = Promise.resolve();
function serialized<T>(work: () => Promise<T>): Promise<T> {
  const next = chain.then(work, work);
  chain = next.catch(() => undefined);
  return next;
}

async function readJobs(): Promise<StoredJob[]> {
  const all = await chrome.storage.local.get(JOBS_KEY);
  return (all[JOBS_KEY] as StoredJob[] | undefined) ?? [];
}

async function writeJobs(jobs: StoredJob[]): Promise<void> {
  await chrome.storage.local.set({ [JOBS_KEY]: jobs });
}

function updateJob(jobId: string, patch: Partial<StoredJob>): Promise<StoredJob | null> {
  return serialized(async () => {
    const jobs = await readJobs();
    const i = jobs.findIndex((j) => j.id === jobId);
    if (i < 0) return null;
    jobs[i] = { ...jobs[i], ...patch, updatedAt: Date.now() };
    await writeJobs(jobs);
    return jobs[i];
  });
}

export async function listAccounts(): Promise<GeminiAccount[]> {
  const all = await chrome.storage.local.get(ACCOUNTS_KEY);
  return (all[ACCOUNTS_KEY] as GeminiAccount[] | undefined) ?? [];
}

async function writeAccounts(accounts: GeminiAccount[]): Promise<void> {
  await chrome.storage.local.set({ [ACCOUNTS_KEY]: accounts });
}

/** Jobs without the extension-internal tab id. Metadata only. Also the
 *  heartbeat: the dashboard polls this, so a stuck job is noticed and queued
 *  work is started even if no other message woke the worker. */
export async function getGeminiState(): Promise<GeminiStateData> {
  await pump();
  const jobs = (await readJobs()).map(({ tabId: _tabId, ...job }) => job);
  return { accounts: await listAccounts(), jobs };
}

/** A job's images: what Gemini generated, and the design it was sent with. */
export async function getJobImages(jobId: string): Promise<{ imageDataUrl: string | null; inputImageDataUrl: string | null }> {
  return {
    imageDataUrl: await GeminiDb.get(outputKey(jobId)),
    inputImageDataUrl: await GeminiDb.get(inputKey(jobId)),
  };
}

// ── Accounts ────────────────────────────────────────────────────────────────

/**
 * Automation tabs live in ONE minimized, unfocused window, so they never show
 * in the user's tab strip and the taskbar doesn't flicker a window per job. A
 * blank holder tab keeps that window alive between jobs; it is closed once
 * nothing is queued, running or scanning (closeHiddenWindowIfIdle).
 */
let hiddenWindowId: number | null = null;

async function openHiddenTab(url: string): Promise<number> {
  clearTimeout(idleTimer);
  if (hiddenWindowId != null) {
    try {
      const tab = await chrome.tabs.create({ windowId: hiddenWindowId, url, active: false });
      return tab.id!;
    } catch {
      hiddenWindowId = null; // the user closed it
    }
  }
  const win = await chrome.windows.create({ url: "about:blank", state: "minimized", focused: false });
  if (win?.id == null) throw new Error("Could not open a Gemini window.");
  hiddenWindowId = win.id;
  const tab = await chrome.tabs.create({ windowId: win.id, url, active: false });
  return tab.id!;
}

// The dashboard queues a batch's next design only after the previous one is
// done, so the window waits a little before closing instead of reopening.
const IDLE_CLOSE_MS = 20_000;
let idleTimer: ReturnType<typeof setTimeout> | undefined;

function scheduleIdleClose(): void {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void closeHiddenWindowIfIdle(), IDLE_CLOSE_MS);
  // Node (the tests) would otherwise wait for this timer before exiting.
  (idleTimer as { unref?: () => void }).unref?.();
}

async function closeHiddenWindowIfIdle(): Promise<void> {
  if (hiddenWindowId == null || scanning) return;
  const jobs = await readJobs();
  if (jobs.some((j) => j.status === "queued" || j.status === "running")) return;
  const id = hiddenWindowId;
  hiddenWindowId = null;
  await chrome.windows.remove(id).catch(() => undefined);
}

export async function addAccount(): Promise<void> {
  await chrome.tabs.create({ url: GEMINI.addAccountUrl, active: true });
}

export async function setAccountLabel(index: number, label: string): Promise<GeminiAccount[]> {
  const accounts = await listAccounts();
  const next = accounts.map((a) =>
    a.index === index ? { ...a, label: label.trim().slice(0, MAX_LABEL_LENGTH) || a.email } : a,
  );
  await writeAccounts(next);
  return next;
}

let scanning: Promise<GeminiAccount[]> | null = null;

/**
 * Find every Google account signed in to this browser: load
 * gemini.google.com/u/0/app, /u/1/app, ... in ONE background tab and read the
 * address each shows. Google answers an index past the last account with an
 * account already seen (or a sign-in page), which is where the scan stops.
 * Labels are kept by email, since an account's index moves when another
 * account signs out.
 */
export function refreshAccounts(): Promise<GeminiAccount[]> {
  scanning ??= scanAccounts().finally(() => {
    scanning = null;
    scheduleIdleClose();
  });
  return scanning;
}

async function scanAccounts(): Promise<GeminiAccount[]> {
  const previous = await listAccounts();
  const labelFor = new Map(previous.map((a) => [a.email, a.label]));
  const found: GeminiAccount[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < MAX_ACCOUNT_SCAN; index++) {
    // A fresh tab per index: re-navigating one tab can report the PREVIOUS
    // page as loaded, which would read the same account twice.
    const tabId = await openHiddenTab(GEMINI.appUrl(index));
    let email: string | null = null;
    try {
      const url = await waitForTabLoad(tabId);
      if (url && isGeminiUrl(url)) {
        const res = await sendToTab<{ signedIn: boolean; email: string | null }>(tabId, { type: "GEMINI_READ_ACCOUNT" });
        email = res?.signedIn ? res.email : null;
      }
    } finally {
      await chrome.tabs.remove(tabId).catch(() => undefined);
    }
    // No address (a sign-in page) or one already seen: past the last account.
    if (!email || seen.has(email)) break;
    seen.add(email);
    found.push({ index, email, label: labelFor.get(email) ?? email });
  }
  await writeAccounts(found);
  return found;
}

// ── Jobs ────────────────────────────────────────────────────────────────────

export interface NewJob {
  jobId: string;
  accountIndex: number;
  jobType: GeminiJobType;
  prompt: string;
  imageBase64?: string;
  imageMime?: string;
}

export async function enqueueJob(req: NewJob): Promise<void> {
  if (!req.jobId || typeof req.jobId !== "string") throw new Error("jobId is required");
  if (!Number.isInteger(req.accountIndex) || req.accountIndex < 0) throw new Error("accountIndex must be a whole number ≥ 0");
  if (req.jobType !== "image" && req.jobType !== "listing") throw new Error('jobType must be "image" or "listing"');
  if (!req.prompt?.trim()) throw new Error("prompt is required");

  const now = Date.now();
  await serialized(async () => {
    const jobs = await readJobs();
    // Checked before the image is written, so a repeated id cannot overwrite
    // the existing job's design.
    if (jobs.some((j) => j.id === req.jobId)) throw new Error(`job ${req.jobId} already exists`);
    if (req.imageBase64) {
      const mime = /^image\/[\w.+-]+$/.test(req.imageMime ?? "") ? req.imageMime : "image/png";
      await GeminiDb.put(inputKey(req.jobId), `data:${mime};base64,${req.imageBase64}`);
    }
    jobs.push({
      id: req.jobId,
      accountIndex: req.accountIndex,
      type: req.jobType,
      prompt: req.prompt.trim(),
      hasInputImage: !!req.imageBase64,
      status: "queued",
      createdAt: now,
      updatedAt: now,
    });
    await writeJobs(jobs);
  });
  void pump();
}

export async function retryJob(jobId: string): Promise<void> {
  const job = (await readJobs()).find((j) => j.id === jobId);
  if (!job) throw new Error("job not found");
  if (job.status !== "failed") throw new Error("only a failed job can be retried");
  if (job.hasInputImage && !(await GeminiDb.get(inputKey(jobId)))) {
    throw new Error("this job's image is no longer stored; add it again");
  }
  await updateJob(jobId, { status: "queued", errorCode: undefined, error: undefined, step: undefined, startedAt: undefined, tabId: undefined });
  void pump();
}

export async function removeJob(jobId: string): Promise<void> {
  const job = await serialized(async () => {
    const jobs = await readJobs();
    const hit = jobs.find((j) => j.id === jobId) ?? null;
    await writeJobs(jobs.filter((j) => j.id !== jobId));
    return hit;
  });
  if (job?.tabId != null) await chrome.tabs.remove(job.tabId).catch(() => undefined);
  await GeminiDb.delete(inputKey(jobId));
  await GeminiDb.delete(outputKey(jobId));
}

async function failJob(jobId: string, code: GeminiErrorCode, error: string): Promise<void> {
  const job = await updateJob(jobId, { status: "failed", errorCode: code, error, step: undefined });
  if (job?.tabId != null) await chrome.tabs.remove(job.tabId).catch(() => undefined);
  await updateJob(jobId, { tabId: undefined });
  console.warn(`[gemini] job ${jobId} failed: ${code} ${error}`);
}

/**
 * Fail running jobs whose tab is gone or that have outlived their timeout.
 * Runs on every state read (the dashboard polls) and every pump, which is what
 * catches a job whose tab died while the service worker was asleep.
 */
async function reconcile(): Promise<void> {
  const now = Date.now();
  for (const job of await readJobs()) {
    if (job.status !== "running") continue;
    const alive = job.tabId != null && (await chrome.tabs.get(job.tabId).then(() => true, () => false));
    if (!alive && job.tabId != null) {
      await failJob(job.id, "UNKNOWN", "The Gemini tab was closed before the job finished.");
    } else if (now - (job.startedAt ?? job.updatedAt) > GEMINI_JOB_TIMEOUT_MS + WATCHDOG_GRACE_MS) {
      await failJob(job.id, "TIMEOUT", "Gemini did not finish answering within 3 minutes.");
    }
  }
}

/**
 * Start the next queued job for every account that is not already busy.
 * Claiming a job (queued -> running) happens inside the serialized store write,
 * so two pumps can never start the same job or two jobs on one account. The
 * claimed jobs then start in the background: one account's slow page load
 * never holds up another account's job.
 */
export async function pump(): Promise<void> {
  await reconcile();
  const claimed = await serialized(async () => {
    const jobs = await readJobs();
    const busy = new Set(jobs.filter((j) => j.status === "running").map((j) => j.accountIndex));
    const picked: StoredJob[] = [];
    const now = Date.now();
    for (const job of jobs) {
      if (job.status !== "queued" || busy.has(job.accountIndex)) continue;
      busy.add(job.accountIndex);
      Object.assign(job, { status: "running", startedAt: now, updatedAt: now, step: "opening Gemini" });
      picked.push(job);
    }
    if (picked.length) await writeJobs(jobs);
    return picked;
  });
  for (const job of claimed) void startJob(job);
  if (!claimed.length) scheduleIdleClose();
}

async function startJob(job: StoredJob): Promise<void> {
  // Live access gate before EVERY job, like the upload engine's loop: no cached
  // plan, and if access cannot be confirmed the job does not run.
  try {
    await assertCanAccess();
  } catch (e) {
    const reason = e instanceof AccessDeniedError ? e.status : (e as Error).message;
    return failJob(job.id, "UNKNOWN", `Access denied (${reason}). Sign in or upgrade in the extension.`);
  }

  let tabId: number | undefined;
  try {
    tabId = await openHiddenTab(GEMINI.appUrl(job.accountIndex));
    await updateJob(job.id, { tabId });

    const url = await waitForTabLoad(tabId);
    if (!url) return failJob(job.id, "TIMEOUT", "Gemini did not finish loading.");
    if (!isGeminiUrl(url)) return failJob(job.id, "NOT_SIGNED_IN", "Google asked this account to sign in again.");

    const account = (await listAccounts()).find((a) => a.index === job.accountIndex);
    const imageDataUrl = job.hasInputImage ? await GeminiDb.get(inputKey(job.id)) : null;
    if (job.hasInputImage && !imageDataUrl) return failJob(job.id, "UNKNOWN", "This job's image is no longer stored.");

    const ack = await sendToTab<{ ok: boolean; error?: string }>(tabId, {
      type: "GEMINI_RUN",
      jobId: job.id,
      jobType: job.type,
      prompt: job.prompt,
      imageDataUrl: imageDataUrl ?? undefined,
      expectedEmail: account?.email,
    });
    if (!ack?.ok) return failJob(job.id, "UNKNOWN", ack?.error ?? "The Gemini page did not respond.");
  } catch (e) {
    return failJob(job.id, "UNKNOWN", e instanceof Error ? e.message : String(e));
  }
}

/** GEMINI_JOB_PROGRESS from a content script. */
export async function handleProgress(jobId: string, step: string, senderTabId?: number): Promise<void> {
  const job = (await readJobs()).find((j) => j.id === jobId);
  if (!job || job.status !== "running" || (senderTabId != null && job.tabId !== senderTabId)) return;
  await updateJob(jobId, { step: String(step).slice(0, 60) });
}

/** GEMINI_JOB_DONE from a content script: record the outcome, close the tab,
 *  start the account's next job. A message from a tab that is not the job's
 *  (a stale tab, a retried job) is ignored. */
export async function handleDone(
  msg: Extract<InternalMessage, { type: "GEMINI_JOB_DONE" }>,
  senderTabId?: number,
): Promise<void> {
  const job = (await readJobs()).find((j) => j.id === msg.jobId);
  if (!job || job.status !== "running" || (senderTabId != null && job.tabId !== senderTabId)) return;

  if (!msg.ok) {
    await failJob(job.id, msg.code, msg.error);
  } else {
    if (msg.imageDataUrl) await GeminiDb.put(outputKey(job.id), msg.imageDataUrl);
    await updateJob(job.id, {
      status: "succeeded",
      step: undefined,
      listing: msg.listing,
      hasResultImage: !!msg.imageDataUrl,
      tabId: undefined,
    });
    // The design the job was sent with is kept until the job is removed: a
    // listing is only useful next to its artwork ("Save as product" on the
    // dashboard reads both back with GEMINI_RESULT).
    if (job.tabId != null) await chrome.tabs.remove(job.tabId).catch(() => undefined);
  }
  void pump();
}

/** A running job's tab was closed by hand. */
/** True when `tabId` is running one of our jobs (the debugger attaches to nothing else). */
export async function isJobTab(tabId: number): Promise<boolean> {
  return (await readJobs()).some((j) => j.status === "running" && j.tabId === tabId);
}

export async function handleTabRemoved(tabId: number): Promise<void> {
  const job = (await readJobs()).find((j) => j.status === "running" && j.tabId === tabId);
  if (job) await failJob(job.id, "UNKNOWN", "The Gemini tab was closed before the job finished.");
  void pump();
}

/**
 * GEMINI_FETCH_IMAGE: fetch a generated image the page's CORS will not let the
 * content script read. Only Google's image host, which the manifest grants;
 * anything else is refused, so this cannot be used to fetch arbitrary URLs.
 */
export async function fetchGeneratedImage(value: unknown): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  let url: URL;
  try {
    url = new URL(String(value));
  } catch {
    return { ok: false, error: "bad url" };
  }
  if (url.protocol !== "https:" || url.hostname !== "lh3.googleusercontent.com") return { ok: false, error: "host not allowed" };
  try {
    const res = await fetch(url.href, { credentials: "include", signal: AbortSignal.timeout(60_000) });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const blob = await res.blob();
    if (!blob.type.startsWith("image/") || blob.size <= 1000 || blob.size > MAX_FETCHED_IMAGE_BYTES) {
      return { ok: false, error: "not an image" };
    }
    return { ok: true, dataUrl: await blobToDataUrl(blob) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Tabs ────────────────────────────────────────────────────────────────────

function isGeminiUrl(url: string): boolean {
  return url.startsWith("https://gemini.google.com/");
}

/** Resolve with the tab's URL once it has loaded, or null on timeout/close. */
function waitForTabLoad(tabId: number, timeoutMs = TAB_LOAD_MS): Promise<string | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (url: string | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
      resolve(url);
    };
    const onUpdated = (id: number, info: chrome.tabs.TabChangeInfo, tab: chrome.tabs.Tab) => {
      if (id === tabId && info.status === "complete" && tab.url && tab.url !== "about:blank") finish(tab.url);
    };
    const timer = setTimeout(() => finish(null), timeoutMs);
    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId).then(
      (tab) => { if (tab.status === "complete" && tab.url && tab.url !== "about:blank") finish(tab.url); },
      () => finish(null),
    );
  });
}

/** Message the content script, retrying while it is still being injected. */
async function sendToTab<T>(tabId: number, message: InternalMessage, attempts = 20): Promise<T | null> {
  for (let i = 0; i < attempts; i++) {
    try {
      return (await chrome.tabs.sendMessage(tabId, message)) as T;
    } catch {
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  return null;
}
