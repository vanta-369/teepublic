"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { ImageOff } from "lucide-react";

import { DesignTitleLink } from "@/components/design-title-link";
import { Badge } from "@/components/ui/badge";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { DesignRollup } from "@/lib/dashboard-types";
import type { DesignThumbIndex } from "@/lib/designThumbs";
import { formatCurrency, formatNumber } from "@/lib/formatters";
import { cn } from "@/lib/utils";

/**
 * Best-earning designs in the window.
 *
 * A table, not a chart: past a handful of classes the ranking is what matters
 * and exact numbers beat bar lengths. The inline share meter is a track in a
 * lighter step of the same hue, so the proportion reads without a second axis.
 *
 * Rows are grouped by DESIGN ID (see `buildTopDesigns`), so two listings that
 * share a title stay separate entries.
 */
export function TopDesignsTable({
  designs,
  currency,
  thumbs,
}: {
  designs: DesignRollup[];
  currency: string;
  /** Normalised title → artwork URL, from the seller's own designs library. */
  thumbs?: DesignThumbIndex;
}) {
  const max = React.useMemo(
    () => designs.reduce((m, d) => Math.max(m, d.earnings), 0),
    [designs],
  );

  return (
    <Card className="viz-root">
      <CardHeader>
        <CardTitle className="text-base">Top designs</CardTitle>
        <CardDescription>
          Ranked by earnings, grouped by design ID.
        </CardDescription>
      </CardHeader>

      {designs.length === 0 ? (
        <p className="px-5 pb-6 text-sm text-zinc-500 dark:text-zinc-400">
          No designs in this range.
        </p>
      ) : (
        <div className="px-2 pb-2">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8">#</TableHead>
                <TableHead>Design</TableHead>
                <TableHead>Top product</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Per unit</TableHead>
                <TableHead className="text-right">Earnings</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {designs.map((d, i) => (
                <TableRow key={d.key}>
                  <TableCell>
                    {/* Podium ranks carry the accent; the rest stay muted so
                        "top three" reads without a legend. */}
                    <span
                      className={cn(
                        "grid h-6 w-6 place-items-center rounded-md text-xs font-bold tabular-nums",
                        i < 3
                          ? "bg-accent-500/15 text-accent-600 dark:text-accent-400"
                          : "text-zinc-400",
                      )}
                    >
                      {i + 1}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="flex items-center gap-3">
                      <DesignThumb
                        src={thumbs?.get(d.designId, d.design)}
                        alt={d.design}
                        designId={d.designId}
                      />
                      <div className="min-w-0 flex-1">
                        <DesignTitleLink design={d.design} designId={d.designId} />
                        {d.designId && (
                          <div className="mt-0.5 font-mono text-[11px] text-zinc-400">
                            #{d.designId}
                          </div>
                        )}
                        {/* Share meter: fill and track are two steps of one hue. */}
                        <div
                          className="mt-1.5 h-1 w-full overflow-hidden rounded-full"
                          style={{ background: "var(--viz-series-1)", opacity: 0.15 }}
                          aria-hidden
                        >
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: `${max ? Math.max(2, (d.earnings / max) * 100) : 0}%`,
                              background: "var(--viz-series-1)",
                            }}
                          />
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge>{d.topProductType}</Badge>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.units)}</TableCell>
                  <TableCell className="text-right tabular-nums text-zinc-500 dark:text-zinc-400">
                    {formatCurrency(d.perUnit, currency)}
                  </TableCell>
                  <TableCell className="text-right font-bold tabular-nums text-accent-600 dark:text-accent-400">
                    {formatCurrency(d.earnings, currency)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </Card>
  );
}

/**
 * Artwork tile. Falls back to a neutral placeholder when the design isn't in
 * the seller's library (bought-in artwork, designs uploaded before this app, or
 * a title edited on TeePublic after upload) — and again if the image 404s.
 *
 * Exported for the period-breakdown dialog, so a thumbnail looks and degrades
 * identically wherever a design is listed.
 */
export function DesignThumb({
  src,
  alt,
  designId,
}: {
  src?: string;
  alt: string;
  designId: string | null;
}) {
  const [failed, setFailed] = React.useState(false);
  React.useEffect(() => setFailed(false), [src]);

  if (!src || failed) {
    return (
      <span
        className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-ink-800 text-zinc-500 dark:text-zinc-400"
        title={designId ? `No artwork in your library for #${designId}` : "No artwork"}
      >
        <ImageOff className="h-4 w-4" aria-hidden />
      </span>
    );
  }

  return (
    <ZoomOnHover src={src} alt={alt}>
      {/* Plain <img>: either an object URL over this browser's IndexedDB, or
          TeePublic's own CDN picture (images.teepublic.com) found by the
          extension - neither belongs in next/image's optimiser. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-10 w-10 shrink-0 cursor-zoom-in rounded-lg bg-ink-800 object-cover"
      />
    </ZoomOnHover>
  );
}

/** TeePublic's CDN serves s_313 and s_630 (larger sizes 404): zoom uses the sharp one. */
const largeImage = (src: string) =>
  src.startsWith("https://images.teepublic.com/") ? src.replace(/([,:])s_\d+(?=[,.])/, "$1s_630") : src;

const ZOOM = 360;

/** A big, clear copy of the thumbnail while the mouse is over it - beside the
 *  thumbnail, kept inside the window, drawn over everything (dialogs too). */
function ZoomOnHover({ src, alt, children }: { src: string; alt: string; children: React.ReactNode }) {
  const ref = React.useRef<HTMLSpanElement>(null);
  const [pos, setPos] = React.useState<{ left: number; top: number; size: number } | null>(null);
  const [big, setBig] = React.useState(src);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const size = Math.min(ZOOM, window.innerWidth - 32, window.innerHeight - 32);
    const right = r.right + 12;
    const left = right + size <= window.innerWidth - 16 ? right : Math.max(16, r.left - 12 - size);
    const top = Math.min(Math.max(16, r.top + r.height / 2 - size / 2), window.innerHeight - size - 16);
    setBig(src); // the small one is cached - it shows at once, then the sharp one replaces it
    const img = new Image();
    img.onload = () => setBig(img.src);
    img.src = largeImage(src);
    setPos({ left, top, size });
  };

  React.useEffect(() => {
    if (!pos) return;
    const hide = () => setPos(null);
    window.addEventListener("scroll", hide, true);
    return () => window.removeEventListener("scroll", hide, true);
  }, [pos]);

  return (
    <span ref={ref} className="shrink-0" onMouseEnter={show} onMouseLeave={() => setPos(null)}>
      {children}
      {pos &&
        createPortal(
          <div
            className="pointer-events-none fixed z-[1000] overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-2xl dark:border-white/10"
            style={{ left: pos.left, top: pos.top, width: pos.size, height: pos.size }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={big} alt={alt} className="h-full w-full object-contain" />
          </div>,
          document.body,
        )}
    </span>
  );
}
