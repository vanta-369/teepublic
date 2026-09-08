"use client";

// Mirrors the extension's upload queue on the dashboard. The extension owns the
// queue: every read is a live QUEUE_STATE round-trip and every button asks the
// extension to mutate it, so this panel and the side panel can never disagree.
// Images are NOT sent back over the wire (they live in the extension's
// ImageStore); thumbnails come from the URL map bridge.ts saved when the queue
// was sent from this browser.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { QueueItem, QueueItemStatus, QueueStateData } from "@teepublic/shared";
import { EmptyState } from "@/components/dashboard/DashBits";
import { QUEUE_CHANGED_EVENT } from "@/components/dashboard/UploadStagePanel";
import {
  isExtensionAvailable,
  getExtensionId,
  fetchQueueState,
  getQueueThumbs,
  startQueue,
  pauseQueue,
  clearQueue,
  retryQueueItem,
  toggleQueueItem,
  selectAllQueueItems,
} from "@/lib/bridge";

const POLL_MS = 2500;
const PAGE_SIZE = 24;

type Filter = "all" | "waiting" | "running" | "succeeded" | "failed";

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "waiting", label: "Waiting" },
  { key: "running", label: "Uploading" },
  { key: "succeeded", label: "Published" },
  { key: "failed", label: "Failed" },
];

function matchesFilter(item: QueueItem, filter: Filter): boolean {
  switch (filter) {
    case "all":       return true;
    case "waiting":   return item.status === "pending" || item.status === "queued";
    case "running":   return item.status === "running";
    case "succeeded": return item.status === "succeeded";
    case "failed":    return item.status === "failed" || item.status === "skipped";
  }
}

function statusChip(status: QueueItemStatus): string {
  switch (status) {
    case "succeeded": return "chip-ok";
    case "failed":    return "chip-err";
    case "running":   return "chip-info";
    case "skipped":   return "chip-warn";
    default:          return "chip-mute";
  }
}

function statusLabel(status: QueueItemStatus): string {
  switch (status) {
    case "pending":   return "waiting";
    case "queued":    return "queued";
    case "running":   return "uploading";
    case "succeeded": return "published";
    case "failed":    return "failed";
    case "skipped":   return "skipped";
  }
}

export function UploadQueuePanel() {
  const [chromePresent, setChromePresent] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [state, setState] = useState<QueueStateData | null>(null);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  // Skip a poll while a control action is mid-flight so the refresh that action
  // triggers isn't raced by a stale in-flight read.
  const busyRef = useRef(false);

  const refresh = useCallback(async () => {
    if (!isExtensionAvailable() || !getExtensionId()) {
      setConnected(false);
      return;
    }
    try {
      const s = await fetchQueueState();
      setState(s);
      setConnected(true);
      setError(null);
    } catch (e) {
      setConnected(false);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    setChromePresent(isExtensionAvailable());
    setThumbs(getQueueThumbs());
    void refresh();

    const id = window.setInterval(() => {
      // Don't poll a hidden tab — the queue is re-read on focus anyway.
      if (document.visibilityState !== "visible" || busyRef.current) return;
      void refresh();
    }, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void refresh();
    const onQueueChanged = () => { setThumbs(getQueueThumbs()); void refresh(); };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    };
  }, [refresh]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    busyRef.current = true;
    setError(null);
    try {
      await action();
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      busyRef.current = false;
    }
  }

  /** Selection toggle is optimistic: flip the card immediately, tell the
   *  extension after. Waiting for the round-trip made every card blink as the
   *  whole grid re-rendered on the poll that followed. */
  async function toggle(itemId: string) {
    setState((prev) =>
      prev?.batch
        ? {
            ...prev,
            batch: {
              ...prev.batch,
              items: prev.batch.items.map((i) =>
                i.id === itemId ? { ...i, selected: !(i.selected !== false) } : i,
              ),
            },
          }
        : prev,
    );
    busyRef.current = true;
    try {
      await toggleQueueItem(itemId);
    } catch (e) {
      setError((e as Error).message);
      await refresh(); // put the card back the way the extension has it
    } finally {
      busyRef.current = false;
    }
  }

  const items = state?.batch?.items ?? [];
  const stats = useMemo(() => {
    const total = items.length;
    const picked = items.filter((i) => i.selected !== false).length;
    const done = items.filter((i) => i.status === "succeeded").length;
    const failed = items.filter((i) => i.status === "failed").length;
    return { total, picked, done, failed, left: Math.max(0, picked - done - failed) };
  }, [items]);

  const filtered = useMemo(() => items.filter((i) => matchesFilter(i, filter)), [items, filter]);
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pageCount - 1);
  const shown = filtered.slice(currentPage * PAGE_SIZE, currentPage * PAGE_SIZE + PAGE_SIZE);
  const progress = stats.picked > 0 ? Math.round(((stats.done + stats.failed) / stats.picked) * 100) : 0;

  if (!chromePresent) {
    return (
      <EmptyState
        title="Open this page in desktop Chrome"
        subtitle="The upload queue lives in the Higgstee extension, which needs Chrome (or Edge/Brave)."
        actionLabel="Install guide"
        actionHref="/download-extension"
      />
    );
  }

  if (connected === false) {
    // An extension built before QUEUE_STATE existed answers "unknown message
    // type" — that's an out-of-date build, not a missing connection.
    const stale = !!error && /unknown message type/i.test(error);
    return (
      <div className="space-y-3">
        <EmptyState
          title={stale ? "Extension needs updating" : "Extension not connected"}
          subtitle={
            stale
              ? "Your installed extension is an older build that can't share its queue. Update it, then reload this page."
              : "Connect the Higgstee extension to see the designs waiting to upload."
          }
          actionLabel={stale ? "Update extension" : "Connect extension"}
          actionHref={stale ? "/download-extension" : "/dashboard/extension"}
        />
        {error && <p className="text-xs text-zinc-500 text-center">{error}</p>}
      </div>
    );
  }

  if (connected === null) return <div className="text-sm text-zinc-500">Loading queue…</div>;

  if (stats.total === 0) {
    return (
      <EmptyState
        title="Nothing in the queue"
        subtitle="Create products and send them to the extension — they'll show up here."
        actionLabel="Create & Send"
        actionHref="/dashboard/create"
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Stats + progress */}
      <div className="surface p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-8 gap-y-3">
            <Stat label="Total"     value={stats.total} />
            <Stat label="Selected"  value={stats.picked}  tone="text-accent-600 dark:text-accent-400" />
            <Stat label="Published" value={stats.done}    tone="text-success-600 dark:text-success-500" />
            <Stat label="Failed"    value={stats.failed}  tone="text-danger-600 dark:text-danger-500" />
            <Stat label="Left"      value={stats.left} />
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy} onClick={() => run(() => startQueue())}>
              ▶ Start
            </button>
            <button className="btn-ghost" disabled={busy} onClick={() => run(() => pauseQueue())}>
              ❚❚ Pause
            </button>
          </div>
        </div>

        <div className="mt-4 h-1.5 w-full rounded-full bg-ink-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-accent-500 transition-[width] duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
        <p className="mt-2 text-xs text-zinc-500">
          {state?.batch?.source.spreadsheetName} • {stats.picked} of {stats.total} selected •{" "}
          {state?.paused ? "paused" : state?.engine === "running" ? "uploading" : "idle"}
        </p>
      </div>

      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}

      {/* Filters + selection controls */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-1.5">
          {FILTERS.map((f) => {
            const count = items.filter((i) => matchesFilter(i, f.key)).length;
            const active = filter === f.key;
            return (
              <button
                key={f.key}
                onClick={() => { setFilter(f.key); setPage(0); }}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                  active
                    ? "bg-accent-500/15 text-accent-600 dark:text-accent-400 border-accent-500/40"
                    : "bg-ink-800 text-zinc-500 border-ink-700 hover:text-zinc-300"
                }`}
              >
                {f.label} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={busy} onClick={() => run(() => selectAllQueueItems(true))}>
            Select all
          </button>
          <button className="btn-ghost" disabled={busy} onClick={() => run(() => selectAllQueueItems(false))}>
            Deselect all
          </button>
          <button
            className="btn-danger"
            disabled={busy}
            onClick={() => {
              if (confirm("Clear the queue? Any pending uploads will be discarded.")) {
                void run(() => clearQueue());
              }
            }}
          >
            Clear queue
          </button>
        </div>
      </div>

      {/* Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {shown.map((item) => {
          const selected = item.selected !== false;
          const thumb = thumbs[item.id];
          return (
            <div
              key={item.id}
              onClick={() => void toggle(item.id)}
              className={`surface p-3 cursor-pointer transition ${
                selected ? "ring-1 ring-accent-500/50" : "opacity-60 hover:opacity-100"
              }`}
            >
              <div className="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={thumb} alt="" className="h-full w-full object-contain" />
                ) : (
                  <div className="h-full w-full grid place-items-center text-2xl text-zinc-600">🖼</div>
                )}
                <span
                  className={`absolute top-2 left-2 h-5 w-5 rounded grid place-items-center text-xs font-bold ${
                    selected ? "bg-accent-500 text-black" : "bg-black/50 text-transparent border border-white/30"
                  }`}
                >
                  ✓
                </span>
                <span className={`${statusChip(item.status)} absolute bottom-2 right-2`}>
                  {statusLabel(item.status)}
                </span>
              </div>

              <p className="mt-2.5 text-sm font-medium text-zinc-900 dark:text-zinc-100 truncate">
                {item.metadata.title || "Untitled"}
              </p>
              <p className="text-xs text-zinc-500 truncate">
                {item.metadata.filename}
                {item.attempts > 0 && ` • try ${item.attempts}`}
              </p>

              {item.metadata.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {item.metadata.tags.slice(0, 3).map((t) => (
                    <span key={t} className="chip-mute text-[10px]">{t}</span>
                  ))}
                </div>
              )}

              {item.lastError && (
                <p className="mt-2 text-[11px] text-danger-600 dark:text-danger-500 line-clamp-2">
                  {item.lastError}
                </p>
              )}

              {(item.status === "failed" || item.publishedUrl) && (
                <div className="mt-2.5 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  {item.status === "failed" && (
                    <button
                      className="btn-ghost text-xs px-2.5 py-1"
                      disabled={busy}
                      onClick={() => run(() => retryQueueItem(item.id))}
                    >
                      Retry
                    </button>
                  )}
                  {item.publishedUrl && (
                    <a
                      className="btn-ghost text-xs px-2.5 py-1"
                      href={item.publishedUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {filtered.length === 0 && (
        <p className="text-sm text-zinc-500 text-center py-6">No designs in this view.</p>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-3 text-sm">
          <button className="btn-ghost" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>
            ‹ Prev
          </button>
          <span className="text-zinc-500">
            Page {currentPage + 1} / {pageCount}
          </span>
          <button
            className="btn-ghost"
            disabled={currentPage >= pageCount - 1}
            onClick={() => setPage(currentPage + 1)}
          >
            Next ›
          </button>
        </div>
      )}

      <p className="text-xs text-zinc-500 text-center">
        Live from the extension — refreshes every {POLL_MS / 1000}s. Click a design to select or deselect it.
      </p>
    </div>
  );
}

function Stat({ label, value, tone = "text-zinc-900 dark:text-zinc-100" }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`text-xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

export default UploadQueuePanel;
