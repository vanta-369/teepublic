// The Create Product listing table replaced the uploaded spreadsheet. What it
// must get right is the Excel copy/paste: a column copied from Excel lands one
// value per row, and the rows it produces still validate and queue exactly
// like the parser's did.

import test from "node:test";
import assert from "node:assert/strict";

const { parseClipboardGrid, pasteIntoRows, syncRowsToImages, setCell, cellsOf } = await import(
  "../apps/dashboard/lib/listingSheet.ts"
);
const { validateRows } = await import("../apps/dashboard/lib/validator.ts");
const { sheetIssues } = await import("../apps/dashboard/lib/listingSheet.ts");

const img = (name: string) => [name.replace(/\.\w+$/, "").toLowerCase(), { originalName: name }] as const;
const images = (...names: string[]) => new Map(names.map(img));

test("one row per image, numbered in filename order", () => {
  const rows = syncRowsToImages([], images("10.png", "2.png", "1.png"));
  assert.deepEqual(rows.map((r) => cellsOf(r).filename), ["1", "2", "10"]);
  assert.deepEqual(rows.map((r) => r.rowNumber), [1, 2, 3]);
  assert.equal(cellsOf(rows[0]).adult_content, "No");
});

test("re-syncing keeps what was typed and drops removed images", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png"));
  rows = [setCell(rows[0], "title", "Keep me"), rows[1]];
  rows = syncRowsToImages(rows, images("1.png", "3.png"));
  assert.deepEqual(rows.map((r) => cellsOf(r).filename), ["1", "3"]);
  assert.equal(rows[0].metadata.title, "Keep me");
});

test("an Excel column copy (one per line, trailing newline) fills down", () => {
  const rows = syncRowsToImages([], images("1.png", "2.png", "3.png"));
  const { rows: out, dropped } = pasteIntoRows(rows, 0, "title", "Alpha\r\nBeta\r\nGamma\r\n");
  assert.deepEqual(out.map((r) => r.metadata.title), ["Alpha", "Beta", "Gamma"]);
  assert.equal(dropped, 0);
});

test("pasting from a middle row starts there; extra lines are counted, not written", () => {
  const rows = syncRowsToImages([], images("1.png", "2.png"));
  const { rows: out, dropped } = pasteIntoRows(rows, 1, "title", "B\nC\nD\n");
  assert.deepEqual(out.map((r) => r.metadata.title), ["", "B"]);
  assert.equal(dropped, 2);
});

test("tags, adult content and a multi-column block map onto the metadata", () => {
  const rows = syncRowsToImages([], images("1.png", "2.png"));
  // A block copied WITH the filename column, pasted on the filename cell.
  const block = "1\tTitle A\tdogs\tDesc A\tYes\tdog, puppy, cute\n2\tTitle B\tcats\tDesc B\tNo\tcat;kitten\n";
  const { rows: out } = pasteIntoRows(rows, 0, "filename", block);
  assert.deepEqual(out.map((r) => cellsOf(r).filename), ["1", "2"]); // pasted, and matching the images
  assert.equal(out[0].metadata.primaryTag, "dogs");
  assert.equal(out[0].metadata.matureContent, true);
  assert.equal(out[1].metadata.matureContent, false);
  assert.deepEqual(out[0].metadata.tags, ["dog", "puppy", "cute"]);
  assert.deepEqual(out[1].metadata.tags, ["cat", "kitten"]);
  const v = validateRows(out, new Set(["1", "2"]));
  assert.equal(v.validRows.length, 2);
});

test("clipboard parsing: quoted multi-line cells, and quotes inside plain text", () => {
  assert.deepEqual(parseClipboardGrid('"line one\nline two"\nnext\n'), [["line one\nline two"], ["next"]]);
  assert.deepEqual(parseClipboardGrid('"Funny" shirt\nSay "hi"\n'), [['"Funny" shirt'], ['Say "hi"']]);
  assert.deepEqual(parseClipboardGrid('"a ""quoted"" word"\tb'), [['a "quoted" word', "b"]]);
  assert.deepEqual(parseClipboardGrid(""), []);
});

const { pasteAt, clearRange, fillDown, rangeToTsv, snapshotCells, restoreCells } = await import(
  "../apps/dashboard/lib/listingSheet.ts"
);

test("one copied value pasted onto a selection fills every selected cell", () => {
  const rows = syncRowsToImages([], images("1.png", "2.png", "3.png"));
  const out = pasteAt(rows, { r0: 0, r1: 2, c0: 4, c1: 4 }, "Yes\r\n").rows;
  assert.deepEqual(out.map((r) => r.metadata.matureContent), [true, true, true]);
});

test("copy a block, paste it elsewhere: same text comes back (multi-line cells included)", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png", "3.png", "4.png"));
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, 'T1\t"tag\tone"\t"two\nlines"\nT2\tx\ty\n').rows;
  const tsv = rangeToTsv(rows, { r0: 0, r1: 1, c0: 1, c1: 3 });
  const moved = pasteAt(rows, { r0: 2, r1: 2, c0: 1, c1: 1 }, tsv).rows;
  assert.deepEqual(cellsOf(moved[2]), { ...cellsOf(rows[0]), filename: "3" });
  assert.deepEqual(cellsOf(moved[3]), { ...cellsOf(rows[1]), filename: "4" });
});

test("Delete clears the selection (filename too - then it's an error); Ctrl+D fills down", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png", "3.png"));
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, "A\nB\nC\n").rows;
  const cleared = clearRange(rows, { r0: 0, r1: 1, c0: 0, c1: 5 });
  assert.deepEqual(cleared.map((r) => [cellsOf(r).filename, r.metadata.title]), [["", ""], ["", ""], ["3", "C"]]);
  assert.ok(sheetIssues(cleared, new Set(["1", "2", "3"])).some((i) => i.row === 0 && i.col === "filename"));
  // The artwork never follows the cell: row 1 still uploads image 1.
  assert.equal(cleared[0].metadata.filename, "1");
  const filled = fillDown(rows, { r0: 0, r1: 2, c0: 1, c1: 1 });
  assert.deepEqual(filled.map((r) => r.metadata.title), ["A", "A", "A"]);
});

test("undo restores by filename, even after a design was removed", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png", "3.png"));
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, "A\nB\nC\n").rows;
  const snap = snapshotCells(rows);
  let edited = clearRange(rows, { r0: 0, r1: 2, c0: 1, c1: 1 });
  edited = syncRowsToImages(edited, images("1.png", "3.png"));
  assert.deepEqual(restoreCells(edited, snap).map((r) => r.metadata.title), ["A", "C"]);
});

const { fillRange, fillHandle } = await import("../apps/dashboard/lib/listingSheet.ts");

test("Ctrl+Enter / fill handle: the same word down a whole column", () => {
  const rows = syncRowsToImages([], images("1.png", "2.png", "3.png", "4.png"));
  const col = fillRange(rows, { r0: 0, r1: 3, c0: 2, c1: 2 }, "baseball");
  assert.deepEqual(col.map((r) => r.metadata.primaryTag), ["baseball", "baseball", "baseball", "baseball"]);
  const one = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, "A\nB\n").rows;
  const dragged = fillHandle(one, { r0: 0, r1: 1, c0: 1, c1: 1 }, 3);
  assert.deepEqual(dragged.map((r) => r.metadata.title), ["A", "B", "A", "B"]);
});


test("save is blocked by any empty column, a bad adult value, or a filename without its image", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png"));
  assert.equal(sheetIssues(rows, new Set(["1", "2"])).length, 8); // 4 empty columns x 2 (adult defaults to No)
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, "T\tp\td\tmaybe\tt1, t2, t3\nT\tp\td\tNo\tt1, t2, t3\n").rows;
  assert.deepEqual(sheetIssues(rows, new Set(["1", "2"])).map((i) => [i.row, i.col]), [[0, "adult_content"]]);
  assert.deepEqual(sheetIssues(rows, new Set(["1"])).map((i) => [i.row, i.col]), [[0, "adult_content"], [1, "filename"]]);
});

test("a pasted filename that isn't the row's design name is an error; the artwork stays the row's own", () => {
  let rows = syncRowsToImages([], images("30.png", "31.png"));
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 0, c1: 0 }, "31\n30.png\n").rows;
  const issues = sheetIssues(rows, new Set(["30", "31"])).filter((i) => i.col === "filename");
  assert.deepEqual(issues.map((i) => i.row), [0, 1]); // "31" on design 30, "30.png" on design 31
  assert.deepEqual(rows.map((r) => r.metadata.filename), ["30", "31"]);
  const fixed = pasteAt(rows, { r0: 0, r1: 0, c0: 0, c1: 0 }, "30\n31.png\n").rows;
  assert.equal(sheetIssues(fixed, new Set(["30", "31"])).filter((i) => i.col === "filename").length, 0);
});

test("every product type starts in Black; a colour the user chose is kept", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png"));
  const colors = rows[0].metadata.productColors ?? {};
  assert.ok(Object.keys(colors).length > 0);
  assert.ok(Object.values(colors).every((c) => /black/i.test(c)), JSON.stringify(colors));
  const slug = Object.keys(colors)[0];
  rows = [{ ...rows[0], metadata: { ...rows[0].metadata, productColors: { ...colors, [slug]: "White" } } }, rows[1]];
  rows = syncRowsToImages(rows, images("1.png", "2.png", "3.png"));
  assert.equal(rows[0].metadata.productColors?.[slug], "White");
  assert.ok(Object.values(rows[2].metadata.productColors ?? {}).every((c) => /black/i.test(c)));
});

const { createPhase } = await import("../apps/dashboard/lib/listingSheet.ts");

test("Create Product step: upload, then listings until the table is complete, then configure", () => {
  assert.equal(createPhase(0, 0), "upload");
  assert.equal(createPhase(0, 5), "upload");
  assert.equal(createPhase(28, 68), "listings");
  assert.equal(createPhase(28, 0), "configure");
});

test("every design starts with all products on except Kids; a chosen set is kept", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png"));
  const on = rows[0].metadata.enabledProducts ?? [];
  assert.ok(on.includes("T-Shirt") && on.includes("Hoodie") && on.includes("Stickers"));
  assert.ok(!on.some((p) => p.startsWith("Kids")), JSON.stringify(on));
  rows = [{ ...rows[0], metadata: { ...rows[0].metadata, enabledProducts: ["Mugs"] } }, rows[1]];
  rows = syncRowsToImages(rows, images("1.png", "2.png"));
  assert.deepEqual(rows[0].metadata.enabledProducts, ["Mugs"]);
});

test("adult content Yes switches the Kids products off", () => {
  let rows = syncRowsToImages([], images("1.png"));
  rows = [{ ...rows[0], metadata: { ...rows[0].metadata, enabledProducts: ["T-Shirt", "Kids", "Kids Hoodie"] } }];
  rows = [setCell(rows[0], "adult_content", "Yes")];
  assert.equal(rows[0].metadata.matureContent, true);
  assert.deepEqual(rows[0].metadata.enabledProducts, ["T-Shirt"]);
});

const { rowsToSheetData } = await import("../apps/dashboard/lib/listingSheet.ts");

test("export: the template's header row, then each row's cells as typed", () => {
  let rows = syncRowsToImages([], images("1.png", "2.png"));
  rows = pasteAt(rows, { r0: 0, r1: 0, c0: 1, c1: 1 }, "T1\ttag1\td1\tYes\ta, b\nT2\ttag2\td2\tNo\tc\n").rows;
  assert.deepEqual(rowsToSheetData(rows), [
    ["filename", "title", "Primary_tag", "description", "adult_content", "supporting_tags"],
    ["1", "T1", "tag1", "d1", "Yes", "a, b"],
    ["2", "T2", "tag2", "d2", "No", "c"],
  ]);
});

test("an uploaded listings sheet fills the matching designs and leaves the table clean", async () => {
  const { applySheetRows } = await import("../apps/dashboard/lib/listingSheet.ts");
  const { metadataFromRow } = await import("../apps/dashboard/lib/parser.ts");
  const sheetRow = (raw: Record<string, unknown>, i: number) => ({ rowNumber: i + 2, raw, metadata: metadataFromRow(raw, {}, []) });
  const sheet = [
    { filename: "2.png", title: "Two", primary_tag: "cat", description: "d2", adult_content: "no", supporting_tags: "a, b" },
    { filename: "1", title: "One", primary_tag: "dog", description: "d1", adult_content: "yes", supporting_tags: "c" },
    { filename: "9.png", title: "No design", primary_tag: "x", description: "x", adult_content: "no", supporting_tags: "x" },
  ].map(sheetRow);
  const imgs = images("1.png", "2.png", "3.png");
  const rows = applySheetRows([], sheet, imgs);
  assert.deepEqual(rows.map((r) => r.metadata.title), ["One", "Two", ""]);
  assert.equal(rows[0].metadata.matureContent, true);
  assert.deepEqual(rows[1].metadata.tags, ["a", "b"]);
  // Defaults still apply (colours / products), and only the design without a row has issues.
  assert.ok(Object.keys(rows[0].metadata.productColors ?? {}).length > 0);
  const issues = sheetIssues(rows, new Set(imgs.keys()));
  assert.ok(issues.length > 0 && issues.every((i) => i.row === 2));
});

test("Colors sheet: a T-shirt colour fills every product with its match, other columns only themselves", async () => {
  const { setRowColor, setColumnColor, colorsToSheetData } = await import("../apps/dashboard/lib/listingSheet.ts");
  const { applyBasicColor } = await import("../apps/dashboard/lib/colorPresets.ts");
  let [row] = syncRowsToImages([], images("1.png"));
  row = setRowColor(row, "t_shirt", "White");
  const matched = applyBasicColor("White");
  assert.equal(row.metadata.productColors.t_shirt, "White");
  for (const [slug, label] of Object.entries(matched)) if (slug !== "t_shirt") assert.equal(row.metadata.productColors[slug], label);
  row = setRowColor(row, "hoodie", "Navy");
  assert.equal(row.metadata.productColors.hoodie, "Navy");
  assert.equal(row.metadata.productColors.t_shirt, "White");
  const rows = setColumnColor(syncRowsToImages([], images("1.png", "2.png")), "hats", "Black");
  assert.deepEqual(rows.map((r) => r.metadata.productColors.hats), ["Black", "Black"]);
  assert.deepEqual(colorsToSheetData(rows, ["hats"]), [["filename", "hats_color"], ["1", "Black"], ["2", "Black"]]);
});

test("every basic colour lands on a colour each product really sells (Shorts has no Navy)", async () => {
  const { applyBasicColor, BASIC_COLORS, paletteFor, resolvePerProductColors } = await import("../apps/dashboard/lib/colorPresets.ts");
  const { SLUG_TO_PRODUCT_LABEL } = await import("../packages/shared/src/index.ts");
  const sells = (slug: string, label: string) => paletteFor(SLUG_TO_PRODUCT_LABEL[slug]).some((c: { label: string }) => c.label === label);
  for (const c of BASIC_COLORS) {
    for (const [slug, label] of Object.entries(applyBasicColor(c.name))) {
      assert.ok(sells(slug, label as string), `${c.name} -> ${slug} "${label}" is not a ${SLUG_TO_PRODUCT_LABEL[slug]} colour`);
    }
  }
  assert.deepEqual(paletteFor("Shorts").map((c: { label: string }) => c.label), ["Heather", "Black", "Military Green", "Creme"]);
  // A stale saved colour is corrected before it is queued.
  const fixed = resolvePerProductColors({ shorts: "Navy" });
  assert.ok(sells("shorts", fixed.shorts), `Navy on shorts became "${fixed.shorts}"`);
});

test("product toggles use the colour list's names (Long Sleeve T-Shirt), and old saves are renamed", async () => {
  const { defaultEnabledProducts, enforceAdultRule } = await import("../apps/dashboard/lib/productGroups.ts");
  const { SLUG_TO_PRODUCT_LABEL } = await import("../packages/shared/src/index.ts");
  const labels = new Set(Object.values(SLUG_TO_PRODUCT_LABEL));
  const apparel = ["T-Shirt", "Hoodie", "Tank", "Crewneck", "Long Sleeve T-Shirt", "Baseball Tee", "Shorts", "Hats", "Bags"];
  for (const p of apparel) assert.ok(defaultEnabledProducts().includes(p) && labels.has(p), p);
  const fixed = enforceAdultRule({ matureContent: false, enabledProducts: ["T-Shirt", "Long Sleeve"] });
  assert.deepEqual(fixed.enabledProducts, ["T-Shirt", "Long Sleeve T-Shirt"]);
});
