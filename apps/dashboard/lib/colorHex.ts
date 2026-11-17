// A swatch colour for each TeePublic colour name - for the dots in the UI and
// for "closest colour" matching (lib/colorPresets.ts). A value may be any CSS
// background (Tie Dye is a gradient).

// Catalog labels don't carry a hex, so map common color words to a
// representative swatch for the dropdown dot. Combos ("White/Black") use the
// first token; unknown labels fall back to a neutral grey.
export const COLOR_HEX: Record<string, string> = {
  // TeePublic's own swatches (exact names first; the generic words below are fallbacks).
  "oatmeal heather": "#ecebe6", "natural heather": "#f3eee6", "charcoal heather": "#1f2a36",
  "light blue": "#c5e0ec", "coastal blue": "#86a6c8", "vintage royal": "#2f5291", "deep royal": "#24397a",
  "soft pink": "#fbc3cf", "hot pink": "#d4457f", "red heather": "#c23447", "forest green": "#0e3b1f",
  "dark green": "#0b4d2c", "dark grey": "#6b6b6b", "military green": "#4b5320",
  "tie dye": "conic-gradient(#f9a8d4, #fde68a, #a7f3d0, #93c5fd, #c4b5fd, #f9a8d4)",
  "sunset stripe": "linear-gradient(180deg, #fde68a, #fbcfe8, #bae6fd)",
  royal: "#2f5291", kelly: "#0b7a45", burgundy: "#7a0b24", creme: "#ede3cc", latte: "#dcc5a4", ghost: "#e8e6e1",
  slate: "#73899a", moss: "#3c4317", basil: "#6b8075", butter: "#fbf3a6", blush: "#fbe3df",
  lavender: "#b88dc3", mauvelous: "#f2a9a6",
  "light grey": "#d1d5db", "light gray": "#d1d5db",
  "vintage heather": "#a8a29e", "royal blue": "#2563eb", "kelly green": "#16a34a",
  black: "#0a0a0a", white: "#ffffff", navy: "#1e293b", blue: "#2563eb",
  red: "#dc2626", maroon: "#7f1d1d", green: "#16a34a", forest: "#14532d",
  yellow: "#facc15", gold: "#d4af37", pink: "#ec4899", purple: "#9333ea",
  orange: "#ea580c", heather: "#9ca3af", grey: "#9ca3af", gray: "#9ca3af",
  charcoal: "#374151", asphalt: "#3f3f46", silver: "#cbd5e1", cream: "#f5f5dc",
  natural: "#e7e0cf", tan: "#d2b48c", khaki: "#c3b091", brown: "#78350f",
  teal: "#0d9488", sage: "#9caf88", olive: "#6b7d3a", indigo: "#4f46e5",
};

export function colorHexForLabel(label: string): string {
  if (!label) return "#52525b";
  const l = label.toLowerCase().trim();
  const first = l.split("/")[0].trim();
  if (COLOR_HEX[l]) return COLOR_HEX[l];
  if (COLOR_HEX[first]) return COLOR_HEX[first];
  for (const key of Object.keys(COLOR_HEX)) {
    if (first.includes(key)) return COLOR_HEX[key];
  }
  return "#52525b";
}

/** RGB of a label's swatch, or null when it has no plain hex (gradients) or no
 *  known colour. A combo ("White/Royal") is the part that isn't white/black. */
export function labelRgb(label: string): [number, number, number] | null {
  const parts = label.split("/").map((p) => p.trim()).filter(Boolean);
  const pick = parts.find((p) => !/^(white|black)$/i.test(p)) ?? parts[0] ?? label;
  const l = pick.toLowerCase();
  const known = COLOR_HEX[l] ?? Object.entries(COLOR_HEX).find(([k]) => l.includes(k))?.[1];
  if (!known || !/^#[0-9a-f]{6}$/i.test(known)) return null;
  return [parseInt(known.slice(1, 3), 16), parseInt(known.slice(3, 5), 16), parseInt(known.slice(5, 7), 16)];
}

/** Perceived distance between two colours: CIE76 delta E in Lab space, so
 *  lightness counts like the eye sees it (purple is nearer navy than red). */
export function colorDistance(a: [number, number, number], b: [number, number, number]): number {
  const [l1, a1, b1] = toLab(a);
  const [l2, a2, b2] = toLab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
}

function toLab([r, g, b]: [number, number, number]): [number, number, number] {
  const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  const R = lin(r), G = lin(g), B = lin(b);
  const x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047;
  const y = 0.2126 * R + 0.7152 * G + 0.0722 * B;
  const z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  return [116 * f(y) - 16, 500 * (f(x) - f(y)), 200 * (f(y) - f(z))];
}
