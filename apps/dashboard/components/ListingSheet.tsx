"use client";

// Create Product's listing table - replaces the uploaded spreadsheet. A small
// spreadsheet: one row per design image, the template's six columns, and the
// Excel moves people already know (select / drag / shift-click ranges, whole
// rows and columns, copy-cut-paste in Excel's own clipboard format, Delete,
// type-to-replace, F2, Ctrl+D, Ctrl+Z / Ctrl+Y, right-click menu, resizable
// columns). The data operations live in lib/listingSheet.ts.
//
// `ListingsView` puts it in its own full-screen view that stays open until the
// user closes it.

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import type { ParsedRow } from "@/lib/parser";
import {
  SHEET_COLUMNS, cellsOf, colorsToSheetData, imageOf, rowsToSheetData, clearRange, fillDown, fillHandle, fillRange, pasteAt, rangeToTsv, restoreCells, setCell, snapshotCells,
  type CellRange, type CellsSnapshot, type SheetIssue,
} from "@/lib/listingSheet";
import { COLOR_SLUGS, ColorsSheet } from "./ColorsSheet";

// The template's own column names, as TeePublic sellers know them.
const HEADERS = ["filename", "title", "Primary_tag", "description", "adult_content", "supporting_tags"];
const DEFAULT_WIDTHS = [120, 380, 190, 400, 150, 420];

const ico = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const, className: "h-[18px] w-[18px] shrink-0" };
const FileIcon = () => <svg {...ico}><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h6" /></svg>;
const TagIcon = () => <svg {...ico}><path d="M20.6 13.4l-7.2 7.2a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z" /><circle cx="7.5" cy="7.5" r="1.5" /></svg>;
// adult_content has no icon.
const HEADER_ICONS = [FileIcon, TagIcon, TagIcon, FileIcon, null, TagIcon];
const LAST_COL = SHEET_COLUMNS.length - 1;
const ADULT_COL = SHEET_COLUMNS.indexOf("adult_content");

const isYes = (v: string) => /^(yes|y|true|1)$/i.test(v.trim());
const isNo = (v: string) => /^(no|n|false|0)$/i.test(v.trim());
/** Set adult_content to Yes / No on these row indices (same spelling as new rows' "No"). */
function setAdult(rows: ParsedRow[], idx: number[], yes: boolean): ParsedRow[] {
  const on = new Set(idx);
  return rows.map((row, i) => (on.has(i) ? setCell(row, "adult_content", yes ? "Yes" : "No") : row));
}
const HISTORY_MAX = 100;

type Pos = { r: number; c: number };
type Editing = { r: number; c: number; value: string; mode: "replace" | "edit" };
type Drag = "cells" | "rows" | "cols" | "fill" | null;


interface SheetProps {
  rows: ParsedRow[];
  previewUrls: Map<string, string>;
  onChange: (rows: ParsedRow[]) => void;
  /** Remove these designs (image + listing) from the batch. */
  onDeleteRows: (stems: string[]) => void;
  /** Cells that block Save (lib/listingSheet sheetIssues) - shown red. */
  issues?: SheetIssue[];
}

export function ListingSheet({ rows, previewUrls, onChange, onDeleteRows, issues = [] }: SheetProps) {
  const bad = new Map(issues.map((i) => [`${i.row}:${SHEET_COLUMNS.indexOf(i.col)}`, i.message]));
  const gridRef = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<Pos>({ r: 0, c: 1 });
  const [active, setActive] = useState<Pos>({ r: 0, c: 1 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [widths, setWidths] = useState(DEFAULT_WIDTHS);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  /** Unsaved text typed in the value bar; null = showing the cell as it is. */
  const [barDraft, setBarDraft] = useState<string | null>(null);
  const [fillTo, setFillToState] = useState<number | null>(null);
  const fillToRef = useRef<number | null>(null);
  const setFillTo = (v: number | null) => { fillToRef.current = v; setFillToState(v); };
  const drag = useRef<Drag>(null);
  const undo = useRef<CellsSnapshot[]>([]);
  const redo = useRef<CellsSnapshot[]>([]);

  const last = rows.length - 1;
  const clampPos = (p: Pos): Pos => ({ r: Math.max(0, Math.min(last, p.r)), c: Math.max(0, Math.min(LAST_COL, p.c)) });
  const sel: CellRange = {
    r0: Math.min(anchor.r, active.r), r1: Math.max(anchor.r, active.r),
    c0: Math.min(anchor.c, active.c), c1: Math.max(anchor.c, active.c),
  };
  const inSel = (r: number, c: number) => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
  const wholeRows = sel.c0 === 0 && sel.c1 === LAST_COL;

  // Keep the selection inside the table when rows are removed.
  useEffect(() => {
    if (rows.length === 0) return;
    setAnchor((p) => clampPos(p));
    setActive((p) => clampPos(p));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows.length]);

  /** Every edit goes through here so Ctrl+Z can take it back. */
  const commit = useCallback((next: ParsedRow[]) => {
    undo.current.push(snapshotCells(rows));
    if (undo.current.length > HISTORY_MAX) undo.current.shift();
    redo.current = [];
    onChange(next);
  }, [rows, onChange]);

  function stepHistory(from: typeof undo, to: typeof undo) {
    const snap = from.current.pop();
    if (!snap) return;
    to.current.push(snapshotCells(rows));
    onChange(restoreCells(rows, snap));
  }

  const focusGrid = () => gridRef.current?.focus({ preventScroll: true });

  function select(p: Pos, extend = false) {
    const q = clampPos(p);
    if (!extend) setAnchor(q);
    setActive(q);
    requestAnimationFrame(() =>
      gridRef.current?.querySelector(`[data-cell="${q.r}:${q.c}"]`)?.scrollIntoView({ block: "nearest", inline: "nearest" }));
  }

  function pasteText(text: string) {
    const { rows: next, dropped } = pasteAt(rows, sel, text);
    commit(next);
    setNote(dropped > 0 ? `${dropped} pasted line${dropped === 1 ? "" : "s"} had no design image and ${dropped === 1 ? "was" : "were"} left out.` : null);
  }

  function deleteSelectedRows() {
    const stems = rows.slice(sel.r0, sel.r1 + 1).map(imageOf);
    const n = stems.length;
    if (!window.confirm(`Remove ${n} design${n === 1 ? "" : "s"} (image and listing) from this batch?`)) return;
    onDeleteRows(stems);
    select({ r: sel.r0, c: anchor.c });
  }

  // ---- editing --------------------------------------------------------------

  function startEdit(p: Pos, mode: Editing["mode"], value?: string) {
    setEditing({ r: p.r, c: p.c, mode, value: value ?? cellsOf(rows[p.r])[SHEET_COLUMNS[p.c]] });
  }

  function finishEdit(move?: Pos) {
    if (editing) {
      const col = SHEET_COLUMNS[editing.c];
      if (editing.value !== cellsOf(rows[editing.r])[col]) {
        commit(rows.map((r, i) => (i === editing.r ? setCell(r, col, editing.value) : r)));
      }
      setEditing(null);
    }
    if (move) select(move);
    focusGrid();
  }

  function onEditorKey(e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) {
    if (!editing) return;
    const { r, c, mode } = editing;
    const multiline = e.currentTarget instanceof HTMLTextAreaElement;
    if (e.key === "Escape") { e.preventDefault(); setEditing(null); focusGrid(); return; }
    if (e.key === "Enter" && e.altKey && multiline) return; // Alt+Enter: new line in the cell, like Excel
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      // Ctrl+Enter: the typed value goes into EVERY selected cell (Excel's "fill selection").
      e.preventDefault();
      commit(fillRange(rows, sel, editing.value));
      setEditing(null);
      focusGrid();
      return;
    }
    if (e.key === "Enter") { e.preventDefault(); finishEdit({ r: r + (e.shiftKey ? -1 : 1), c }); return; }
    if (e.key === "Tab") { e.preventDefault(); finishEdit({ r, c: c + (e.shiftKey ? -1 : 1) }); return; }
    // Typing straight into a cell: arrows leave it. After F2 / double-click they move the caret.
    if (mode === "replace") {
      const d = ({ ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] } as Record<string, [number, number]>)[e.key];
      if (d) { e.preventDefault(); finishEdit({ r: r + d[0], c: c + d[1] }); }
    }
  }

  function onEditorPaste(e: React.ClipboardEvent) {
    const text = e.clipboardData.getData("text/plain");
    // Several lines / cells pasted into a cell still spread down the table.
    if (!/[\n\t]/.test(text.replace(/\r?\n$/, ""))) return;
    e.preventDefault();
    setEditing(null);
    pasteText(text);
    focusGrid();
  }

  // ---- keyboard on the grid -------------------------------------------------

  function onGridKey(e: React.KeyboardEvent<HTMLDivElement>) {
    if (editing || rows.length === 0) return;
    const ctrl = e.ctrlKey || e.metaKey;
    const k = e.key;
    const move = (dr: number, dc: number) => {
      e.preventDefault();
      const to = ctrl
        ? { r: dr ? (dr > 0 ? last : 0) : active.r, c: dc ? (dc > 0 ? LAST_COL : 0) : active.c }
        : { r: active.r + dr, c: active.c + dc };
      select(to, e.shiftKey);
    };
    if (k === "ArrowUp") return move(-1, 0);
    if (k === "ArrowDown") return move(1, 0);
    if (k === "ArrowLeft") return move(0, -1);
    if (k === "ArrowRight") return move(0, 1);
    if (k === "PageDown") { e.preventDefault(); return select({ r: active.r + 10, c: active.c }, e.shiftKey); }
    if (k === "PageUp") { e.preventDefault(); return select({ r: active.r - 10, c: active.c }, e.shiftKey); }
    if (k === "Home") { e.preventDefault(); return select(ctrl ? { r: 0, c: 0 } : { r: active.r, c: 0 }, e.shiftKey); }
    if (k === "End") { e.preventDefault(); return select(ctrl ? { r: last, c: LAST_COL } : { r: active.r, c: LAST_COL }, e.shiftKey); }
    if (k === "Tab") { e.preventDefault(); return select({ r: active.r, c: active.c + (e.shiftKey ? -1 : 1) }); }
    if (k === "Enter") {
      e.preventDefault();
      return select({ r: active.r + (e.shiftKey ? -1 : 1), c: active.c });
    }
    if (k === "Delete" || k === "Backspace") { e.preventDefault(); return commit(clearRange(rows, sel)); }
    // adult_content is a yes/no switch: Space flips the selected rows, y / n set them.
    if (active.c === ADULT_COL && !ctrl && !e.altKey && sel.c0 === ADULT_COL && sel.c1 === ADULT_COL) {
      const picked = rows.slice(sel.r0, sel.r1 + 1).map((_, i) => sel.r0 + i);
      if (k === " " && !e.shiftKey) { e.preventDefault(); return commit(setAdult(rows, picked, !picked.every((i) => isYes(cellsOf(rows[i]).adult_content)))); }
      if (k.toLowerCase() === "y") { e.preventDefault(); return commit(setAdult(rows, picked, true)); }
      if (k.toLowerCase() === "n") { e.preventDefault(); return commit(setAdult(rows, picked, false)); }
    }
    if (k === "F2") { e.preventDefault(); return startEdit(active, "edit"); }
    if (k === " " && e.shiftKey && !ctrl) { e.preventDefault(); setAnchor({ r: active.r, c: 0 }); setActive({ r: active.r, c: LAST_COL }); return; }
    if (k === " " && ctrl) { e.preventDefault(); setAnchor({ r: 0, c: active.c }); setActive({ r: last, c: active.c }); return; }
    if (ctrl) {
      const key = k.toLowerCase();
      if (key === "a") { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setActive({ r: last, c: LAST_COL }); return; }
      if (key === "z" && !e.shiftKey) { e.preventDefault(); return stepHistory(undo, redo); }
      if (key === "y" || (key === "z" && e.shiftKey)) { e.preventDefault(); return stepHistory(redo, undo); }
      if (key === "d") { e.preventDefault(); return commit(fillDown(rows, sel)); }
      if (k === "-") { e.preventDefault(); return deleteSelectedRows(); }
      return; // Ctrl+C / X / V arrive as clipboard events below
    }
    if (k.length === 1 && !e.altKey) { e.preventDefault(); startEdit(active, "replace", k); }
  }

  // Clipboard events go to <body> when a non-editable element has focus, so
  // listen on the document and act only while the grid is the focused thing.
  useEffect(() => {
    const mine = () => !!gridRef.current && document.activeElement === gridRef.current && !editing;
    const onCopy = (e: ClipboardEvent) => {
      if (!mine()) return;
      e.preventDefault();
      e.clipboardData?.setData("text/plain", rangeToTsv(rows, sel));
    };
    const onCut = (e: ClipboardEvent) => {
      if (!mine()) return;
      onCopy(e);
      commit(clearRange(rows, sel));
    };
    const onPaste = (e: ClipboardEvent) => {
      if (!mine()) return;
      e.preventDefault();
      pasteText(e.clipboardData?.getData("text/plain") ?? "");
    };
    document.addEventListener("copy", onCopy);
    document.addEventListener("cut", onCut);
    document.addEventListener("paste", onPaste);
    return () => {
      document.removeEventListener("copy", onCopy);
      document.removeEventListener("cut", onCut);
      document.removeEventListener("paste", onPaste);
    };
  });

  // ---- mouse ----------------------------------------------------------------

  useEffect(() => {
    const up = () => { drag.current = null; };
    const close = () => setMenu(null);
    window.addEventListener("mouseup", up);
    window.addEventListener("click", close);
    return () => { window.removeEventListener("mouseup", up); window.removeEventListener("click", close); };
  }, []);

  function cellDown(e: React.MouseEvent, r: number, c: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (editing) finishEdit();
    select({ r, c }, e.shiftKey);
    drag.current = "cells";
    focusGrid();
  }
  function cellEnter(r: number, c: number) {
    if (drag.current === "fill") setFillTo(r > sel.r1 ? r : null);
    else if (drag.current === "cells") setActive({ r, c });
    else if (drag.current === "rows") setActive({ r, c: LAST_COL });
  }
  /** The fill handle (the square on the selection's corner): drag down, let go, copied. */
  function fillDownStart(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    drag.current = "fill";
    const range = sel;
    const finish = () => {
      window.removeEventListener("mouseup", finish);
      drag.current = null;
      const to = fillToRef.current;
      setFillTo(null);
      if (to != null) {
        commit(fillHandle(rows, range, to));
        setAnchor({ r: range.r0, c: range.c0 });
        setActive({ r: to, c: range.c1 });
      }
    };
    window.addEventListener("mouseup", finish);
  }

  function rowDown(e: React.MouseEvent, r: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (editing) finishEdit();
    if (!e.shiftKey) setAnchor({ r, c: 0 }); else setAnchor((a) => ({ r: a.r, c: 0 }));
    setActive({ r, c: LAST_COL });
    drag.current = "rows";
    focusGrid();
  }
  function colDown(e: React.MouseEvent, c: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    if (editing) finishEdit();
    if (!e.shiftKey) setAnchor({ r: 0, c }); else setAnchor((a) => ({ r: 0, c: a.c }));
    setActive({ r: last, c });
    drag.current = "cols";
    focusGrid();
  }
  function colEnter(c: number) { if (drag.current === "cols") setActive({ r: last, c }); }
  function onContext(e: React.MouseEvent, r: number, c: number) {
    e.preventDefault();
    if (!inSel(r, c)) select({ r, c });
    setMenu({ x: e.clientX, y: e.clientY });
    focusGrid();
  }

  function startResize(e: React.MouseEvent, c: number) {
    e.preventDefault();
    e.stopPropagation();
    const x0 = e.clientX;
    const w0 = widths[c];
    const moveFn = (ev: MouseEvent) => setWidths((w) => w.map((v, i) => (i === c ? Math.max(60, w0 + ev.clientX - x0) : v)));
    const upFn = () => { window.removeEventListener("mousemove", moveFn); window.removeEventListener("mouseup", upFn); };
    window.addEventListener("mousemove", moveFn);
    window.addEventListener("mouseup", upFn);
  }

  // ---- menu actions (clipboard API: the menu isn't a keyboard shortcut) ------

  async function menuCopy(cut: boolean) {
    try {
      await navigator.clipboard.writeText(rangeToTsv(rows, sel));
      if (cut) commit(clearRange(rows, sel));
    } catch { setNote("Chrome blocked the clipboard - use Ctrl+C / Ctrl+X instead."); }
  }
  async function menuPaste() {
    try { pasteText(await navigator.clipboard.readText()); }
    catch { setNote("Chrome blocked reading the clipboard - use Ctrl+V instead."); }
  }

  // A new cell selected: the bar shows that cell, not a leftover draft.
  useEffect(() => { setBarDraft(null); }, [active.r, active.c]);

  const filled = (c: number) => rows.filter((r) => cellsOf(r)[SHEET_COLUMNS[c]].trim() !== "").length;

  // ---- value bar (Excel's formula bar) --------------------------------------
  // Shows the active cell's full text - the cells themselves are one line with
  // "…" - and edits it: Enter saves, Alt+Enter new line, Esc puts it back.
  const activeRow = rows[active.r];
  const activeCol = SHEET_COLUMNS[active.c];
  const activeValue = activeRow ? cellsOf(activeRow)[activeCol] : "";
  const editingHere = editing && editing.r === active.r && editing.c === active.c;
  const barValue = editingHere ? editing.value : barDraft ?? activeValue;
  function commitBar() {
    if (barDraft === null || !activeRow) return;
    if (barDraft !== activeValue) commit(rows.map((r, i) => (i === active.r ? setCell(r, activeCol, barDraft) : r)));
    setBarDraft(null);
  }
  function onBarKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.altKey) { e.preventDefault(); commitBar(); e.currentTarget.blur(); focusGrid(); return; }
    if (e.key === "Enter" && e.altKey) { e.preventDefault(); setBarDraft(barValue + "\n"); return; }
    if (e.key === "Escape") { e.preventDefault(); setBarDraft(null); e.currentTarget.blur(); focusGrid(); }
  }

  return (
    <div className="flex flex-col">
      {note && <div className="hs-note mb-2" onClick={() => setNote(null)} title="Dismiss">{note}</div>}
      <div className="hs-fbar">
        <span className="hs-fbar-name" title="Selected cell">
          {activeRow ? <>{activeRow.rowNumber || active.r + 1}<span>·</span>{HEADERS[active.c]}</> : "-"}
        </span>
        <span className="hs-fbar-fx" aria-hidden>fx</span>
        <div className="hs-fbar-box">
          <textarea
            rows={1}
            value={barValue}
            spellCheck={false}
            disabled={!activeRow}
            onFocus={() => { if (editing) finishEdit(); }}
            onChange={(e) => setBarDraft(e.target.value)}
            onKeyDown={onBarKey}
            onBlur={commitBar}
            placeholder={activeRow ? "(empty)" : ""}
            aria-label="Selected cell value"
          />
        </div>
      </div>
      <div
        ref={gridRef}
        tabIndex={0}
        onKeyDown={onGridKey}
        className="hs-grid relative outline-none select-none"
      >
        <table className="border-separate border-spacing-0 text-sm" style={{ tableLayout: "fixed", width: 52 + widths.reduce((a, b) => a + b, 0) }}>
          <colgroup>
            <col style={{ width: 52 }} />
            {widths.map((w, i) => <col key={i} style={{ width: w }} />)}
          </colgroup>
          {/* Sticks just under the value bar (44px, .hs-fbar). */}
          <thead className="sticky z-20" style={{ top: 44 }}>
            <tr>
              <th
                className="hs-th-corner sticky left-0 z-30"
                title="Select all (Ctrl+A)"
                onMouseDown={(e) => { e.preventDefault(); setAnchor({ r: 0, c: 0 }); setActive({ r: last, c: LAST_COL }); focusGrid(); }}
              >
                #
              </th>
              {HEADERS.map((h, c) => {
                const Icon = HEADER_ICONS[c];
                return (
                <th
                  key={h}
                  className="hs-th"
                  data-on={c >= sel.c0 && c <= sel.c1 && sel.r0 === 0 && sel.r1 === last ? "1" : undefined}
                  onMouseDown={(e) => colDown(e, c)}
                  onMouseEnter={() => colEnter(c)}
                  title={`${filled(c)} of ${rows.length} filled - click to select the column`}
                >
                  <div className="flex items-center gap-2">
                    {Icon && <span className="hs-th-icon"><Icon /></span>}
                    <span className="truncate flex-1">{h}</span>
                    <span className="hs-th-caret" data-full={filled(c) === rows.length ? "1" : undefined} aria-hidden>
                      <svg viewBox="0 0 10 6" className="h-1.5 w-2.5"><path d="M0 0h10L5 6z" fill="currentColor" /></svg>
                    </span>
                  </div>
                  <div
                    className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent-400/40"
                    onMouseDown={(e) => startResize(e, c)}
                    title="Drag to resize"
                  />
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => {
              const cells = cellsOf(row);
              const image = imageOf(row);
              const preview = previewUrls.get(image);
              const rowOn = r >= sel.r0 && r <= sel.r1;
              const rowSelected = wholeRows && rowOn;
              return (
                <tr key={image}>
                  <td
                    className="hs-rownum"
                    data-on={rowOn ? "1" : undefined}
                    data-row={rowSelected ? "1" : undefined}
                    onMouseDown={(e) => rowDown(e, r)}
                    onMouseEnter={() => cellEnter(r, LAST_COL)}
                    onContextMenu={(e) => { if (!rowSelected) { setAnchor({ r, c: 0 }); setActive({ r, c: LAST_COL }); } e.preventDefault(); setMenu({ x: e.clientX, y: e.clientY }); focusGrid(); }}
                    title="Select row"
                  >
                    {/* The design's place in the batch - stays put while the view is filtered. */}
                    {row.rowNumber || r + 1}
                  </td>
                  {SHEET_COLUMNS.map((col, c) => {
                    const isActive = active.r === r && active.c === c;
                    const isEditing = editing?.r === r && editing.c === c;
                    const problem = bad.get(`${r}:${c}`);
                    const missing = !!problem;
                    return (
                      <td
                        key={col}
                        data-cell={`${r}:${c}`}
                        className="hs-td"
                        data-sel={inSel(r, c) ? "1" : undefined}
                        data-missing={missing ? "1" : undefined}
                        style={fillTo != null && r > sel.r1 && r <= fillTo && c >= sel.c0 && c <= sel.c1
                          ? { outline: "1px dashed var(--hs-sel-line)", outlineOffset: -3 } : undefined}
                        onMouseDown={(e) => cellDown(e, r, c)}
                        onMouseEnter={() => cellEnter(r, c)}
                        onDoubleClick={() => { if (c !== ADULT_COL) startEdit({ r, c }, "edit"); }}
                        onContextMenu={(e) => onContext(e, r, c)}
                      >
                        {isActive && <div className="hs-active" />}
                        {/* No picture column (the sheet matches the product list):
                            hovering the filename shows the row's own design. */}
                        {c === 0 && preview && (
                          <span className="hs-peek" aria-hidden>
                            <img src={preview} alt="" draggable={false} />
                            <span>{image}</span>
                          </span>
                        )}
                        {r === sel.r1 && c === sel.c1 && !editing && (
                          <div className="hs-handle" onMouseDown={fillDownStart} title="Drag down to copy" />
                        )}
                        {/* One line per row like the product list sheet; the full
                            text is in the tooltip and the editor. Primary tag and
                            adult content read as pills. */}
                        <div
                          className={`hs-cell hs-col-${col}`}
                          title={problem ?? (cells[col].length > 30 ? cells[col] : undefined)}
                        >
                          {col === "adult_content"
                            // A yes/no switch: click the pill to flip it.
                            ? <button
                                type="button"
                                tabIndex={-1}
                                className={isYes(cells[col]) ? "hs-pill-yes" : cells[col] ? "hs-pill-mute" : "hs-pill-empty"}
                                data-bad={problem ? "1" : undefined}
                                onClick={() => commit(setAdult(rows, [r], !isYes(cells[col])))}
                                title="Click to switch yes / no"
                              >
                                {isYes(cells[col]) ? "yes" : cells[col] ? (isNo(cells[col]) ? "no" : cells[col]) : "no?"}
                              </button>
                            : cells[col]
                            ? (problem
                                ? <span className="hs-required not-italic">{cells[col]}</span>
                                : col === "primary_tag" ? <span className="hs-pill">{cells[col]}</span>
                                : cells[col])
                            : (missing ? <span className="hs-required">required</span> : "")}
                        </div>
                        {isEditing && (
                          col === "description"
                            ? <textarea
                                autoFocus
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onKeyDown={onEditorKey}
                                onPaste={onEditorPaste}
                                onBlur={() => finishEdit()}
                                onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); }}
                                className="hs-editor min-h-[8rem] resize-y"
                              />
                            : <input
                                autoFocus
                                value={editing.value}
                                onChange={(e) => setEditing({ ...editing, value: e.target.value })}
                                onKeyDown={onEditorKey}
                                onPaste={onEditorPaste}
                                onBlur={() => finishEdit()}
                                onFocus={(e) => { const n = e.currentTarget.value.length; e.currentTarget.setSelectionRange(n, n); }}
                                className="hs-editor h-full"
                              />
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        {menu && (
          <div className="hs-menu" style={{ left: menu.x, top: menu.y }} onMouseDown={(e) => e.stopPropagation()}>
            <MenuItem label="Cut" hint="Ctrl+X" onClick={() => menuCopy(true)} />
            <MenuItem label="Copy" hint="Ctrl+C" onClick={() => menuCopy(false)} />
            <MenuItem label="Paste" hint="Ctrl+V" onClick={menuPaste} />
            <hr />
            <MenuItem label="Clear contents" hint="Delete" onClick={() => commit(clearRange(rows, sel))} />
            <MenuItem
              label="Fill selection with this value"
              hint="Ctrl+Enter"
              onClick={() => commit(fillRange(rows, sel, cellsOf(rows[active.r])[SHEET_COLUMNS[active.c]]))}
              disabled={sel.r1 === sel.r0 && sel.c1 === sel.c0}
            />
            <MenuItem label="Fill down" hint="Ctrl+D" onClick={() => commit(fillDown(rows, sel))} disabled={sel.r1 === sel.r0} />
            <hr />
            <MenuItem
              label={`Delete row${sel.r1 > sel.r0 ? `s ${sel.r0 + 1}–${sel.r1 + 1}` : ` ${sel.r0 + 1}`}`}
              hint="Ctrl+−"
              danger
              onClick={deleteSelectedRows}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function MenuItem({ label, hint, onClick, danger, disabled }: { label: string; hint?: string; onClick: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick} data-danger={danger ? "1" : undefined}>
      <span>{label}</span>
      {hint && <span className="hs-display text-xs opacity-60">{hint}</span>}
    </button>
  );
}

/** The listings table in its own full-screen view, styled like the extension's
 *  side panel. Stays open until closed. */
export function ListingsView({
  rows, previewUrls, onChange, onDeleteRows, onClose, issues = [], showIssues = true, error, actions,
}: SheetProps & {
  onClose: () => void;
  /** False until the user tries to Save: no red cells, no issues panel. */
  showIssues?: boolean;
  error?: string | null;
  actions?: ReactNode;
}) {
  const badRows = new Set(issues.map((i) => i.row));
  const ready = rows.length - badRows.size;
  const errors = issues.length;

  // "Only rows with issues" (offered once Save has shown the problems). The
  // sheet edits the visible rows; edits are merged back into the batch by
  // design image, so filtering never drops or reorders anything.
  const [onlyIssues, setOnlyIssues] = useState(false);
  // Two sheets, like the upload template: the listings and their colours.
  const [tab, setTab] = useState<"listings" | "colors">("listings");
  const filterOn = showIssues && onlyIssues && errors > 0;
  const visibleIdx = rows.flatMap((_, i) => (filterOn && !badRows.has(i) ? [] : [i]));
  const filtering = visibleIdx.length !== rows.length;
  const visibleRows = filtering ? visibleIdx.map((i) => rows[i]) : rows;
  const toVisible = new Map(visibleIdx.map((full, vis) => [full, vis]));
  const visibleIssues = filtering
    ? issues.flatMap((i) => (toVisible.has(i.row) ? [{ ...i, row: toVisible.get(i.row)! }] : []))
    : issues;
  const onVisibleChange = (next: ParsedRow[]) => {
    if (!filtering) return onChange(next);
    const byImage = new Map(next.map((r) => [imageOf(r), r]));
    onChange(rows.map((r) => byImage.get(imageOf(r)) ?? r));
  };
  // The page behind shouldn't scroll while the view is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // The whole view scrolls as one page (not just the table); the table's
  // header row sticks to the top while scrolling.
  return (
    <div className="hs-view fixed inset-0 z-50 overflow-auto" role="dialog" aria-label="Listings">
      {/* The view bar: brand and live counts. */}
      <header className="hs-bar">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/higgstee-mark.png" alt="" className="h-10 w-10 rounded-xl" />
          <span className="hs-bar-brand">Higgstee</span>
        </div>
        <span className="hs-bar-div" />
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="hs-bar-stat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" aria-hidden><path d="M8 3l-5 3 2 4 2-1v12h10V9l2 1 2-4-5-3c-.5 1.5-2 2.5-4 2.5S8.5 4.5 8 3z" /></svg>
            {rows.length} Products
          </span>
          <span className="hs-bar-stat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="M4 12.5l5 5L20 6.5" /></svg>
            Ready: {ready}
          </span>
          <span className="hs-bar-stat">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>
            Pending: {rows.length - ready}
          </span>
          <span className="hs-bar-stat" data-bad={errors ? "1" : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" aria-hidden><circle cx="12" cy="12" r="9" /><path d="M9 9l6 6M15 9l-6 6" /></svg>
            Issues: {errors}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {/* Export: the table as an .xlsx in the template's columns, made in the
              browser - nothing is uploaded. */}
          <button type="button" className="hs-btn" onClick={() => exportXlsx(rows)} disabled={rows.length === 0}>
            Export
          </button>
          {actions}
          <button type="button" className="hs-btn" onClick={onClose}>Close</button>
        </div>
      </header>
      {error && <div className="px-6 py-2 text-sm" style={{ color: "var(--hs-danger)" }}>{error}</div>}
      {tab === "listings" && showIssues && issues.length > 0 && (
        <div className="mx-4 my-3 rounded-lg border px-4 py-2.5 text-sm" style={{ borderColor: "color-mix(in srgb, var(--hs-danger) 45%, transparent)", background: "color-mix(in srgb, var(--hs-danger) 8%, transparent)" }}>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="hs-display text-base font-bold" style={{ color: "var(--hs-danger)" }}>
              Can't save yet - {issues.length} problem{issues.length === 1 ? "" : "s"} in {badRows.size} row{badRows.size === 1 ? "" : "s"}
            </div>
            <button type="button" className="hs-filter" data-on={filterOn ? "1" : undefined} onClick={() => setOnlyIssues((v) => !v)}>
              {filterOn ? `Show all ${rows.length} rows` : `Only rows with issues (${badRows.size})`}
            </button>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5" style={{ color: "var(--hs-muted)" }}>
            {issues.slice(0, 8).map((i) => <span key={`${i.row}:${i.col}`}>Row {i.row + 1} · {i.message}</span>)}
            {issues.length > 8 && <span>+{issues.length - 8} more (red cells)</span>}
          </div>
        </div>
      )}
      {/* The sheet runs edge to edge; its own lime bar sits under the top bar. */}
      <div>
        {tab === "listings"
          ? <ListingSheet rows={visibleRows} previewUrls={previewUrls} onChange={onVisibleChange} onDeleteRows={onDeleteRows} issues={showIssues ? visibleIssues : []} />
          : <ColorsSheet rows={rows} previewUrls={previewUrls} onChange={onChange} />}
      </div>
      {/* Sheet tabs, bottom-left like Excel. */}
      <div className="sticky bottom-0 left-0 z-30 flex items-center gap-1 border-t px-4 py-1.5" style={{ borderColor: "var(--hs-border)", background: "var(--hs-bg)" }}>
        {([["listings", "Listings"], ["colors", "Colors"]] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className="rounded-md px-4 py-1.5 text-sm font-semibold transition"
            style={tab === id
              ? { background: "var(--hs-lime)", color: "var(--table-header)" }
              : { color: "var(--hs-muted)" }}
            aria-pressed={tab === id}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "listings" && <div className="sticky left-0 flex flex-wrap items-center gap-x-5 gap-y-1 border-t px-6 py-3 text-xs" style={{ color: "var(--hs-muted)", borderColor: "var(--hs-border)" }}>
        {[
          ["Ctrl+C / Ctrl+V", "copy, paste — Excel columns fill down"],
          ["Header · type · Ctrl+Enter", "same value in the whole column"],
          ["Corner square", "drag down to copy"],
          ["adult_content", "click · Space · Y / N"],
          ["Delete", "clear"],
          ["Ctrl+Z", "undo"],
          ["Right-click", "more"],
        ].map(([k, v]) => (
          <span key={k} className="inline-flex items-center gap-1.5"><kbd className="hs-kbd">{k}</kbd>{v}</span>
        ))}
      </div>}
    </div>
  );
}

/** Download the listings as listings.xlsx: the template's metadata sheet and
 *  its colours sheet, so dropping the file back in restores both. */
async function exportXlsx(rows: ParsedRow[]) {
  const XLSX = await import("xlsx");
  const sheet = XLSX.utils.aoa_to_sheet(rowsToSheetData(rows));
  sheet["!cols"] = [{ wch: 10 }, { wch: 50 }, { wch: 24 }, { wch: 60 }, { wch: 14 }, { wch: 60 }];
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Listings");
  const colors = XLSX.utils.aoa_to_sheet(colorsToSheetData(rows, COLOR_SLUGS));
  XLSX.utils.book_append_sheet(book, colors, "Colors");
  XLSX.writeFile(book, "listings.xlsx");
}
