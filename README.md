# TeePublic Uploader

Local-first batch upload manager for [TeePublic](https://www.teepublic.com).
Two parts that talk over Chrome's `runtime.sendMessage` bridge:

```
┌────────────────────┐     QUEUE_INIT         ┌─────────────────────┐
│  Next.js dashboard │ ─────────────────────► │  Chrome extension   │
│  localhost:3030    │ ◄─────────────────────  │  (MV3 service       │
│  parse / validate  │     PING / responses   │   worker + popup    │
│  preview / send    │                        │   + queue UI)       │
└────────────────────┘                        └──────────┬──────────┘
                                                         │
                                                         ▼
                                              ┌─────────────────────┐
                                              │ teepublic.com tab   │
                                              │ content script      │
                                              │ fills + publishes   │
                                              └─────────────────────┘
```

The dashboard parses your spreadsheet, matches images by filename, validates,
and previews. When you click **Start Upload**, the entire queue is sent to the
extension via `chrome.runtime.sendMessage`. The extension persists the queue in
`chrome.storage.local`, opens a queue dashboard, and walks through items one at
a time, driving the TeePublic upload page through a content script.

## Repo layout

```
apps/
  dashboard/          Next.js 15 + React 19 + Tailwind
  extension/          MV3 Chrome extension, esbuild bundled
packages/
  shared/             Shared TypeScript types + wire protocol
automa/               (cloned reference — patterns borrowed, not imported)
superpowers/          (Claude Code dev tooling — not part of the product)
```

The extension's React-aware form fillers (`apps/extension/src/lib/dom.ts`)
follow the pattern from `automa/src/utils/handleFormElement.js`.

## Spreadsheet schema

Drop an `.xlsx` or `.csv` with these columns (case-insensitive headers):

| Column           | Required | Notes                                       |
|------------------|:-------: |---------------------------------------------|
| `filename`       | yes      | Must match a staged image (e.g. `tiger.png`)|
| `title`          | yes      | Design title (≤ 50 chars recommended)       |
| `description`    | yes      |                                              |
| `tags`           | yes      | Comma- or semicolon-separated               |
| `mature_content` | no       | `true` / `yes` / `1` enables the toggle     |
| `products`       | no       | Comma-separated product slugs (reserved)    |

## Install & run

Prereqs: Node 20+, pnpm 9+.

```bash
pnpm install

# 1. Start the dashboard (localhost:3030)
pnpm dev:dashboard

# 2. Build the extension (writes apps/extension/dist/)
pnpm dev:extension     # watch mode
# or
pnpm build:extension
```

### Load the extension into Chrome

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** → pick `apps/extension/dist`.
4. Copy the **extension ID** shown on the card.
5. Open `http://localhost:3030`, paste the ID into the **Extension Status**
   panel, click **Test connection**.

### Use it

1. Drop a spreadsheet + matching image files on the dashboard.
2. Review the validation panel and the preview grid.
3. Click **Start Upload**. The extension's queue page opens automatically.
4. Watch progress; failed items can be retried per-card.

## Safety knobs (`SettingsStore` defaults)

| Setting             | Default        | Why                                  |
|---------------------|----------------|--------------------------------------|
| `betweenItemsMinMs` | `8 000`        | Human-like wait between uploads      |
| `betweenItemsMaxMs` | `18 000`       | Randomized upper bound               |
| `retryMax`          | `2`            | Per-item retries before failing      |

Edit `apps/extension/src/services/queueStore.ts` to tune.

## Notes

- **Selectors**: TeePublic's React app is volatile. All selectors live in
- Deployment refresh
  `apps/extension/src/lib/selectors.ts` — fix them there only.
- **First run**: TeePublic must be logged in in the same Chrome profile.
- **No telemetry**: nothing leaves your machine; the dashboard only runs on
  `localhost`.
