// The seller's colour preferences, kept in this browser (IndexedDB `docs`):
//  - order:  the order the colour swatches appear in (drag to change it on
//            "Select colors");
//  - pinned: colours added from a design card's "+" list, which then stay in
//            every card's row next to White and Black.

import { useSyncExternalStore } from "react";
import { getDoc, putDoc } from "@/lib/localDb";

const KEY = "colorPrefs";

export interface ColorPrefs {
  order: string[];
  pinned: string[];
}

let prefs: ColorPrefs = { order: [], pinned: [] };
let loaded = false;
const listeners = new Set<() => void>();

function emit() { for (const l of listeners) l(); }

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  getDoc<ColorPrefs>(KEY)
    .then((saved) => {
      if (saved) { prefs = { order: saved.order ?? [], pinned: saved.pinned ?? [] }; emit(); }
    })
    .catch(() => { /* local storage blocked - defaults only */ });
}

function save(next: ColorPrefs) {
  prefs = next;
  emit();
  putDoc(KEY, next).catch(() => { /* not remembered, still applied */ });
}

export function useColorPrefs(): ColorPrefs {
  load();
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => { listeners.delete(l); }; },
    () => prefs,
    () => prefs,
  );
}

/** Sort items by the saved order; unknown names keep their place at the end. */
export function sortByOrder<T extends { name: string }>(items: T[], order: string[]): T[] {
  const rank = new Map(order.map((n, i) => [n.toLowerCase(), i]));
  return items
    .map((item, i) => ({ item, r: rank.get(item.name.toLowerCase()) ?? order.length + i }))
    .sort((a, b) => a.r - b.r)
    .map((x) => x.item);
}

/** Move `name` to just before `before` (or to the end) and save. */
export function moveColor(all: string[], name: string, before: string | null) {
  const rest = all.filter((n) => n !== name);
  const at = before ? rest.indexOf(before) : -1;
  rest.splice(at < 0 ? rest.length : at, 0, name);
  save({ ...prefs, order: rest });
}

export function pinColor(name: string) {
  if (prefs.pinned.some((n) => n.toLowerCase() === name.toLowerCase())) return;
  save({ ...prefs, pinned: [...prefs.pinned, name] });
}

export function unpinColor(name: string) {
  save({ ...prefs, pinned: prefs.pinned.filter((n) => n.toLowerCase() !== name.toLowerCase()) });
}
