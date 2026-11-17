// One page watcher for every TeePublic store/search feature (delete bar, export
// icon, trend badges, upload dates), instead of one MutationObserver each.
//
// Why: every card on a TeePublic grid has a sale countdown that re-renders each
// second. Three whole-document observers each rescanned every card on every
// tick - the scan walks each card's ancestors - which pinned the CPU on big
// pages. Here:
//   - text-only changes (the countdowns) and our own .higgstee-sd elements are
//     ignored, so a quiet page costs nothing;
//   - a real change bumps `generation`, which is what findCards() caches on;
//   - subscribers run at most once per MIN_GAP_MS, together.

const MIN_GAP_MS = 1000;
const DEBOUNCE_MS = 500;

/** Bumped on every relevant DOM change; caches keyed on it are fresh until it moves. */
export let generation = 0;

const subs: (() => void | Promise<void>)[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let lastRun = 0;
let lastUrl = location.href;

const ours = (n: Node): boolean =>
  n.nodeType === Node.ELEMENT_NODE && !!(n as Element).closest?.(".higgstee-sd");

function relevant(muts: MutationRecord[]): boolean {
  for (const m of muts) {
    if (ours(m.target)) continue; // inside our own bar / panel / pill
    for (const n of [...Array.from(m.addedNodes), ...Array.from(m.removedNodes)]) {
      if (n.nodeType !== Node.ELEMENT_NODE) continue; // text: countdowns, prices
      const e = n as Element;
      if (e.classList.contains("higgstee-sd") || ours(e)) continue;
      return true;
    }
  }
  return false;
}

function schedule(): void {
  if (timer) return;
  const wait = Math.max(DEBOUNCE_MS, MIN_GAP_MS - (Date.now() - lastRun));
  timer = setTimeout(async () => {
    timer = null;
    lastRun = Date.now();
    for (const fn of subs) {
      try { await fn(); } catch (e) { console.warn("[higgstee]", e); }
    }
  }, wait);
}

new MutationObserver((muts) => {
  // TeePublic swaps pages in place: a URL change always counts.
  const moved = location.href !== lastUrl;
  if (moved) lastUrl = location.href;
  if (moved || relevant(muts)) { generation++; schedule(); }
}).observe(document.documentElement, { childList: true, subtree: true });

/** Run `fn` now and after every relevant page change (throttled, shared). */
export function onPageChange(fn: () => void | Promise<void>): void {
  subs.push(fn);
  schedule();
}
