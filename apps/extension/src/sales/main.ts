// The Sales window (opened by the side panel's Sales button). Reads and
// changes the sales notifier through the service worker (services/salesMonitor.ts);
// all numbers come from this device's storage.

import { dayKey, formatGmt, usd } from "../lib/salesCore";
import { getChosenProject, listMyProjects } from "../lib/projects";
import type { SalesState } from "../services/salesMonitor";

const el = (id: string) => document.getElementById(id) as HTMLElement;

if (window.top === window) document.documentElement.classList.add("as-popup");
const input = (id: string) => document.getElementById(id) as HTMLInputElement;

function send<T = { ok?: boolean; error?: string; data?: unknown }>(message: unknown): Promise<T | undefined> {
  return new Promise((resolve) => {
    try { chrome.runtime.sendMessage(message, (res) => { void chrome.runtime.lastError; resolve(res as T); }); }
    catch { resolve(undefined); }
  });
}

async function render(): Promise<SalesState | undefined> {
  const res = await send<{ data?: SalesState }>({ type: "SALES_STATE" });
  const s = res?.data;
  if (!s) return;
  const b = s.baseline;
  el("sold").textContent = b ? String(b.sold) : "—";
  el("earned").textContent = b ? usd(b.cents) : "—";
  el("payment").textContent = b?.nextPaymentCents != null ? usd(b.nextPaymentCents) : "—";
  el("month").textContent = b?.monthCents != null ? usd(b.monthCents) : "—";
  el("payment-period").textContent = b?.nextPaymentPeriod || "Earnings";
  el("month-period").textContent = b?.monthPeriod || "Earnings";
  input("enabled").checked = s.enabled;
  document.body.dataset.monitor = s.enabled ? "on" : "off";
  el("monitor-note").textContent = s.enabled
    ? `Checks your TeePublic sales page every ${s.intervalSeconds >= 120 && s.intervalSeconds % 60 === 0 ? `${s.intervalSeconds / 60} minutes` : `${s.intervalSeconds} seconds`}.`
    : "Off - Higgstee doesn't open your TeePublic sales page.";
  input("sound").checked = s.sound;
  if (document.activeElement !== input("interval") && !input("interval").dataset.dirty) input("interval").value = String(s.intervalSeconds);
  if (document.activeElement !== input("volume")) {
    input("volume").value = String(s.volume);
    el("volume-value").textContent = `${s.volume}%`;
  }
  const ok = !s.enabled || /^Monitoring|^Waiting/.test(s.status);
  el("status").dataset.error = ok ? "" : "1";
  el("status").textContent = s.enabled ? s.status : "Monitoring paused";
  el("checked").textContent = s.checkedAt ? `Last success: ${formatGmt(s.checkedAt)}` : "The first successful check saves your current numbers.";

  renderDaily(s);

  const hist = el("history");
  hist.replaceChildren();
  for (const e of s.history) {
    const row = document.createElement("div");
    row.className = "entry";
    row.dataset.sale = e.sales > 0 ? "1" : "0";
    const title = document.createElement("b");
    title.textContent = `${e.sales >= 0 ? "+" : ""}${e.sales} sale${Math.abs(e.sales) === 1 ? "" : "s"} · ${e.cents >= 0 ? "+" : "-"}${usd(Math.abs(e.cents))}`;
    const date = document.createElement("small");
    date.textContent = formatGmt(e.at);
    row.append(title, date);
    hist.append(row);
  }
  if (!s.history.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No changes detected yet.";
    hist.append(p);
  }
  return s;
}

/** Items sold per day: the last 14 days as bars, then every recorded day. */
function renderDaily(s: SalesState) {
  const daily = s.daily ?? {};
  const today = dayKey(Date.now());
  const span: string[] = [];
  for (let i = 13; i >= 0; i--) span.push(dayKey(Date.now() - i * 86_400_000));
  const max = Math.max(1, ...span.map((d) => Math.max(0, daily[d]?.sales ?? 0)));
  const chart = el("daily-chart");
  chart.replaceChildren(...span.map((d) => {
    const n = Math.max(0, daily[d]?.sales ?? 0);
    const col = document.createElement("div");
    col.title = `${d}: ${daily[d]?.sales ?? 0} sales · ${usd(daily[d]?.cents ?? 0)}`;
    if (d === today) col.dataset.today = "1";
    const bar = document.createElement("i");
    bar.style.height = `${(n / max) * 100}%`;
    if (n === 0) bar.dataset.zero = "1";
    col.append(bar);
    return col;
  }));
  el("daily-from").textContent = span[0].slice(5).replace("-", "/");
  const week = span.slice(-7).reduce((t, d) => t + (daily[d]?.sales ?? 0), 0);
  el("daily-total").textContent = `${daily[today]?.sales ?? 0} today · ${week} this week`;

  const days = Object.keys(daily).sort().reverse();
  const list = el("daily-list");
  if (!days.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "Each day's sales show here once the first one is detected.";
    list.replaceChildren(p);
    return;
  }
  list.replaceChildren(...days.map((d) => {
    const row = document.createElement("div");
    row.className = "day";
    if (d === today) row.dataset.today = "1";
    const date = document.createElement("span");
    date.textContent = d === today ? "Today" : new Date(`${d}T12:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
    const n = document.createElement("b");
    n.textContent = `${daily[d].sales} sale${Math.abs(daily[d].sales) === 1 ? "" : "s"}`;
    const money = document.createElement("small");
    money.textContent = `${daily[d].cents >= 0 ? "+" : "-"}${usd(Math.abs(daily[d].cents))}`;
    row.append(date, n, money);
    return row;
  }));
}

async function renderProject() {
  try {
    const [list, chosen] = await Promise.all([listMyProjects(), getChosenProject()]);
    el("project").textContent = list.find((p) => p.id === chosen)?.name ?? "this Chrome profile";
  } catch {
    // Signed out of Higgstee: sales still work, for this profile's TeePublic account.
    el("project").textContent = "this Chrome profile";
  }
}

// ── Wiring ──────────────────────────────────────────────────────────────────
input("interval").addEventListener("input", () => { input("interval").dataset.dirty = "1"; el("interval-status").textContent = "Click Save to apply."; });
el("interval-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const seconds = Number(input("interval").value);
  const res = await send({ type: "SALES_SETTINGS", settings: { intervalSeconds: seconds } });
  if (res?.ok === false) { el("interval-status").textContent = res.error ?? "Couldn't save."; return; }
  delete input("interval").dataset.dirty;
  el("interval-status").textContent = `Saved: every ${seconds} seconds.`;
});
input("volume").addEventListener("input", () => { el("volume-value").textContent = `${input("volume").value}%`; });
input("volume").addEventListener("change", () => void send({ type: "SALES_SETTINGS", settings: { volume: Number(input("volume").value) } }));
for (const id of ["enabled", "sound"]) {
  input(id).addEventListener("change", () => void send({ type: "SALES_SETTINGS", settings: { enabled: input("enabled").checked, sound: input("sound").checked } }));
}
for (const [id, type] of [["check", "SALES_CHECK"], ["test", "SALES_TEST_SOUND"]] as const) {
  el(id).addEventListener("click", async () => {
    (el(id) as HTMLButtonElement).disabled = true;
    try { await send({ type }); } finally { (el(id) as HTMLButtonElement).disabled = false; }
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && ("teepublic.sales" in changes || "teepublic.salesSettings" in changes)) void render();
  if (area === "local" && "teepublic.project" in changes) { void renderProject(); void render(); }
});

void renderProject();
// Showing the sales = seen: clears the badge.
void render().then(() => send({ type: "SALES_SEEN" }));
