"use client";

// The listings view's second sheet - the template's Sheet2_Colors: one row per
// design, one column per product. Every cell offers only that product's own
// TeePublic colours. Picking a T-shirt colour sets every other product on the
// row to its closest match (Black -> Baseball Tee "Black/White"); any other
// column changes just that cell. A column header's picker sets the whole column.

import { SLUG_TO_PRODUCT_LABEL } from "@teepublic/shared";
import type { ParsedRow } from "@/lib/parser";
import { paletteFor } from "@/lib/colorPresets";
import { LEAD_COLOR_SLUG, imageOf, setColumnColor, setRowColor } from "@/lib/listingSheet";
import { colorHexForLabel } from "./ColorsEditor";

export const COLOR_SLUGS = Object.keys(SLUG_TO_PRODUCT_LABEL);

export function ColorsSheet({
  rows, previewUrls, onChange,
}: {
  rows: ParsedRow[];
  previewUrls: Map<string, string>;
  onChange: (rows: ParsedRow[]) => void;
}) {
  const setCellColor = (r: number, slug: string, label: string) =>
    onChange(rows.map((row, i) => (i === r ? setRowColor(row, slug, label) : row)));

  return (
    <div className="hs-grid overflow-x-auto">
      <table className="border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed", width: 52 + 150 + COLOR_SLUGS.length * 170 }}>
        <colgroup>
          <col style={{ width: 52 }} />
          <col style={{ width: 150 }} />
          {COLOR_SLUGS.map((s) => <col key={s} style={{ width: 170 }} />)}
        </colgroup>
        <thead className="sticky z-20" style={{ top: 0 }}>
          <tr>
            <th className="hs-th-corner sticky left-0 z-30">#</th>
            <th className="hs-th">filename</th>
            {COLOR_SLUGS.map((slug) => (
              <th key={slug} className="hs-th" title={slug === LEAD_COLOR_SLUG ? "Picks a matching colour for every product" : undefined}>
                <div className="flex flex-col gap-1">
                  <span className="truncate">{slug}_color{slug === LEAD_COLOR_SLUG ? " ★" : ""}</span>
                  {/* Whole column at once. */}
                  <ColorSelect
                    slug={slug}
                    value=""
                    placeholder="All rows…"
                    onPick={(label) => onChange(setColumnColor(rows, slug, label))}
                  />
                </div>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => {
            const image = imageOf(row);
            const enabled = new Set(row.metadata.enabledProducts ?? []);
            const preview = previewUrls.get(image);
            return (
              <tr key={image}>
                <td className="hs-rownum">{row.rowNumber || r + 1}</td>
                <td className="hs-td">
                  <div className="flex items-center gap-2 px-2">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {preview && <img src={preview} alt="" className="h-7 w-7 shrink-0 rounded object-contain" />}
                    <span className="hs-cell">{image}</span>
                  </div>
                </td>
                {COLOR_SLUGS.map((slug) => {
                  const off = enabled.size > 0 && !enabled.has(SLUG_TO_PRODUCT_LABEL[slug]);
                  return (
                    <td key={slug} className="hs-td" style={off ? { opacity: 0.45 } : undefined} title={off ? "This product is off for this design" : undefined}>
                      <div className="px-1.5">
                        <ColorSelect
                          slug={slug}
                          value={row.metadata.productColors?.[slug] ?? ""}
                          onPick={(label) => setCellColor(r, slug, label)}
                        />
                      </div>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="px-6 py-3 text-xs" style={{ color: "var(--hs-muted)" }}>
        ★ Choosing a <b>t_shirt_color</b> fills every product with its matching colour. Other columns change only that cell. The picker under a header sets the whole column.
      </p>
    </div>
  );
}

/** A product's own colours, with a swatch of the current one. */
function ColorSelect({
  slug, value, placeholder, onPick,
}: {
  slug: string;
  value: string;
  placeholder?: string;
  onPick: (label: string) => void;
}) {
  const palette = paletteFor(SLUG_TO_PRODUCT_LABEL[slug]);
  const known = !value || palette.some((c) => c.label === value);
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-3.5 w-3.5 shrink-0 rounded-full ring-1 ring-black/15"
        style={{ background: value ? colorHexForLabel(value) : "transparent" }}
        aria-hidden
      />
      <select
        value={value}
        onChange={(e) => { if (e.target.value) onPick(e.target.value); }}
        className="w-full min-w-0 truncate rounded bg-transparent py-1 text-sm outline-none"
        style={{ color: "inherit" }}
        aria-label={`${slug} colour`}
      >
        <option value="">{placeholder ?? "-"}</option>
        {!known && <option value={value}>{value}</option>}
        {palette.map((c) => <option key={c.label} value={c.label}>{c.label}</option>)}
      </select>
    </div>
  );
}
