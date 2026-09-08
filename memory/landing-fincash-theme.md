---
name: landing-fincash-theme
description: The whole product (marketing site + extension) deliberately mirrors the Fincash TailGrids template (lime on near-black).
metadata:
  type: project
---

The Higgstee marketing site (dashboard `app/page.tsx`, `components/site/*`, `app/globals.css`) **and the Chrome extension UI** (`apps/extension/src/{sidepanel,queue,popup}/style.css`) were intentionally restyled to match the **Fincash** TailGrids demo (https://fincash.demos.tailgrids.com/). Palette was extracted from that site's compiled CSS (not guessed):

- **Primary/accent = lime `#D6FF66`** (hover `#D2FB64`). Rule: **near-black text (`#141414`) on lime**, never white — applies to `.btn-primary`, `.feat-icon`, the `bg-grad-accent` CTA band, and the logo mark.
- **Dark-first** (default color mode = dark). Dark surfaces are near-black neutrals: page `#141414` (`--ink-950`), card `#1f1f1f` (`--ink-900`), soft `#2a2a2a`, border `#383838`. Text = white / neutral-400 `#a1a1a1`.
- **Light mode** is the "also" toggle: white/neutral surfaces, near-black text, lime buttons. In light, accent *text* uses a dark olive (`--accent-600 #5c7a10`) because bright lime is unreadable on white; bright lime (`--accent-500`) is reserved for fills/button backgrounds.
- Neutral grays throughout (Tailwind `neutral-*`), not slate/blue.

Extension surfaces: sidepanel has a dark(default)+light `[data-theme]` toggle; queue + popup are dark-only. All use lime `--accent` with `--accent-text: #141414`. In the light palettes (dashboard + sidepanel), accent *text/icons* use dark olive (`#5C7A10`) while button *fills* stay bright lime — because bright lime is unreadable as text on white.

Don't "fix" the lime-on-black or the dark default — it's the intended Fincash look. If touching accent tokens, keep the light-mode dark-olive vs dark-mode bright-lime split. Related: [[theme-tokens]].
