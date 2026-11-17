// The TeePublic listing exporter (apps/extension/src/lib/listingCore.ts):
// reading a public design page into title / main tag / supporting tags /
// description, and writing a valid .xlsx. Fixtures are the live page's own
// strings (checked 2026-11).

import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, strFromU8 } from "fflate";

const { titleFromHeading, supportingTags, tagsLine, rowsToTable, toXlsx, parseListing, designImageFromHtml, tagsFromHtml } =
  await import("../apps/extension/src/lib/listingCore.ts");
const { LISTING } = await import("../apps/extension/src/lib/selectors.ts");

test("title comes from the h1's title attribute, which may itself contain ' - '", () => {
  assert.equal(titleFromHeading("BREWERS - Brewers - T-Shirt", "BREWERS T-Shirt"), "BREWERS");
  assert.equal(titleFromHeading("Back - To - Back - Brewers - T-Shirt", ""), "Back - To - Back");
  // No usable attribute: the text minus the product word.
  assert.equal(titleFromHeading("", "Milwaukee Brewers T-Shirt"), "Milwaukee Brewers T-Shirt");
});

test("supporting tags drop the main tag (any case) and duplicates, keep page order", () => {
  const all = ["brewers", "baseball", "Brew Crew", "baseball", " milwaukee ", ""];
  assert.deepEqual(supportingTags(all, "Brewers"), ["baseball", "Brew Crew", "milwaukee"]);
  assert.equal(tagsLine({ mainTag: "brewers", tags: ["baseball", "mke"] }), "brewers, baseball, mke");
});

test("the main tag is read from the page's dataLayer script", () => {
  const js = `dataLayer.push({"design__price_usd":16.0,"design__primary_tag":"brewers","design__owner_type":"designer"})`;
  assert.equal(js.match(LISTING.primaryTagJs)?.[1], "brewers");
  assert.equal(`"design_primary_tag": "brew crew",`.match(LISTING.primaryTagJs)?.[1], "brew crew");
});

test("a design page parses into one row", () => {
  // Just enough of a Document for parseListing.
  const tags = ["brewers", "baseball", "brew crew"].map((t) => ({ getAttribute: (n: string) => (n === "data-gtm-result" ? t : null), textContent: t }));
  const nodes: Record<string, unknown> = {
    "h1[title]": { getAttribute: () => "BREWERS - Brewers - T-Shirt", textContent: "BREWERS T-Shirt" },
    'p.m-design-details__description-text[data-utilities--read-more-target="content"]': { textContent: "\n  BREWERS fan shirt\n" },
  };
  const doc = {
    querySelector: (s: string) => nodes[s] ?? null,
    querySelectorAll: (s: string) => (s === LISTING.tagLinks[0] ? tags : []),
  } as unknown as Document;
  const row = parseListing(doc, `{"design__primary_tag":"brewers"}`, "81378182", "https://www.teepublic.com/t-shirt/81378182-brewers");
  assert.deepEqual(row, {
    id: "81378182", url: "https://www.teepublic.com/t-shirt/81378182-brewers",
    title: "BREWERS", mainTag: "brewers", tags: ["baseball", "brew crew"], description: "BREWERS fan shirt",
  });
});

test("tags from raw HTML (trend badges): main tag first, then the rest, no DOM needed", () => {
  const pill = (t: string, i: number) =>
    `<a data-search--impressions-target="impression" data-gtm-name="designersAppliedTags" data-gtm-result="${t}" data-gtm-position="${i}" class="link gtmDesignersAppliedTag">`;
  const html = `<script>dataLayer.push({"design__primary_tag":"brewers"})</script>` +
    ["Brewers", "baseball", "brew crew", "Tom &amp; Jerry"].map(pill).join("\n");
  assert.deepEqual(tagsFromHtml(html), ["Brewers", "baseball", "brew crew", "Tom & Jerry"]);
  assert.deepEqual(tagsFromHtml("<html>challenge</html>"), []);
});

test("a design's picture: og:image without the watermark, at card size, TeePublic's CDN only", () => {
  const live = `<meta property="og:image" content="https://images.teepublic.com/derived/production/designs/81378182_0/1759767120/i_p:c_262c3a,bnr_1,wmk,s_630,q_90.jpg">`;
  assert.equal(designImageFromHtml(live),
    "https://images.teepublic.com/derived/production/designs/81378182_0/1759767120/i_p:c_262c3a,s_313,q_90.jpg");
  assert.equal(designImageFromHtml(`<meta property="og:image" content="https://evil.example/x.jpg">`), "");
  assert.equal(designImageFromHtml("<html>challenge</html>"), "");
});

test(".xlsx: a valid package with one sheet, header first, text escaped", () => {
  const rows = [{ id: "1", url: "u", title: `Tom & "Jerry" <3`, mainTag: "cats", tags: ["mice", "cartoon"], description: "a\u0001b" }];
  const files = unzipSync(toXlsx(rowsToTable(rows)));
  for (const f of ["[Content_Types].xml", "_rels/.rels", "xl/workbook.xml", "xl/_rels/workbook.xml.rels", "xl/styles.xml", "xl/worksheets/sheet1.xml"]) {
    assert.ok(files[f], `missing ${f}`);
  }
  const sheet = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(sheet, /<c r="A1" t="inlineStr" s="1"><is><t xml:space="preserve">Design ID<\/t>/);
  assert.match(sheet, /Tom &amp; &quot;Jerry&quot; &lt;3/);
  assert.match(sheet, /<c r="D2"[^>]*><is><t xml:space="preserve">mice, cartoon<\/t>/);
  assert.match(sheet, /<c r="E2"[^>]*><is><t xml:space="preserve">cats, mice, cartoon<\/t>/);
  assert.ok(!sheet.includes("\u0001"), "control characters would make Excel refuse the file");
});
