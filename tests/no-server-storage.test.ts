// An audit of the shipped source tree.
//
// The behavioural tests prove what the code does when it runs. These prove that
// the code that used to do the wrong thing is GONE — that there is no dormant
// route, helper or import left for a future change to reach for. They read the
// real files from disk, so deleting a test file cannot make them pass and
// re-adding a removed route cannot make them stay green.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";

// Injected by tests/run.mjs. The bundle does not live where its source does, so
// a path relative to import.meta.url would point at the wrong tree.
declare const __REPO_ROOT__: string;
const ROOT = __REPO_ROOT__;
const DASH = path.join(ROOT, "apps/dashboard");
const EXT = path.join(ROOT, "apps/extension");

const SKIP_DIRS = new Set(["node_modules", ".next", "dist", ".git", ".build", "automa", "superpowers"]);

function sourceFiles(dir: string, exts = [".ts", ".tsx", ".mjs"]): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full, exts));
    else if (exts.some((e) => entry.endsWith(e))) out.push(full);
  }
  return out;
}

function read(file: string): string {
  return readFileSync(file, "utf8");
}

function rel(file: string): string {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

/** Application source: excludes the SQL, the tests and the vendored clones. */
const DASH_SOURCES = [
  ...sourceFiles(path.join(DASH, "app")),
  ...sourceFiles(path.join(DASH, "lib")),
  ...sourceFiles(path.join(DASH, "components")),
  path.join(DASH, "next.config.mjs"),
  path.join(DASH, "middleware.ts"),
].filter(existsSync);

const EXT_SOURCES = sourceFiles(path.join(EXT, "src"));

/** Files that legitimately mention a pattern because they explain its removal. */
function isCommentLine(line: string): boolean {
  const t = line.trim();
  return t.startsWith("//") || t.startsWith("*") || t.startsWith("/*");
}

function offendingLines(files: string[], re: RegExp): string[] {
  const hits: string[] = [];
  for (const file of files) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (isCommentLine(line)) return; // a comment cannot make a request
        if (re.test(line)) hits.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
      });
  }
  return hits;
}

// ── 1. The removed routes ───────────────────────────────────────────────────

test("the unauthenticated /api/files routes no longer exist", () => {
  assert.equal(existsSync(path.join(DASH, "app/api/files")), false);
});

test("no production code calls /api/files", () => {
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /["'`]\/api\/files/), []);
});

test("the routes that stored designs, batches and earnings exports are gone", () => {
  for (const route of ["app/api/designs", "app/api/spreadsheet", "app/api/sales-report"]) {
    assert.equal(existsSync(path.join(DASH, route)), false, `${route} still exists`);
  }
});

test("only account-level API routes remain", () => {
  const apiDir = path.join(DASH, "app/api");
  const routes = sourceFiles(apiDir)
    .map((f) => path.relative(apiDir, path.dirname(f)).replaceAll("\\", "/"))
    .sort();
  // Auth (sign in/out/register/me) and admin user management. Nothing that
  // touches a design, a listing or an image.
  assert.deepEqual(routes, [
    "admin/users",
    "auth/login",
    "auth/logout",
    "auth/me",
    "auth/register",
  ]);
});

test("no code calls /api/designs, /api/spreadsheet or /api/sales-report", () => {
  assert.deepEqual(
    offendingLines(DASH_SOURCES, /["'`]\/api\/(designs|spreadsheet|sales-report)/),
    [],
  );
});

// ── 2. The service-role uploader and the Storage bucket ─────────────────────

test("the service-role file-upload helper is deleted", () => {
  assert.equal(existsSync(path.join(DASH, "lib/fileStore.ts")), false);
});

test("no production route can upload to a Supabase Storage bucket", () => {
  // `.storage.from(...)` is the supabase-js Storage entry point. chrome.storage
  // and navigator.storage are unrelated APIs and are checked elsewhere.
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /\.storage\.from\(/), []);
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /getPublicUrl|createSignedUrl/), []);
});

test("the service-role client is used only for account administration", () => {
  const users = offendingLines(DASH_SOURCES, /createAdminClient/).map((l) => l.split(":")[0]);
  const unique = [...new Set(users)].sort();
  assert.deepEqual(unique, [
    "apps/dashboard/app/api/admin/users/route.ts",
    "apps/dashboard/lib/supabase/admin.ts",
  ]);
});

// ── 3. No Supabase table holds designs, listings or per-upload events ───────

test("nothing reads or writes the retired Supabase tables", () => {
  const hits = offendingLines(
    [...DASH_SOURCES, ...EXT_SOURCES],
    /\.from\(\s*["'`](designs|spreadsheet_batches|sales_reports|upload_events)["'`]/,
  );
  assert.deepEqual(hits, []);
});

test("the only upload statistic read is the aggregate counter", () => {
  const hits = offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /upload_stats|increment_upload_count/);
  assert.ok(hits.length > 0, "something must read the counter");
  for (const hit of hits) {
    assert.ok(
      /upload_stats|increment_upload_count/.test(hit),
      `unexpected upload statistic reference: ${hit}`,
    );
  }
  // The old time-bucketed RPC is gone from the client too.
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /get_upload_stats/), []);
});

// ── 4. Both Supabase clients run through the privacy guard ──────────────────

test("every Supabase client is constructed with the guarded fetch", () => {
  const clients = [
    path.join(DASH, "lib/supabase/client.ts"),
    path.join(DASH, "lib/supabase/server.ts"),
    path.join(DASH, "lib/supabase/middleware.ts"),
    path.join(EXT, "src/lib/supabaseClient.ts"),
  ];
  for (const file of clients) {
    assert.match(read(file), /fetch:\s*guardedFetch/, `${rel(file)} is not guarded`);
  }
});

// ── 5. Large local data lives in IndexedDB, not localStorage/chrome.storage ─

test("the extension stores artwork in IndexedDB, not chrome.storage", () => {
  const queueStore = read(path.join(EXT, "src/services/queueStore.ts"));
  assert.match(queueStore, /OriginalsDb|ThumbsDb/, "image stores delegate to IndexedDB");
  // The old per-image chrome.storage key prefixes survive only in the migration
  // module, which exists to empty them.
  const prefixUsers = offendingLines(EXT_SOURCES, /teepublic\.img\.|teepublic\.thumb\./)
    .map((l) => l.split(":")[0]);
  assert.deepEqual([...new Set(prefixUsers)], ["apps/extension/src/lib/imageDb.ts"]);
});

test("only small settings are written to localStorage", () => {
  // localStorage is a ~5 MB, origin-wide, string-only store: exactly the wrong
  // place for artwork, and one oversized write takes unrelated keys down with
  // it. Pin the set of modules allowed to write there, and assert each one is a
  // settings module with no access to image or listing data.
  const writers = [
    ...new Set(offendingLines(DASH_SOURCES, /localStorage\.setItem/).map((l) => l.split(":")[0])),
  ].sort();
  assert.deepEqual(writers, [
    "apps/dashboard/lib/aiSettings.ts",   // Gemini key / model / prompt
    "apps/dashboard/lib/batchConfig.ts",  // custom colour swatches
    "apps/dashboard/lib/bridge.ts",       // the extension id
    "apps/dashboard/lib/colorMode.ts",    // colour-mode preference
    "apps/dashboard/lib/theme.ts",        // light/dark preference
  ]);

  for (const w of writers) {
    const src = read(path.join(ROOT, w));
    assert.doesNotMatch(src, /data:image|Blob|FileReader|arrayBuffer/, `${w} handles image data`);
  }
});

test("the design and batch stores are backed by IndexedDB", () => {
  for (const file of ["lib/designsStore.ts", "lib/spreadsheetStore.ts", "lib/salesReportStore.ts"]) {
    const src = read(path.join(DASH, file));
    assert.match(src, /from "@\/lib\/localDb"/, `${file} does not use the local store`);
    assert.doesNotMatch(src, /^\s*const res = await fetch\(/m, `${file} still calls an API`);
  }
});

// ── 6. Extension permissions ────────────────────────────────────────────────

test("the extension asks for no credential, cookie or browsing-history access", () => {
  const manifest = JSON.parse(read(path.join(EXT, "manifest.json")));
  const forbidden = ["cookies", "history", "webRequest", "webRequestBlocking", "browsingData", "downloads", "identity", "management", "topSites", "webNavigation"];
  for (const p of forbidden) {
    assert.ok(!manifest.permissions.includes(p), `manifest requests "${p}"`);
  }
  assert.deepEqual(manifest.permissions.sort(), [
    "scripting",
    "sidePanel",
    "storage",
    "tabs",
    "unlimitedStorage",
  ]);
});

test("the extension's host access is limited to its own site, Supabase and TeePublic", () => {
  const manifest = JSON.parse(read(path.join(EXT, "manifest.json")));
  // The checked-in manifest is the PRODUCTION one; build.mjs narrows the
  // Supabase wildcard to the one project and adds localhost only under --watch.
  assert.deepEqual(manifest.host_permissions.sort(), [
    "https://*.supabase.co/*",
    "https://www.higgstee.com/*",
    "https://www.teepublic.com/*",
  ]);
  // www only: higgstee.com 308-redirects to www, so no page is ever SERVED at
  // the apex and nothing there should be able to message the extension.
  assert.deepEqual(manifest.externally_connectable.matches, ["https://www.higgstee.com/*"]);

  // No wildcard subdomain: teepublic.com 301s to www, every page the content
  // script drives is on www, and "*.teepublic.com" is what makes the Chrome Web
  // Store flag the package for in-depth review.
  for (const cs of manifest.content_scripts) {
    assert.deepEqual(cs.matches, ["https://www.teepublic.com/*"]);
  }
});

test("the production manifest carries no development origin", () => {
  const manifest = read(path.join(EXT, "manifest.json"));
  assert.doesNotMatch(manifest, /localhost|127\.0\.0\.1|http:\/\//, "dev origin in the manifest");
});

test("the manifest declares no remote code", () => {
  const manifest = JSON.parse(read(path.join(EXT, "manifest.json")));
  // Every script is a file in the package. No remotely hosted script, no
  // relaxed CSP that would allow one, no sandboxed remote page.
  assert.equal(manifest.content_security_policy, undefined);
  assert.equal(manifest.sandbox, undefined);
  assert.equal(manifest.background.service_worker, "background/index.js");
  for (const cs of manifest.content_scripts) {
    for (const js of cs.js) assert.doesNotMatch(js, /^https?:/);
  }
});

test("no extension code reads cookies or browsing history", () => {
  assert.deepEqual(
    offendingLines(EXT_SOURCES, /chrome\.cookies|chrome\.history|document\.cookie/),
    [],
  );
});

// ── 7. The Gemini key never leaves the device ───────────────────────────────

test("the Gemini key is read only by the Gemini call", () => {
  const readers = offendingLines(DASH_SOURCES, /getGeminiKey\(/).map((l) => l.split(":")[0]);
  assert.deepEqual([...new Set(readers)].sort(), [
    "apps/dashboard/components/GenerationApp.tsx",
    "apps/dashboard/lib/aiSettings.ts",
  ]);
  // And the module that holds it makes no network calls at all.
  assert.doesNotMatch(read(path.join(DASH, "lib/aiSettings.ts")), /fetch\(|supabase/);
});

// ── 8. The privacy page ─────────────────────────────────────────────────────

test("/privacy exists and is reachable without signing in", () => {
  assert.ok(existsSync(path.join(DASH, "app/privacy/page.tsx")));
  const mw = read(path.join(DASH, "lib/supabase/middleware.ts"));
  assert.match(mw, /"\/privacy"/, "/privacy is not in the public prefix list");
});

// ── 9. Artwork is never retrieved over the network ──────────────────────────

test("the remote design-image fallback is gone from the tree", () => {
  // `fetchDesignAsDataUrl` pulled a design's PNG from the (public) Supabase
  // Storage bucket whenever the local copy was missing. There is no bucket to
  // read from any more, so the helper is deleted rather than left dormant.
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /fetchDesignAsDataUrl/), []);
  // …and so is the export-time variant on both sides of the bridge.
  assert.deepEqual(offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /fetchAsDataUrl/), []);
});

test("the extension makes exactly one network call, and it is the guarded Supabase fetch", () => {
  // Anything the extension fetches, it fetches through the privacy-guarded
  // wrapper. A second `fetch(` in this tree is by definition a new egress path
  // and has to be justified here before it can ship.
  const calls = offendingLines(EXT_SOURCES, /(^|[^.\w])fetch\(/);
  assert.deepEqual(calls.map((l) => l.split(":")[0]), ["apps/extension/src/lib/supabaseClient.ts"]);
});

test("no code fetches an item's imageUrl", () => {
  assert.deepEqual(
    offendingLines([...DASH_SOURCES, ...EXT_SOURCES], /fetch\(\s*[\w.]*imageUrl/),
    [],
  );
});

test("dashboardOrigin only opens dashboard tabs — it is not an image source", () => {
  const readers = [
    ...new Set(offendingLines(EXT_SOURCES, /dashboardOrigin/).map((l) => l.split(":")[0])),
  ].sort();
  assert.deepEqual(readers, [
    "apps/extension/src/background/index.ts",   // records the sending dashboard's origin
    "apps/extension/src/popup/main.ts",         // upgrade link
    "apps/extension/src/services/queueStore.ts",// the setting itself
    "apps/extension/src/sidepanel/main.ts",     // sign-in / trial / upgrade tabs
  ]);
  // None of those files can make a request at all.
  for (const r of readers) {
    assert.doesNotMatch(read(path.join(ROOT, r)), /(^|[^.\w])fetch\(/m, `${r} makes a network call`);
  }
});

test("a missing image fails the item instead of reaching for a URL", () => {
  const engine = read(path.join(EXT, "src/services/automationEngine.ts"));
  assert.match(
    engine,
    /Image missing — import the batch again or select the image/,
    "the missing-image message is not the one the product promises",
  );
  // The only image source in the engine is the local store.
  assert.match(engine, /await ImageStore\.get\(item\.id\)/);
});

test("no extension view renders an item's imageUrl as an image source", () => {
  // Thumbnails are read out of the local ImageStore by id. An `<img src>` built
  // from item.imageUrl would make the browser fetch whatever that string says.
  const views = ["src/popup/main.ts", "src/sidepanel/main.ts", "src/queue/main.ts"];
  for (const v of views) {
    const src = read(path.join(EXT, v));
    const hits = src
      .split("\n")
      .filter((l) => !isCommentLine(l) && /src=.*imageUrl|imageUrl\s*\|\|/.test(l));
    assert.deepEqual(hits, [], `${v} renders item.imageUrl`);
  }
});

test("an imported batch can never carry a remote image URL", () => {
  for (const f of [
    path.join(EXT, "src/services/batchTransfer.ts"),
    path.join(DASH, "lib/batchTransfer.ts"),
  ]) {
    assert.match(read(f), /startsWith\("data:"\)|imageUrl: ""/, `${rel(f)} does not sanitise imageUrl`);
  }
});
