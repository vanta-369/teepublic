"use client";

import { useState } from "react";
import clsx from "clsx";
import type { DesignMetadata } from "@teepublic/shared";
import type { ParsedRow } from "@/lib/parser";
import type { MatchedImage } from "@/lib/queue";
import { ColorsEditor } from "./ColorsEditor";
import { DesignPreview, DesignColorSwatches } from "./DesignPreview";
import type { ColorPreset } from "@/lib/colorPresets";
import type { CustomBasicColor } from "@/lib/batchConfig";

type Tab = "info" | "colors" | "products";

interface Props {
  row: ParsedRow;
  image: MatchedImage | undefined;
  /** Object URL over the artwork held in this device's IndexedDB. The image
   *  record itself carries no URL and no bytes - see lib/spreadsheetStore.ts. */
  previewSrc?: string;
  onChange: (rowNumber: number, next: DesignMetadata) => void;
  onRemove?: () => void;
  customBasicColors?: CustomBasicColor[];
  onAddCustomBasicColor?: (c: CustomBasicColor) => void;
  onRemoveCustomBasicColor?: (name: string) => void;
  /** Total rows in the batch — used to label and gate the Apply-to-all
   *  button. Apply-to-all is hidden when totalDesigns <= 1. */
  totalDesigns?: number;
  /** Copy this row's productColors onto every other row in the batch. */
  onApplyColorsToAll?: () => void;
  /** Copy this row's enabledProducts onto every other row in the batch. */
  onApplyProductsToAll?: () => void;
}

const ALL_PRODUCTS = [
  "T-Shirt", "Hoodie", "Tank", "Crewneck", "Long Sleeve", "Baseball Tee",
  "Kids", "Kids Hoodie", "Kids Long Sleeve T-Shirt",
  "Hats", "Shorts", "Bags",
  "Stickers", "Cases", "Mugs", "Wall Art", "Pillows", "Totes",
  "Tapestries", "Pins", "Magnets",
];

export function DesignCard({
  row, image, previewSrc, onChange, onRemove,
  customBasicColors, onAddCustomBasicColor, onRemoveCustomBasicColor,
  totalDesigns, onApplyColorsToAll, onApplyProductsToAll,
}: Props) {
  const [tab, setTab] = useState<Tab>("info");
  // Preset tracking is UI-only (not part of DesignMetadata) — defaults to
  // "all" so no toggle button shows as active until the user clicks one.
  const [preset, setPreset] = useState<ColorPreset>("all");

  const m = row.metadata;

  // Always-editable, immediate-write — matches the "Generate with AI" flow.
  // Every field change is committed to the row store right away; there is no
  // Edit/Save/Cancel step.
  function update(patch: Partial<DesignMetadata>) {
    onChange(row.rowNumber, { ...row.metadata, ...patch });
  }

  return (
    <div className="surface p-5">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-3">
          <h3 className="font-semibold tracking-tight">Design Configuration</h3>
          <span className="chip-mute font-mono">{row.metadata.filename}</span>
        </div>
        {onRemove && (
          <button className="btn-ghost text-xs" onClick={onRemove} title="Remove">✕</button>
        )}
      </div>

      {/* Large tinted preview on the left, horizontal tabs on the right —
          mirrors the "Generate with AI" Design Configuration layout. */}
      <div className="grid grid-cols-1 lg:grid-cols-[260px_1fr] gap-6">
        <div className="relative">
          <DesignPreview src={previewSrc} alt={m.title} productColors={m.productColors ?? {}} />
          <div className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400" title={row.metadata.filename}>
            {row.metadata.filename}
          </div>
          <DesignColorSwatches productColors={m.productColors ?? {}} />
        </div>

        <div className="min-w-0 space-y-4">
          <Tabs value={tab} onChange={setTab} />

          {tab === "info" && (
            <InfoTab metadata={m} onChange={update} />
          )}
          {tab === "colors"   && (
            <ColorsEditor
              productColors={m.productColors ?? {}}
              enabledProducts={m.enabledProducts ?? []}
              preset={preset}
              onChange={({ productColors, preset: nextPreset }) => {
                setPreset(nextPreset);
                update({ productColors });
              }}
              customBasicColors={customBasicColors}
              onAddCustomBasicColor={onAddCustomBasicColor}
              onRemoveCustomBasicColor={onRemoveCustomBasicColor}
              applyToAllCount={totalDesigns}
              onApplyToAll={onApplyColorsToAll}
            />
          )}
          {tab === "products" && (
            <ProductsTab
              metadata={m}
              onChange={(enabledProducts) => update({ enabledProducts })}
              totalDesigns={totalDesigns}
              onApplyToAll={onApplyProductsToAll}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// Horizontal segmented tabs — mirrors the AI flow's Design Configuration tabs.
function Tabs({ value, onChange }: { value: Tab; onChange: (v: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: "info",     label: "Info" },
    { id: "colors",   label: "Colors" },
    { id: "products", label: "Products" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2 p-1 rounded-xl bg-zinc-100 dark:bg-ink-800">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={clsx(
              "py-2.5 rounded-lg text-sm font-medium transition",
              active
                ? "bg-white text-zinc-900 ring-1 ring-success-500/60 shadow-sm dark:bg-ink-900 dark:text-white"
                : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"
            )}
          >
            {it.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Info tab ────────────────────────────────────────────────────────────────
// Always-editable inputs — every change writes straight through to the row
// store (no Edit/Save step), matching the AI flow.
function InfoTab({ metadata, onChange }: { metadata: DesignMetadata; onChange: (p: Partial<DesignMetadata>) => void }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Field label="Design Title">
        <input className="input" value={metadata.title} onChange={(e) => onChange({ title: e.target.value })} />
      </Field>

      <Field label="Primary Tag">
        <input className="input" value={metadata.primaryTag ?? ""} onChange={(e) => onChange({ primaryTag: e.target.value || undefined })} />
      </Field>

      <Field label="Description" full>
        <textarea className="input min-h-[80px]" value={metadata.description} onChange={(e) => onChange({ description: e.target.value })} />
      </Field>

      <Field label="Supporting Tags" full>
        <textarea
          className="input min-h-[80px]"
          value={metadata.tags.join(", ")}
          onChange={(e) => onChange({ tags: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })}
          placeholder="comma-separated tags"
        />
      </Field>

      <Field label="Adult Content">
        <div className="flex gap-3">
          <RadioOption checked={!metadata.matureContent} label="No"  onClick={() => onChange({ matureContent: false })} />
          <RadioOption checked={metadata.matureContent}  label="Yes" onClick={() => onChange({ matureContent: true })} />
        </div>
      </Field>
    </div>
  );
}

// ── Products tab ────────────────────────────────────────────────────────────
function ProductsTab({
  metadata, onChange, totalDesigns, onApplyToAll,
}: {
  metadata: DesignMetadata;
  onChange: (next: string[]) => void;
  totalDesigns?: number;
  onApplyToAll?: () => void;
}) {
  const enabled = new Set(metadata.enabledProducts ?? []);
  function toggle(name: string) {
    const next = new Set(enabled);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange([...next]);
  }
  const canApplyToAll = !!onApplyToAll && (totalDesigns ?? 0) > 1;
  return (
    <div className="space-y-3">
      {canApplyToAll && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            {enabled.size} of {ALL_PRODUCTS.length} enabled.
          </p>
          <button
            type="button"
            className="btn-ghost text-xs px-2.5 py-1.5"
            title="Copy this design's enabled products onto every other design in the batch"
            onClick={() => {
              if (window.confirm(`Copy these enabled products to all ${totalDesigns} designs? This overwrites every other design's product list.`)) {
                onApplyToAll?.();
              }
            }}
          >
            Apply to all {totalDesigns}
          </button>
        </div>
      )}
      {/* Terminal checklist — [x]/[ ] rows laid out in columns. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-x-6 gap-y-0.5">
        {ALL_PRODUCTS.map((name) => {
          const on = enabled.has(name);
          return (
            <button
              key={name}
              onClick={() => toggle(name)}
              className={clsx(
                "group flex items-center gap-2.5 px-2 py-1.5 text-sm text-left rounded-sm transition cursor-pointer hover:bg-ink-800",
                on ? "text-zinc-900 dark:text-zinc-100" : "text-zinc-500"
              )}
            >
              <span className={clsx("font-mono select-none shrink-0", on ? "text-accent-500" : "text-zinc-600")}>
                {on ? "[x]" : "[ ]"}
              </span>
              <span className="truncate">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────
function Field({ label, children, full = false }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={clsx(full && "md:col-span-2")}>
      <div className="text-xs font-semibold text-zinc-300 mb-1">{label}</div>
      {children}
    </div>
  );
}

function RadioOption({ checked, label, onClick }: { checked: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        "px-3 py-1.5 rounded-lg border text-sm transition",
        checked ? "border-accent-500 bg-accent-500/10 text-accent-200" : "border-white/10 text-zinc-300 hover:border-white/20"
      )}
    >
      <span className="inline-block w-2 h-2 rounded-full mr-2 align-middle"
            style={{ background: checked ? "currentColor" : "transparent", boxShadow: "inset 0 0 0 1px currentColor" }} />
      {label}
    </button>
  );
}

