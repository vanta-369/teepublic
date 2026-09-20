"use client";

import { stemName, type ParsedRow } from "@/lib/parser";
import type { MatchedImage } from "@/lib/queue";
import type { DesignMetadata } from "@teepublic/shared";

interface Props {
  rows: ParsedRow[];
  images: Map<string, MatchedImage>;       // keyed by stem
  /** Object URLs over the artwork in this device's IndexedDB, keyed by stem.
   *  A MatchedImage carries no URL and no bytes - see lib/spreadsheetStore.ts. */
  previewUrls?: Map<string, string>;
  onRemove: (stem: string) => void;
}

export function PreviewTable({ rows, images, previewUrls, onRemove }: Props) {
  if (rows.length === 0) return null;

  return (
    <section className="surface overflow-hidden">
      <header className="px-5 py-4 flex items-center justify-between border-b border-white/5">
        <h3 className="font-semibold tracking-tight">Preview</h3>
        <span className="chip-info">{rows.length} matched</span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-zinc-400 text-xs uppercase tracking-wider">
              <th className="px-5 py-3 w-20">Image</th>
              <th className="px-3 py-3 w-24">Filename</th>
              <th className="px-3 py-3">Title</th>
              <th className="px-3 py-3">Primary tag</th>
              <th className="px-3 py-3">Tags</th>
              <th className="px-3 py-3">Products</th>
              <th className="px-3 py-3 w-12"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const stem = stemName(row.metadata.filename);
              const img = images.get(stem);
              return (
                <tr key={row.rowNumber} className="border-t border-white/5 hover:bg-white/[0.02] transition">
                  <td className="px-5 py-3">
                    <div className="h-12 w-12 rounded-lg overflow-hidden bg-ink-800 grid place-items-center ring-1 ring-white/5">
                      {img && previewUrls?.get(stem) ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={previewUrls.get(stem)} alt={row.metadata.title} className="w-full h-full object-contain" />
                      ) : (
                        <span className="text-zinc-500 text-[10px]">no img</span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-3 font-mono text-zinc-300">{row.metadata.filename}</td>
                  <td className="px-3 py-3">
                    <div className="text-zinc-900 dark:text-zinc-100 truncate max-w-[28ch]" title={row.metadata.title}>{row.metadata.title}</div>
                    {row.metadata.matureContent && <span className="chip-warn mt-1">Mature</span>}
                  </td>
                  <td className="px-3 py-3 text-zinc-300">
                    {row.metadata.primaryTag ?? <span className="text-zinc-500">—</span>}
                  </td>
                  <td className="px-3 py-3 text-zinc-300">
                    <TagsCell tags={row.metadata.tags} />
                  </td>
                  <td className="px-3 py-3 text-zinc-300">
                    <ProductsCell metadata={row.metadata} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {img && (
                      <button
                        className="chip-mute hover:bg-white/10"
                        onClick={() => onRemove(stem)}
                        title="Remove staged image"
                      >
                        ✕
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TagsCell({ tags }: { tags: string[] }) {
  if (tags.length === 0) return <span className="text-zinc-500">—</span>;
  return (
    <span title={tags.join(", ")} className="inline-block max-w-[26ch] truncate align-middle">
      <span className="font-mono text-zinc-900 dark:text-zinc-100">{tags.length}</span>
      <span className="text-zinc-500"> · {tags.slice(0, 3).join(", ")}{tags.length > 3 ? "…" : ""}</span>
    </span>
  );
}

function ProductsCell({ metadata }: { metadata: DesignMetadata }) {
  const products = metadata.enabledProducts;
  const colors = metadata.productColors;
  const colorEntries = Object.entries(colors);

  if (products.length === 0 && colorEntries.length === 0) {
    return <span className="text-zinc-500">—</span>;
  }

  // Summarize color spread: { "White": 11, "black": 2 } → "White ×11, black ×2"
  const counts = new Map<string, number>();
  for (const [, c] of colorEntries) counts.set(c, (counts.get(c) ?? 0) + 1);
  const colorSummary = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([color, n]) => `${color}×${n}`)
    .join(", ");

  return (
    <div className="flex flex-col gap-0.5">
      <span title={products.join(", ")} className="truncate max-w-[26ch]">
        <span className="font-mono text-zinc-900 dark:text-zinc-100">{products.length}</span>
        <span className="text-zinc-500"> products</span>
      </span>
      {colorSummary && (
        <span className="text-xs text-zinc-500 truncate max-w-[26ch]" title={colorEntries.map(([k, v]) => `${k}: ${v}`).join("\n")}>
          {colorSummary}
        </span>
      )}
    </div>
  );
}
