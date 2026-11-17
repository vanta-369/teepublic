// TeePublic sales notifier - the service-worker side.
//
// The offscreen document (src/offscreen) fetches www.teepublic.com/account/sales
// with the user's own TeePublic session every N seconds, parses the counters and
// sends a snapshot here. This compares it with the last one: a rise in items
// sold is a sale -> desktop notification, chime, badge. Royalty-only changes and
// corrections are recorded without a sound. The first reading is a baseline.
//
// Everything stays in chrome.storage.local - nothing goes to Higgstee or
// Supabase. Readings are kept PER PROJECT (one TeePublic account each), so
// counters from two accounts are never compared against each other.

import { addToDaily, dailyFromHistory, formatGmt, salesToday, salesChange, usd, type SalesDay, type SalesEvent, type SalesSnapshot } from "../lib/salesCore";
import { getChosenProject } from "../lib/projects";

const SETTINGS_KEY = "teepublic.salesSettings";
const DATA_KEY = "teepublic.sales";
const HISTORY_MAX = 1000;

export interface SalesSettings {
  enabled: boolean;
  sound: boolean;
  /** 0-100 */
  volume: number;
  intervalSeconds: number;
}

export interface ProjectSales {
  baseline: SalesSnapshot | null;
  history: SalesEvent[];
  unread: number;
  status: string;
  checkedAt: number | null;
  /** Sales and royalty per day (local date), kept for good - the activity
   *  list keeps only its latest 1,000 entries. */
  daily: Record<string, SalesDay>;
}

export interface SalesState extends SalesSettings, ProjectSales {
  projectKey: string;
}

/** Checks are spaced out so the traffic doesn't look like a bot: every 2 minutes
 *  by default, never more often than once a minute. */
export const MIN_INTERVAL_SECONDS = 60;
export const DEFAULT_INTERVAL_SECONDS = 120;
const DEFAULT_SETTINGS: SalesSettings = { enabled: true, sound: true, volume: 100, intervalSeconds: DEFAULT_INTERVAL_SECONDS };
const emptyProject = (): ProjectSales => ({ baseline: null, history: [], unread: 0, status: "Waiting for first check", checkedAt: null, daily: {} });

/** Saved before the per-day tally existed: rebuild it from the activity list. */
const withDaily = (p: ProjectSales): ProjectSales =>
  Object.keys(p.daily ?? {}).length === 0 && p.history.length > 0 ? { ...p, daily: dailyFromHistory(p.history) } : { ...p, daily: p.daily ?? {} };

async function projectKey(): Promise<string> {
  return (await getChosenProject()) ?? "default";
}

export async function getSettings(): Promise<SalesSettings> {
  const all = await chrome.storage.local.get(SETTINGS_KEY);
  const s: SalesSettings = { ...DEFAULT_SETTINGS, ...(all[SETTINGS_KEY] ?? {}) };
  // Saved under the old 20-second default (or the old 10-second minimum).
  if (!Number.isSafeInteger(s.intervalSeconds) || s.intervalSeconds < MIN_INTERVAL_SECONDS) s.intervalSeconds = DEFAULT_INTERVAL_SECONDS;
  return s;
}

async function readAll(): Promise<Record<string, ProjectSales>> {
  const all = await chrome.storage.local.get(DATA_KEY);
  const raw = all[DATA_KEY];
  return raw && typeof raw === "object" ? (raw as Record<string, ProjectSales>) : {};
}

// One write at a time: snapshots, errors and "seen" can land together.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => {});
  return next;
}

async function updateProject(fn: (p: ProjectSales) => ProjectSales): Promise<ProjectSales> {
  return serial(async () => {
    const key = await projectKey();
    const all = await readAll();
    const next = fn(withDaily({ ...emptyProject(), ...(all[key] ?? {}) }));
    all[key] = next;
    await chrome.storage.local.set({ [DATA_KEY]: all });
    return next;
  });
}

export async function getSalesState(): Promise<SalesState> {
  const [settings, key, all] = await Promise.all([getSettings(), projectKey(), readAll()]);
  return { ...settings, ...withDaily({ ...emptyProject(), ...(all[key] ?? {}) }), projectKey: key };
}

export async function setSettings(patch: Partial<SalesSettings>): Promise<void> {
  const cur = await getSettings();
  const next: SalesSettings = {
    enabled: patch.enabled ?? cur.enabled,
    sound: patch.sound ?? cur.sound,
    volume: patch.volume != null ? Math.max(0, Math.min(100, Math.round(patch.volume))) : cur.volume,
    intervalSeconds: patch.intervalSeconds != null ? patch.intervalSeconds : cur.intervalSeconds,
  };
  if (!Number.isSafeInteger(next.intervalSeconds) || next.intervalSeconds < MIN_INTERVAL_SECONDS || next.intervalSeconds > 86400) {
    throw new Error(`Check every: a whole number from ${MIN_INTERVAL_SECONDS} to 86400 seconds.`);
  }
  await chrome.storage.local.set({ [SETTINGS_KEY]: next });
  await ensureOffscreen();
  void toOffscreen({ type: "SALES_CONFIG", intervalSeconds: next.intervalSeconds, enabled: next.enabled });
  const state = await getSalesState();
  await updateBadge(salesToday(state.daily), next.enabled);
}

/** A reading from the offscreen document. */
export async function onSnapshot(snapshot: SalesSnapshot): Promise<void> {
  const settings = await getSettings();
  if (!settings.enabled) return;
  if (!Number.isSafeInteger(snapshot?.sold) || !Number.isSafeInteger(snapshot?.cents) || snapshot.sold < 0 || snapshot.cents < 0) {
    throw new Error("Invalid sales snapshot");
  }
  const at = Date.now();
  let event: SalesEvent | null = null;
  const next = await updateProject((p) => {
    event = salesChange(p.baseline, snapshot, at);
    const ev = event as SalesEvent | null;
    return {
      ...p,
      baseline: snapshot,
      history: ev ? [ev, ...p.history].slice(0, HISTORY_MAX) : p.history,
      daily: ev ? addToDaily(p.daily, ev) : p.daily,
      unread: p.unread + (ev && ev.sales > 0 ? ev.sales : 0),
      checkedAt: at,
      status: `Monitoring · every ${settings.intervalSeconds} seconds`,
    };
  });
  await updateBadge(salesToday(next.daily), settings.enabled);
  const ev = event as SalesEvent | null;
  if (ev && ev.sales > 0) {
    const royalty = `${ev.cents < 0 ? "-" : "+"}${usd(Math.abs(ev.cents))}`;
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: chrome.runtime.getURL("icons/sales-128.png"),
        title: `${ev.sales} new TeePublic sale${ev.sales === 1 ? "" : "s"}!`,
        message: `${royalty} royalty · ${formatGmt(at)}`,
      });
    } catch (e) { console.warn("[sales] notification failed", e); }
    if (settings.sound) void playSound(settings.volume);
  }
}

/** A failed check: shown as the status, the last good baseline is kept. */
export async function onSalesError(message: string): Promise<void> {
  await updateProject((p) => ({ ...p, status: message }));
}

/** The Sales screen was opened. The badge keeps today's count. */
export async function markSalesSeen(): Promise<void> {
  const next = await updateProject((p) => ({ ...p, unread: 0 }));
  await updateBadge(salesToday(next.daily), (await getSettings()).enabled);
}

export async function checkSalesNow(): Promise<void> {
  await ensureOffscreen();
  await toOffscreen({ type: "SALES_CHECK" });
}

export async function playSound(volume?: number): Promise<void> {
  await ensureOffscreen();
  await toOffscreen({ type: "SALES_PLAY", volume: volume ?? (await getSettings()).volume });
}

/** Today's sales; "off" (grey) while the monitor is turned off. */
async function updateBadge(count: number, enabled = true): Promise<void> {
  await chrome.action.setBadgeText({ text: enabled ? String(count) : "off" });
  await chrome.action.setBadgeBackgroundColor({ color: enabled && count > 0 ? "#16804a" : "#596579" });
  await chrome.action.setBadgeTextColor?.({ color: "#ffffff" });
}

function toOffscreen(message: Record<string, unknown>): Promise<unknown> {
  return chrome.runtime.sendMessage({ target: "offscreen", ...message }).catch(() => undefined);
}

// ── The offscreen document: parses the HTML and plays the chime ─────────────
let creating: Promise<void> | null = null;
export async function ensureOffscreen(): Promise<void> {
  if (creating) return creating;
  creating = (async () => {
    const contexts = await chrome.runtime.getContexts({ contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT] });
    if (contexts.length) return;
    await chrome.offscreen.createDocument({
      url: "offscreen/index.html",
      reasons: [chrome.offscreen.Reason.DOM_PARSER, chrome.offscreen.Reason.AUDIO_PLAYBACK],
      justification: "Read the signed-in TeePublic sales page every few seconds and play a sound for new sales.",
    });
  })();
  try { await creating; } finally { creating = null; }
}

/** On every worker wake-up: badge back, a 1-minute watchdog that re-creates the
 *  offscreen document if Chrome closed it. */
export async function bootSalesMonitor(): Promise<void> {
  const state = await getSalesState();
  await updateBadge(salesToday(state.daily), state.enabled);
  await chrome.alarms.create("sales-watchdog", { periodInMinutes: 1 });
  await ensureOffscreen();
}

chrome.alarms?.onAlarm.addListener((alarm) => {
  if (alarm.name !== "sales-watchdog") return;
  void ensureOffscreen().catch((e) => console.warn("[sales] offscreen", e));
  // Back to 0 after midnight.
  void getSalesState().then((s) => updateBadge(salesToday(s.daily), s.enabled)).catch(() => undefined);
});
chrome.notifications?.onClicked.addListener(() => {
  void chrome.tabs.create({ url: "https://www.teepublic.com/account/sales" });
});
