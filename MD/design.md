# design.md — LinkPilot design system (shipped, Phase 7)

This is the spec the three surfaces are built to. Change it here first, then in the CSS.

Surfaces:
- **In-page UI** (`content/styles.css`): analysis panel, Post Creator and World Clock drawers, dock, follow-up bar on messaging, scoring banner on search.
- **Settings** (`options/styles.css`)
- **Toolbar popup** (`popup/styles.css`)

All three share one token vocabulary. The in-page tokens are prefixed `--lp-` and scoped to our root ids. Settings and popup use unprefixed tokens on `:root`.

## 1. Why it looks the way it does

The previous UI read as AI-generated. The causes were specific:
- Tailwind violet `#7c3aed` with glows and gradients, and sparkle icons (including the toolbar icon).
- 27 emoji used as icons.
- A card around every fact, nested cards, ALL-CAPS micro-labels.
- Fake progress bars for categorical values; "∞" bars on Pro.
- An unconditional dark `!important` override layered on a light base: 70 distinct hex colors and 35 shadows.

The redesign removes every one of those. Rules that keep it that way:
- **One accent, used for action and selection only.** Satyron violet. No gradients, no glows, no colored shadows.
- **Hairlines over boxes.** Facts are rows in a `<dl>` divided by 1px borders, not cards. A card only exists where a real group exists (verdict, message draft, refine section).
- **Sentence case everywhere.** Feature names stay capitalised ("Post Creator", "World Clock"). Nothing is uppercase.
- **No emoji, no decorative glyph arrows (→ ↗ ∞ ✓ ⚠) in UI copy.** Icons are 1.8–2.2px stroke SVGs using `currentColor`. Breadcrumb paths such as "Settings → Integrations" are fine.
- **Bars only for real quantities.** Free-plan usage gets a bar against its limit. Pro usage is three plain numbers. Categorical values (High/Medium/Low, Yes/No, Strong fit) are badges.
- **Brand mark** is the typeset "LP" monogram in Space Grotesk on violet (`.lia-logo`, `assets/icon-*.png`). Never a sparkle.

## 2. Color tokens

Source: Satyron's production CSS (satyrontech.com). Light is the default; dark comes from `prefers-color-scheme: dark`. Ratios are measured against the token they sit on.

| Token | Light | Dark | Use |
|---|---|---|---|
| bg | `#FFFFFF` | `#171329` | drawer, card, popup background |
| canvas | `#FBFAFE` | `#0E0B1A` | Settings page background |
| surface | `#F7F4FB` | `#211B3A` | recessed groups, chips |
| surface-hover | `#F1ECF7` | `#2A2350` | hover |
| border | `#E7DDF4` | `#2E2750` | decorative hairlines (not for controls) |
| border-strong | `#8F78B3` | `#6E62A3` | input/select/secondary-button edges (≥3:1, WCAG 1.4.11) |
| text | `#21152F` (17:1) | `#FFFFFF` | primary text |
| text-2 | `#463453` | `#D8D4F0` | body copy |
| muted | `#655374` (6.9:1) | `#9A94BA` (lightened from Satyron's `#8A84AA` to pass AA) | labels, meta |
| accent | `#56318D` | `#9F8FD4` | primary buttons, links, selection |
| on-accent | `#FFFFFF` (9.5:1) | `#0E0B1A` (6.8:1) | text on accent |
| accent-soft / accent-line | `#F1ECF7` / `#CDB9E6` | `#2A2350` / `#4A3F7E` | selected tiles, badges |
| good fg / bg / line | `#1E6B47` / `#E8F5EE` / `#B9DEC8` | `#6FE8C2` / `#173328` / `#24533F` | High, Yes, Strong fit, replied |
| mid (warn) | `#7A5200` / `#FBF2DC` / `#EAD39C` | `#E8C96F` / `#33290F` / `#5A4718` | Medium, follow-up, ICP warnings |
| bad | `#B42318` / `#FEF1EF` / `#F4C3BD` | `#FCA5A5` / `#3A1A22` / `#64303A` | errors, exclusions |
| info (Settings/popup) | `#1D5A8C` / `#E9F2FA` | `#8CC8F5` / `#142A3D` | "reaching out" stages |

Semantic color is separate from the accent and never stands alone. A badge always carries its word ("High", "Strong fit"). Low/neutral values use the muted surface, not red.

Pipeline and popup stage/score colors are **tone classes** (`tone-good|warn|info|muted|neutral|hot`), never inline hex. `STAGE_META` in `options/index.js` and `popup/index.js` carries `tone`, not `color`. Stage `<select>`s border with `currentColor` so the control edge clears 3:1.

**Known exception:** the Satyron logo PNG is dark artwork with no reversed variant. It always sits on a fixed light tile (`.powered-logo`, `.sig-powered img`). Replace with a proper reversed asset if Satyron supplies one.

## 3. Typography

- **Display:** Space Grotesk (variable 300–700), self-hosted at `assets/fonts/SpaceGrotesk-Variable.woff2` under the OFL license. Used for the panel title, section labels, verdict values, page headings, prices and clock digits. Never for body text.
  - The content script loads it via the absolute `chrome-extension://<pinned id>/…` URL, because relative URLs resolve against linkedin.com. It's exposed through `web_accessible_resources` (`assets/fonts/*.woff2`).
  - No third-party font requests, consistent with the privacy promise.
- **Body/UI:** the system stack (`-apple-system, Segoe UI, Roboto…`). It feels native next to LinkedIn and costs nothing to load.
- **Scale (panel):** 12 / 12.5 / 13 / 13.5 / 14 / 15.5 / 17–18. Settings headings 17 (card) and 28 (page). Line height 1.45–1.6 for prose.
- `font-variant-numeric: tabular-nums` on counts, clocks, prices and char counters.

## 4. Shape, spacing, motion

- **Radius:** 6px badges and chips, 8px controls and buttons, 12px cards and tiles. Logo tile 7px at 24px.
- **Spacing:** flex/grid `gap` only. Panel body gap 16, sections 8, Settings card padding 24 (18 below 560px).
- **Shadows:** only on floating layers (drawer edge, dock buttons, popovers). Cards in Settings get a 1px hairline shadow in light mode and none in dark.
- **Motion:**
  - Drawers slide with `transform` over 280ms, `cubic-bezier(.2,.8,.2,1)`, and toggle `visibility`, so closed drawers leave the tab order.
  - Hover transitions run 150ms.
  - Everything is disabled under `prefers-reduced-motion`.
- **Focus:** every interactive element shows `--focus` (a 3px accent ring at 30–40% alpha) on `:focus-visible`.

## 5. Layout behavior

- **Drawers:**
  - 400px wide, `max-width: 100vw`, full height. Only one is open at a time (`closeOtherFloatingPanels`).
  - The dock follows the open drawer (`body:has(... .lia-open)` → `right: 400px`).
  - At ≤520px the drawer is full-width and the dock hides until it closes.
- **Settings:**
  - 232px sidebar plus a content column capped at 760px. The Pipeline board is uncapped: 5 columns with `minmax(220px, 1fr)`, scrolling horizontally inside itself.
  - At ≤860px the sidebar becomes a sticky top bar with a horizontally scrolling nav.
  - At ≤560px form rows and pricing plans stack, and the pipeline columns snap-scroll.
  - Single-column grids use `minmax(0, 1fr)`; plain `1fr` lets the nav's min-content width blow out the page.
- **Popup:** fixed 360px.

## 6. Specificity contract (in-page CSS)

LinkedIn ships aggressive global CSS, so every in-page rule is scoped under one of our root ids:
- `#lia-panel`, `#lia-post-panel`, `#lia-time-panel`, `#lia-sidebar-dock`, `#lia-followup-bar`, `#lia-search-banner`.

That out-specifies LinkedIn without `!important`. The only `!important` uses are the reduced-motion kill switch and a handful of resets where JS writes inline styles. The base layer resets `li` margins because host pages style `li` globally.

## 7. Component inventory (in-page)

| Pattern | Classes |
|---|---|
| Verdict ("Should you message?") | `.lia-verdict.ro-yes / .ro-maybe / .ro-no` → `-head`, `-label`, `-value`, `-reason` |
| Fact rows | `dl.lia-facts > .lia-fact > dt + dd (+ .lia-fact-note)` |
| Badge | `badgeHtml(value, label)` → `.lia-badge--good / --mid / --low / --neutral` |
| Notice | `.lia-notice` (warn by default), `.lia-notice--bad`; legacy `.lia-icp-warning*` shares the style |
| Numbered insights | `ol.lia-list` (CSS counters, accent-soft numerals) |
| Choice tiles | `.lia-strategy-btn`, `.lia-tone-btn`, `.lia-pc-style-card` (`.active` = accent-soft and accent border) |
| Gates | `_renderGate()` → `.lia-gate` (icon tile uses `currentColor`; the old per-gate neon colors are ignored) |
| Inline errors | `.lia-error-msg` / `.lia-pc-error`. A per-drawer `MutationObserver` (`keepErrorsInView`) scrolls any newly shown error into view, with `scroll-margin: 24px`. |

## 8. Verification (re-run after any visual change)

Scripts live in the session scratchpad. Port them into the repo if this becomes routine.
- `shoot.mjs <label> [light|dark]` screenshots every surface (27 shots per theme) and logs horizontal overflow at 390px plus page errors.
- `contrast_audit.mjs` walks every rendered text node and form control on 19 surfaces in both themes, alpha-blending through ancestor backgrounds. It enforces 4.5:1 for text and placeholders (3:1 for large text) and 3:1 for control edges. **Phase 7 result: 1,256 text nodes, 0 failures.**
- `verify_ui_actions.mjs` is an 18-check functional click-through:
  - keyboard open, dock follow, verdict and fact rendering
  - exact clipboard copy, strategy selection
  - invalid-key error shown and scrolled into view
  - drawer close and tab order, Post Creator flow
  - mobile Settings nav, key validation, zero page errors
