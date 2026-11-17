// Offscreen document for the TeePublic sales notifier (services/salesMonitor.ts).
// It exists because a service worker can neither parse HTML nor play audio.
//
// Every N seconds: fetch the signed-in sales page with the user's own TeePublic
// session, parse the counters, hand the snapshot to the worker. Recovers on its
// own after the computer sleeps or the connection drops. Never bypasses a login
// or challenge page - those just show as an error until the user signs in.

import { parseSalesPage } from "../lib/salesCore";

const SALES_URL = "https://www.teepublic.com/account/sales";

let busy = false;
let controller: AbortController | null = null;
let recoveryPending = false;
let pollTimer: ReturnType<typeof setInterval> | undefined;
let enabled = true;
let configured = false;

function send(message: Record<string, unknown>): Promise<unknown> {
  return chrome.runtime.sendMessage(message).catch(() => undefined);
}

function configure(seconds: number) {
  const s = Number.isSafeInteger(seconds) && seconds >= 60 && seconds <= 86400 ? seconds : 120;
  clearInterval(pollTimer);
  pollTimer = setInterval(() => void check(), s * 1000);
}

function recover() {
  if (!navigator.onLine) return;
  if (busy) { recoveryPending = true; controller?.abort(); }
  else void check();
}

async function check(): Promise<void> {
  if (busy || !navigator.onLine) return;
  busy = true;
  controller = new AbortController();
  const timeout = setTimeout(() => controller?.abort(), 15_000);
  try {
    if (!configured) {
      const state = (await send({ type: "SALES_STATE" })) as { data?: { intervalSeconds: number; enabled: boolean } } | undefined;
      if (state?.data) { configure(state.data.intervalSeconds); enabled = state.data.enabled; configured = true; }
    }
    if (!enabled) return;
    const response = await fetch(SALES_URL, { credentials: "include", cache: "no-store", signal: controller.signal });
    if (!response.ok) throw new Error(`TeePublic returned ${response.status}. Open the sales page and check your login.`);
    if (!new URL(response.url).pathname.startsWith("/account/sales")) throw new Error("Sign in to TeePublic in this Chrome profile, then check again.");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    // Not awaited: handling the snapshot may ask this document to play the chime.
    void send({ type: "SALES_SNAPSHOT", snapshot: parseSalesPage(doc) });
  } catch (error) {
    if (!recoveryPending) {
      void send({ type: "SALES_ERROR", error: navigator.onLine ? (error as Error).message : "Offline. Waiting for the connection to return." });
    }
  } finally {
    clearTimeout(timeout);
    controller = null;
    busy = false;
    if (recoveryPending) { recoveryPending = false; recover(); }
  }
}

chrome.runtime.onMessage.addListener((message, _sender, respond) => {
  if (message?.target !== "offscreen") return;
  if (message.type === "SALES_PLAY") {
    const audio = document.getElementById("sale") as HTMLAudioElement;
    audio.volume = Number.isFinite(message.volume) ? Math.max(0, Math.min(100, message.volume)) / 100 : 1;
    audio.currentTime = 0;
    audio.play().then(() => respond({ ok: true }), (e) => respond({ ok: false, error: (e as Error).message }));
    return true;
  }
  if (message.type === "SALES_CONFIG") {
    configured = true;
    enabled = message.enabled !== false;
    configure(message.intervalSeconds);
    respond({ ok: true });
    void check();
    return;
  }
  if (message.type === "SALES_CHECK") { respond({ ok: true }); void check(); return; }
});

window.addEventListener("online", recover);
window.addEventListener("offline", () => {
  controller?.abort();
  void send({ type: "SALES_ERROR", error: "Offline. Waiting for the connection to return." });
});

// A paused heartbeat resumes as soon as the browser runs JS again after sleep:
// check right away instead of waiting for the next regular poll.
let lastBeat = Date.now();
let wasOnline = navigator.onLine;
setInterval(() => {
  const now = Date.now();
  if (now - lastBeat > 5000 || (navigator.onLine && !wasOnline)) recover();
  lastBeat = now;
  wasOnline = navigator.onLine;
}, 1000);

configure(20);
void check();
