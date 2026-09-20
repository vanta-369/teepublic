"use client";

// The user's product library. Reads THIS DEVICE's IndexedDB, not an API:
// designs, their listing copy and their artwork never leave the browser, so
// there is no server that could list them. See lib/designsStore.ts.

import { useEffect, useState } from "react";
import { EmptyState } from "@/components/dashboard/DashBits";
import { loadDesigns, getDesignImageObjectUrl, type PersistedDesign } from "@/lib/designsStore";

export function ProductsList() {
  const [designs, setDesigns] = useState<PersistedDesign[] | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];

    (async () => {
      try {
        const rows = await loadDesigns();
        if (cancelled) return;
        setDesigns(rows);

        const next: Record<string, string> = {};
        for (const d of rows) {
          const url = await getDesignImageObjectUrl(d.id).catch(() => null);
          if (url) {
            next[d.id] = url;
            created.push(url);
          }
        }
        if (cancelled) {
          created.forEach(URL.revokeObjectURL);
          return;
        }
        setThumbs(next);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load products from this device.");
        }
      }
    })();

    return () => {
      cancelled = true;
      created.forEach(URL.revokeObjectURL);
    };
  }, []);

  if (error) return <div className="chip-err w-full justify-center py-2">{error}</div>;
  if (!designs) return <div className="text-sm text-zinc-500">Loading…</div>;
  if (designs.length === 0)
    return (
      <EmptyState
        title="No products on this device"
        subtitle="Create your first product to start uploading. Products are stored in this browser."
        actionLabel="Create Product"
        actionHref="/dashboard/create"
      />
    );

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {designs.map((d) => (
        <div key={d.id} className="surface p-4 flex gap-4">
          <div className="h-16 w-16 shrink-0 rounded-lg overflow-hidden bg-ink-800 border border-ink-700">
            {thumbs[d.id] ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={thumbs[d.id]} alt="" className="h-full w-full object-cover" />
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
