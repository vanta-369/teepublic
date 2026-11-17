// The TeePublic product types a design can be published on, in the groups the
// design card shows. `name` is what the extension matches on TeePublic - only
// the `label` shown on a pill may differ ("Kids" reads as "Kids T-Shirt").

export interface ProductGroup {
  title: string;
  items: { name: string; label?: string }[];
  /** Left out of the default set (every new design starts without these). */
  offByDefault?: boolean;
}

export const PRODUCT_GROUPS: ProductGroup[] = [
  {
    title: "Product types",
    items: [
      { name: "T-Shirt" }, { name: "Hoodie" }, { name: "Tank" }, { name: "Crewneck" },
      { name: "Long Sleeve T-Shirt", label: "Long Sleeve" }, { name: "Baseball Tee" }, { name: "Shorts" },
    ],
  },
  {
    title: "Kids",
    offByDefault: true,
    items: [
      { name: "Kids", label: "Kids T-Shirt" },
      { name: "Kids Hoodie" },
      { name: "Kids Long Sleeve T-Shirt", label: "Kids Long Sleeve" },
    ],
  },
  {
    title: "Other products",
    items: [
      { name: "Hats" }, { name: "Bags" }, { name: "Stickers" }, { name: "Cases" }, { name: "Mugs" },
      { name: "Wall Art" }, { name: "Pillows" }, { name: "Totes" }, { name: "Tapestries" },
      { name: "Pins" }, { name: "Magnets" },
    ],
  },
];

/** Every product except the Kids ones - what each design starts with. */
export function defaultEnabledProducts(): string[] {
  return PRODUCT_GROUPS.filter((g) => !g.offByDefault).flatMap((g) => g.items.map((i) => i.name));
}

/** Products that must never carry an adult design. */
export const KIDS_PRODUCTS: string[] = PRODUCT_GROUPS.filter((g) => g.offByDefault).flatMap((g) => g.items.map((i) => i.name));

/** Old names saved before a product took TeePublic's full name. */
const RENAMED: Record<string, string> = { "Long Sleeve": "Long Sleeve T-Shirt" };

/** Adult content = no Kids products: drop them from an adult design's list.
 *  Also brings old product names up to date (every edit passes through here). */
export function enforceAdultRule<T extends { matureContent: boolean; enabledProducts?: string[] }>(m: T): T {
  const list = m.enabledProducts ?? [];
  const renamed = list.some((p) => p in RENAMED)
    ? [...new Set(list.map((p) => RENAMED[p] ?? p))]
    : list;
  const kept = m.matureContent ? renamed.filter((p) => !KIDS_PRODUCTS.includes(p)) : renamed;
  return kept.length === list.length && kept.every((p, i) => p === list[i]) ? m : { ...m, enabledProducts: kept };
}
