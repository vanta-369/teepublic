// Reading TeePublic's sales page (www.teepublic.com/account/sales) and
// comparing two readings. Pure functions - the offscreen document parses, the
// service worker compares (services/salesMonitor.ts). Amounts are integer cents.
//
// Selectors are TeePublic's account-page cards; if the page changes, fix them here.

export interface SalesSnapshot {
  sold: number;
  cents: number;
  nextPaymentCents: number | null;
  monthCents: number | null;
  nextPaymentPeriod: string;
  monthPeriod: string;
}

export interface SalesEvent {
  at: number;
  /** New items sold since the last reading (can be negative: a correction). */
  sales: number;
  /** Royalty change in cents. */
  cents: number;
  totalSold: number;
  totalCents: number;
}

const CARD = ".m-account__sales-info-container";
const CARD_HEADER = ".m-account__sales-info-container--header";
const CARD_VALUE = ".callout";

export function numeric(text: string, money = false): number {
  const cleaned = text.replace(/[$,\s]/g, "");
  if (!(money ? /^\d+(\.\d{1,2})?$/ : /^\d+$/).test(cleaned)) throw new Error("Unexpected counter format");
  const value = Number(cleaned);
  const result = money ? Math.round(value * 100) : value;
  if (!Number.isSafeInteger(result)) throw new Error("Invalid counter");
  return result;
}

export function parseSalesPage(doc: Document): SalesSnapshot {
  const cards = [...doc.querySelectorAll(CARD)];
  const find = (pattern: RegExp) => cards.find((card) => pattern.test(card.querySelector(CARD_HEADER)?.textContent || ""));
  const sold = find(/items?\s+sold/i);
  const earned = find(/total\s+earned|total\s+earnings/i);
  if (!sold || !earned) throw new Error("Sales counters not found. Sign in to TeePublic, or check whether the page layout changed.");
  const payment = find(/next\s+payment/i);
  const month = find(/this\s+month/i);
  const amount = (card?: Element) => (card ? numeric(card.querySelector(CARD_VALUE)?.textContent || "", true) : null);
  const period = (card: Element | undefined, title: RegExp) =>
    (card?.querySelector(CARD_HEADER)?.textContent || "").replace(title, "").replace(/\s+/g, " ").trim();
  return {
    sold: numeric(sold.querySelector(CARD_VALUE)?.textContent || ""),
    cents: numeric(earned.querySelector(CARD_VALUE)?.textContent || "", true),
    nextPaymentCents: amount(payment),
    monthCents: amount(month),
    nextPaymentPeriod: period(payment, /next\s+payment/i),
    monthPeriod: period(month, /this\s+month/i),
  };
}

/** What changed between two readings, or null when nothing did (or there is
 *  no earlier reading - the first one is only a baseline). */
export function salesChange(previous: SalesSnapshot | null, current: SalesSnapshot, at: number): SalesEvent | null {
  if (!previous || (previous.sold === current.sold && previous.cents === current.cents)) return null;
  return { at, sales: current.sold - previous.sold, cents: current.cents - previous.cents, totalSold: current.sold, totalCents: current.cents };
}

/** One day's sales: items sold (net of corrections) and royalty, in cents. */
export interface SalesDay { sales: number; cents: number }

/** The day a change was detected, as YYYY-MM-DD in this computer's time zone. */
export function dayKey(timestamp: number): string {
  const d = new Date(timestamp);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Add one change to the per-day tally (returns a new object). */
export function addToDaily(daily: Record<string, SalesDay>, ev: SalesEvent): Record<string, SalesDay> {
  const key = dayKey(ev.at);
  const d = daily[key] ?? { sales: 0, cents: 0 };
  return { ...daily, [key]: { sales: d.sales + ev.sales, cents: d.cents + ev.cents } };
}

/** Items sold today (local date) - the number on the sales badge. Opening the
 *  Sales screen doesn't clear it; it starts again from 0 at midnight. */
export function salesToday(daily: Record<string, SalesDay> | undefined, now = Date.now()): number {
  return Math.max(0, daily?.[dayKey(now)]?.sales ?? 0);
}

/** The tally rebuilt from the activity list (for days recorded before it existed). */
export function dailyFromHistory(history: SalesEvent[]): Record<string, SalesDay> {
  return history.reduce((acc, ev) => addToDaily(acc, ev), {} as Record<string, SalesDay>);
}

export function formatGmt(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 19).replace("T", " ") + " GMT";
}

export const usd = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
