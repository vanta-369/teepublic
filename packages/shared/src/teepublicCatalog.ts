// Static catalog of TeePublic colors available per product. The dashboard
// uses this to reconcile the Excel's requested color into a value TeePublic
// actually offers, before queueing the design for upload.
//
// Seed: TeePublic's documented per-product palettes. Labels match what
// TeePublic shows in <label class="dd-option-text">, case-sensitive
// (e.g. "Black/White", not "Black / White").
//
// Match against the `label` field only — the `id` is informational; the
// extension matches dd-options by text, not by hidden numeric ID.

export interface TPColor {
  /** Stable label TeePublic shows in the dropdown. Case-sensitive. */
  label: string;
  /** Optional family tag for similarity matching. */
  family?: ColorFamily;
  /** Optional swatch URL (TeePublic's color tile image). */
  swatch?: string;
}

export type ColorFamily =
  | "light" | "dark" | "red" | "pink" | "blue" | "green"
  | "purple" | "orange" | "yellow" | "brown" | "multi";

export const FAMILY_MEMBERS: Record<ColorFamily, string[]> = {
  light:  ["White", "Off White", "Vintage White", "Solid White", "Oatmeal Heather", "Natural Heather", "Natural", "Heather", "Athletic Heather", "Vintage Heather", "Heather Grey", "Heather Gray", "Light Heather Grey", "Light Heather Gray", "Cream", "Creme", "Ivory", "Ghost", "Butter", "Sport Grey", "Sport Gray", "Sand", "Ash", "Stone", "Silver", "Light Grey", "Light Gray"],
  dark:   ["Black", "Solid Black", "Asphalt", "Charcoal", "Charcoal Heather", "Heather Charcoal", "Heather Black", "Tri-Black", "Tri Black", "Dark Grey", "Dark Gray", "Oxford"],
  red:    ["Red", "Vintage Red", "Crimson", "Maroon", "Burgundy", "Garnet", "Red Heather"],
  pink:   ["Pink", "Light Pink", "Baby Pink", "Soft Pink", "Hot Pink", "Azalea", "Blush", "Mauvelous", "Lavender"],
  blue:   ["Navy", "Vintage Navy", "Deep Navy", "Midnight Navy", "Navy Blue", "Navy Heather", "Royal", "Royal Blue", "True Royal", "Deep Royal", "Vintage Royal", "Royal Heather", "Light Blue", "Baby Blue", "Powder Blue", "Indigo Blue", "Colony Blue", "Coastal Blue", "Slate", "Cobalt", "Blue", "Teal"],
  green:  ["Kelly", "Kelly Green", "Sage", "Pistachio", "Forest", "Forest Green", "Military Green", "Sport Green", "Moss", "Basil", "Dark Green", "Olive", "Green"],
  purple: ["Purple", "Violet", "Paragon"],
  orange: ["Orange", "Tennessee Orange", "Rust"],
  yellow: ["Yellow", "Daisy", "Lemon", "Gold"],
  brown:  ["Brown", "Espresso", "Chocolate", "Latte", "Chestnut", "Tan", "Khaki", "Beige"],
  multi:  ["Black/White", "White/Black", "White/Royal", "White/Red", "White/Kelly", "White/Navy", "Tie Dye", "Sunset Stripe"],
};

function tag(label: string): TPColor {
  for (const [family, members] of Object.entries(FAMILY_MEMBERS) as [ColorFamily, string[]][]) {
    if (members.some((m) => m.toLowerCase() === label.toLowerCase())) {
      return { label, family };
    }
  }
  return { label };
}

const list = (...labels: string[]): TPColor[] => labels.map(tag);

// Per-product palettes. Seeded from TeePublic's published catalog. The exact
// list per product may shift over time; the matcher tolerates that with
// substring + family fallbacks.
export const TEEPUBLIC_CATALOG: Record<string, TPColor[]> = {
  // Each list below is exactly TeePublic's "Select Default Color" dropdown for
  // that product, in its order (checked against the live page, 2026-11-04).
  "T-Shirt": list(
    "White", "Heather", "Black", "Navy", "Light Blue", "Royal Blue", "Kelly", "Teal", "Maroon", "Red",
    "Soft Pink", "Hot Pink", "Brown", "Yellow", "Creme", "Latte", "Purple", "Asphalt", "Tie Dye",
  ),
  "Hoodie": list(
    "Oatmeal Heather", "Black", "Charcoal Heather", "Navy", "Burgundy", "Creme", "Vintage Heather",
  ),
  "Tank": list(
    "White", "Black", "Navy", "Red",
  ),
  "Crewneck": list(
    "White", "Heather", "Black", "Charcoal Heather", "Navy", "Royal Blue", "Creme",
  ),
  "Long Sleeve T-Shirt": list(
    "White", "Heather", "Black", "Navy", "Ghost", "Royal Blue", "Dark Green",
  ),
  "Baseball Tee": list(
    "Black/White", "White/Black", "White/Royal", "White/Red", "White/Kelly", "White/Navy",
  ),
  "Kids": list(
    "White", "Heather", "Dark Grey", "Black", "Navy", "Light Blue", "Coastal Blue", "Royal Blue", "Slate",
    "Forest Green", "Moss", "Basil", "Red", "Soft Pink", "Orange", "Butter", "Blush", "Creme", "Lavender",
    "Asphalt", "Sunset Stripe",
  ),
  "Kids Hoodie": list(
    "Natural Heather", "Black", "Navy", "Kelly", "Mauvelous", "Red Heather", "Vintage Royal",
  ),
  "Kids Long Sleeve T-Shirt": list(
    "Black", "Navy", "Deep Royal",
  ),
  // Exactly TeePublic's trucker-hat dropdown — no other colors are offered.
  "Hats": list(
    "Black", "Navy", "Deep Royal", "Red", "Creme",
    "White/Black", "White/Royal", "White/Red", "White/Navy",
  ),
  // Exactly TeePublic's shorts dropdown — no other colors are offered.
  "Shorts": list(
    "Heather", "Black", "Military Green", "Creme",
  ),
  "Bags": list(
    "Light Grey", "Natural", "Black", "Oxford", "Navy",
  ),
};
