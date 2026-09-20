"use client";

// Staging area on the Uploads page: assemble the designs you want to publish
// HERE, then push them to the extension. Sources are your saved products or a
// batch file exported from the extension's queue page (same format, both ways).
//
// Staged designs live in memory for this page visit — Send or Export is what
// makes them durable. Titles can be edited one by one or across the whole
// selection before anything leaves the dashboard.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import type { QueueBatch, QueueItem } from "@teepublic/shared";
import { EmptyState } from "@/components/dashboard/DashBits";
import type { PersistedDesign } from "@/lib/designsStore";
import {
  loadDesigns,
  getDesignImageDataUrl,
  getDesignImageObjectUrl,
} from "@/lib/designsStore";
import { buildExportChunks, downloadExportChunks, importExportFilesToLocal } from "@/lib/batchTransfer";
import { getExtensionId, isExtensionAvailable, sendQueueToExtension } from "@/lib/bridge";

/** Fired after a successful send so the live queue panel re-reads immediately. */
export const QUEUE_CHANGED_EVENT = "higgstee:queue-changed";

type TitleOp = "set" | "prefix" | "suffix" | "replace";

const TITLE_OPS: { key: TitleOp; label: string; hint: string }[] = [
  { key: "set",     label: "Set to",       hint: "Replace every selected title with this text" },
  { key: "prefix",  label: "Add before",   hint: "Put this text in front of every selected title" },
  { key: "suffix",  label: "Add after",    hint: "Put this text after every selected title" },
  { key: "replace", label: "Find/replace", hint: "Replace text inside every selected title" },
];

function designToItem(d: PersistedDesign): QueueItem {
  const now = Date.now();
  return {
    id: d.id || nanoid(10),
    metadata: {
      filename: d.serverFilename || d.originalName || "",
      title: d.listing?.title ?? "",
      description: d.listing?.description ?? "",
      primaryTag: d.listing?.primaryTag || undefined,
      tags: d.listing?.tags ?? [],
      matureContent: d.listing?.matureContent ?? false,
      productColors: { ...(d.config?.productColors ?? {}) },
      enabledProducts: [...(d.config?.enabledProducts ?? [])],
    },
    // Artwork is not carried on the item: it is read from this device's
    // IndexedDB by id at the moment it is sent or exported.
    imageUrl: "",
    imageMime: d.mime,
    imageSizeBytes: d.size,
    status: "pending",
    selected: true,
    attempts: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function UploadStagePanel() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const [showTitleTools, setShowTitleTools] = useState(false);
  const [titleOp, setTitleOp] = useState<TitleOp>("prefix");
  const [titleValue, setTitleValue] = useState("");
  const [titleFind, setTitleFind] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  // Preview URLs over the Blobs in this device's IndexedDB, keyed by item id.
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  const selected = useMemo(() => items.filter((i) => i.selected !== false), [items]);
  const stagedIds = useMemo(() => items.map((i) => i.id).join(","), [items]);

  // Artwork for the staged tiles. Object URLs are revoked when the staged set
  // changes, so editing a long list does not leak a blob per design.
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next: Record<string, string> = {};
      for (const id of stagedIds ? stagedIds.split(",") : []) {
        const url = await getDesignImageObjectUrl(id).catch(() => null);
        if (url) { next[id] = url; created.push(url); }
      }
      if (cancelled) { created.forEach(URL.revokeObjectURL); return; }
      setThumbs(next);
    })();
    return () => {
      cancelled = true;
      created.forEach(URL.revokeObjectURL);
    };
  }, [stagedIds]);
  const untitled = useMemo(() => selected.filter((i) => !i.metadata.title.trim()).length, [selected]);

  const merge = useCallback((incoming: QueueItem[]) => {
    setItems((prev) => {
      const byId = new Map(prev.map((i) => [i.id, i]));
      // Keep the staged copy on collision: it may carry unsent title edits.
      for (const it of incoming) if (!byId.has(it.id)) byId.set(it.id, it);
      return [...byId.values()];
    });
  }, []);

  async function run(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError(null);
    setNotice(null);
    try {
      await action();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  function loadMyDesigns() {
    return run("load", async () => {
      const designs = await loadDesigns();
      if (designs.length === 0) {
        setNotice("You have no saved products yet — create some first.");
        return;
      }
      merge(designs.map(designToItem));
      setNotice(`Loaded ${designs.length} product(s).`);
    });
  }

  function onImportFiles(ev: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(ev.target.files ?? []);
    ev.target.value = ""; // allow re-importing the same files
    if (files.length === 0) return;
    void run("import", async () => {
      // An export file inlines each design's artwork; the import moves it into
      // this device's IndexedDB and hands back metadata-only items.
      const { items: staged, errors } = await importExportFilesToLocal(files);
      merge(staged);
      const summary = `Imported ${staged.length} design(s) from ${files.length} file(s).`;
      if (errors.length) setError(`${summary} Skipped: ${errors.join("; ")}`);
      else setNotice(summary);
    });
  }

  function exportStaged() {
    return run("export", async () => {
      const batch = toBatch(items, "staged export");
      const chunks = await buildExportChunks(batch, undefined, (item) =>
        getDesignImageDataUrl(item.id),
      );
      await downloadExportChunks(chunks);
      setNotice(
        chunks.length > 1
          ? `Exported ${chunks.length} files (30 designs each). Import ALL of them to rebuild the batch.`
          : "Exported 1 file.",
      );
    });
  }

  function sendToExtension() {
    return run("send", async () => {
      if (!isExtensionAvailable() || !getExtensionId()) {
        throw new Error("Extension isn't connected — connect it on the Extension page first.");
      }
      if (selected.length === 0) throw new Error("Select at least one design to send.");
      if (untitled > 0) throw new Error(`${untitled} selected design(s) have no title — set one first.`);
      await sendQueueToExtension(
        toBatch(selected, `Uploads (${selected.length})`),
        undefined,
        (item) => getDesignImageDataUrl(item.id),
      );
      setNotice(`Sent ${selected.length} design(s) to the extension. Start the run below.`);
      window.dispatchEvent(new CustomEvent(QUEUE_CHANGED_EVENT));
    });
  }

  function toggle(id: string) {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, selected: !(i.selected !== false) } : i)));
  }
  function setAllSelected(value: boolean) {
    setItems((prev) => prev.map((i) => ({ ...i, selected: value })));
  }
  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  function saveTitle(id: string) {
    const title = draftTitle.trim();
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, metadata: { ...i.metadata, title }, updatedAt: Date.now() } : i)),
    );
    setEditingId(null);
  }

  /** Bulk title edit — applies to the SELECTED designs only. */
  function applyTitleOp() {
    if (selected.length === 0) {
      setError("Select the designs you want to retitle first.");
      return;
    }
    if (titleOp === "replace" ? !titleFind : !titleValue) {
      setError(titleOp === "replace" ? "Enter the text to find." : "Enter the text to apply.");
      return;
    }
    setError(null);
    const ids = new Set(selected.map((i) => i.id));
    setItems((prev) =>
      prev.map((i) => {
        if (!ids.has(i.id)) return i;
        const old = i.metadata.title;
        const title =
          titleOp === "set"     ? titleValue
          : titleOp === "prefix" ? `${titleValue}${old}`
          : titleOp === "suffix" ? `${old}${titleValue}`
          : old.split(titleFind).join(titleValue); // replace, literal (no regex surprises)
        return { ...i, metadata: { ...i.metadata, title }, updatedAt: Date.now() };
      }),
    );
    setNotice(`Updated ${selected.length} title(s).`);
  }

  const working = busy !== null;

  return (
    <div className="surface p-5 space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="font-semibold text-zinc-900 dark:text-zinc-100">Designs to upload</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Stage them here, fix the titles, then send the batch to the extension.
            {items.length > 0 && ` ${selected.length} of ${items.length} selected.`}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-ghost" disabled={working} onClick={loadMyDesigns}>
            {busy === "load" ? "Loading…" : "Load my products"}
          </button>
          <button className="btn-ghost" disabled={working} onClick={() => fileInput.current?.click()}>
            {busy === "import" ? "Importing…" : "⤒ Import"}
          </button>
          <button className="btn-ghost" disabled={working || items.length === 0} onClick={exportStaged}>
            {busy === "export" ? "Exporting…" : "⤓ Export"}
          </button>
          <button className="btn-primary" disabled={working || selected.length === 0} onClick={sendToExtension}>
            {busy === "send" ? "Sending…" : `Send to extension${selected.length ? ` (${selected.length})` : ""}`}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            multiple
            hidden
            onChange={onImportFiles}
          />
        </div>
      </div>

      {error && <div className="chip-err w-full justify-center py-2">{error}</div>}
      {notice && !error && <div className="chip-info w-full justify-center py-2">{notice}</div>}

      {items.length === 0 ? (
        <EmptyState
          title="Nothing staged yet"
          subtitle="Load your saved products, or import a batch file exported from the extension."
          actionLabel="Create Product"
          actionHref="/dashboard/create"
        />
      ) : (
        <>
          {/* Selection + title tools */}
          <div className="flex items-center justify-between gap-3 flex-wrap border-t border-ink-700 pt-4">
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={() => setAllSelected(true)}>Select all</button>
              <button className="btn-ghost" onClick={() => setAllSelected(false)}>Deselect all</button>
              <button className="btn-ghost" onClick={() => setItems([])}>Clear staged</button>
            </div>
            <button className="btn-ghost" onClick={() => setShowTitleTools((v) => !v)}>
              ✎ Change titles {showTitleTools ? "▲" : "▼"}
            </button>
          </div>

          {showTitleTools && (
            <div className="surface-soft p-4 space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {TITLE_OPS.map((op) => (
                  <button
                    key={op.key}
                    title={op.hint}
                    onClick={() => setTitleOp(op.key)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                      titleOp === op.key
                        ? "bg-accent-500/15 text-accent-600 dark:text-accent-400 border-accent-500/40"
                        : "bg-ink-800 text-zinc-500 border-ink-700 hover:text-zinc-300"
                    }`}
                  >
                    {op.label}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                {titleOp === "replace" && (
                  <input
                    className="input flex-1 min-w-[10rem]"
                    placeholder="Find this text"
                    value={titleFind}
                    onChange={(e) => setTitleFind(e.target.value)}
                  />
                )}
                <input
                  className="input flex-1 min-w-[10rem]"
                  placeholder={titleOp === "replace" ? "Replace with (blank = delete)" : "Text"}
                  value={titleValue}
                  onChange={(e) => setTitleValue(e.target.value)}
                />
                <button className="btn-primary" onClick={applyTitleOp}>
                  Apply to {selected.length} selected
                </button>
              </div>
              <p className="text-xs text-zinc-500">
                {TITLE_OPS.find((o) => o.key === titleOp)?.hint}. Only selected designs change — click a
                card&apos;s title to edit just that one.
              </p>
            </div>
          )}

          {untitled > 0 && (
            <div className="chip-warn w-full justify-center py-2">
              {untitled} selected design(s) still have no title — TeePublic needs one.
            </div>
          )}

          {/* Staged grid */}
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {items.map((item) => {
              const isSelected = item.selected !== false;
              const isEditing = editingId === item.id;
              return (
                <div
                  key={item.id}
                  className={`surface p-3 transition ${
                    isSelected ? "ring-1 ring-accent-500/50" : "opacity-60 hover:opacity-100"
                  }`}
                >
                  <div
                    className="relative aspect-square rounded-lg overflow-hidden bg-ink-800 border border-ink-700 cursor-pointer"
                    onClick={() => toggle(item.id)}
                  >
                    {thumbs[item.id] ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumbs[item.id]} alt="" className="h-full w-full object-contain" />
                    ) : (
                      <div className="h-full w-full grid place-items-center text-2xl text-zinc-600">🖼</div>
                    )}
                    <span
                      className={`absolute top-2 left-2 h-5 w-5 rounded grid place-items-center text-xs font-bold ${
                        isSelected ? "bg-accent-500 text-black" : "bg-black/50 text-transparent border border-white/30"
                      }`}
                    >
                      ✓
                    </span>
                  </div>

                  {isEditing ? (
                    <div className="mt-2.5 space-y-2">
                      <input
                        autoFocus
                        className="input"
                        value={draftTitle}
                        onChange={(e) => setDraftTitle(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveTitle(item.id);
                          if (e.key === "Escape") setEditingId(null);
                        }}
                      />
                      <div className="flex gap-2">
                        <button className="btn-primary text-xs px-2.5 py-1" onClick={() => saveTitle(item.id)}>
                          Save
                        </button>
                        <button className="btn-ghost text-xs px-2.5 py-1" onClick={() => setEditingId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      className="mt-2.5 w-full text-left group"
                      title="Click to edit this title"
                      onClick={() => { setEditingId(item.id); setDraftTitle(item.metadata.title); }}
                    >
                      <p
                        className={`text-sm font-medium truncate group-hover:text-accent-500 ${
                          item.metadata.title
                            ? "text-zinc-900 dark:text-zinc-100"
                            : "text-danger-600 dark:text-danger-500"
                        }`}
                      >
                        {item.metadata.title || "No title — click to add"} <span className="opacity-40">✎</span>
                      </p>
                    </button>
                  )}

                  <p className="text-xs text-zinc-500 truncate mt-0.5">{item.metadata.filename}</p>

                  <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {item.metadata.tags.slice(0, 2).map((t) => (
                        <span key={t} className="chip-mute text-[10px]">{t}</span>
                      ))}
                    </div>
                    <button
                      className="text-xs text-zinc-500 hover:text-danger-500 shrink-0"
                      title="Remove from this batch"
                      onClick={() => removeItem(item.id)}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          <p className="text-xs text-zinc-500">
            Staged designs are kept for this page visit only — Send or Export before you reload.
          </p>
        </>
      )}
    </div>
  );
}

function toBatch(items: QueueItem[], name: string): QueueBatch {
  return {
    id: nanoid(12),
    createdAt: Date.now(),
    items,
    source: { spreadsheetName: name, rowCount: items.length, matchedCount: items.length },
  };
}

export default UploadStagePanel;
