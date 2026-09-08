"use client";

import { ExternalLink } from "lucide-react";

import { designUrl } from "@/lib/teepublic";
import { cn } from "@/lib/utils";

/**
 * Design title, linked to its public page on TeePublic when the export gave us
 * a usable id. Shared by the top-designs and recent-sales tables so a title
 * behaves the same wherever it appears.
 *
 * Falls back to plain text rather than a dead link: a row with no design id (or
 * a non-numeric one) has nothing reliable to point at, and a link that 404s is
 * worse than no link.
 */
export function DesignTitleLink({
  design,
  designId,
  className,
}: {
  design: string;
  designId: string | null;
  className?: string;
}) {
  // The title is what builds the URL slug, so it's passed alongside the id.
  const href = designUrl(designId, design);

  if (!href) {
    return (
      <span
        className={cn("block truncate font-medium text-zinc-900 dark:text-zinc-100", className)}
        title={design}
      >
        {design}
      </span>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      // noreferrer alongside noopener: this is an external origin, and the
      // referrer would leak which of the seller's pages they came from.
      rel="noopener noreferrer"
      title={`${design} — open on TeePublic`}
      className={cn(
        "group/link inline-flex max-w-full items-center gap-1 rounded-sm font-medium text-zinc-900 dark:text-zinc-100",
        "underline-offset-2 hover:text-accent-600 hover:underline dark:hover:text-accent-400",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500",
        className,
      )}
    >
      <span className="truncate">{design}</span>
      {/* Marks the link as leaving the app, so "this is clickable" isn't
          signalled by hover colour alone. */}
      <ExternalLink
        className="h-3 w-3 shrink-0 opacity-0 transition-opacity group-hover/link:opacity-100"
        aria-hidden
      />
      <span className="sr-only">(opens on TeePublic in a new tab)</span>
    </a>
  );
}
