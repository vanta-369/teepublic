// The TeePublic sales notifier (apps/extension/src/lib/salesCore.ts and
// services/salesMonitor.ts): reading the sales page, telling a sale from a
// royalty update or a correction, and keeping every number on this device.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

declare const __REPO_ROOT__: string;

const { numeric, parseSalesPage, salesChange, formatGmt } = await import("../apps/extension/src/lib/salesCore.ts");

// A stand-in for the sales page: cards with a header and a ".callout" value.
const card = (header: string, value: string) => ({ querySelector: (sel: string) => ({ textContent: sel.includes("header") ? header : value }) });
const page = (...cards: ReturnType<typeof card>[]) => ({ querySelectorAll: () => cards }) as unknown as Document;

test("counters: money in cents, plain numbers, garbage refused", () => {
  assert.equal(numeric("$1,092.25", true), 109225);
  assert.equal(numeric(" 40 "), 40);
  assert.throws(() => numeric(""));
  assert.throws(() => numeric("$bad", true));
  assert.equal(formatGmt(Date.parse("2026-10-31T17:05:09+01:00")), "2026-10-31 16:05:09 GMT");
});

test("the sales page's four cards are read; the two optional ones may be missing", () => {
  assert.deepEqual(
    parseSalesPage(page(card("Next Payment Oct Earnings", "$90.25"), card("This Month Oct Earnings", "$12.50"), card("Total Earned Lifetime", "$90.25"), card("Items Sold", "40"))),
    { sold: 40, cents: 9025, nextPaymentCents: 9025, monthCents: 1250, nextPaymentPeriod: "Oct Earnings", monthPeriod: "Oct Earnings" },
  );
  const minimal = parseSalesPage(page(card("Total Earned Lifetime", "$90.25"), card("Items Sold", "40")));
  assert.equal(minimal.nextPaymentCents, null);
  assert.equal(minimal.monthCents, null);
  // A login / challenge page has no counters: an error, never a zero baseline.
  assert.throws(() => parseSalesPage(page()));
});

test("first reading is only a baseline; a rise in items sold is a sale; royalties and corrections are not", () => {
  const base = { sold: 40, cents: 9025, nextPaymentCents: null, monthCents: null, nextPaymentPeriod: "", monthPeriod: "" };
  assert.equal(salesChange(null, base, 0), null);
  assert.equal(salesChange(base, { ...base }, 0), null);
  assert.deepEqual(salesChange(base, { ...base, sold: 41, cents: 9225 }, 123), { at: 123, sales: 1, cents: 200, totalSold: 41, totalCents: 9225 });
  assert.equal(salesChange(base, { ...base, cents: 9425 }, 0)!.sales, 0);   // royalty only
  assert.equal(salesChange({ ...base, sold: 41 }, base, 0)!.sales, -1);    // correction
  assert.equal(salesChange(base, { ...base, monthCents: 200 }, 0), null);   // month figure alone
});

test("sales stay on this device: the notifier never talks to Supabase or Higgstee", () => {
  const root = __REPO_ROOT__;
  for (const f of ["apps/extension/src/lib/salesCore.ts", "apps/extension/src/services/salesMonitor.ts", "apps/extension/src/offscreen/main.ts"]) {
    const src = readFileSync(path.join(root, f), "utf8");
    assert.ok(!/supabase|higgstee\.com|\.rpc\(|\.from\(/i.test(src.replace(/^\s*\/\/.*$/gm, "")), `${f} must not reach a server other than TeePublic`);
  }
  const off = readFileSync(path.join(root, "apps/extension/src/offscreen/main.ts"), "utf8");
  const urls = [...off.matchAll(/https?:\/\/[^\s"'`]+/g)].map((m) => m[0]);
  assert.deepEqual([...new Set(urls)], ["https://www.teepublic.com/account/sales"]);
});

test("daily sales: each change adds to its day, and older activity rebuilds the tally", async () => {
  const { addToDaily, dailyFromHistory, dayKey } = await import("../apps/extension/src/lib/salesCore.ts");
  const t1 = new Date(2026, 10, 3, 9, 0).getTime();
  const t2 = new Date(2026, 10, 3, 21, 30).getTime();
  const t3 = new Date(2026, 10, 4, 8, 15).getTime();
  const ev = (at: number, sales: number, cents: number) => ({ at, sales, cents, totalSold: 0, totalCents: 0 });
  let daily = addToDaily({}, ev(t1, 1, 200));
  daily = addToDaily(daily, ev(t2, 2, 425));
  daily = addToDaily(daily, ev(t3, 1, 200));
  assert.deepEqual(daily, { [dayKey(t1)]: { sales: 3, cents: 625 }, [dayKey(t3)]: { sales: 1, cents: 200 } });
  assert.equal(dayKey(t1), "2026-11-03");
  // A royalty-only update adds money, not sales; a correction takes a sale back.
  assert.deepEqual(addToDaily(daily, ev(t3, 0, 50))[dayKey(t3)], { sales: 1, cents: 250 });
  assert.deepEqual(addToDaily(daily, ev(t3, -1, -200))[dayKey(t3)], { sales: 0, cents: 0 });
  assert.deepEqual(dailyFromHistory([ev(t3, 1, 200), ev(t2, 2, 425), ev(t1, 1, 200)]), daily);
});

test("the badge counts today's sales; opening the Sales screen doesn't clear it", async () => {
  const { addToDaily, salesToday } = await import("../apps/extension/src/lib/salesCore.ts");
  const now = new Date(2026, 10, 5, 15).getTime();
  const yesterday = now - 86_400_000;
  const daily = addToDaily(addToDaily({}, { at: yesterday, sales: 4, cents: 900, totalSold: 4, totalCents: 900 }),
    { at: now, sales: 2, cents: 450, totalSold: 6, totalCents: 1350 });
  assert.equal(salesToday(daily, now), 2);
  assert.equal(salesToday({}, now), 0);
  assert.equal(salesToday(undefined, now), 0);
});
