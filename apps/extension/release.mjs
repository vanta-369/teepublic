// Package the compiled extension as a Chrome Web Store ZIP.
//
// The rule this script exists to enforce: the ZIP contains the CONTENTS of
// dist/ and nothing else. No TypeScript source, no .env, no tests, no source
// maps, no node_modules, no repo documentation. Those are either useless to
// Chrome or actively harmful in a public package — a stray .map file publishes
// the whole readable source, and a stray .env publishes a secret.
//
// It is deliberately a separate step from `build`, so a release is an explicit
// act. It re-runs the build first (a stale dist is the classic release bug),
// then verifies the output before it will write an archive:
//
//   • manifest is present, MV3, has a version, and names no dev origin
//   • auth is actually compiled in (a build without credentials cannot ship)
//   • no .map / .env / .ts / dotfile anywhere in the tree
//   • no service-role or secret-shaped key in any bundled byte
//
// Any failure aborts before the ZIP is written. Usage:  npm run release

import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(__dirname, "dist");
const OUT_DIR = path.join(__dirname, "release");

/** Never allowed inside the package, whatever produced it. */
const FORBIDDEN = [
  { re: /\.map$/i, why: "source map (publishes readable source)" },
  { re: /\.tsx?$/i, why: "TypeScript source" },
  { re: /(^|[/\\])\.env/i, why: "environment file (may hold a secret)" },
  { re: /(^|[/\\])\./, why: "dotfile" },
  { re: /(^|[/\\])node_modules([/\\]|$)/i, why: "node_modules" },
  { re: /\.(test|spec)\./i, why: "test file" },
  { re: /(^|[/\\])(tests?|__tests__)([/\\]|$)/i, why: "test directory" },
  { re: /\.(md|rar|zip|log)$/i, why: "documentation or archive" },
];

async function walk(dir, base = dir) {
  const out = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full, base)));
    else out.push(path.relative(base, full).replaceAll("\\", "/"));
  }
  return out.sort();
}

function fail(message) {
  console.error(`\n[release] ABORTED: ${message}\n`);
  process.exit(1);
}

// ── 1. Always package a freshly built dist ──────────────────────────────────
console.log("[release] building…");
const built = spawnSync(process.execPath, [path.join(__dirname, "build.mjs")], {
  stdio: "inherit",
  cwd: __dirname,
});
if (built.status !== 0) fail("the build failed — nothing was packaged");

// ── 2. Inspect what the build produced ──────────────────────────────────────
const files = await walk(DIST);
if (files.length === 0) fail("dist/ is empty");

for (const f of files) {
  for (const { re, why } of FORBIDDEN) {
    if (re.test(f)) fail(`dist/${f} must not ship — ${why}`);
  }
}

const manifest = JSON.parse(await fs.readFile(path.join(DIST, "manifest.json"), "utf8"));
if (manifest.manifest_version !== 3) fail("manifest_version is not 3");
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version ?? "")) fail(`invalid version ${manifest.version}`);

const manifestText = JSON.stringify(manifest);
if (/localhost|127\.0\.0\.1|"http:\/\//.test(manifestText)) {
  fail("the manifest names a development origin — was this built with --watch?");
}

// Every script the manifest references must exist in the package, and none of
// them may be a URL: that is what "no remote code" means in practice.
const declared = [
  manifest.background?.service_worker,
  ...(manifest.content_scripts ?? []).flatMap((c) => c.js ?? []),
].filter(Boolean);
for (const script of declared) {
  if (/^https?:/i.test(script)) fail(`manifest references remote code: ${script}`);
  if (!files.includes(script)) fail(`manifest references a missing file: ${script}`);
}

// ── 3. Inspect the compiled bytes ───────────────────────────────────────────
let configuredUrl = null;
let anonKeyFound = false;
for (const f of files.filter((n) => n.endsWith(".js"))) {
  const code = await fs.readFile(path.join(DIST, f), "utf8");

  // Look for KEYS, not for the words. supabase-js ships JSDoc that says
  // "never expose your `service_role` key in the browser" — matching that text
  // would fail every build for the very comment warning against the mistake.
  if (/sb_secret_[A-Za-z0-9_-]{8,}/.test(code)) fail(`${f} contains an sb_secret_ key`);
  const envLeak = code.match(/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'`][^"'`]+/);
  if (envLeak) fail(`${f} embeds a service-role key value`);
  // A legacy service_role JWT, base64 in the bundle.
  for (const jwt of code.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g) ?? []) {
    try {
      const claims = JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString());
      if (claims.role === "service_role") fail(`${f} embeds a service-role JWT`);
    } catch { /* not a JWT — nothing to check */ }
  }
  // The dashboard's dev origin. (supabase-js carries its own unused default,
  // `var GOTRUE_URL = "http://localhost:9999"`, which is library furniture and
  // not a dev server of ours — so match the port we actually run on.)
  if (/https?:\/\/(localhost|127\.0\.0\.1):3030/.test(code)) fail(`${f} points at the dev dashboard`);

  const url = code.match(/https:\/\/[a-z0-9]+\.supabase\.co/)?.[0];
  if (url) configuredUrl = url;
  if (/sb_publishable_[A-Za-z0-9_-]{8,}/.test(code)) anonKeyFound = true;
  for (const jwt of code.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\./g) ?? []) {
    try {
      if (JSON.parse(Buffer.from(jwt.split(".")[1], "base64url").toString()).role === "anon") {
        anonKeyFound = true;
      }
    } catch { /* not a JWT */ }
  }
}

// Auth compiled in is the thing that must be true before this ships. A build
// without it produces an extension that gates nothing.
if (!configuredUrl) {
  fail("no Supabase URL is compiled into the bundle — auth & access gating would be OFF");
}
if (!configuredUrl.startsWith("https://")) fail(`Supabase URL is not https: ${configuredUrl}`);
if (!anonKeyFound) {
  fail("no anon/publishable key is compiled into the bundle — auth & access gating would be OFF");
}

// ── 4. Write the ZIP ────────────────────────────────────────────────────────
// Chrome wants the manifest at the ROOT of the archive, so the contents of
// dist/ are zipped, not the dist/ folder itself.
const entries = [];
for (const f of files) entries.push({ name: f, data: await fs.readFile(path.join(DIST, f)) });
const archive = makeZip(entries);

await fs.mkdir(OUT_DIR, { recursive: true });
const name = `higgstee-extension-v${manifest.version}.zip`;
const outPath = path.join(OUT_DIR, name);
await fs.writeFile(outPath, archive);

const bytes = await fs.readFile(outPath);
const sha256 = createHash("sha256").update(bytes).digest("hex");

console.log(`\n[release] ${name}`);
console.log(`[release] path    ${outPath}`);
console.log(`[release] size    ${(bytes.length / 1024).toFixed(1)} KB`);
console.log(`[release] entries ${files.length}`);
console.log(`[release] sha256  ${sha256}`);
console.log(`[release] version ${manifest.version} · Supabase configured · auth ENABLED\n`);
for (const f of files) console.log(`           ${f}`);

// ── A minimal, deterministic ZIP writer ─────────────────────────────────────
//
// Adding a packaging dependency for ~70 lines of well-specified format would be
// a poor trade for a build that ships to users. Timestamps are pinned to the
// DOS epoch rather than "now", so rebuilding the same dist/ produces a
// byte-identical archive — which is what makes the SHA-256 below meaningful as
// a check that the reviewed bytes are the uploaded bytes.

// This section sits BELOW the steps that call it, so everything here has to be
// a hoisted function declaration — a module-level `const` table would still be
// in its temporal dead zone when makeZip runs.
function crcTable() {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
}

function crc32(buf, table) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

function makeZip(entries) {
  const DOS_TIME = 0;      // 00:00:00
  const DOS_DATE = 0x0021; // 1980-01-01
  const table = crcTable();
  const local = [];
  const central = [];
  let offset = 0;

  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data, table);
    const deflated = deflateRawSync(data, { level: 9 });
    // Store instead of deflate when compression does not pay — same rule every
    // zip tool uses, and it keeps tiny files honest.
    const useDeflate = deflated.length < data.length;
    const body = useDeflate ? deflated : data;
    const method = useDeflate ? 8 : 0;

    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);   // local file header signature
    header.writeUInt16LE(20, 4);           // version needed
    header.writeUInt16LE(0, 6);            // flags
    header.writeUInt16LE(method, 8);
    header.writeUInt16LE(DOS_TIME, 10);
    header.writeUInt16LE(DOS_DATE, 12);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(nameBuf.length, 26);
    header.writeUInt16LE(0, 28);           // extra field length
    local.push(header, nameBuf, body);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);      // central directory signature
    dir.writeUInt16LE(20, 4);              // version made by
    dir.writeUInt16LE(20, 6);              // version needed
    dir.writeUInt16LE(0, 8);               // flags
    dir.writeUInt16LE(method, 10);
    dir.writeUInt16LE(DOS_TIME, 12);
    dir.writeUInt16LE(DOS_DATE, 14);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt16LE(0, 30);              // extra
    dir.writeUInt16LE(0, 32);              // comment
    dir.writeUInt16LE(0, 34);              // disk number start
    dir.writeUInt16LE(0, 36);              // internal attributes
    dir.writeUInt32LE(0o644 << 16, 38);    // external attributes (rw-r--r--)
    dir.writeUInt32LE(offset, 42);         // local header offset
    central.push(dir, nameBuf);

    offset += header.length + nameBuf.length + body.length;
  }

  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);        // end of central directory
  end.writeUInt16LE(0, 4);                 // this disk
  end.writeUInt16LE(0, 6);                 // disk with central directory
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);                // comment length

  return Buffer.concat([...local, centralBuf, end]);
}
