// Test runner for the monorepo.
//
// There was no test setup here before, and adding one had to clear two hurdles
// without pulling in a new dependency tree:
//
//   1. The tests import real application modules, which are TypeScript, use the
//      `@/…` path alias, and import `@teepublic/shared` — whose package `main`
//      points straight at a .ts file inside node_modules. Node's built-in type
//      stripping refuses to touch node_modules, so plain `node --test` cannot
//      load them.
//   2. The extension's Supabase config is injected at build time by esbuild
//      `define`, so a module that reads it is only meaningful once bundled.
//
// esbuild is already a dependency (the extension builds with it), so each test
// file is bundled exactly the way the app is — same aliases, same defines — and
// the bundles are handed to Node's built-in test runner. That also means a test
// exercises the code as it actually ships, not a re-implementation of it.
//
// Usage:  node tests/run.mjs            (all tests)
//         node tests/run.mjs upload     (only files matching "upload")

import { build } from "esbuild";
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, ".build");

const filter = process.argv[2] ?? "";

const all = (await fs.readdir(__dirname)).filter((f) => f.endsWith(".test.ts"));
const files = filter ? all.filter((f) => f.includes(filter)) : all;

if (files.length === 0) {
  console.error(`No test files match ${JSON.stringify(filter)}. Available: ${all.join(", ")}`);
  process.exit(1);
}

await fs.rm(OUT, { recursive: true, force: true });
await fs.mkdir(OUT, { recursive: true });

await build({
  entryPoints: files.map((f) => path.join(__dirname, f)),
  outdir: OUT,
  outExtension: { ".js": ".mjs" },
  bundle: true,
  format: "esm",
  platform: "node",
  target: ["node20"],
  // Resolve the dashboard's "@/…" alias exactly as next.config/tsconfig do, so
  // a test can import the real module graph.
  alias: { "@": path.join(ROOT, "apps/dashboard") },
  // The extension reads these through esbuild `define`; give the tests a
  // recognisable fake project so nothing can accidentally reach a real one.
  define: {
    __SUPABASE_URL__: JSON.stringify("https://test-project.supabase.co"),
    __SUPABASE_ANON_KEY__: JSON.stringify("test-anon-key"),
    "process.env.NEXT_PUBLIC_SUPABASE_URL": JSON.stringify("https://test-project.supabase.co"),
    "process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY": JSON.stringify("test-anon-key"),
    // Bundles live in tests/.build, so import.meta.url would resolve the repo
    // root one directory too deep for the tests that read source files.
    __REPO_ROOT__: JSON.stringify(ROOT),
  },
  // Node built-ins the test files use, plus SheetJS: it resolves `stream` and
  // friends through a dynamic require that an ESM bundle cannot inline, and it
  // is not the code under test - leave it to Node's resolver.
  external: ["node:*", "xlsx"],
  logLevel: "warning",
});

const child = spawn(
  process.execPath,
  [
    "--test",
    // supabase-js keeps a token auto-refresh timer alive once a client is
    // constructed, so a run that exercises a real client never reaches an empty
    // event loop. The results are already in by then.
    "--test-force-exit",
    ...files.map((f) => path.join(OUT, f.replace(/\.ts$/, ".mjs"))),
  ],
  { stdio: "inherit", cwd: ROOT },
);
child.on("exit", (code) => process.exit(code ?? 1));
