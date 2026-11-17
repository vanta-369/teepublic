# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first batch upload manager for [TeePublic](https://www.teepublic.com), now with a Supabase-backed SaaS access layer. Two products in one npm-workspace monorepo talk over Chrome's messaging bridge:

- **Dashboard** (`apps/dashboard`) — Next.js 15 / React 19 / Tailwind, runs on `localhost:3030`. Parses spreadsheets **or** generates listings with Gemini, validates, previews, and pushes a queue to the extension. Also hosts auth, the account/access gates, and the admin panel. Designs, listings and artwork live in the browser's IndexedDB — see **Local-first data** below, which is the single most important constraint in this repo.
- **Extension** (`apps/extension`) — MV3 Chrome extension, esbuild-bundled. Receives the queue, persists it in `chrome.storage.local`, and drives the TeePublic upload pages through a content script.
- **Shared** (`packages/shared`) — pure TypeScript types + the wire protocol + the `AccessState` contract, consumed by both.

## Commands

Package manager is **npm** (root `package-lock.json` + npm-workspace scripts). The README says `pnpm` — that is stale; ignore it. The `pnpm-lock.yaml` under `automa/` belongs to a vendored reference clone, not this project.

```bash
npm install                 # from repo root — installs all workspaces

npm run dev:dashboard       # next dev on :3030
npm run dev:dashboard:turbo # same, with Turbopack — ~2x faster route compiles
npm run dev:extension       # esbuild --watch → apps/extension/dist/
npm run build:extension     # one-shot extension build
npm run build:dashboard     # next build

# per-workspace checks (no shared root aliases):
npm run typecheck --workspace=@teepublic/extension   # tsc --noEmit
npm run lint      --workspace=@teepublic/dashboard   # next lint
```

**Never run `next build` while `next dev` is running** — both write to the same
`apps/dashboard/.next`, and the production build replaces the dev server's CSS
chunks, so every page renders unstyled until you stop the server, delete
`.next`, and restart. Deleting `.next` also wipes `.next/cache/webpack`, which
makes the next visit to every route recompile from scratch (a first visit costs
1–6s in dev; ~20s for `/dashboard/analytics`, the recharts route). Warm
navigation is ~0.2–0.7s.

```bash
npm test                    # node tests/run.mjs - esbuild-bundles tests/*.test.ts
                            # and runs them under node --test
npm test upload             # only test files whose name contains "upload"
npm run typecheck           # tsc --noEmit for BOTH workspaces
npm run verify              # typecheck + test + both builds, in order
```

`next lint` in `apps/dashboard` is **not configured** — there is no ESLint config in
the repo, so the script drops into Next's interactive setup prompt and fails in a
non-interactive shell. Use `npm run typecheck` instead; fixing or removing the
`lint` script is outstanding.

The test suite (`tests/`) is mostly about the privacy invariants below: what may
go on the wire, what must stay local, and what the migrations declare. It bundles
each test with esbuild before running so the tests import the REAL application
modules — path aliases, the `@teepublic/shared` TS package and the extension's
build-time `define`s all resolve exactly as they do in a build.

### Loading / rebuilding the extension

`build.mjs` bakes the Supabase URL + anon key into the bundle at build time via esbuild `define`. Set `SUPABASE_URL` / `SUPABASE_ANON_KEY` (or reuse the dashboard's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) **before** building, or auth/access gating is compiled out with a warning. After building, load `apps/extension/dist` as an unpacked extension at `chrome://extensions`. The dashboard connects **only** to the published Web Store extension (`EXTENSION_ID` = `obkkmfkhfofjemedkdmemdadbcodjdpn` and `EXTENSION_STORE_URL` in `lib/nav.ts`); the manual-ID "Advanced" panel was removed at the owner's request (2026-11-17), so an unpacked build (different ID) won't connect to the dashboard.

### Dashboard env

Copy `apps/dashboard/.env.example` → `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` (used only by `lib/supabase/admin.ts` — never expose to the browser or the extension).

## Architecture — the parts that span multiple files

### The dashboard ↔ extension wire protocol (`packages/shared/src/protocol.ts`)

The dashboard sends `chrome.runtime.sendMessage(extensionId, …)`; the extension's `onMessageExternal` listener receives it. **Images are transported separately from metadata on purpose:** `QUEUE_INIT` carries the batch with every `imageUrl` blanked to `""`, then each design's (multi-MB base64) image follows in its own `QUEUE_IMAGE` message. This keeps any single message under Chrome's 64 MiB runtime-message cap. In the extension, each image is stored under its **own** key in the `ImageStore` — *not* inside the batch object — because rewriting the whole batch on every image arrival was O(N²) and filled storage (`FILE_ERROR_NO_SPACE`). That store is now backed by **IndexedDB** (`src/lib/imageDb.ts`), not `chrome.storage.local`. `apps/dashboard/lib/bridge.ts` (`sendQueueToExtension`) is the sender; `apps/extension/src/background/index.ts` is the receiver.

The sender also takes a `resolveImage` callback. Artwork is NOT carried on the queue item: `sendQueueToExtension` reads one design at a time out of the dashboard's local IndexedDB, so a 200-design batch never holds 200 images in memory, and the batch that gets stored anywhere is metadata-only.

### Extension automation (the hard part)

- **`background/index.ts`** — MV3 service worker. Routes external + internal messages, persists via `QueueStore`/`SettingsStore`/`ImageStore`, and owns the toolbar → side-panel behavior. On every wake-up it self-heals: any item stuck in `running` (SW was suspended mid-upload) is reset to `queued`.
- **`services/automationEngine.ts`** — the orchestrator ("brain"). Picks the next item, owns retries + human-like inter-item delays, and **never touches the DOM**. Two modes:
  - **single** — one design at a time via `quick_create`.
  - **bulk** — dispatches all selected designs to `bulk_uploader`; the content script then *self-drives* across the many `/designs/<id>/edit` pages it loads, surviving each navigation via `chrome.storage` run-state; the engine just monitors until every item reports a terminal status.
- **`content/teepublic.ts`** — a **thin DOM driver** injected into `*.teepublic.com`. Fills forms and clicks Publish. Because a successful Publish navigates the page and destroys the `sendResponse` callback, terminal status flows back over resilient fire-and-forget messages instead: `ITEM_STATUS` and `PUBLISHED_URL_DETECTED` (the freshly-loaded content script on a `/t-shirt/<slug>` listing announces success). The engine also polls tab URL + stored status as a fallback before ever downgrading an item to failed — this is what prevents re-publishing the same design.

- **`content/storeDelete.ts`** — bulk delete on the owner's store page (imported by `teepublic.ts`, inert on `/designs*`). Checkbox overlays + one floating bar; deletes one design at a time through TeePublic's own card menu → Delete → confirm (a native `confirm()` is answered via the SW's `TP_AUTO_CONFIRM`, MAIN-world `executeScript`). Run state (design ids only) lives in `chrome.storage.local` `teepublic.storeDelete` and resumes across page loads; `ASSERT_ACCESS` every iteration. Selectors in `STORE` — unverified against the live page when written.

- **`content/listingExport.ts`** — floating lime icon on any page with design cards (store, search; never `/designs*`). Opens a panel that GETs each card's public `/t-shirt/<id>` page (same origin, 3 at a time), parses title / main tag / supporting tags / description (`lib/listingCore.ts`, selectors in `LISTING`, pinned by `tests/listing-export.test.ts`), and offers copy buttons + an `.xlsx` download (hand-written workbook zipped with `fflate`). Nothing is stored or sent off the tab. The earnings tables (`components/dashboard.tsx`) get a picture per design id the same way: `DESIGN_IMAGES` → `services/designImages.ts` reads `og:image` from the public design page (cached in `teepublic.designImages`), and `withRemoteImages` (`lib/designThumbs.ts`) uses it when the local library has no title match. `storeDelete.ts` also paints each card's upload date ABOVE the picture, read from the `/designs/<id>_<n>/<unix>/` stamp in the image URL. (A trending-tag badge / "⛏ Scrape" feature and a merge of the owner's "TP-Design Scraper" extension were built and then removed at the owner's request, 2026-11-16 - don't reintroduce them unasked; the Scraper is kept as its own extension under `Teepublic Scraper/`.)

**Status invariants worth respecting when editing:** succeeded items are never downgraded; `succeeded` items get their stored image freed, `failed` items keep it (so Retry has the artwork); pressing Start re-queues *selected* `failed` items.

### Selectors are centralized — fix them in ONE place

TeePublic's React app is volatile. Every DOM selector lives in `apps/extension/src/lib/selectors.ts` (`TP` for single/quick-create, `BULK` for the bulk uploader), each as an ordered candidate list (first match wins). When automation breaks after a TeePublic redesign, fix it here — do not scatter selectors into the content script. Note some TeePublic controls (Get Started, Next Design) are styled `<div>`s, not real buttons, so `:contains()` text fallbacks and `fullClick` matter.

### Access control — one source of truth, never trust the client

This is the single most important cross-cutting rule. Entitlement is resolved **only** by the Supabase RPC `public.get_my_access()` (defined in `apps/dashboard/supabase/migrations/0005_saas_access.sql`), which computes the *effective* status server-side (trials expire by the DB clock, not a cron). Its return shape is the `AccessState` type in `packages/shared/src/access.ts` — the shared contract all three consumers read:

- **Dashboard middleware** (`lib/supabase/middleware.ts`) gates every non-API route by effective status → routes to `/verify-email`, `/pending`, `/trial-expired`, `/suspended`, or the app. Uses `auth.getUser()` (revalidates the JWT), never `getSession()`.
- **Dashboard API routes** call `requireAccess()` (`lib/access.ts`) — mutating routes require `can_access`; some reads are allowed in the expired/"limited" state.
- **Extension** calls `assertCanAccess()` (`src/lib/access.ts`) at the top of every automation action **and again on every loop iteration** — no caching, no stored plan/status. Fail-safe: if access can't be confirmed live, automation is paused/denied. `fetchAccess()` deliberately calls `auth.getUser()` first to force a token refresh (a stale side-panel token would make the RPC run anonymously and wrongly lock a valid user).

Sensitive `profiles` columns (`plan`, `trial_*`, `account_status`, `approved`) have **no user UPDATE policy** — they're mutated only by `SECURITY DEFINER` `admin_*` RPCs (which check `is_admin()`) or the service role. When adding a gated feature, gate it on the **server** (RPC/route), not on a client boolean. See `docs/ARCHITECTURE.md` for the full SaaS design (note: some folder layout there, e.g. `app/(public)/` route groups, is aspirational and does not match the current filesystem — trust the actual files).

### Dashboard two-mode flow

`components/UploaderApp.tsx` toggles between `spreadsheet` and `generate` modes:
- **spreadsheet** ("From spreadsheet") — images, optionally with a listings `.xlsx`/`.csv` dropped alongside (or later via "Upload listings file"): `applySheetRows` (`lib/listingSheet.ts`) fills matching designs by filename stem, so the table step is skipped when nothing is missing. Each image gets a row in an Excel-like grid (`components/ListingSheet.tsx`; data ops in `lib/listingSheet.ts`, pinned by `tests/listing-sheet.test.ts`) with the old template's metadata columns. It opens in a full-screen `ListingsView` after an upload and stays until closed; ranges, row/column selection, Excel-format copy/paste, Delete, Ctrl+D, undo by filename. Deleting a row removes that design from the batch. It yields the same `ParsedRow[]` the parser did (`metadataFromRow`), matched by filename **stem** (`1` matches `1.png`); `lib/validator.ts` validates, `lib/queue.ts` (`buildQueue`) assembles the `QueueBatch`. Colors / enabled products are set per design in the design card (the template's Sheet2/Sheet3 are not read). `lib/parser.ts` is no longer used by this page. The page shows one step at a time, derived by `createPhase(images, issues)`: `upload` (hero `Dropzone variant="hero"` only) → `listings` (one quiet row; table open) → `configure` (every design as a `DesignCard` in a grid + Send; a card's arrow opens its listing and it spans the row, one at a time). Nothing stores the step, so a reload lands on the same one. Styles are the `.cp-*` classes in `globals.css`; `.cp-soft` removes outlines on this page.
- **generate** — `components/GenerationApp.tsx` + `lib/gemini.ts` call Gemini directly from the browser with the user's own API key (never proxied server-side) and a `responseSchema` that maps to `DesignMetadata`.

Designs and spreadsheet batches persist **locally, in the browser's IndexedDB** — `lib/localDb.ts` is the store, `lib/designsStore.ts` and `lib/spreadsheetStore.ts` are the two façades over it. There are no `/api/designs` or `/api/spreadsheet` routes any more, and nothing follows the account across browsers. Moving work between machines is the export/import batch file on the Uploads page.

### Local-first data — the rule that outranks convenience

**Designs, listing copy and artwork never reach Higgstee's servers.** This is a
product promise, published at `/privacy`, and it is enforced in three places so
that breaking it is loud rather than silent:

1. **Storage.** `apps/dashboard/lib/localDb.ts` — IndexedDB, three object
   stores: `designs` (metadata + listing + config, never bytes), `images` (one
   Blob per design), `docs` (the spreadsheet batch, the earnings export). The
   extension mirrors this in `apps/extension/src/lib/imageDb.ts`; artwork is
   **not** in `chrome.storage.local` any more (that area ran out of space, and
   its change events pushed every image into every open page).
2. **The wire.** Both Supabase clients — dashboard (`lib/supabase/client.ts`,
   `server.ts`, `middleware.ts`) and extension (`src/lib/supabaseClient.ts`) —
   are constructed with a `fetch` that throws on image bytes or listing content.
   The predicates live in `packages/shared/src/privacy.ts`. If you add a Supabase
   call that carries a title or a data URL, it fails in development.
3. **The database.** Migration `0010` makes the retired tables and the `designs`
   Storage bucket read-only; migration `0009` reduces upload stats to
   `upload_stats (user_id, total_upload_count, updated_at)`.

What Supabase may hold, and nothing more: user id, email, approval/trial/plan/
subscription/account status, admin flag, that one upload count, and **projects**
(migration `0013`: per project only a name and an upload count; `0014` adds a
failed count, moved only by `record_project_upload_failure(p_project, p_delta)`
from `uploadCounter.ts` - each item counted once, taken back if a retry publishes).

**Projects** = one per TeePublic account (each account lives in its own Chrome
profile, where its designs are prepared and uploaded). Create Product requires
choosing one before designs can be dropped (`components/ProjectPicker.tsx`; the
choice is per profile, IndexedDB `docs` key `chosenProject`); the batch carries
`projectId`, and the extension then calls `increment_project_upload_count(p_project)`
(bumps the project AND the total) instead of `increment_upload_count()`. Table
access lives only in `lib/projects.ts`, the RPC only in `uploadCounter.ts` -
pinned by `tests/no-server-storage.test.ts`. Dashboard home lists each project's
count (`ProjectsPanel`). Daily per-project limits are the planned next step.

**When an upload succeeds**, the extension calls the no-argument RPC
`increment_upload_count()`; the server resolves the account from `auth.uid()`.
Double counting is prevented **locally**, by item id, in
`src/lib/uploadCounter.ts` — deliberately, because the old dedupe key was the
published listing URL, and using it meant storing it.

**Before changing anything here**, read `tests/no-server-storage.test.ts`: it
pins the removed routes, the permitted `localStorage` writers, the manifest
permissions and the guarded clients, and it reads the real source tree.

### Migrations 0009–0011 and the pending cleanup

`0009` (new counter + backfill) and `0010` (lock legacy writes) are safe and
should be applied. `supabase/INSPECT_LEGACY_DATA.sql` is read-only and reports
what artwork and listing content a project still holds. **`0011_cleanup_legacy_data.sql`
is inert** — every destructive statement is commented out and must stay that way
until the owner has reviewed the inspection output and approved the deletion.
Flipping the public `designs` bucket private is documented in `0010` step 6 and
is likewise not executed.

### Gemini browser jobs (gemini.google.com via the extension)

A second Gemini path, separate from `lib/gemini.ts` (official API + user key):
the extension drives gemini.google.com in background tabs, in Google accounts the
user signed into in their own Chrome. Contract in `packages/shared/src/gemini.ts`;
messages `LIST_ACCOUNTS`/`ADD_ACCOUNT`/`RUN_GEMINI_JOB`/`GEMINI_STATE`/`GEMINI_RESULT`
in `protocol.ts`.

- `services/geminiJobs.ts` — job list (`teepublic.gemini.jobs`), accounts
  (`teepublic.gemini.accounts`), runner. One job at a time **per account**; a job
  runs on exactly its `accountIndex` — never add account picking/rotation. Images
  live in IndexedDB's `gemini` store (`imageDb.ts` v2), not chrome.storage.
- `services/geminiDebugger.ts` — attaches the design the way Donepixel/Playwright
  does: chrome.debugger trusted clicks + `Page.setInterceptFileChooserDialog`, then
  fills the exact input Gemini opened. Attached for seconds, only to job tabs
  (`isJobTab`). Requested by the content script via `GEMINI_ATTACH_DEBUGGER`; the
  synthetic paths below are the fallback.
- `content/geminiMain.ts` — the only page-world ("world": "MAIN") script: answers
  Gemini's `input.click()` on its file input with an armed File instead of the OS
  picker (which needs a real user gesture). Jobs run in ONE shared minimized window.
- `content/gemini.ts` — thin DOM driver; reports via fire-and-forget
  `GEMINI_JOB_DONE` (like `ITEM_STATUS`), because jobs outlive the SW idle timeout.
- `lib/geminiSelectors.ts` — every Gemini selector. Unverified against the live
  page when written; fix breakage here.
- Dashboard: `/dashboard/gemini` is the "Connect account" page (`GeminiAccountsPanel`);
  listing generation runs from Create Product → Generate with AI → "Google account"
  (`lib/geminiAccount.ts`: queues one job, polls, removes it). `GeminiGeneratePanel` /
  `GeminiJobsPanel` (image jobs) are currently not routed.
  Jobs are kept apart from the TeePublic `QueueBatch` on purpose — the upload
  engine would try to publish anything pending in it.

### TeePublic sales notifier (extension, local only)

`services/salesMonitor.ts` (worker) + `src/offscreen/` (offscreen document: DOMParser + audio) +
`lib/salesCore.ts` (parse/compare, pinned by `tests/sales-notifier.test.ts`). The offscreen page
GETs `www.teepublic.com/account/sales` with the user's session every N s (default 120, minimum 60 - fewer requests to TeePublic; a switch turns it off, badge "off"), the worker
compares with the last reading: items-sold rise -> notification + `sale.mp3` + badge; royalty-only
changes / corrections are logged silently; the first reading is a baseline. State is in
`chrome.storage.local` (`teepublic.sales`, keyed by the side panel's chosen project so two accounts
are never compared; `teepublic.salesSettings`). Nothing reaches Supabase. UI: the side panel's Sales box.

### Shared package has no build step

`packages/shared` `main`/`types` point straight at `./src/index.ts`. Both apps compile it through their own toolchain (Next/tsc for the dashboard, esbuild for the extension). Editing a type here immediately affects both sides — keep it pure types + small enums with no runtime deps.

## Conventions

- **Migrations are forward-only and idempotent** (`if not exists`, `drop policy if exists`, `create or replace`). Add new numbered files under `apps/dashboard/supabase/migrations/`; never rewrite an applied one.
- The dashboard bundles fonts locally (no CDN) — extensions/CSP block external font requests.

## Not part of the product — don't edit

`automa/` (vendored reference clone; the React-aware form fillers in `apps/extension/src/lib/dom.ts` borrow its `handleFormElement` pattern but nothing is imported from it), `superpowers/` (Claude Code dev tooling), and the stray `*.rar` archives in the repo root/`apps/extension`.
