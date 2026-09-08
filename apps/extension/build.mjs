// Tiny build script: esbuild bundles TS entries, copy static manifest + HTML.
// `node build.mjs` for one-shot, `node build.mjs --watch` for dev.

import { build, context } from "esbuild";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import chokidar from "chokidar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(__dirname, "src");
const DIST = path.join(__dirname, "dist");
const STATIC_DIRS = ["popup", "queue", "sidepanel"]; // dirs w/ HTML/CSS/SVG to copy
const watch = process.argv.includes("--watch");

const entries = {
  "background/index":    path.join(SRC, "background/index.ts"),
  "content/teepublic":   path.join(SRC, "content/teepublic.ts"),
  "popup/main":          path.join(SRC, "popup/main.ts"),
  "queue/main":          path.join(SRC, "queue/main.ts"),
  "sidepanel/main":      path.join(SRC, "sidepanel/main.ts"),
};

// Bake Supabase connection details into the bundle at build time. The anon key
// is public and safe to embed. Set SUPABASE_URL / SUPABASE_ANON_KEY (or reuse
// the dashboard's NEXT_PUBLIC_* vars) before building; if unset, the extension
// builds but the auth/access features stay disabled until rebuilt with them.
const define = {
  __SUPABASE_URL__: JSON.stringify(
    process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  ),
  __SUPABASE_ANON_KEY__: JSON.stringify(
    process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  ),
};

if (!JSON.parse(define.__SUPABASE_URL__) || !JSON.parse(define.__SUPABASE_ANON_KEY__)) {
  console.warn(
    "[extension] WARNING: SUPABASE_URL / SUPABASE_ANON_KEY not set — auth & access gating will be disabled in this build.",
  );
}

const sharedOpts = {
  entryPoints: entries,
  outdir: DIST,
  bundle: true,
  format: "esm",
  target: ["chrome120"],
  platform: "browser",
  // Dev only. A release build must not ship .map files: they embed the full
  // readable TypeScript source in the Chrome Web Store package.
  sourcemap: watch,
  logLevel: "info",
  define,
};

// Emit dist/manifest.json from the checked-in one, with two build-time edits.
// The file on disk is the PRODUCTION manifest; dev affordances are added here so
// they can never be forgotten in a release ZIP.
async function writeManifest() {
  const m = JSON.parse(await fs.readFile(path.join(__dirname, "manifest.json"), "utf8"));

  // Narrow "https://*.supabase.co/*" (every Supabase tenant on the internet) to
  // just this project. Least privilege, and one less thing for review to query.
  const supabaseUrl = JSON.parse(define.__SUPABASE_URL__);
  if (supabaseUrl) {
    const origin = new URL(supabaseUrl).origin + "/*";
    m.host_permissions = m.host_permissions.map((h) =>
      h === "https://*.supabase.co/*" ? origin : h,
    );
  }

  // DEV ONLY — never in a release build. A cleartext http://localhost host
  // permission reads as unfinished software to Chrome review, and
  // externally_connectable on localhost would let ANY program listening on that
  // port drive the automation.
  if (watch) {
    const devOrigins = ["http://localhost:3030/*", "http://127.0.0.1:3030/*"];
    m.host_permissions.push(...devOrigins);
    m.externally_connectable.matches.push(...devOrigins);
  }

  await fs.writeFile(path.join(DIST, "manifest.json"), JSON.stringify(m, null, 2));
}

async function copyStatic() {
  await fs.mkdir(DIST, { recursive: true });
  await writeManifest();
  for (const dir of STATIC_DIRS) {
    const from = path.join(SRC, dir);
    const to = path.join(DIST, dir);
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from)) {
      if (/\.(html|css|svg|png)$/.test(entry)) {
        await fs.copyFile(path.join(from, entry), path.join(to, entry));
      }
    }
  }
  // Icons
  const iconsFrom = path.join(SRC, "icons");
  if (await exists(iconsFrom)) {
    const iconsTo = path.join(DIST, "icons");
    await fs.mkdir(iconsTo, { recursive: true });
    for (const entry of await fs.readdir(iconsFrom)) {
      await fs.copyFile(path.join(iconsFrom, entry), path.join(iconsTo, entry));
    }
  }
  // Fonts (bundled locally — NO CDN; extensions block external font requests)
  const fontsFrom = path.join(SRC, "assets", "fonts");
  if (await exists(fontsFrom)) {
    const fontsTo = path.join(DIST, "assets", "fonts");
    await fs.mkdir(fontsTo, { recursive: true });
    for (const entry of await fs.readdir(fontsFrom)) {
      await fs.copyFile(path.join(fontsFrom, entry), path.join(fontsTo, entry));
    }
  }
}

async function exists(p) {
  try { await fs.access(p); return true; } catch { return false; }
}

if (watch) {
  const ctx = await context(sharedOpts);
  await ctx.watch();
  await copyStatic();
  console.log("[extension] watching for changes");
  chokidar.watch([
    path.join(__dirname, "manifest.json"),
    path.join(SRC, "**/*.{html,css,svg,png}"),
    path.join(SRC, "icons/**/*"),
  ]).on("change", async () => {
    await copyStatic();
    console.log("[extension] static assets refreshed");
  });
} else {
  await build(sharedOpts);
  await copyStatic();
  console.log("[extension] built ->", DIST);
}
