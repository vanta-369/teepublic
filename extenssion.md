# HiggsTee — Extension UI Redesign Spec

Full visual + structural redesign of the TeePublic Uploader extension UI.

---

## ⛔ DO NOT BREAK — read first

This is a **UI / layout redesign**. The upload, bulk, color, toggle, and publish logic all work — do not touch them.

1. **Do NOT modify** any upload/bulk/color/toggle/publish logic, message passing, or content-script code.
2. **Keep every existing feature working**: sign in/out, design queue, selection, Start / Pause / Queue / Clear, status states (PENDING, QUEUED, RUNNING, SUCCEEDED, FAILED), stats counters.
3. If you rename an element ID or class that JS depends on, update **all** references and verify nothing breaks.
4. No refactors of unrelated code. Touch only the UI layer (HTML/CSS + the minimal JS needed for the new UI states: sidebar shell, login vs app view, pagination, lock overlay).
5. In your summary, list exactly which files/functions you added or changed.

---

## Brand identity

- **Name:** HiggsTee
- **Product label in header:** "TeePublic Uploader"
- **Logo:** provided PNG — bold black lettering on bright yellow. Use it in the login screen (large) and the header (small icon).
- **Primary accent:** `#f1e41b` (bright yellow)

### Color tokens

Implement both themes with CSS variables and a toggle (persist choice).

**Dark mode (default)**
```css
--bg:            #0A0A0A;
--bg-elevated:   #161616;   /* cards, panels */
--bg-hover:      #1F1F1F;
--border:        #2A2A2A;
--text:          #FFFFFF;
--text-muted:    #9CA3AF;
--accent:        #f1e41b;   /* yellow */
--accent-text:   #0A0A0A;   /* text ON yellow */
```

**Light mode**
```css
--bg:            #FFFFFF;
--bg-elevated:   #F7F8FA;
--bg-hover:      #EFEFEF;
--border:        #E5E7EB;
--text:          #111827;
--text-muted:    #6B7280;
--accent:        #f1e41b;
--accent-text:   #0A0A0A;
```

**Status colors (both themes)**
```css
--status-success: #10B981;  /* SUCCEEDED */
--status-failed:  #EF4444;  /* FAILED */
--status-queued:  #6B7280;  /* QUEUED / PENDING */
--status-running: #f1e41b;  /* RUNNING — yellow, subtle pulse */
```

### Visual style (reference: higgsfield.ai)
- Dark, high-contrast, modern. Bright yellow used sparingly for primary actions and active states.
- Bold, tight headings (600–700 weight); uppercase for small labels.
- Cards: `--bg-elevated`, 1px `--border`, 10–12px radius, subtle shadow.
- Comfortable spacing: 12–16px card padding, 8–12px gaps. Nothing cramped.
- Font: system sans (Inter / -apple-system / Segoe UI).

---

## Structural change: SIDEBAR, not popup

Convert the extension UI from a small popup to a **Chrome side panel (sidebar)**.

- Use the `sidePanel` API (`chrome.sidePanel`) — add `"side_panel": { "default_path": "sidepanel/index.html" }` and the `"sidePanel"` permission to `manifest.json`.
- Clicking the extension icon opens the side panel.
- Layout must be responsive to the panel width (typically ~320–500px) — nothing overflows or clips. Design mobile-first / narrow-first.
- Keep a scrollable main area with the header pinned at top and the action bar pinned at bottom.

---

## Screen 1 — Login (signed out)

A clean, centered, minimal login view filling the whole sidebar. Reference: simple centered card, generous spacing.

Contents, top to bottom, centered:
1. **Logo** (the HiggsTee mark), ~64–80px.
2. **"HiggsTee"** — large bold heading.
3. Subtitle in muted text, e.g. "Welcome back to your uploader".
4. **Email** — label above, full-width input, rounded, 1px border, placeholder `your.email@example.com`.
5. **Password** — label above, full-width input, dots placeholder.
6. **Sign In** — full-width primary button: yellow background `--accent`, dark text `--accent-text`, bold.
7. Thin divider.
8. "Don't have an account?" muted, then a **Create Account** full-width secondary button (transparent bg, 1px border).
9. Footer: small muted "Secure login · Privacy Policy".

When signed out, show ONLY this screen — no header chrome, no stats, no grid.

---

## Screen 2 — Main app (signed in)

### 2.1 Header (pinned top)
- **Left:** small HiggsTee logo + "HiggsTee" (bold) with a small muted second line "TeePublic Uploader".
- **Right:** compact icon buttons —
  - theme toggle (sun/moon),
  - refresh,
  - **account chip**: small avatar circle + short name + caret.
- **Account dropdown** (on clicking the chip) shows:
  - the user's **email** at top,
  - **Plan** row with an icon: plan name + status (e.g. "Free Trial — 4 days left", or "Monthly — active", or "No active plan"),
  - a red **Sign Out** item at the bottom.
  - Styled as an elevated card with border and shadow, right-aligned under the chip.

### 2.2 Platform tab
A single pill/tab: **"TeePublic Upload"** with the TeePublic icon, rendered in the active state (yellow accent). Do NOT add other platform tabs (no Normal/Pro/Redbubble/Amazon) — this extension only targets TeePublic. If a tab bar adds no value at this width, render it as a simple section label/badge instead.

### 2.3 Toolbar
- **Search** input with a magnifier icon: placeholder "Search designs…".
- **Status filter** dropdown: All Status / Pending / Queued / Running / Succeeded / Failed.
- Keep these compact; wrap to a second line if the panel is narrow.

### 2.4 Stats row
Four compact stat cards in one row (wrap if narrow): **TOTAL / PICKED / DONE / FAILED**.
- Big bold number on top, small uppercase muted label under it.
- Number colors: TOTAL = `--text`, PICKED = `--accent`, DONE = `--status-success`, FAILED = `--status-failed`.

### 2.5 Selection controls
Replace the current cluttered button row with:
- **Select all** — selects every design across **all pages**.
- **Select page** — selects only the designs on the **current page**.
- **Invert** — inverts selection on the current page.
- A muted counter on the right: "N of M selected for upload".

**Remove entirely:** the "Mode: Bulk" toggle and the "Copy log" button. (Bulk is the only mode; drop the switch. Remove the Copy log button from the UI — keep any underlying logging as-is internally.)

### 2.6 Design grid + pagination
- Responsive grid of design cards (2 columns at narrow widths, 3+ when wider).
- **Card:** thumbnail with rounded corners, a **status pill** under (or overlaid on) the image, and a selection checkbox in the top-left corner.
  - Status pill colors: SUCCEEDED = green, FAILED = red, QUEUED/PENDING = gray, RUNNING = yellow with a subtle pulse animation.
  - **Selected state:** 2px `--accent` ring around the card + a filled yellow check badge. (Keep current selection behavior; only restyle.)
  - Hover: slight elevation / border brightening.
- **Pagination** below the grid: `‹ Prev`, page numbers (or "Page X of Y"), `Next ›`. Choose a sensible page size (e.g. 12 or 20) and keep it consistent. "Select page" operates on the visible page; "Select all" spans every page.

### 2.7 Action bar (pinned bottom)
A single row, clear hierarchy:
- **▶ Start** — primary, yellow `--accent` bg, dark text, bold, widest.
- **⏸ Pause** — secondary (bordered, transparent bg).
- **Queue ↗** — secondary.
- **Clear** — danger style: red text + red border, transparent bg.

Give them proper height (~40px), rounded corners, and even spacing. The current cramped look must be replaced.

---

## Plan gating / lock

Access is controlled by the user's plan:
- **Free trial:** 7 days, full access.
- **Monthly subscription:** full access.
- **No active plan (never subscribed, or trial/subscription expired): fully blocked — the user cannot perform ANY action.**

When there is no active plan:
1. Render a **lock overlay** over the design grid area: a large lock icon, heading e.g. **"Uploader Locked"**, a muted line "Start your 7-day free trial or subscribe to upload designs.", then two full-width buttons:
   - **Start Free Trial** (primary, yellow), and
   - **Upgrade Plan** / **Open Dashboard** (secondary, bordered).
2. **Disable every action:** Start, Pause, Queue, Clear, Select all, Select page, Invert, and design selection — all non-interactive and visually dimmed (reduced opacity, `pointer-events: none`, `disabled` attribute where applicable).
3. The account dropdown's Plan row should reflect the locked state (e.g. "No active plan").

The grid may still render the design thumbnails behind a blur/dim under the overlay, but nothing must be clickable.

---

## Acceptance checklist

- [ ] UI opens as a Chrome **side panel**, not a popup.
- [ ] Signed out → clean centered HiggsTee login screen only.
- [ ] Signed in → header (logo + name + theme toggle + refresh + account chip), single "TeePublic Upload" tab, toolbar, stats, selection controls, paginated grid, bottom action bar.
- [ ] Account chip dropdown shows email, plan status, and Sign Out.
- [ ] **Select all** = all pages; **Select page** = current page only.
- [ ] "Mode: Bulk" and "Copy log" buttons are gone from the UI.
- [ ] Dark mode (black + `#f1e41b`) and light mode (white + `#f1e41b`) both work and the choice persists.
- [ ] No active plan → lock overlay shown and every control disabled.
- [ ] Every previously working feature still works identically.
- [ ] Nothing clips or overflows at ~320px panel width.

---

## Notes for implementation

- Put the logo PNG in the extension assets and reference it from both the login screen and the header.
- Use CSS variables for all colors so the theme toggle is a single class swap on `<html>` or `<body>`.
- Prefer inline SVG icons (lock, search, filter, sun/moon, refresh, user, sign-out, play, pause, external-link) — no icon-font dependency.
- Keep the markup semantic and the CSS in one stylesheet for the panel.