// Daily upload quota, one per project (= one TeePublic account).
//
// TeePublic allows N uploads per ROLLING 24h window and counts failed uploads
// against it too, but never shows how many are left. So we keep one timestamp
// per upload attempt that ended (succeeded or failed) and count the ones
// younger than 24h. Kept locally in chrome.storage, under its own key, so
// clearing the queue never resets it - and nothing about it reaches a server.
//
// Entries hold an attempt key (`<itemId>#<attempt>`) and a time - no design
// data. Batches without a project share the "default" bucket.

import type { UploadQuota } from "@teepublic/shared";

export const DEFAULT_DAILY_LIMIT = 50;
const LOG_KEY = "teepublic.uploadLog";
const LIMITS_KEY = "teepublic.dailyLimits";
const WINDOW_MS = 24 * 60 * 60 * 1000;

interface Entry { id: string; at: number }
type Logs = Record<string, Entry[]>;

export type Quota = UploadQuota;

export function projectKey(projectId: string | undefined | null): string {
  return projectId || "default";
}

// Serialize every read-modify-write: ITEM_STATUS and the engine can land at once.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function readLogs(): Promise<Logs> {
  const all = await chrome.storage.local.get(LOG_KEY);
  const raw = all[LOG_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Logs) : {};
}

async function readLog(key: string): Promise<Entry[]> {
  const cutoff = Date.now() - WINDOW_MS;
  return ((await readLogs())[key] ?? []).filter((e) => e && e.at > cutoff);
}

async function writeLog(key: string, log: Entry[]): Promise<void> {
  const logs = await readLogs();
  logs[key] = log;
  await chrome.storage.local.set({ [LOG_KEY]: logs });
}

async function readLimits(): Promise<Record<string, number>> {
  const all = await chrome.storage.local.get(LIMITS_KEY);
  const raw = all[LIMITS_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, number>) : {};
}

export async function getQuota(key: string): Promise<Quota> {
  const [log, limits] = await Promise.all([readLog(key), readLimits()]);
  const limit = Math.max(0, Math.floor(Number(limits[key] ?? DEFAULT_DAILY_LIMIT) || 0));
  const times = log.map((e) => e.at).sort((a, b) => a - b);
  const used = times.length;
  const remaining = Math.max(0, limit - used);
  // When full, a slot frees once enough old uploads age out to drop below the limit.
  const nextFreeAt = used === 0 ? null
    : remaining > 0 ? times[0] + WINDOW_MS
    : times[Math.max(0, used - limit)] + WINDOW_MS;
  return { limit, used, remaining, nextFreeAt };
}

export async function getQuotas(keys: string[]): Promise<Record<string, Quota>> {
  const out: Record<string, Quota> = {};
  for (const k of keys) out[k] = await getQuota(k);
  return out;
}

/** Count upload attempts that just ended. Each attempt key counts once. */
export function recordAttempts(key: string, attemptIds: string[]): Promise<void> {
  return serial(async () => {
    const log = await readLog(key);
    const seen = new Set(log.map((e) => e.id));
    const now = Date.now();
    for (const id of attemptIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      log.push({ id, at: now });
    }
    await writeLog(key, log);
  });
}

/** "Fix count": I already used N in the last 24h. Extra ones are stamped now
 *  (they free up in 24h - the safe side); fewer drops the oldest. */
export function setUsed(key: string, n: number): Promise<void> {
  return serial(async () => {
    const log = (await readLog(key)).sort((a, b) => a.at - b.at);
    const want = Math.max(0, Math.floor(n));
    const now = Date.now();
    while (log.length > want) log.shift();
    for (let i = log.length; i < want; i++) log.push({ id: `manual-${now}-${i}`, at: now });
    await writeLog(key, log);
  });
}

export function setLimit(key: string, limit: number): Promise<void> {
  return serial(async () => {
    const limits = await readLimits();
    limits[key] = Math.max(0, Math.min(1000, Math.floor(Number(limit) || 0)));
    await chrome.storage.local.set({ [LIMITS_KEY]: limits });
  });
}

// ── Upload history: { [project]: { "YYYY-MM-DD" (UTC): { done, failed } } } ──
// A permanent per-day tally for the dashboard's History, separate from the
// 24h log above. Counts only - no design data. Kept locally like the log.
const HISTORY_KEY = "teepublic.uploadHistory";
const HISTORY_DAYS = 400;

type History = Record<string, Record<string, UploadDay>>;
export interface UploadDay { done: number; failed: number }

async function readHistory(): Promise<History> {
  const all = await chrome.storage.local.get(HISTORY_KEY);
  const raw = all[HISTORY_KEY];
  return raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as History) : {};
}

export function addHistory(key: string, done: number, failed: number): Promise<void> {
  if (done <= 0 && failed <= 0) return Promise.resolve();
  return serial(async () => {
    const hist = await readHistory();
    const days = hist[key] ?? {};
    const today = new Date().toISOString().slice(0, 10);
    const d = days[today] ?? { done: 0, failed: 0 };
    days[today] = { done: d.done + done, failed: d.failed + failed };
    // Keep about a year per project.
    const cutoff = new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString().slice(0, 10);
    for (const day of Object.keys(days)) if (day < cutoff) delete days[day];
    hist[key] = days;
    await chrome.storage.local.set({ [HISTORY_KEY]: hist });
  });
}

export async function getHistory(keys: string[]): Promise<Record<string, Record<string, UploadDay>>> {
  const hist = await readHistory();
  return Object.fromEntries(keys.map((k) => [k, hist[k] ?? {}]));
}
