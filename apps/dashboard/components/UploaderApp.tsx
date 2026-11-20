"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { nanoid } from "nanoid";
import { parseSpreadsheet, stemName, type ParsedRow } from "@/lib/parser";
import { applySheetRows, syncRowsToImages, syncCellsFromMetadata, sheetIssues, createPhase } from "@/lib/listingSheet";
import { validateRows, type ValidationResult } from "@/lib/validator";
import { buildQueue, type MatchedImage } from "@/lib/queue";
import { sendQueueToExtension } from "@/lib/bridge";
import type { QueueBatch } from "@teepublic/shared";
import { Dropzone } from "./Dropzone";
import { DesignCard } from "./DesignCard";
import { ListingsView } from "./ListingSheet";
import { GenerationApp } from "./GenerationApp";
import type { DesignMetadata } from "@teepublic/shared";
import { loadCustomBasicColors, saveCustomBasicColors, type CustomBasicColor } from "@/lib/batchConfig";
import { applyBasicColor } from "@/lib/colorPresets";
import { enforceAdultRule } from "@/lib/productGroups";
import { ColorRun } from "./ColorRun";
import { ProjectPicker } from "./ProjectPicker";
import { clearChosenProjectId, createProject, deleteProject, getChosenProjectId, renameProject, listProjects, setChosenProjectId, type Project } from "@/lib/projects";
import {
  loadSpreadsheet,
  saveSpreadsheet,
  clearSpreadsheet,
  saveSheetImage,
  sheetImageKey,
  getSheetImageDataUrl,
  getSheetImageObjectUrl,
} from "@/lib/spreadsheetStore";
import { safeSegment } from "@/lib/localImages";
import { expandDroppedFiles } from "@/lib/zip";

type Stage = "idle" | "validated" | "sending" | "sent";
type Mode  = "spreadsheet" | "generate";

export function UploaderApp() {
  const [sessionId] = useState(() => nanoid(10));
  const [mode, setMode] = useState<Mode>("spreadsheet");
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [spreadsheetName, setSpreadsheetName] = useState<string>("");
  // Images keyed by STEM (lowercased, extensionless) so "1" matches "1.png".
  const [images, setImages] = useState<Map<string, MatchedImage>>(new Map());
  // Object URLs over the Blobs in IndexedDB, keyed by stem. Rebuilt whenever
  // the matched set changes and revoked on the way out, so a long editing
  // session never leaks one blob per image it has ever previewed.
  const [previewUrls, setPreviewUrls] = useState<Map<string, string>>(new Map());
  // Bumped on every drop: a new batch can reuse old names (a new 30.png), and the
  // previews must reload even though the set of stems didn't change.
  const [dropGen, setDropGen] = useState(0);
  // Table problems stay hidden until the first Save (or Send) attempt; after
  // that they're shown live until fixed. A new drop hides them again.
  const [saveTried, setSaveTried] = useState(false);
  const [validation, setValidation] = useState<ValidationResult | null>(null);
  const [stage, setStage] = useState<Stage>("idle");
  const [error, setError] = useState<string | null>(null);
  // Becomes true once the saved spreadsheet batch has loaded, so the autosave
  // effect doesn't overwrite it with the empty initial state.
  const [hydrated, setHydrated] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  // The listings table opens in its own full-screen view after images arrive;
  // it stays open until the user closes it, and the card below reopens it.
  const [listingsOpen, setListingsOpen] = useState(false);
  // Custom basic-color swatches — shared with the AI-generate flow via the
  // same localStorage key, so colors added on either page show up on both.
  const [customBasicColors, setCustomBasicColors] = useState<CustomBasicColor[]>([]);
  useEffect(() => { setCustomBasicColors(loadCustomBasicColors()); }, []);
  const customColorsLoaded = useRef(false);
  useEffect(() => {
    if (!customColorsLoaded.current) { customColorsLoaded.current = true; return; }
    saveCustomBasicColors(customBasicColors);
  }, [customBasicColors]);
  function addCustomBasicColor(c: CustomBasicColor) {
    setCustomBasicColors((prev) => prev.find((x) => x.name === c.name) ? prev : [...prev, c]);
  }
  function removeCustomBasicColor(name: string) {
    setCustomBasicColors((prev) => prev.filter((x) => x.name !== name));
  }

  function revalidate(nextRows = rows, nextImages = images) {
    if (nextRows.length === 0) {
      setValidation(null);
      return;
    }
    const stems = new Set([...nextImages.keys()]);
    const result = validateRows(nextRows, stems);
    setValidation(result);
    setStage("validated");
  }

  // Load the user's saved spreadsheet batch once on mount so their work follows
  // their account across browsers/devices.
  useEffect(() => {
    (async () => {
      try {
        const batch = await loadSpreadsheet();
        if (batch && (batch.rows.length > 0 || batch.images.length > 0)) {
          const map = new Map(batch.images.map((i) => [i.stem, i]));
          const tableRows = syncRowsToImages(batch.rows, map);
          setSpreadsheetName(batch.spreadsheetName);
          setRows(tableRows);
          setImages(map);
          revalidate(tableRows, map);
        }
      } catch (e) {
        console.warn("loadSpreadsheet failed", e); // non-fatal: start empty
      } finally {
        setHydrated(true);
      }
    })();
  }, []);

  // Previews for whatever is currently matched, straight from local storage.
  const imageKeys = useMemo(() => [...images.keys()].sort().join("\0"), [images]);
  useEffect(() => {
    let cancelled = false;
    const created: string[] = [];
    (async () => {
      const next = new Map<string, string>();
      for (const stem of imageKeys ? imageKeys.split("\0") : []) {
        const url = await getSheetImageObjectUrl(stem).catch(() => null);
        if (url) { next.set(stem, url); created.push(url); }
      }
      if (cancelled) { created.forEach(URL.revokeObjectURL); return; }
      setPreviewUrls(next);
    })();
    return () => {
      cancelled = true;
      created.forEach(URL.revokeObjectURL);
    };
  }, [imageKeys, dropGen]);

  // Save the current batch to THIS DEVICE on demand (the Save button), not
  // automatically. Nothing here is sent anywhere: the rows and the artwork go
  // into IndexedDB (lib/spreadsheetStore.ts) and stay in this browser.
  const [importStage, setImportStage] = useState<"idle" | "saving" | "saved">("idle");
  // Every column filled, adult content yes/no, filename = its design image -
  // anything else blocks Save and Send (shown in the table and on this page).
  const issues = useMemo(() => sheetIssues(rows, new Set(images.keys())), [rows, images]);
  const blockedMsg = issues.length > 0
    ? `Fix the listings table first: ${issues.length} problem${issues.length === 1 ? "" : "s"} (empty columns or wrong values, shown in red).`
    : null;
  async function saveToDevice() {
    if (blockedMsg) {
      setSaveTried(true);
      // In the listings view the issues panel says it; the page needs the line.
      if (!listingsOpen) setError(blockedMsg);
      return;
    }
    setError(null);
    setImportStage("saving");
    try {
      await saveSpreadsheet({ spreadsheetName, rows, images: [...images.values()] });
      setImportStage("saved");
    } catch (e) {
      setError(`Save failed: ${(e as Error).message}`);
      setImportStage("idle");
    }
  }
  // Any edit invalidates the "saved" indicator.
  useEffect(() => { if (hydrated) setImportStage("idle"); }, [rows, images, spreadsheetName, hydrated]);

  /** Rows from dropped listings spreadsheets (.xlsx / .csv), all sheets' rows together. */
  async function readSheets(sheets: File[]): Promise<ParsedRow[] | null> {
    if (sheets.length === 0) return null;
    const out: ParsedRow[] = [];
    for (const f of sheets) {
      try { out.push(...(await parseSpreadsheet(f))); }
      catch (e) { setError(`Could not read ${safeSegment(f.name)}: ${(e as Error).message}`); }
    }
    return out;
  }

  async function handleImages(rawFiles: File[]) {
    setError(null);
    // Expand any dropped .zip. Images are the designs; an .xlsx / .csv dropped
    // with them fills their listings (matched by filename), so the listings
    // table is skipped when every design has one. Either way it stays editable.
    const { images: imgFiles, sheets } = await expandDroppedFiles(rawFiles);
    const sheetRows = await readSheets(sheets);

    // Only a listings file, onto the designs already here.
    if (imgFiles.length === 0) {
      if (!sheetRows || images.size === 0) {
        if (sheetRows) setError("Add the designs first (or drop them together with the listings file).");
        return;
      }
      const nextRows = applySheetRows(rows, sheetRows, images);
      const matched = sheetRows.filter((r) => images.has(stemName(r.metadata.filename))).length;
      if (matched === 0) setError("No row in that file matches a design's filename (e.g. 1 or 1.png for 1.png).");
      setRows(nextRows);
      revalidate(nextRows, images);
      return;
    }

    // A new drop is a new batch: the previous designs, their listings and the
    // copy saved on this device are discarded, not merged with the new work.
    try { await clearSpreadsheet(); } catch (e) { console.warn("clearSpreadsheet failed", e); }
    setCurrentIndex(0);
    setStage("idle");
    const next = new Map<string, MatchedImage>();
    for (const file of imgFiles) {
      try {
        const stem = stemName(file.name);
        // Bytes go straight into this device's IndexedDB. The batch record
        // keeps only the key that points at them.
        await saveSheetImage(stem, file);
        next.set(stem, {
          stem,
          originalName: file.name,
          imageKey: sheetImageKey(stem),
          mime: file.type || "image/png",
          size: file.size,
        });
      } catch (e) {
        setError(`Could not store ${safeSegment(file.name)} on this device: ${(e as Error).message}`);
      }
    }
    // One table row per image, numbered in filename order - all fresh, or
    // filled from the listings file when one came with them.
    const nextRows = sheetRows ? applySheetRows([], sheetRows, next) : syncRowsToImages([], next);
    setDropGen((g) => g + 1);
    setSaveTried(false);
    setImages(next);
    setRows(nextRows);
    revalidate(nextRows, next);
    // With a listings file, go straight on (the table opens only if something
    // is missing - the listings step shows then).
    if (!sheetRows) setListingsOpen(true);
  }

  function removeImage(stem: string) {
    const next = new Map(images);
    next.delete(stem);
    const nextRows = syncRowsToImages(rows, next);
    setImages(next);
    setRows(nextRows);
    revalidate(nextRows, next);
  }

  /** Delete rows in the listings table = drop those designs from the batch. */
  function removeImages(stems: string[]) {
    const next = new Map(images);
    for (const stem of stems) next.delete(stem);
    const nextRows = syncRowsToImages(rows, next);
    setImages(next);
    setRows(nextRows);
    revalidate(nextRows, next);
  }

  function updateRowMetadata(rowNumber: number, metadata: DesignMetadata) {
    // Keep the table cells in line with what the design card edited.
    const nextRows = rows.map((r) => (r.rowNumber === rowNumber ? syncCellsFromMetadata({ ...r, metadata }) : r));
    setRows(nextRows);
    revalidate(nextRows, images);
  }

  /** Copy the source row's productColors onto every OTHER row in the batch.
   *  Leaves each row's enabledProducts + listing metadata alone. */
  function applyColorsToAllRows(sourceRowNumber: number) {
    const src = rows.find((r) => r.rowNumber === sourceRowNumber);
    if (!src) return;
    const nextRows = rows.map((r) =>
      r.rowNumber === sourceRowNumber
        ? r
        : { ...r, metadata: { ...r.metadata, productColors: { ...src.metadata.productColors } } }
    );
    setRows(nextRows);
    revalidate(nextRows, images);
  }

  /** Copy the source row's enabledProducts onto every OTHER row in the batch.
   *  Colors are left alone. */
  function applyProductsToAllRows(sourceRowNumber: number) {
    const src = rows.find((r) => r.rowNumber === sourceRowNumber);
    if (!src) return;
    const nextRows = rows.map((r) =>
      r.rowNumber === sourceRowNumber
        ? r
        // Adult designs still never get Kids products.
        : { ...r, metadata: enforceAdultRule({ ...r.metadata, enabledProducts: [...src.metadata.enabledProducts] }) }
    );
    setRows(nextRows);
    revalidate(nextRows, images);
  }

  async function handleStartUpload() {
    setError(null);
    if (blockedMsg) { setSaveTried(true); setError(blockedMsg); return; }
    if (!validation) return;
    setStage("sending");
    try {
      const batch: QueueBatch = buildQueue(
        validation.validRows,
        images,
        { spreadsheetName: spreadsheetName || "Create Product table", rowCount: rows.length },
      );
      // The project's count goes up with each design the extension publishes.
      if (chosenProject) batch.projectId = chosenProject;
      // Send the queue to the extension only - the user picks which designs
      // to upload in the popup, then clicks Start there. Artwork is read out of
      // local storage one design at a time and sent in its own message, so a
      // big batch never exceeds Chrome's 64 MiB per-message limit and never
      // passes through a Higgstee server.
      await sendQueueToExtension(batch, undefined, (item) =>
        getSheetImageDataUrl(stemName(item.metadata.filename)),
      );
      setStage("sent");
    } catch (e) {
      setError((e as Error).message);
      setStage("validated");
    }
  }

  // Create Product shows one step at a time: upload -> listings -> configure.
  const phase = createPhase(images.size, issues.length);
  const replaceRef = useRef<HTMLInputElement>(null);
  /** The design card whose listing is open in the grid (one at a time). */
  const [openCard, setOpenCard] = useState<number | null>(null);
  /** "Select colors" pass: index of the design being coloured, or null. */
  const [colorRun, setColorRun] = useState<number | null>(null);

  // Projects (one per TeePublic account). The chosen one is remembered in this
  // browser profile; designs can only be dropped once one is chosen.
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [projectsError, setProjectsError] = useState<string | null>(null);
  const [chosenProject, setChosenProject] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [list, chosen] = await Promise.all([listProjects(), getChosenProjectId()]);
        if (cancelled) return;
        setProjects(list);
        setChosenProject(list.some((p) => p.id === chosen) ? chosen : null);
      } catch (e) {
        if (!cancelled) setProjectsError((e as Error).message);
      }
    })();
    return () => { cancelled = true; };
  }, []);
  const chooseProject = (id: string) => { setChosenProject(id); void setChosenProjectId(id); };
  const renameChosen = async (id: string, name: string) => {
    await renameProject(id, name);
    setProjects((list) => list?.map((p) => (p.id === id ? { ...p, name: name.trim() } : p)) ?? list);
  };
  const deleteChosen = async (id: string) => {
    await deleteProject(id);
    setProjects((list) => list?.filter((p) => p.id !== id) ?? list);
    if (chosenProject === id) setChosenProject(null);
  };
  const chosenName = projects?.find((p) => p.id === chosenProject)?.name ?? null;
  const projectChip = chosenName && (
    <span className="rounded-full bg-accent-500/15 px-3 py-1 text-xs font-semibold text-accent-600 dark:text-accent-400" title="Project">
      {chosenName}
    </span>
  );

  async function startOver() {
    if (!window.confirm(`Remove all ${images.size} designs and their listings, and start again?`)) return;
    await clearBatch();
  }

  // Clear this batch and pick (or make) another project before the next one.
  async function workOnNewProject() {
    if (!window.confirm(`Work on a new project? This clears these ${images.size} designs and their listings - press "Save on this device" first to keep them.`)) return;
    await clearBatch();
    setChosenProject(null);
    void clearChosenProjectId();
  }

  async function clearBatch() {
    try { await clearSpreadsheet(); } catch (e) { console.warn("clearSpreadsheet failed", e); }
    const empty = new Map<string, MatchedImage>();
    setImages(empty);
    setRows([]);
    setCurrentIndex(0);
    setStage("idle");
    setSaveTried(false);
    setListingsOpen(false);
    setError(null);
    revalidate([], empty);
  }

  const matchedCount = validation?.validRows.length ?? 0;
  const errorCount = validation?.issues.filter((i) => i.level === "error").length ?? 0;

  return (
    <div className="space-y-6">
      {/* Mode switcher — pick the input flow. */}
      <div className="surface px-2 py-2 inline-flex items-center gap-1">
        <button
          type="button"
          onClick={() => setMode("spreadsheet")}
          className={`tab ${mode === "spreadsheet" ? "tab-active" : ""}`}
        >
          From spreadsheet
        </button>
        <button
          type="button"
          onClick={() => setMode("generate")}
          className={`tab ${mode === "generate" ? "tab-active" : ""}`}
        >
          Generate with AI
        </button>
      </div>

      {mode === "generate" && (
        <div className="space-y-6">
          {/* Same project choice as the spreadsheet flow: the batch carries it. */}
          {!chosenProject ? (
            <ProjectPicker
              projects={projects}
              chosenId={chosenProject}
              error={projectsError}
              onChoose={chooseProject}
              onCreate={async (name) => {
                const created = await createProject(name);
                setProjects((list) => [...(list ?? []), created]);
                chooseProject(created.id);
              }}
              onRename={renameChosen}
              onDelete={deleteChosen}
            />
          ) : (
            <div className="flex items-center gap-3">
              {projectChip}
              <button type="button" className="text-sm text-zinc-500 hover:text-accent-500"
                onClick={() => { setChosenProject(null); void clearChosenProjectId(); }}>
                Change project
              </button>
            </div>
          )}
          <GenerationApp sessionId={sessionId} projectId={chosenProject} projectName={chosenName} />
        </div>
      )}

      {mode === "spreadsheet" && (
      <div className="cp-soft space-y-6">
        {phase === "upload" && (
          <ProjectPicker
            projects={projects}
            chosenId={chosenProject}
            error={projectsError}
            onChoose={chooseProject}
            onCreate={async (name) => {
              const created = await createProject(name);
              setProjects((list) => [...(list ?? []), created]);
              chooseProject(created.id);
            }}
            onRename={renameChosen}
            onDelete={deleteChosen}
          />
        )}
        {phase === "upload" && (
          <Dropzone
            variant="hero"
            disabled={!projectsError && !chosenProject}
            title="Upload your designs"
            canvaImport
            hint="Drop .png / .jpg or a .zip - add your listings .xlsx / .csv too to skip the table - or"
            accept="image/png,image/jpeg,image/webp,.zip,application/zip,.xlsx,.xls,.csv"
            multiple
            onFiles={handleImages}
          />
        )}

        {phase === "listings" && (
          <div className="cp-quiet flex flex-wrap items-center gap-3">
            <div>
              <p className="flex items-center gap-2 text-base font-semibold">{images.size} design{images.size === 1 ? "" : "s"} {projectChip}</p>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">Fill the listings table, then press Save</p>
            </div>
            <span className="flex-1" />
            <input
              ref={replaceRef}
              type="file"
              accept="image/png,image/jpeg,image/webp,.zip,application/zip,.xlsx,.xls,.csv"
              multiple
              className="hidden"
              onChange={(e) => { const f = Array.from(e.target.files ?? []); if (f.length) handleImages(f); e.target.value = ""; }}
            />
            <button type="button" className="cp-link" onClick={workOnNewProject}>Work on new project</button>
            <button type="button" className="cp-link" onClick={() => replaceRef.current?.click()} title="An .xlsx / .csv with a filename column fills the matching designs">Upload listings file</button>
            <button type="button" className="cp-pill" onClick={() => replaceRef.current?.click()}>Replace designs</button>
            <button type="button" className="cp-pill cp-pill-primary" onClick={() => setListingsOpen(true)}>Open listings table</button>
          </div>
        )}

        {error && <p className="cp-error">{error}</p>}

        {phase === "configure" && validation && validation.validRows.length > 0 && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <p className="flex items-center gap-2 text-base font-semibold">{validation.validRows.length} design{validation.validRows.length === 1 ? "" : "s"} {projectChip}</p>
              <span className="flex-1" />
              <button
                type="button"
                className="cp-pill"
                onClick={() => { setOpenCard(null); setColorRun(0); }}
              >
                Select colors
              </button>
              <button type="button" className="cp-link" onClick={() => setListingsOpen(true)}>Edit listings</button>
              <button type="button" className="cp-link" onClick={workOnNewProject}>Work on new project</button>
              <button type="button" className="cp-link" onClick={startOver}>Start over</button>
              <button
                type="button"
                className="cp-pill"
                disabled={importStage === "saving"}
                onClick={saveToDevice}
              >
                {importStage === "saving" ? "Saving…" : importStage === "saved" ? "Saved ✓" : "Save on this device"}
              </button>
              <button
                type="button"
                className="cp-pill cp-pill-primary"
                disabled={matchedCount === 0 || errorCount > 0 || stage === "sending"}
                onClick={handleStartUpload}
              >
                {stage === "sending" ? "Sending…" : stage === "sent" ? "Sent ✓" : `Send to extension (${matchedCount})`}
              </button>
            </div>
            {/* "Select colors": one design at a time, same place; a pick moves on. */}
            {colorRun !== null && (() => {
              const all = validation.validRows;
              const idx = Math.min(colorRun, all.length - 1);
              const row = all[idx];
              const stem = stemName(row.metadata.filename);
              const advance = () => setColorRun(idx + 1 < all.length ? idx + 1 : null);
              return (
                <ColorRun
                  row={row}
                  index={idx}
                  total={all.length}
                  previewSrc={previewUrls.get(stem)}
                  customBasicColors={customBasicColors}
                  onPick={(name) => {
                    updateRowMetadata(row.rowNumber, { ...row.metadata, productColors: applyBasicColor(name) });
                    advance();
                  }}
                  onBack={idx > 0 ? () => setColorRun(idx - 1) : undefined}
                  onSkip={advance}
                  onClose={() => setColorRun(null)}
                />
              );
            })()}

            {/* The open design sits in one panel above the grid; › swaps the next
                design into it in place - the page does not move. */}
            {(() => {
              const all = validation.validRows;
              const i = all.findIndex((r) => r.rowNumber === openCard);
              if (i < 0) return null;
              const row = all[i];
              const stem = stemName(row.metadata.filename);
              const next = all[i + 1];
              return (
                <div id="design-open" className="scroll-mt-4">
                  <DesignCard
                    key={row.rowNumber}
                    row={row}
                    image={images.get(stem)}
                    previewSrc={previewUrls.get(stem)}
                    onChange={(rowNumber, nextMeta) => updateRowMetadata(rowNumber, nextMeta)}
                    onRemove={() => { removeImage(stem); setOpenCard(next?.rowNumber ?? null); }}
                    customBasicColors={customBasicColors}
                    onAddCustomBasicColor={addCustomBasicColor}
                    onRemoveCustomBasicColor={removeCustomBasicColor}
                    totalDesigns={all.length}
                    onApplyColorsToAll={() => applyColorsToAllRows(row.rowNumber)}
                    onApplyProductsToAll={() => applyProductsToAllRows(row.rowNumber)}
                    expanded
                    onToggleExpanded={() => setOpenCard(null)}
                    onNextDesign={next ? () => setOpenCard(next.rowNumber) : undefined}
                  />
                </div>
              );
            })()}

            {/* Every design as a small card. Its arrow opens it in the panel above. */}
            <div className="grid gap-5 [grid-template-columns:repeat(auto-fill,minmax(300px,1fr))]">
              {validation.validRows.map((row) => {
                const stem = stemName(row.metadata.filename);
                const isOpen = openCard === row.rowNumber;
                return (
                  <div key={row.rowNumber} className={isOpen ? "rounded-2xl ring-2 ring-accent-500/60" : undefined}>
                    <DesignCard
                      row={row}
                      image={images.get(stem)}
                      previewSrc={previewUrls.get(stem)}
                      onChange={(rowNumber, nextMeta) => updateRowMetadata(rowNumber, nextMeta)}
                      onRemove={() => { removeImage(stem); if (isOpen) setOpenCard(null); }}
                      customBasicColors={customBasicColors}
                      onAddCustomBasicColor={addCustomBasicColor}
                      onRemoveCustomBasicColor={removeCustomBasicColor}
                      totalDesigns={validation.validRows.length}
                      onApplyColorsToAll={() => applyColorsToAllRows(row.rowNumber)}
                      onApplyProductsToAll={() => applyProductsToAllRows(row.rowNumber)}
                      expanded={false}
                      onToggleExpanded={() => {
                        setColorRun(null);
                        setOpenCard(row.rowNumber);
                        // Opening from the grid brings the panel into view once.
                        requestAnimationFrame(() => document.getElementById("design-open")?.scrollIntoView({ behavior: "smooth", block: "start" }));
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </section>
        )}

        {listingsOpen && rows.length > 0 && (
          <ListingsView
            rows={rows}
            previewUrls={previewUrls}
            onChange={(next) => { setRows(next); revalidate(next, images); }}
            onDeleteRows={removeImages}
            onClose={() => setListingsOpen(false)}
            issues={issues}
            showIssues={saveTried}
            error={error}
            actions={
              // Colors and products are chosen per design after this, so the view
              // only saves; sending happens from the page once they're set.
              <button
                className="hs-btn hs-btn-primary"
                disabled={importStage === "saving"}
                onClick={saveToDevice}
              >
                {importStage === "saving" ? "Saving…" : importStage === "saved" ? "Saved ✓" : "Save"}
              </button>
            }
          />
        )}
      </div>
      )}
    </div>
  );
}

