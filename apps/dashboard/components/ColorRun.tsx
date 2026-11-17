"use client";

// "Select colors": one design at a time in the same place. Picking a colour
// applies it to that design and the next design takes its place, until the
// last one - a quick pass over the whole batch. Drag a swatch to change the
// order the colours appear in (remembered in this browser).

import { useState } from "react";
import { BASIC_COLORS } from "@/lib/colorPresets";
import { moveColor, sortByOrder, useColorPrefs } from "@/lib/colorPrefs";
import type { CustomBasicColor } from "@/lib/batchConfig";
import type { ParsedRow } from "@/lib/parser";
import { DesignPreview } from "./DesignPreview";

export function ColorRun({
  row, index, total, previewSrc, customBasicColors, onPick, onBack, onSkip, onClose,
}: {
  row: ParsedRow;
  index: number;
  total: number;
  previewSrc?: string;
  customBasicColors: CustomBasicColor[];
  /** Apply this basic colour (by name) to the design, then move on. */
  onPick: (name: string) => void;
  onBack?: () => void;
  onSkip: () => void;
  onClose: () => void;
}) {
  const { order } = useColorPrefs();
  const swatches = sortByOrder([
    ...BASIC_COLORS.map((c) => ({ name: c.name, hex: c.hex })),
    ...customBasicColors.map((c) => ({ name: c.name, hex: c.hex })),
  ], order);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  return (
    <div className="surface p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h3 className="font-semibold tracking-tight">Select colors</h3>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          Design <span className="font-semibold text-accent-600 dark:text-accent-400">{index + 1}</span> of {total}
        </span>
        <span className="flex-1" />
        <button type="button" className="btn-ghost h-8 w-8 !p-0 text-base" onClick={onBack} disabled={!onBack} title="Previous design" aria-label="Previous design">‹</button>
        <button type="button" className="btn-ghost h-8 w-8 !p-0 text-base" onClick={onSkip} title="Skip - keep this design's colour" aria-label="Skip">›</button>
        <button type="button" className="cp-pill !py-1.5" onClick={onClose}>Done</button>
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-[220px_1fr] sm:items-center">
        <DesignPreview key={row.rowNumber} src={previewSrc} alt={row.metadata.title} productColors={row.metadata.productColors ?? {}} />
        <div className="min-w-0">
          <p className="truncate text-base font-semibold text-zinc-900 dark:text-zinc-100" title={row.metadata.title}>
            {row.metadata.title || row.metadata.filename}
          </p>
          <p className="mb-4 text-sm text-zinc-500 dark:text-zinc-400">Pick a colour - the next design comes up right here. Drag a colour to reorder.</p>
          <div className="flex flex-wrap gap-3">
            {swatches.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.name)}
                draggable
                onDragStart={(e) => { setDragging(c.name); e.dataTransfer.effectAllowed = "move"; }}
                onDragOver={(e) => { if (dragging) { e.preventDefault(); setOver(c.name); } }}
                onDragLeave={() => setOver((o) => (o === c.name ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragging && dragging !== c.name) moveColor(swatches.map((x) => x.name), dragging, c.name);
                  setDragging(null); setOver(null);
                }}
                onDragEnd={() => { setDragging(null); setOver(null); }}
                className={`group flex w-16 cursor-grab flex-col items-center gap-1.5 rounded-lg transition active:cursor-grabbing ${dragging === c.name ? "opacity-40" : ""} ${over === c.name && dragging !== c.name ? "ring-2 ring-accent-500/60" : ""}`}
                title={`${c.name} - drag to reorder`}
              >
                <span
                  className="h-11 w-11 rounded-full ring-1 ring-black/10 transition group-hover:scale-110 group-hover:ring-2 group-hover:ring-accent-500 dark:ring-white/15"
                  style={{ background: c.hex }}
                />
                <span className="truncate text-[11px] text-zinc-500 dark:text-zinc-400">{c.name}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
