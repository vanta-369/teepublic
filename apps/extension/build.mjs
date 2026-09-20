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

// ── Supabase connection details, baked in at build time ─────────────────────
//
// The anon/publishable key is public and safe to embed in the bundle: it grants
// nothing beyond what RLS and get_my_access() already allow. The SERVICE-ROLE
// key is not, and must never appear here — the guard below refuses to build if
// one is passed by mistake.
//
// Values come from the environment, or from a project env file. Only these four
// names are ever read out of a file; a secret sitting in the same file (e.g.
// SUPABASE_SERVICE_ROLE_KEY) is not loaded and cannot reach the bundle.
const ENV_URL_NAMES = ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"];
const ENV_KEY_NAMES = ["SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"];
const ENV_ALLOWLIST = new Set([...ENV_URL_NAMES, ...ENV_KEY_NAMES]);

// Searched in order; the first file that defines a name wins, and the real
// environment outranks all of them. All are gitignored.
const ENV_FILES = [
  path.join(__dirname, ".env.production"),
  path.join(__dirname, ".env.local"),
  path.join(__dirname, ".env"),
  // The dashboard's file is the practical default: both apps talk to the same
  // Supabase project, and keeping one copy of the URL + publishable key means
  // they cannot drift apart between a dashboard deploy and an extension build.
  path.join(__dirname, "..", "dashboard", ".env.local"),
];

async function loadEnvFiles() {
  const loaded = {};
  const sources = {};
  for (const file of ENV_FILES) {
    if (!(await exists(file))) continue;
    const text = await fs.readFile(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
      if (!m) continue;
      const [, name, rawValue] = m;
      if (!ENV_ALLOWLIST.has(name)) continue;          // secrets are never read
      if (loaded[name] !== undefined) continue;        // first file wins
      loaded[name] = rawValue.trim().replace(/^["']|["']$/g, "");
      sources[name] = path.relative(path.join(__dirname, "..", ".."), file);
    }
  }
  return { loaded, sources };
}

const { loaded: fileEnv, sources: envSources } = await loadEnvFiles();
const pick = (names) => {
  for (const n of names) {
    if (process.env[n]) return { value: process.env[n], name: n, from: "environment" };
  }
  for (const n of names) {
    if (fileEnv[n]) return { value: fileEnv[n], name: n, from: envSources[n] };
  }
  return { value: "", name: names[0], from: null };
};

const supabaseUrlVar = pick(ENV_URL_NAMES);
const supabaseKeyVar = pick(ENV_KEY_NAMES);

const define = {
  __SUPABASE_URL__: JSON.stringify(supabaseUrlVar.value),
  __SUPABASE_ANON_KEY__: JSON.stringify(supabaseKeyVar.value),
};

/** A key that grants more than the browser should ever hold. Both the legacy
 *  service_role JWT and the newer `sb_secret_…` form are refused outright. */
function isSecretKey(key) {
  if (key.startsWith("sb_secret_")) return true;
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    return JSON.parse(Buffer.from(parts[1], "base64url").toString()).role === "service_role";
  } catch {
    return false;
  }
}

if (supabaseKeyVar.value && isSecretKey(supabaseKeyVar.value)) {
  console.error(
    `\n[extension] BUILD REFUSED: ${supabaseKeyVar.name} holds a SERVICE-ROLE / secret key.\n` +
      "  That key must never ship in a browser extension. Use the anon /\n" +
      "  publishable key (Supabase → Project Settings → API).\n",
  );
  process.exit(1);
}

// A release build with auth compiled out would ship an extension that cannot
// gate anything. Fail loudly instead — silence here is the dangerous outcome.
// `--watch` (dev) still warns and continues, so the DOM automation can be
// worked on without credentials.
if (!supabaseUrlVar.value || !supabaseKeyVar.value) {
  const missing = [
    !supabaseUrlVar.value && ENV_URL_NAMES.join(" or "),
    !supabaseKeyVar.value && ENV_KEY_NAMES.join(" or "),
  ].filter(Boolean);
  const message =
    `Supabase is not configured: set ${missing.join(", ")}.\n` +
    `  Either export them, or put them in one of:\n` +
    ENV_FILES.map((f) => `    ${path.relative(path.join(__dirname, "..", ".."), f)}`).join("\n");
  if (watch) {
    console.warn(`\n[extension] WARNING: ${message}\n  Auth & access gating are DISABLED in this dev build.\n`);
  } else {
    console.error(`\n[extension] BUILD FAILED: ${message}\n`);
    process.exit(1);
  }
} else {
  console.log(
    `[extension] Supabase configured from ${supabaseUrlVar.from} ` +
      `(${supabaseUrlVar.name}, ${supabaseKeyVar.name}) — auth & access gating ENABLED`,
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
