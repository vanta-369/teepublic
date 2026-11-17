"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { clearPendingCanvaExport, getPendingCanvaExport, importCanvaPages } from "@/lib/canvaImport";

interface Props {
  title: string;
  hint: string;
  accept: string;
  multiple?: boolean;
  badge?: string;
  canvaImport?: boolean;
  onFiles: (files: File[]) => void | Promise<void>;
  /** "hero": the big glowing upload used by Create Product's first step. */
  variant?: "card" | "hero";
  /** Hero only: dimmed and inert (no click, no drop) - e.g. until a project is chosen. */
  disabled?: boolean;
}

export function Dropzone({ title, hint, accept, multiple, badge, canvaImport, onFiles, variant = "card", disabled = false }: Props) {
  const [active, setActive] = useState(false);
  const [showCanva, setShowCanva] = useState(false);
  const [canvaSource, setCanvaSource] = useState<{ url: string; title: string } | null>(null);
  const [canvaBusy, setCanvaBusy] = useState(false);
  const [canvaError, setCanvaError] = useState<string | null>(null);
  const [canvaCount, setCanvaCount] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!canvaImport) return;
    try {
      const source = getPendingCanvaExport();
      if (source) {
        setCanvaSource(source);
        setShowCanva(true);
      }
    } catch {
      setShowCanva(true);
      setCanvaError("Invalid Canva export. Send the pages again from the Higgstee Canva app.");
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, [canvaImport]);

  async function grabCanvaPages() {
    if (!canvaSource || canvaBusy) return;
    setCanvaBusy(true);
    setCanvaError(null);
    try {
      const files = await importCanvaPages(canvaSource);
      await onFiles(files);
      setCanvaCount(files.length);
      clearPendingCanvaExport();
      setCanvaSource(null);
    } catch (error) {
      setCanvaError(error instanceof Error ? error.message : "Could not import Canva pages.");
    } finally {
      setCanvaBusy(false);
    }
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setActive(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length) onFiles(files);
  }, [onFiles]);

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple={multiple}
      className="hidden"
      onChange={(e) => {
        const files = Array.from(e.target.files ?? []);
        if (files.length) onFiles(files);
        e.target.value = "";
      }}
    />
  );
  const canvaPanel = canvaImport && showCanva && (
    <div className="surface-soft p-4 space-y-3 text-left">
      <p className="text-sm text-zinc-700 dark:text-zinc-200">
        Open your multi-page design in Canva, then open the Higgstee Canva app.
        Choose PNG and all pages in its export panel, then send the pages here.
        Each page becomes a separate design without saving a file to Downloads.
      </p>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        {canvaSource ? `Ready to import: ${canvaSource.title}` :
          "The Higgstee Canva app must be registered and configured before this connection can be used."}
      </p>
      <div className="flex flex-wrap gap-2">
        <a className="btn-ghost text-sm" href="https://www.canva.com/" target="_blank" rel="noopener noreferrer">
          Open Canva
        </a>
        <button type="button" className="btn-primary text-sm" disabled={!canvaSource || canvaBusy} onClick={grabCanvaPages}>
          {canvaBusy ? "Grabbing pages..." : "Grab all exported pages"}
        </button>
      </div>
      {canvaError && <p role="alert" className="text-sm text-danger-600 dark:text-danger-500">{canvaError}</p>}
      {canvaCount > 0 && <p role="status" className="text-sm">Imported {canvaCount} Canva pages.</p>}
    </div>
  );

  if (variant === "hero") {
    return (
      <div>
        <h2 className="cp-hero-title">{title}<span>to start</span></h2>
        <div
          className="cp-glow"
          data-active={active ? "1" : undefined}
          data-disabled={disabled ? "1" : undefined}
          role="button"
          tabIndex={disabled ? -1 : 0}
          aria-disabled={disabled}
          onClick={() => { if (!disabled) inputRef.current?.click(); }}
          onKeyDown={(e) => { if (!disabled && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); inputRef.current?.click(); } }}
          onDragOver={(e) => { e.preventDefault(); if (!disabled) setActive(true); }}
          onDragLeave={() => setActive(false)}
          onDrop={(e) => { if (disabled) { e.preventDefault(); return; } onDrop(e); }}
        >
          {fileInput}
          <div className="cp-glow-icon" aria-hidden>
            <svg viewBox="0 0 24 24" className="h-7 w-7" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 16V4M8 8l4-4 4 4" /><path d="M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
            </svg>
          </div>
          <h3>Add designs to upload</h3>
          <p>{hint} <u>browse</u></p>
          <span className="cp-pill">Select files</span>
        </div>
        {canvaImport && !disabled && (
          <div className="mt-4 max-w-[760px] space-y-3">
            <button type="button" className="cp-link" aria-expanded={showCanva} onClick={() => setShowCanva((s) => !s)}>
              or grab pages from Canva
            </button>
            {canvaPanel}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="surface p-5">
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-semibold tracking-tight">{title}</h3>
        {badge && <span className="chip-info">{badge}</span>}
      </div>
      {canvaImport && (
        <div className="mb-3 space-y-3">
          <button
            type="button"
            className="btn-ghost text-sm"
            aria-expanded={showCanva}
            onClick={() => setShowCanva((shown) => !shown)}
          >
            Grab pages from Canva
          </button>
          {canvaPanel}
        </div>
      )}
      <div
        className={clsx("dropzone", active && "dropzone-active")}
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => { e.preventDefault(); setActive(true); }}
        onDragLeave={() => setActive(false)}
        onDrop={onDrop}
      >
        {fileInput}
        <div className="text-sm text-zinc-700 dark:text-zinc-200 font-medium">Drop files here, or click to browse</div>
        <div className="text-xs text-zinc-400 mt-1">{hint}</div>
      </div>
    </div>
  );
}
