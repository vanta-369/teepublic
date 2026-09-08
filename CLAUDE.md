# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Local-first batch upload manager for [TeePublic](https://www.teepublic.com), now with a Supabase-backed SaaS access layer. Two products in one npm-workspace monorepo talk over Chrome's messaging bridge:

- **Dashboard** (`apps/dashboard`) — Next.js 15 / React 19 / Tailwind, runs on `localhost:3030`. Parses spreadsheets **or** generates listings with Gemini, validates, previews, and pushes a queue to the extension. Also hosts auth, the account/access gates, and the admin panel.
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

There is **no automated test suite** and no test runner configured. The verification loop is: extension `typecheck`, dashboard `lint`, and the two `build` scripts. Don't invent `npm test`.

### Loading / rebuilding the extension

`build.mjs` bakes the Supabase URL + anon key into the bundle at build time via esbuild `define`. Set `SUPABASE_URL` / `SUPABASE_ANON_KEY` (or reuse the dashboard's `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`) **before** building, or auth/access gating is compiled out with a warning. After building, load `apps/extension/dist` as an unpacked extension at `chrome://extensions`, then paste its ID into the dashboard's Extension Status panel.

### Dashboard env

Copy `apps/dashboard/.env.example` → `.env.local`: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the server-only `SUPABASE_SERVICE_ROLE_KEY` (used only by `lib/supabase/admin.ts` — never expose to the browser or the extension).

## Architecture — the parts that span multiple files

### The dashboard ↔ extension wire protocol (`packages/shared/src/protocol.ts`)

The dashboard sends `chrome.runtime.sendMessage(extensionId, …)`; the extension's `onMessageExternal` listener receives it. **Images are transported separately from metadata on purpose:** `QUEUE_INIT` carries the batch with every `imageUrl` blanked to `""`, then each design's (multi-MB base64) image follows in its own `QUEUE_IMAGE` message. This keeps any single message under Chrome's 64 MiB runtime-message cap. In the extension, each image is stored under its **own** `ImageStore` key — *not* inside the batch object — because rewriting the whole batch on every image arrival was O(N²) and filled storage (`FILE_ERROR_NO_SPACE`). `apps/dashboard/lib/bridge.ts` (`sendQueueToExtension`) is the sender; `apps/extension/src/background/index.ts` is the receiver.

### Extension automation (the hard part)

- **`background/index.ts`** — MV3 service worker. Routes external + internal messages, persists via `QueueStore`/`SettingsStore`/`ImageStore`, and owns the toolbar → side-panel behavior. On every wake-up it self-heals: any item stuck in `running` (SW was suspended mid-upload) is reset to `queued`.
- **`services/automationEngine.ts`** — the orchestrator ("brain"). Picks the next item, owns retries + human-like inter-item delays, and **never touches the DOM**. Two modes:
  - **single** — one design at a time via `quick_create`.
  - **bulk** — dispatches all selected designs to `bulk_uploader`; the content script then *self-drives* across the many `/designs/<id>/edit` pages it loads, surviving each navigation via `chrome.storage` run-state; the engine just monitors until every item reports a terminal status.
- **`content/teepublic.ts`** — a **thin DOM driver** injected into `*.teepublic.com`. Fills forms and clicks Publish. Because a successful Publish navigates the page and destroys the `sendResponse` callback, terminal status flows back over resilient fire-and-forget messages instead: `ITEM_STATUS` and `PUBLISHED_URL_DETECTED` (the freshly-loaded content script on a `/t-shirt/<slug>` listing announces success). The engine also polls tab URL + stored status as a fallback before ever downgrading an item to failed — this is what prevents re-publishing the same design.

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
- **spreadsheet** — `lib/parser.ts` reads `.xlsx`/`.csv`, images are matched to rows by filename **stem** (lowercased, extension-stripped, so `1` matches `1.png`), `lib/validator.ts` validates, `lib/queue.ts` (`buildQueue`) assembles the `QueueBatch`.
- **generate** — `components/GenerationApp.tsx` + `lib/gemini.ts` call Gemini directly from the browser with the user's own API key (never proxied server-side) and a `responseSchema` that maps to `DesignMetadata`.

Designs and spreadsheet batches persist **per-user in Supabase** (RLS-scoped to `auth.uid()`), so work follows the account across browsers — see `lib/designsStore.ts` + `app/api/designs/route.ts` and migrations `0002`/`0003`. Design images live in a Supabase Storage `designs` bucket (public URLs, so the extension fetches them directly).

### Shared package has no build step

`packages/shared` `main`/`types` point straight at `./src/index.ts`. Both apps compile it through their own toolchain (Next/tsc for the dashboard, esbuild for the extension). Editing a type here immediately affects both sides — keep it pure types + small enums with no runtime deps.

## Conventions

- **Migrations are forward-only and idempotent** (`if not exists`, `drop policy if exists`, `create or replace`). Add new numbered files under `apps/dashboard/supabase/migrations/`; never rewrite an applied one.
- The dashboard bundles fonts locally (no CDN) — extensions/CSP block external font requests.

## Not part of the product — don't edit

`automa/` (vendored reference clone; the React-aware form fillers in `apps/extension/src/lib/dom.ts` borrow its `handleFormElement` pattern but nothing is imported from it), `superpowers/` (Claude Code dev tooling), and the stray `*.rar` archives in the repo root/`apps/extension`.
