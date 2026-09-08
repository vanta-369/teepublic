"use client";

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/dashboard/DashBits";

interface Design {
  id: string;
  imageUrl: string;
  originalName: string;
  status: string;
  listing: { title?: string } | null;
}

export function ProductsList() {
  const [designs, setDesigns] = useState<Design[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/designs")
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
        if (d.ok) setDesigns(d.designs as Design[]);
        else setError(d.error || "Failed to load products.");
      })
      .catch(() => !cancelled && setError("Failed to load products."));
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return <div className="chip-err w-full justify-center py-2">{error}</div>;
  if (!designs) return <div className="text-sm text-zinc-500">Loading…</div>;
  if (designs.length === 0)
    return (
      <EmptyState
        title="No products yet"
        subtitle="Create your first product to start uploading."
        actionLabel="Create Product"
        actionHref="/dashboard/create"
      />
    );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {designs.map((d) => (
        <div key={d.id} className="surface p-4 flex gap-4">
          <div className="h-16 w-16 shrink-0 rounded-lg overflow-hidden bg-ink-800 border border-ink-700">
            {d.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={d.imageUrl} alt="" className="h-full w-full object-cover" />
            ) : null}
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-medium text-zinc-900 dark:text-zinc-100 truncate">
              {d.listing?.title || d.originalName || "Untitled product"}
            </p>
            <p className="text-xs text-zinc-500 truncate mt-0.5">{d.originalName}</p>
            <span className="chip-mute mt-2">{d.status || "ready"}</span>
          </div>
        </div>
      ))}
    </div>
  );
}
