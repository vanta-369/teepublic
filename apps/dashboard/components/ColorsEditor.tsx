"use client";

// Shared per-design color editor. Used by both the AI-generation flow
// (GenerationApp) and the spreadsheet flow (DesignCard) so the two pages
// look and behave identically: Light/Dark/All preset toggle + Basic Colors
// swatch row + per-product dropdowns populated from the catalog.

import { useState } from "react";
import { SLUG_TO_PRODUCT_LABEL } from "@teepublic/shared";
import {
  BASIC_COLORS,
  applyBasicColor,
  applyPreset,
  paletteFor,
  productSlugs,
  type ColorPreset,
} from "@/lib/colorPresets";
import type { CustomBasicColor } from "@/lib/batchConfig";
import { colorHexForLabel } from "@/lib/colorHex";

// Kept here too for the components that already import it from this file.
export { colorHexForLabel };
import { pinColor, sortByOrder, unpinColor, useColorPrefs } from "@/lib/colorPrefs";

interface Props {
  productColors: Record<string, string>;
  enabledProducts: string[];
  preset: ColorPreset;
  onChange: (next: { productColors: Record<string, string>; preset: ColorPreset }) => void;
  readOnly?: boolean;
  customBasicColors?: CustomBasicColor[];
  onAddCustomBasicColor?: (c: CustomBasicColor) => void;
  onRemoveCustomBasicColor?: (name: string) => void;
  /** Copies the colors shown here onto every other design in the batch.
   *  Receiver is responsible for confirming + overwriting. Button hidden
   *  when `applyToAllCount <= 1` (nothing to apply to). */
  onApplyToAll?: () => void;
  /** Total designs in the batch — used to label the button ("Apply to all
   *  18 designs") and to hide it when there's only one design. */
  applyToAllCount?: number;
  /** "basic": only the Basic-colors swatch row (the design card shows it under
   *  the artwork). "detail": everything except that row. Default: all of it. */
  section?: "all" | "basic" | "detail";
}

export function ColorsEditor({
  productColors,
  enabledProducts,
  preset,
  onChange,
  readOnly = false,
  customBasicColors = [],
  onAddCustomBasicColor,
  onRemoveCustomBasicColor,
  onApplyToAll,
  applyToAllCount,
  section = "all",
}: Props) {
  const slugs = productSlugs();

  function setPreset(next: ColorPreset) {
    onChange({ productColors: applyPreset(next), preset: next });
  }
  function setColor(slug: string, color: string) {
    onChange({ productColors: { ...productColors, [slug]: color }, preset });
  }
  function applyColor(name: string) {
    onChange({ productColors: applyBasicColor(name), preset });
  }

  // A swatch is "on" when every product it applies to carries its colour.
  // With no products enabled yet, compare them all - otherwise nothing is
  // compared and every swatch would read as selected.
  function isBasicActive(name: string): boolean {
    const resolved = applyBasicColor(name);
    const considered = Object.entries(SLUG_TO_PRODUCT_LABEL)
      .filter(([slug, label]) => resolved[slug] && (enabledProducts.length === 0 || enabledProducts.includes(label)));
    if (considered.length === 0) return false;
    return considered.every(([slug]) => productColors[slug] === resolved[slug]);
  }

  // Custom-basic-color adder UI state.
  const [showAdd, setShowAdd] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftHex, setDraftHex] = useState("#888888");
  function submitAdd(e: React.FormEvent) {
    e.preventDefault();
    if (!draftName.trim() || !onAddCustomBasicColor) return;
    onAddCustomBasicColor({ name: draftName, hex: draftHex });
    setDraftName("");
    setDraftHex("#888888");
    setShowAdd(false);
  }

  // Under the design card only White, Black and the colours added from the
  // "+" list show (added ones stay, on every card), plus whatever is picked.
  const [listOpen, setListOpen] = useState(false);
  const { order, pinned } = useColorPrefs();
  const compact = section === "basic";
  const isPinned = (name: string) => pinned.some((n) => n.toLowerCase() === name.toLowerCase());
  const shown = (name: string) => !compact || name === "White" || name === "Black" || isPinned(name) || isBasicActive(name);
  const basics = sortByOrder(BASIC_COLORS, order);
  const roundBtn = "h-8 w-8 mt-0.5 rounded-full border-2 border-dashed border-zinc-300 dark:border-white/15 text-zinc-400 dark:text-zinc-500 grid place-items-center text-base hover:border-accent-500 hover:text-accent-500 transition";
  const allChoices = [
    ...basics.map((c) => ({ name: c.name, hex: c.hex })),
    ...customBasicColors.map((c) => ({ name: c.name, hex: c.hex })),
  ];

  const addForm = (
    <form onSubmit={submitAdd} className="flex items-center gap-1 surface-soft px-2 py-1.5">
      <input
        type="color"
        value={draftHex}
        onChange={(e) => setDraftHex(e.target.value)}
        className="h-7 w-7 rounded cursor-pointer bg-transparent border-0 p-0"
        aria-label="Pick hex"
      />
      <input
        autoFocus
        className="input text-xs py-1 w-28"
        placeholder="Color name"
        value={draftName}
        onChange={(e) => setDraftName(e.target.value)}
      />
      <button type="submit" className="btn-primary text-xs px-2 py-1">Add</button>
      <button type="button" onClick={() => { setShowAdd(false); setDraftName(""); }} className="btn-ghost text-xs px-2 py-1">×</button>
    </form>
  );

  // Basic-colors row - built-ins + user-added swatches + Add button.
  const basicRow = (
        <div className="flex items-start gap-3 flex-wrap">
          {/* Under the design card's artwork the swatches speak for themselves. */}
          {section !== "basic" && <span className="text-xs text-zinc-500 dark:text-zinc-400 mt-2 mr-1">Basic colors:</span>}

          {basics.filter((c) => shown(c.name)).map((c) => {
            const active = isBasicActive(c.name);
            return (
              <Swatch
                key={c.name}
                name={c.name}
                hex={c.hex}
                checkOn={c.checkOn}
                active={active}
                disabled={readOnly}
                onClick={() => !readOnly && applyColor(c.name)}
                onRemove={compact && !readOnly && isPinned(c.name) ? () => unpinColor(c.name) : undefined}
              />
            );
          })}

          {customBasicColors.filter((c) => shown(c.name)).map((c) => {
            const active = isBasicActive(c.name);
            const lum = hexLuminance(c.hex);
            return (
              <Swatch
                key={c.name}
                name={c.name}
                hex={c.hex}
                checkOn={lum > 0.55 ? "dark" : "light"}
                active={active}
                custom
                disabled={readOnly}
                onClick={() => !readOnly && applyColor(c.name)}
                onRemove={onRemoveCustomBasicColor ? () => onRemoveCustomBasicColor(c.name) : undefined}
              />
            );
          })}

          {compact && !readOnly && (
            <div className="relative">
              <button type="button" onClick={() => setListOpen((o) => !o)} className={roundBtn} aria-label="More colors" aria-expanded={listOpen} title="More colors">+</button>
              {listOpen && (
                <>
                  {/* Click anywhere else to close. */}
                  <div className="fixed inset-0 z-30" onClick={() => { setListOpen(false); setShowAdd(false); }} aria-hidden />
                  <div className="absolute left-0 top-10 z-40 w-52 overflow-hidden rounded-xl bg-white py-1 shadow-xl ring-1 ring-black/10 dark:bg-ink-800 dark:ring-white/10">
                    <p className="px-3 py-1.5 text-[11px] font-medium text-zinc-500">Select color</p>
                    <div className="max-h-72 overflow-y-auto">
                      {allChoices.map((c) => {
                        const active = isBasicActive(c.name);
                        return (
                          <button
                            key={c.name}
                            type="button"
                            onClick={() => { applyColor(c.name); pinColor(c.name); setListOpen(false); }}
                            className={`flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-xs transition hover:bg-zinc-100 dark:hover:bg-ink-700 ${active ? "font-semibold text-accent-600 dark:text-accent-400" : "text-zinc-700 dark:text-zinc-200"}`}
                          >
                            <span className="h-5 w-5 shrink-0 rounded ring-1 ring-black/10 dark:ring-white/15" style={{ background: c.hex }} />
                            <span className="flex-1 truncate">{c.name}</span>
                            {active && <span aria-hidden>✓</span>}
                          </button>
                        );
                      })}
                    </div>
                    {onAddCustomBasicColor && (
                      <div className="border-t border-zinc-200 p-1.5 dark:border-white/10">
                        {showAdd ? addForm : (
                          <button type="button" onClick={() => setShowAdd(true)} className="w-full rounded-md px-2 py-1.5 text-left text-xs text-zinc-500 hover:bg-zinc-100 hover:text-accent-500 dark:hover:bg-ink-700">+ Custom colour…</button>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Add custom basic color — only shown if a handler was passed in. */}
          {!compact && !readOnly && onAddCustomBasicColor && (
            !showAdd ? (
              <button
                type="button"
                onClick={() => setShowAdd(true)}
                className={roundBtn}
                aria-label="Add custom basic color"
                title="Add custom basic color"
              >+</button>
            ) : addForm
          )}
        </div>
  );
  if (section === "basic") return basicRow;

  const canApplyToAll = !readOnly && !!onApplyToAll && (applyToAllCount ?? 0) > 1;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Applies to <span className="font-medium text-zinc-700 dark:text-zinc-200">this design only</span>.
        </p>
        <div className="flex items-center gap-2">
          {canApplyToAll && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Copy these colors to all ${applyToAllCount} designs? This overwrites every other design's color settings.`)) {
                  onApplyToAll?.();
                }
              }}
              className="btn-ghost text-xs px-2.5 py-1.5"
              title="Copy this design's colors onto every other design in the batch"
            >
              Apply to all {applyToAllCount}
            </button>
          )}
          <div className="flex items-center gap-1 p-1 rounded-lg bg-zinc-100 dark:bg-ink-800">
            {(["light", "dark", "all"] as ColorPreset[]).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => !readOnly && setPreset(p)}
                disabled={readOnly}
                className={`px-3 py-1.5 text-xs font-medium rounded-md capitalize transition ${
                  preset === p
                    ? "bg-white shadow-sm text-zinc-900 dark:bg-ink-700 dark:text-white"
                    : "text-zinc-600 dark:text-zinc-300"
                } ${readOnly ? "opacity-60 cursor-not-allowed" : ""}`}
              >
                {p === "all" ? "All colors" : `${p} colors`}
              </button>
            ))}
          </div>
        </div>
      </div>

      {section === "all" && basicRow}

      {/* Per-product colors — split into two columns so every product is
          visible at once (half the scrolling). Falls back to one column on
          narrow screens. */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 border-t border-zinc-700/40">
        {slugs.map((slug) => {
          const label = SLUG_TO_PRODUCT_LABEL[slug];
          const palette = paletteFor(label);
          const enabled = enabledProducts.includes(label);
          const selected = productColors[slug] ?? palette[0]?.label ?? "";
          return (
            <div
              key={slug}
              className={`flex items-center justify-between gap-3 py-2 px-1 border-b border-zinc-700/30 transition ${enabled ? "" : "opacity-55"}`}
            >
              <span className="text-sm flex items-center gap-2 min-w-0">
                <span className="truncate">{label}</span>
                {!enabled && <span className="text-zinc-500 text-[10px] shrink-0">· disabled</span>}
              </span>
              <label className="surface-soft flex items-center gap-2 pl-2.5 pr-2 py-1.5 shrink-0 w-44 focus-within:border-accent-500/70 transition">
                <span
                  className="h-3.5 w-3.5 rounded-full border border-zinc-600 shrink-0"
                  style={{ background: colorHexForLabel(selected) }}
                />
                <select
                  // Options get explicit colours in globals.css - a transparent
                  // select would otherwise show a white list with light text.
                  className="flex-1 min-w-0 bg-transparent text-sm outline-none disabled:cursor-not-allowed"
                  value={selected}
                  onChange={(e) => setColor(slug, e.target.value)}
                  disabled={readOnly || !enabled || palette.length === 0}
                >
                  {palette.length === 0
                    ? <option>No catalog</option>
                    : palette.map((c) => (
                        <option key={c.label} value={c.label}>{c.label}</option>
                      ))}
                </select>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Swatch({
  name, hex, checkOn, active, custom, disabled, onClick, onRemove,
}: {
  name: string;
  hex: string;
  checkOn: "light" | "dark";
  active: boolean;
  custom?: boolean;
  disabled?: boolean;
  onClick: () => void;
  onRemove?: () => void;
}) {
  return (
    <div className="group flex flex-col items-center gap-1 relative">
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        title={`Set all products to ${name}`}
        aria-label={`Set all products to ${name}`}
        aria-pressed={active}
        className={`relative h-8 w-8 rounded-full shadow-sm transition
          ring-2 ${active ? "ring-accent-500 ring-offset-2 ring-offset-white dark:ring-offset-ink-900" : "ring-zinc-300 dark:ring-white/10"}
          ${disabled ? "opacity-60 cursor-not-allowed" : "group-hover:ring-accent-500/60"}`}
        style={{ background: hex }}
      >
        {active && (
          <span className={`absolute inset-0 grid place-items-center text-xs font-bold ${checkOn === "light" ? "text-white" : "text-black"}`}>✓</span>
        )}
      </button>
      <span className="text-[10px] text-zinc-500 dark:text-zinc-400 max-w-[64px] truncate">{name}</span>
      {onRemove && !disabled && (
        <button
          type="button"
          onClick={onRemove}
          className="absolute -top-1.5 -right-1.5 h-4 w-4 rounded-full bg-zinc-900 text-white text-[10px] grid place-items-center opacity-0 group-hover:opacity-100 transition dark:bg-white dark:text-zinc-900"
          aria-label={`Remove ${name}`}
          title={`Remove ${name}`}
        >×</button>
      )}
    </div>
  );
}


function hexLuminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
