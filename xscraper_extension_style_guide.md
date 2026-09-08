# XScraper-Inspired Extension UI Style Guide

## 1. Overview

This interface uses a **premium dark SaaS / automation-tool aesthetic**.

The visual identity combines:

- Very dark navy-black surfaces
- Bright electric yellow as the main brand accent
- Soft blue-gray borders and secondary text
- Rounded cards and large icon containers
- Subtle yellow glow effects
- A separate purple accent reserved for PRO and account features

The final result feels like a mix of:

- Modern SaaS dashboard
- Developer tool
- Automation software
- Premium browser extension
- Technical control panel

---

## 2. Core Visual Identity

The design is built around four main principles.

### 2.1 Dark Layered Surfaces

Do not use one flat black background for the whole interface.

Create depth using several dark shades:

- Main page background
- Header background
- Navigation surface
- Cards
- Inner selectors
- Buttons
- Disabled sections
- Bottom action dock

This creates hierarchy without depending on heavy shadows.

### 2.2 Yellow as the Primary Action Color

Yellow represents:

- Brand identity
- Active tools
- Selected states
- Important headings
- Primary actions
- Interactive icons
- Notifications
- Upgrade-related emphasis

Do not use yellow as a large background everywhere.

Yellow must remain selective so that it feels important.

### 2.3 Rounded Utility Interface

Use rounded corners on almost every component:

- Navigation container
- Cards
- Buttons
- Icon boxes
- Toast notifications
- Settings panels
- Subscription card
- Step indicators
- Action buttons

This makes the interface feel modern, friendly, and premium.

### 2.4 Strong Typography Hierarchy

Use bold text for:

- Brand name
- Tool title
- Step titles
- Main actions
- Account tier
- Important messages

Use medium-weight gray text for:

- Subtitles
- Supporting text
- Descriptions
- Disabled labels

---

## 3. Color Palette

The following values are approximated from the reference screenshots.

### 3.1 Main Colors

| Role | Description | HEX |
|---|---|---|
| Main page background | Near-black navy | `#030712` |
| Deepest background | Black-blue | `#02050D` |
| Header background | Dark navy | `#080B12` |
| Main surface | Navy charcoal | `#131921` |
| Raised surface | Blue charcoal | `#1A2029` |
| Inner surface | Deep blue-black | `#0B101B` |
| Card background | Near-black | `#03060E` |
| Primary yellow | Golden yellow | `#FACC15` |
| Bright yellow | Electric yellow | `#FFE100` |
| Main text | Off-white | `#F9FAFC` |
| Secondary text | Light gray | `#D1D5DB` |
| Muted text | Cool gray | `#9297A3` |
| Disabled text | Slate gray | `#6B7280` |
| Normal border | Blue-gray | `#252D39` |
| Strong border | Slate blue-gray | `#313945` |

### 3.2 Yellow Supporting Colors

| Purpose | Value |
|---|---|
| Yellow transparent surface | `rgba(250, 204, 21, 0.10)` |
| Yellow hover surface | `rgba(250, 204, 21, 0.14)` |
| Yellow border | `rgba(250, 204, 21, 0.45)` |
| Yellow strong border | `#9A8110` |
| Yellow dark icon background | `#372F15` |
| Yellow glow | `rgba(250, 204, 21, 0.16)` |

### 3.3 Purple PRO Colors

Purple should be reserved for:

- PRO plans
- Account tiers
- Billing
- License activation
- Upgrade sections
- Premium status

| Role | Value |
|---|---|
| Purple card start | `#3C2469` |
| Purple card center | `#2E2159` |
| Purple card end | `#36225D` |
| Purple border | `#785DA1` |
| Bright purple | `#9759F7` |
| Purple heading | `#D7B4FE` |
| Purple glow | `rgba(151, 89, 247, 0.20)` |

### 3.4 Yellow Usage Rule

Use:

- `#FACC15` for borders, icons, labels, and normal active states
- `#FFE100` for the logo, major headings, and primary CTA states

This creates a clear hierarchy.

---

## 4. Background Construction

Do not use pure black everywhere.

Use a dark background with subtle radial yellow illumination.

```css
body {
  background:
    radial-gradient(
      circle at 20% 25%,
      rgba(250, 204, 21, 0.055),
      transparent 28%
    ),
    #02050d;

  color: #f9fafc;
}
```

Around active tool sections, add a faint olive-yellow glow.

```css
.tool-section {
  background:
    radial-gradient(
      circle at 18% 10%,
      rgba(250, 204, 21, 0.09),
      transparent 32%
    ),
    #02050d;
}
```

The glow should be subtle.

It should be felt, not clearly visible.

---

## 5. Typography

Use a modern UI sans-serif font.

Recommended font stack:

```css
font-family:
  Inter,
  -apple-system,
  BlinkMacSystemFont,
  "Segoe UI",
  sans-serif;
```

### 5.1 Typography Scale

| Element | Suggested Size | Weight |
|---|---:|---:|
| Brand name | `25px–27px` | `800` |
| Brand subtitle | `17px–18px` | `600` |
| Navigation tab | `17px–19px` | `700` |
| Main module title | `24px–26px` | `800` |
| Module subtitle | `16px–18px` | `600` |
| Step title | `22px–24px` | `750–800` |
| Selector title | `18px–20px` | `700` |
| Body text | `16px–18px` | `500–600` |
| Small supporting text | `14px–16px` | `500` |
| Main button | `21px–23px` | `800` |
| Account heading | `25px–27px` | `800` |

### 5.2 Text Colors

```css
.text-primary {
  color: #f9fafc;
}

.text-secondary {
  color: #d1d5db;
}

.text-muted {
  color: #9297a3;
}

.text-disabled {
  color: #6b7280;
}

.text-accent {
  color: #ffe100;
}
```

Avoid very thin font weights.

Even secondary text should usually use medium or semibold weight.

---

## 6. Spacing System

Use a loose 4px spacing system.

```css
--space-1: 4px;
--space-2: 8px;
--space-3: 12px;
--space-4: 16px;
--space-5: 20px;
--space-6: 24px;
--space-8: 32px;
--space-10: 40px;
```

Recommended usage:

- Main horizontal padding: `20px–24px`
- Card padding: `18px–24px`
- Space between icon and text: `12px–16px`
- Space between cards: `14px–18px`
- Space between heading and subtitle: `4px–8px`
- Section separation: `24px–32px`

---

## 7. Border Radius System

Large rounded corners are one of the strongest characteristics of this design.

```css
--radius-sm: 10px;
--radius-md: 14px;
--radius-lg: 18px;
--radius-xl: 22px;
--radius-2xl: 26px;
--radius-round: 999px;
```

Recommended component radius:

| Component | Radius |
|---|---:|
| Small icon button | `12px–14px` |
| Navigation active pill | `12px–14px` |
| Tool icon square | `16px–18px` |
| Content card | `18px–20px` |
| Navigation container | `24px–26px` |
| Toast | `14px` |
| Circular icon | `999px` |
| PRO subscription card | `18px–20px` |

Avoid sharp corners.

---

## 8. Border Style

Borders should be thin and low contrast.

### 8.1 Standard Border

```css
border: 1px solid #252d39;
```

### 8.2 Strong Interactive Border

```css
border: 1px solid #313945;
```

### 8.3 Yellow Active Border

```css
border: 1px solid rgba(250, 204, 21, 0.45);
```

### 8.4 Selection Box Border

The selector uses a thick dashed border.

```css
border: 3px dashed #313945;
```

Selected state:

```css
border-color: #a18814;
background: rgba(250, 204, 21, 0.08);
```

The dashes should feel rounded and medium-sized.

---

## 9. Header Design

The header contains three zones:

1. User or avatar area
2. Brand title and subtitle
3. Utility buttons

### 9.1 Brand Name

```css
.brand-name {
  color: #ffe100;
  font-size: 26px;
  font-weight: 800;
  letter-spacing: -0.5px;
}
```

### 9.2 Brand Subtitle

```css
.brand-subtitle {
  color: #b8bdc7;
  font-size: 18px;
  font-weight: 600;
}
```

### 9.3 Utility Buttons

Use square buttons with rounded corners.

Recommended size:

- Width: `58px–62px`
- Height: `58px–62px`
- Radius: `18px`

```css
.utility-button {
  width: 60px;
  height: 60px;
  display: grid;
  place-items: center;

  background: #080c14;
  border: 2px solid #252d39;
  border-radius: 18px;

  color: #aeb5c1;
}
```

Hover state:

```css
.utility-button:hover {
  color: #facc15;
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.06);
}
```

### 9.4 Avatar Fallback

Do not allow broken images to appear.

```html
<img
  src="avatar.png"
  alt=""
  onerror="this.src='default-avatar.svg'"
/>
```

Always provide a fallback avatar.

---

## 10. Main Navigation

The navigation is placed inside a large rounded panel.

```css
.main-nav {
  min-height: 96px;
  padding: 12px;
  background: linear-gradient(135deg, #131921, #111827);
  border: 1px solid #273142;
  border-radius: 26px;
}
```

### 10.1 Main Tool Icon

The main tool icon should use:

- Width: `70px–74px`
- Height: `70px–74px`
- Radius: `18px`
- Yellow transparent background
- Yellow border
- Yellow icon

```css
.main-tool-icon {
  width: 72px;
  height: 72px;
  border-radius: 18px;

  background: rgba(250, 204, 21, 0.07);
  border: 2px solid rgba(250, 204, 21, 0.40);
  color: #ffe100;
}
```

### 10.2 Navigation Tabs

Inactive tab:

```css
.nav-item {
  color: #d1d5db;
  font-size: 18px;
  font-weight: 700;
}
```

Active tab:

```css
.nav-item.active {
  background: #252d3a;
  color: #ffffff;
  border-radius: 13px;
  padding: 12px 18px;
}
```

The active tab does not need a yellow fill.

The yellow main tool icon already provides the brand accent.

---

## 11. Tool Header

The tool header contains:

- Circular yellow icon
- Yellow uppercase title
- Gray description
- Utility controls on the right

### 11.1 Tool Icon

```css
.tool-header-icon {
  width: 46px;
  height: 46px;
  border-radius: 50%;

  display: grid;
  place-items: center;

  color: #facc15;
  background: rgba(250, 204, 21, 0.10);
  border: 1px solid rgba(250, 204, 21, 0.40);

  box-shadow: 0 0 22px rgba(250, 204, 21, 0.13);
}
```

### 11.2 Tool Title

```css
.tool-title {
  color: #ffe100;
  font-size: 25px;
  font-weight: 800;
  text-transform: uppercase;
}
```

### 11.3 Tool Subtitle

```css
.tool-subtitle {
  color: #9297a3;
  font-size: 17px;
  font-weight: 600;
}
```

### 11.4 Tool Action Buttons

```css
.tool-action {
  width: 44px;
  height: 44px;
  border-radius: 50%;

  background: #131921;
  border: 1px solid #303846;
  color: #bdc3cd;
}
```

Hover:

```css
.tool-action:hover {
  color: #ffffff;
  background: #1a2029;
  border-color: #4b5563;
}
```

---

## 12. Step Cards

Each workflow step should be inside a large rounded card.

```css
.step-card {
  padding: 20px;
  background: rgba(3, 6, 14, 0.94);
  border: 1px solid #202733;
  border-radius: 19px;
}
```

### 12.1 Step Number Badge

```css
.step-number {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  font-size: 17px;
  font-weight: 800;
}
```

Active step:

```css
.step-number.active {
  background: #ffe100;
  color: #111111;
  box-shadow: 0 5px 14px rgba(250, 204, 21, 0.25);
}
```

Disabled step:

```css
.step-number.disabled {
  background: #6b7280;
  color: #e5e7eb;
  box-shadow: 0 5px 14px rgba(107, 114, 128, 0.25);
}
```

### 12.2 Disabled Step Card

Do not make disabled content almost invisible.

```css
.step-card.disabled {
  opacity: 0.58;
  pointer-events: none;
}
```

Use opacity between `0.55` and `0.65`.

---

## 13. Select List Component

This is one of the main interactive components.

### 13.1 Default State

The default selector uses:

- Dark blue inner background
- Thick dashed gray border
- White title
- Gray subtitle
- Yellow icon container

```css
.selector-box {
  min-height: 86px;
  padding: 16px 20px;

  display: flex;
  align-items: center;
  justify-content: center;
  gap: 16px;

  background: #0b101b;
  border: 3px dashed #313945;
  border-radius: 17px;

  cursor: pointer;
  transition: 160ms ease;
}
```

### 13.2 Selector Icon

```css
.selector-icon {
  width: 46px;
  height: 46px;
  border-radius: 13px;

  display: grid;
  place-items: center;

  background: #372f15;
  border: 1px solid #655515;
  color: #ffe100;
}
```

### 13.3 Selector Title

```css
.selector-title {
  color: #f9fafc;
  font-size: 19px;
  font-weight: 700;
}
```

### 13.4 Selector Subtitle

```css
.selector-subtitle {
  color: #9297a3;
  font-size: 16px;
  font-weight: 500;
}
```

### 13.5 Hover State

```css
.selector-box:hover {
  background: rgba(250, 204, 21, 0.075);
  border-color: #a18814;
}

.selector-box:hover .selector-title {
  color: #facc15;
}
```

### 13.6 Selected State

```css
.selector-box.selected {
  background: rgba(250, 204, 21, 0.10);
  border-color: #facc15;
  box-shadow:
    inset 0 0 0 1px rgba(250, 204, 21, 0.08),
    0 0 24px rgba(250, 204, 21, 0.07);
}
```

---

## 14. Primary Button System

### 14.1 Enabled Primary Button

The enabled CTA should use yellow.

```css
.primary-button {
  min-height: 68px;
  padding: 0 28px;

  border: none;
  border-radius: 18px;

  background: #ffe100;
  color: #111318;

  font-size: 22px;
  font-weight: 800;

  box-shadow: 0 8px 24px rgba(250, 204, 21, 0.18);
}
```

Hover:

```css
.primary-button:hover {
  background: #facc15;
  transform: translateY(-1px);
}
```

Pressed:

```css
.primary-button:active {
  transform: translateY(0);
  filter: brightness(0.92);
}
```

### 14.2 Disabled Primary Button

```css
.primary-button:disabled {
  background: #131921;
  color: #6b7280;
  border: 1px solid #273142;
  box-shadow: none;
  cursor: not-allowed;
}
```

The play icon should use the same disabled gray.

---

## 15. Bottom Action Dock

The bottom navigation should behave like a permanent action dock.

Characteristics:

- Fixed or sticky at the bottom
- Near-black background
- Thin top border
- Large primary button
- Three square shortcut buttons

```css
.bottom-dock {
  position: sticky;
  bottom: 0;
  z-index: 20;

  display: grid;
  grid-template-columns: 1fr auto auto auto;
  gap: 14px;

  padding: 18px 12px;
  background: rgba(0, 1, 2, 0.97);
  border-top: 1px solid #202733;
  backdrop-filter: blur(12px);
}
```

Shortcut button:

```css
.dock-button {
  width: 66px;
  height: 66px;
  border-radius: 17px;

  background: #060a12;
  border: 1px solid #252d39;
  color: #6b7280;
}
```

Active shortcut:

```css
.dock-button.active {
  color: #facc15;
  border-color: rgba(250, 204, 21, 0.45);
  background: rgba(250, 204, 21, 0.08);
}
```

---

## 16. Toast Notification

The validation toast uses:

- Black background
- Yellow border
- White bold text
- Yellow icon
- Rounded corners
- Subtle yellow glow

```css
.toast {
  display: flex;
  align-items: center;
  gap: 10px;

  padding: 13px 18px;
  background: #050608;
  border: 1.5px solid #ffe100;
  border-radius: 13px;

  color: #ffffff;
  font-size: 17px;
  font-weight: 700;

  box-shadow:
    0 10px 28px rgba(0, 0, 0, 0.50),
    0 0 18px rgba(250, 204, 21, 0.12);
}
```

Position:

```css
.toast {
  position: fixed;
  top: 16px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1000;
}
```

Example message:

```text
Please select a list element first
```

---

## 17. Settings Page

The settings screen keeps the same dark visual system.

It introduces purple only for monetization and account-related elements.

### 17.1 Settings Header

The settings header contains:

- Circular or rounded gear icon container
- Large white title
- Gray subtitle
- Close button

```css
.settings-icon {
  width: 62px;
  height: 62px;
  border-radius: 20px;
  background: #131921;
  border: 1px solid #252d39;
}
```

The close button should remain minimal and dark.

---

## 18. Account and Subscription Card

The FREE Account card is the main gradient surface.

```css
.account-card {
  padding: 28px 24px;
  border-radius: 19px;

  background:
    linear-gradient(
      110deg,
      #3c2469 0%,
      #2e2159 55%,
      #36225d 100%
    );

  border: 1px solid #9b6dd1;

  box-shadow:
    0 12px 30px rgba(46, 33, 89, 0.35),
    0 0 20px rgba(151, 89, 247, 0.10);
}
```

Account tier heading:

```css
.account-tier {
  color: #d7b4fe;
  font-size: 26px;
  font-weight: 800;
}
```

Purple toggle:

```css
.account-toggle {
  background: #9759f7;
}
```

Purple must remain exclusive to:

- PRO
- Billing
- Upgrade
- License
- Account plan
- Premium features

Do not use purple in the extraction workflow.

---

## 19. License Cards

License-related rows use:

- Dark card
- Soft border
- Yellow icon box
- White title
- Muted subtitle

```css
.license-card {
  min-height: 88px;
  padding: 18px;

  display: flex;
  align-items: center;
  gap: 18px;

  background: #0c0f18;
  border: 1px solid #252a35;
  border-radius: 18px;
}
```

Hover:

```css
.license-card:hover {
  background: #10141f;
  border-color: rgba(250, 204, 21, 0.35);
}
```

---

## 20. Icon Style

Use one consistent outline icon library.

Recommended libraries:

- Lucide Icons
- Heroicons Outline
- Phosphor Icons
- Tabler Icons

Preferred option:

**Lucide Icons**

Recommended icon style:

```css
.icon {
  width: 24px;
  height: 24px;
  stroke-width: 2.2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
```

Typical icon sizes:

- Small button icons: `20px–22px`
- Navigation icons: `22px–25px`
- Main tool icon: `28px–32px`
- Empty-state icon: `24px–28px`
- Settings icon: `27px–30px`

Do not mix filled icons with outline icons randomly.

---

## 21. Shadows and Glows

Avoid large gray shadows.

Use colored glows selectively.

### 21.1 Normal Dark Shadow

```css
box-shadow: 0 10px 26px rgba(0, 0, 0, 0.35);
```

### 21.2 Yellow Icon Glow

```css
box-shadow: 0 0 20px rgba(250, 204, 21, 0.16);
```

### 21.3 Yellow Badge Glow

```css
box-shadow: 0 5px 14px rgba(250, 204, 21, 0.25);
```

### 21.4 Purple Card Glow

```css
box-shadow: 0 12px 28px rgba(151, 89, 247, 0.16);
```

Use glow only for:

- Active icons
- Important notifications
- Selected states
- PRO card
- Primary CTA

Do not glow every component.

---

## 22. Scrollbar

Use a custom dark scrollbar.

```css
::-webkit-scrollbar {
  width: 10px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #454b55;
  border-radius: 999px;
  border: 2px solid #090c12;
}

::-webkit-scrollbar-thumb:hover {
  background: #606773;
}
```

---

## 23. Animation Style

Animations should be quick, smooth, and controlled.

```css
transition:
  color 150ms ease,
  background-color 150ms ease,
  border-color 150ms ease,
  box-shadow 150ms ease,
  transform 150ms ease;
```

Recommended interactions:

- Button hover: move upward by `1px`
- Button click: return to `0`
- Selector hover: fade to yellow border
- Toast entrance: fade and move downward
- Settings panel: slide from the right
- Loading icon: slow rotation
- Active navigation: soft background fade

Avoid:

- Bouncing
- Cartoon-like movement
- Excessive scaling
- Long animations
- Flashing glows

The interface should feel premium and technical.

---

## 24. Suggested Extension Dimensions

The reference looks like a wide popup or side-panel interface.

Recommended dimensions:

```css
.extension-shell {
  width: 640px;
  min-height: 760px;
  max-height: 100vh;
}
```

For a Chrome side panel:

```css
.extension-shell {
  width: 100%;
  min-width: 380px;
  max-width: 680px;
}
```

Recommended layout:

```text
Extension Shell
├── Header
├── Main Navigation
├── Divider
├── Scrollable Tool Content
│   ├── Tool Header
│   ├── Step Card 1
│   ├── Step Card 2
│   └── Additional Settings
└── Sticky Bottom Dock
```

Only the main tool content should scroll.

Keep the header and bottom CTA visible when practical.

---

## 25. Complete CSS Token Set

```css
:root {
  /* Backgrounds */
  --bg-page: #02050d;
  --bg-deep: #030712;
  --bg-header: #080b12;
  --bg-surface: #131921;
  --bg-surface-raised: #1a2029;
  --bg-inner: #0b101b;
  --bg-card: #03060e;

  /* Borders */
  --border-default: #252d39;
  --border-strong: #313945;
  --border-yellow: rgba(250, 204, 21, 0.45);

  /* Yellow Brand */
  --yellow-primary: #facc15;
  --yellow-bright: #ffe100;
  --yellow-surface: rgba(250, 204, 21, 0.10);
  --yellow-surface-hover: rgba(250, 204, 21, 0.14);
  --yellow-dark: #372f15;
  --yellow-border-dark: #655515;

  /* Text */
  --text-primary: #f9fafc;
  --text-secondary: #d1d5db;
  --text-muted: #9297a3;
  --text-disabled: #6b7280;

  /* Purple PRO */
  --purple-primary: #9759f7;
  --purple-text: #d7b4fe;
  --purple-start: #3c2469;
  --purple-center: #2e2159;
  --purple-end: #36225d;
  --purple-border: #785da1;

  /* Radius */
  --radius-sm: 10px;
  --radius-md: 14px;
  --radius-lg: 18px;
  --radius-xl: 22px;
  --radius-2xl: 26px;
  --radius-round: 999px;

  /* Shadows */
  --shadow-dark: 0 10px 26px rgba(0, 0, 0, 0.35);
  --shadow-yellow: 0 0 20px rgba(250, 204, 21, 0.16);
  --shadow-purple: 0 12px 28px rgba(151, 89, 247, 0.16);
}
```

---

## 26. Component State System

Use the following state logic consistently.

| State | Background | Border | Text or Icon |
|---|---|---|---|
| Default | Dark navy | Blue-gray | White or gray |
| Hover | Slightly lighter navy | Strong gray or yellow | White or yellow |
| Active | Yellow-tinted dark | Yellow | Yellow or white |
| Selected | Olive-black tint | Dashed yellow | Yellow |
| Disabled | Dark slate | Dark border | `#6B7280` |
| Success | Dark green tint | Green | Green |
| Error | Dark red tint | Red | Red |
| PRO | Purple gradient | Purple | Lavender or white |

---

## 27. Responsive Behavior

The interface should remain usable at narrower widths.

### 27.1 Responsive Header

At smaller widths:

- Reduce logo subtitle size
- Keep utility buttons visible
- Allow text to truncate
- Reduce horizontal padding

```css
@media (max-width: 480px) {
  .brand-name {
    font-size: 22px;
  }

  .brand-subtitle {
    font-size: 14px;
  }

  .utility-button {
    width: 48px;
    height: 48px;
  }
}
```

### 27.2 Navigation

At narrow widths:

- Keep navigation horizontally scrollable
- Do not compress icons excessively
- Maintain touch-friendly button sizes

```css
.main-nav-tabs {
  overflow-x: auto;
  scrollbar-width: none;
}
```

### 27.3 Bottom Dock

At narrow widths:

- Reduce shortcut button width
- Keep main CTA dominant
- Preserve at least `48px` touch targets

---

## 28. Accessibility Rules

### 28.1 Contrast

Maintain sufficient contrast between:

- White text and dark backgrounds
- Gray subtitles and dark cards
- Yellow text and yellow-tinted backgrounds
- Disabled text and dark surfaces

### 28.2 Focus States

Keyboard focus should be clearly visible.

```css
button:focus-visible,
.selector-box:focus-visible {
  outline: 2px solid #ffe100;
  outline-offset: 3px;
}
```

### 28.3 Click Targets

Use a minimum clickable size of:

```text
44px × 44px
```

### 28.4 Tooltips

Add tooltips to icon-only buttons such as:

- Information
- Refresh
- Close
- Settings
- History
- Cloud
- Data

### 28.5 Reduced Motion

```css
@media (prefers-reduced-motion: reduce) {
  * {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

---

## 29. Important Design Improvements

The reference design is visually strong, but the following problems should be improved.

### 29.1 Broken Avatar

The screenshot shows a broken image.

Always provide a fallback avatar.

### 29.2 Disabled Contrast

Some disabled sections are too faint.

Keep disabled content readable while clearly inactive.

Recommended opacity:

```css
opacity: 0.58;
```

### 29.3 Text Clipping

Some subtitles are clipped horizontally.

For single-line text:

```css
min-width: 0;
overflow: hidden;
text-overflow: ellipsis;
white-space: nowrap;
```

For wrapping text:

```css
white-space: normal;
overflow-wrap: anywhere;
```

### 29.4 Yellow Inconsistency

Standardize yellow usage:

- `#FACC15` for normal yellow accents
- `#FFE100` for strong emphasis

### 29.5 Toggle Ambiguity

The purple toggle in the account card does not clearly communicate its function.

Add:

- Label
- Tooltip
- Status text
- Clear on/off state

### 29.6 Too Many Emphasis Points

Do not glow:

- Title
- Icon
- Card
- Border
- CTA

all at the same time.

Use only one or two highlighted elements per section.

---

## 30. What Makes This Style Recognizable

The most important details to preserve are:

1. Near-black navy background instead of ordinary black
2. Electric yellow used selectively
3. Large rounded cards and icon containers
4. Bold white headings
5. Medium gray subtitles
6. Yellow-tinted active surfaces
7. Thin cool-gray borders
8. Dashed selection areas
9. Sticky bottom action dock
10. Purple reserved only for PRO and account content
11. Consistent outline icons
12. Subtle colored glows
13. Strong visual hierarchy
14. Large touch-friendly controls

---

## 31. Recommended Component Architecture

Use reusable components instead of styling each page independently.

Suggested components:

```text
AppShell
Header
BrandBlock
Avatar
UtilityIconButton
MainNavigation
NavigationTab
ToolHeader
ToolActionButton
StepCard
StepBadge
SelectorBox
PrimaryButton
SecondaryButton
BottomDock
DockButton
Toast
SettingsPanel
AccountCard
LicenseCard
Toggle
Tooltip
Divider
ScrollableContent
```

Each component should support states such as:

```text
default
hover
active
selected
disabled
loading
success
error
pro
```

---

## 32. Claude Implementation Instructions

Use the following as direct implementation requirements.

### Global Requirements

- Build a dark browser extension UI inspired by the provided reference
- Do not copy brand names, logos, or exact content
- Preserve the same visual language
- Use layered navy-black backgrounds
- Use electric yellow as the primary accent
- Use purple only for PRO and subscription sections
- Use large rounded cards
- Use Lucide outline icons
- Keep the interface compact but spacious
- Maintain consistent spacing and hierarchy
- Keep the bottom CTA sticky
- Use subtle glow effects only on important states
- Ensure responsive behavior
- Ensure accessible focus states
- Avoid broken images
- Avoid low-contrast disabled content
- Avoid excessive gradients
- Avoid excessive shadows

### Primary Visual Direction

```text
Premium dark automation dashboard with layered navy-black surfaces,
electric yellow brand accents, bold modern typography, large rounded cards,
subtle colored glows, cool-gray borders, outline icons, and a dedicated
purple visual language for premium account features.
```

---

## 33. Final Style Definition

The extension should feel like:

> A premium dark automation dashboard using layered navy-black surfaces, electric yellow brand accents, bold modern typography, large rounded cards, subtle colored glows, cool-gray borders, outline icons, and a dedicated purple visual language for premium account features.

The design should feel:

- Professional
- Technical
- Premium
- Modern
- Clear
- Fast
- Trustworthy
- Easy to use
- Suitable for a Chrome extension or SaaS side panel
