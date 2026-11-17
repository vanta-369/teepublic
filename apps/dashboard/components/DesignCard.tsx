"use client";

import { useState } from "react";
import clsx from "clsx";
import type { DesignMetadata } from "@teepublic/shared";
import type { ParsedRow } from "@/lib/parser";
import type { MatchedImage } from "@/lib/queue";
import { ColorsEditor } from "./ColorsEditor";
import { DesignPreview } from "./DesignPreview";
import { PRODUCT_GROUPS, enforceAdultRule } from "@/lib/productGroups";
import type { ColorPreset } from "@/lib/colorPresets";
import type { CustomBasicColor } from "@/lib/batchConfig";

type Tab = "info" | "colors";

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
  /** Controlled open/closed for the listing side (the grid opens one at a
   *  time). Left out, the card keeps its own state, open to start with. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  /** Open the next design's listing instead (shown while open). */
  onNextDesign?: () => void;
}


export function DesignCard({
  row, image, previewSrc, onChange, onRemove,
  customBasicColors, onAddCustomBasicColor, onRemoveCustomBasicColor,
  totalDesigns, onApplyColorsToAll, onApplyProductsToAll,
  expanded, onToggleExpanded, onNextDesign,
}: Props) {
  const [tab, setTab] = useState<Tab>("info");
  // Preset tracking is UI-only (not part of DesignMetadata) — defaults to
  // "all" so no toggle button shows as active until the user clicks one.
  const [preset, setPreset] = useState<ColorPreset>("all");
  // The arrow shows / hides the right side (the listing tabs). Hidden, the
  // card shrinks to the artwork, colours and products - a compact card.
  const [ownShowDetails, setOwnShowDetails] = useState(true);
  const showDetails = expanded ?? ownShowDetails;
  const toggleDetails = onToggleExpanded ?? (() => setOwnShowDetails((v) => !v));

  const m = row.metadata;

  // Always-editable, immediate-write — matches the "Generate with AI" flow.
  // Every field change is committed to the row store right away; there is no
  // Edit/Save/Cancel step.
  function update(patch: Partial<DesignMetadata>) {
    // Adult content Yes switches the Kids products off.
    onChange(row.rowNumber, enforceAdultRule({ ...row.metadata, ...patch }));
  }

  return (
    <div className="surface p-5">
      {/* Design number, then its buttons. */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="flex items-center gap-3">
          <span className="chip-mute font-mono">{row.metadata.filename}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="h-8 rounded-full px-3 text-sm font-semibold text-accent-600 transition hover:bg-accent-500/10 dark:text-accent-400"
            onClick={toggleDetails}
            aria-expanded={showDetails}
          >
            {showDetails ? "Hide info" : "Show info"}
          </button>
          {/* Next design: just the arrow, shown while the listing is open. */}
          {showDetails && onNextDesign && (
            <button
              type="button"
              className="btn-ghost h-8 w-8 !p-0 text-base"
              onClick={onNextDesign}
              title="Next design"
              aria-label="Next design"
            >
              ›
            </button>
          )}
          {onRemove && (
            <button className="btn h-8 px-3 text-xs bg-danger-500/15 text-danger-600 hover:bg-danger-500/25 dark:text-danger-500" onClick={onRemove}>Remove design</button>
          )}
        </div>
      </div>


      {/* Large tinted preview on the left, horizontal tabs on the right —
          mirrors the "Generate with AI" Design Configuration layout. */}
      <div className={clsx("grid grid-cols-1 gap-6", showDetails && "lg:grid-cols-[260px_1fr]")}>
        <div className="relative">
          <DesignPreview src={previewSrc} alt={m.title} productColors={m.productColors ?? {}} />
          <div className="mt-2 truncate text-xs text-zinc-500 dark:text-zinc-400" title={row.metadata.filename}>
            {row.metadata.filename}
          </div>
          {/* Basic colors sit right under the artwork, whatever tab is open. */}
          <div className="mt-4">
            <ColorsEditor
              section="basic"
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
            />
          </div>
          {/* Product types under the colours, as pills: adult, kids, other. */}
          <div className="mt-5">
            <ProductPills
              metadata={m}
              onChange={(enabledProducts) => update({ enabledProducts })}
              totalDesigns={totalDesigns}
              onApplyToAll={onApplyProductsToAll}
            />
          </div>
        </div>

        {showDetails && (
        <div className="min-w-0 space-y-4">
          <Tabs value={tab} onChange={setTab} />

          {tab === "info" && (
            <InfoTab metadata={m} onChange={update} />
          )}
          {tab === "colors"   && (
            <ColorsEditor
              section="detail"
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
        </div>
        )}
      </div>
    </div>
  );
}

// Horizontal segmented tabs — mirrors the AI flow's Design Configuration tabs.
function Tabs({ value, onChange }: { value: Tab; onChange: (v: Tab) => void }) {
  const items: { id: Tab; label: string }[] = [
    { id: "info",     label: "Info" },
    { id: "colors",   label: "Colors" },
  ];
  return (
    <div className="grid grid-cols-2 gap-1 rounded-full bg-ink-800 p-1">
      {items.map((it) => {
        const active = value === it.id;
        return (
          <button
            key={it.id}
            type="button"
            onClick={() => onChange(it.id)}
            className={clsx(
              "rounded-full py-2 text-sm font-semibold transition",
              active
                ? "bg-accent-500 text-zinc-950"
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
// Always-editable - every change writes straight through to the row store (no
// Edit/Save step). Soft fields, no outlines; the table's cells follow along.
const FIELD = "w-full rounded-xl bg-ink-800 px-3.5 py-2.5 text-sm text-zinc-900 outline-none transition placeholder:text-zinc-500 focus:ring-2 focus:ring-accent-500/50 dark:text-zinc-100";

function InfoTab({ metadata, onChange }: { metadata: DesignMetadata; onChange: (p: Partial<DesignMetadata>) => void }) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-[1fr_240px]">
      <Field label="Title" hint={`${metadata.title.length} chars`}>
        <textarea
          rows={2}
          className={clsx(FIELD, "resize-none font-semibold leading-snug")}
          style={{ fieldSizing: "content" } as React.CSSProperties}
          value={metadata.title}
          onChange={(e) => onChange({ title: e.target.value.replace(/\n/g, " ") })}
        />
      </Field>

      <Field label="Primary tag">
        <input
          className={clsx(FIELD, "font-semibold !text-accent-600 dark:!text-accent-400")}
          value={metadata.primaryTag ?? ""}
          onChange={(e) => onChange({ primaryTag: e.target.value || undefined })}
        />
      </Field>

      <Field label="Description" full>
        <textarea
          rows={3}
          className={clsx(FIELD, "resize-y leading-relaxed")}
          style={{ fieldSizing: "content" } as React.CSSProperties}
          value={metadata.description}
          onChange={(e) => onChange({ description: e.target.value })}
        />
      </Field>

      <Field label="Supporting tags" hint={`${metadata.tags.length} tags`} full>
        <TagEditor tags={metadata.tags} onChange={(tags) => onChange({ tags })} />
      </Field>

      <Field label="Adult content">
        <div className="inline-flex rounded-full bg-ink-800 p-1">
          <button
            type="button"
            onClick={() => onChange({ matureContent: false })}
            className={clsx("rounded-full px-5 py-1.5 text-sm font-semibold transition",
              !metadata.matureContent ? "bg-ink-600 text-zinc-900 dark:text-zinc-100" : "text-zinc-500 hover:text-zinc-300")}
          >
            No
          </button>
          <button
            type="button"
            onClick={() => onChange({ matureContent: true })}
            className={clsx("rounded-full px-5 py-1.5 text-sm font-semibold transition",
              metadata.matureContent ? "bg-danger-500/20 text-danger-600 dark:text-danger-500" : "text-zinc-500 hover:text-zinc-300")}
          >
            Yes
          </button>
        </div>
      </Field>
    </div>
  );
}

/** Supporting tags as pills: × removes one; type and press Enter or a comma to
 *  add (a pasted "a, b, c" adds all three); Backspace in the empty box removes
 *  the last one. */
function TagEditor({ tags, onChange }: { tags: string[]; onChange: (tags: string[]) => void }) {
  const [draft, setDraft] = useState("");
  function add(text: string) {
    const next = [...tags];
    for (const t of text.split(",").map((x) => x.trim()).filter(Boolean)) {
      if (!next.some((x) => x.toLowerCase() === t.toLowerCase())) next.push(t);
    }
    if (next.length !== tags.length) onChange(next);
    setDraft("");
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-xl bg-ink-800 p-2 focus-within:ring-2 focus-within:ring-accent-500/50">
      {tags.map((t, i) => (
        <span key={`${t}-${i}`} className="inline-flex items-center gap-1 rounded-full bg-ink-700 py-1 pl-3 pr-1 text-xs text-zinc-800 dark:text-zinc-200">
          {t}
          <button
            type="button"
            onClick={() => onChange(tags.filter((_, j) => j !== i))}
            className="grid h-5 w-5 place-items-center rounded-full text-zinc-500 hover:bg-ink-600 hover:text-zinc-100"
            aria-label={`Remove ${t}`}
          >
            ×
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => (e.target.value.includes(",") ? add(e.target.value) : setDraft(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); add(draft); }
          else if (e.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        }}
        onBlur={() => { if (draft.trim()) add(draft); }}
        placeholder="Add tag…"
        className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm text-zinc-900 outline-none placeholder:text-zinc-500 dark:text-zinc-100"
      />
    </div>
  );
}

/** Product types as pills, in three groups. A lime pill is enabled for this design. */
function ProductPills({
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
  /** Switch every type in a group on (or off when they all are already). */
  function toggleGroup(names: string[], allOn: boolean) {
    const next = new Set(enabled);
    for (const n of names) { if (allOn) next.delete(n); else next.add(n); }
    onChange([...next]);
  }
  const canApplyToAll = !!onApplyToAll && (totalDesigns ?? 0) > 1;
  // Each group is one line with its count; click it to open the pills.
  const [open, setOpen] = useState<Record<string, boolean>>({});
  return (
    <div className="space-y-1">
      {PRODUCT_GROUPS.map((g) => {
        const isOpen = !!open[g.title];
        const on = g.items.filter((i) => enabled.has(i.name)).length;
        // Kids products are not allowed for an adult design.
        const locked = !!g.offByDefault && metadata.matureContent;
        return (
        <div key={g.title} className="rounded-lg bg-ink-800/60">
          <div className="flex items-center gap-2 px-2.5 py-1">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [g.title]: !o[g.title] }))}
              aria-expanded={isOpen}
              className="flex min-w-0 flex-1 items-center gap-2 text-left"
            >
              <span className={clsx("text-xs text-zinc-500 transition-transform", isOpen && "rotate-90")} aria-hidden>▸</span>
              <span className="truncate text-xs font-medium text-zinc-800 dark:text-zinc-100">{g.title}</span>
            </button>
            {/* Select all, in the middle of the line. */}
            {locked ? (
              <span className="shrink-0 text-[11px] text-zinc-500" title="Kids products are off for adult designs">Off - adult design</span>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => toggleGroup(g.items.map((i) => i.name), on === g.items.length)}
                  className="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold text-accent-600 hover:bg-accent-500/10 dark:text-accent-400"
                >
                  {on === g.items.length ? "Unselect all" : "Select all"}
                </button>
                <span className={clsx("shrink-0 text-right text-[11px] tabular-nums", on > 0 ? "text-accent-600 dark:text-accent-400" : "text-zinc-500")}>
                  {on}/{g.items.length}
                </span>
              </>
            )}
          </div>
          {isOpen && (
          <div className="flex flex-wrap gap-1 px-2.5 pb-2">
            {g.items.map(({ name, label }) => {
              const on = enabled.has(name);
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => toggle(name)}
                  disabled={locked}
                  aria-pressed={on}
                  className={clsx(
                    "rounded-full px-2.5 py-1 text-[11px] font-medium transition disabled:cursor-not-allowed disabled:opacity-40",
                    on
                      ? "bg-accent-500/15 text-accent-600 dark:text-accent-400"
                      : "bg-ink-700 text-zinc-600 hover:bg-ink-600 dark:text-zinc-300"
                  )}
                >
                  {label ?? name}
                </button>
              );
            })}
          </div>
          )}
        </div>
        );
      })}
      {canApplyToAll && (
        <button
          type="button"
          className="cp-link"
          onClick={() => {
            if (window.confirm(`Copy these products to all ${totalDesigns} designs? This overwrites every other design's product list.`)) {
              onApplyToAll?.();
            }
          }}
        >
          Apply these products to all {totalDesigns} designs
        </button>
      )}
    </div>
  );
}

// ── Building blocks ─────────────────────────────────────────────────────────
function Field({ label, hint, children, full = false }: { label: string; hint?: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div className={clsx(full && "md:col-span-2")}>
      <div className="mb-1.5 flex items-baseline justify-between gap-3">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-500">{label}</span>
        {hint && <span className="text-[11px] text-zinc-500">{hint}</span>}
      </div>
      {children}
    </div>
  );
}


