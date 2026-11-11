# phases.md — Development Phases

Phases 1-5 reflect work already shipped (either before this documentation effort or during the
session that produced it). Phases 6+ are the active/forward plan. Don't re-do completed phases;
don't skip ahead of Phase 6 without the evidence it calls for.

---

## Phase 1 — Core Extension Foundation ✅ COMPLETE

**Objective**: a working MV3 extension that analyzes a LinkedIn profile and generates basic outreach.

- Manifest V3 scaffold, content script injection on `linkedin.com/*`, slide-in panel UI.
- Three-mode system (B2B Sales / Freelance / Job Search), each with its own scoring rubric.
- Profile Analysis (AI scoring via Anthropic), Connection Request generation, First Message generation.
- Options page (mode selection, ICP/business profile, API keys) and toolbar popup.
- Basic contact extraction (email/phone/social links visible on a profile).

**Output**: a usable, single-user extension with no account system or billing.

---

## Phase 2 — Account System & Monetization ✅ COMPLETE

**Objective**: turn the extension into a product with sign-in, cross-device sync, and a paid tier.

- Google Sign-In (`chrome.identity`), Supabase backend (`users` table, Edge Functions).
- Cloud settings sync — push on local change, field-by-field merge on sign-in restore.
- Stripe billing: Free (50 analysis + 50 message + 50 post events/month, tracked independently) vs.
  Pro (unlimited), checkout + customer portal via Supabase functions.
- Usage gating (`withUsageGate`/`withProGate`) wrapping every AI-calling and Pro-only route.

**Output**: a sellable SaaS-style extension with real account infrastructure.

---

## Phase 3 — Pipeline & Productivity Tools ✅ COMPLETE

**Objective**: make the extension useful across a full outreach sequence, not just the first touch.

- Saved contacts / 9-stage pipeline tracking, with per-field-timestamp cloud merge.
- Follow-up / chat-aware message generation (conversation scraping, reply classification,
  stage-driven angle system).
- Follow-up reminders (OS notifications, toolbar badge, snooze).
- HubSpot integration (push contact as deal).
- Post Creator (Personal Brand + Company Brand post generation, topic suggestion, AI image gen).
- Messaging-page quick-action bar, search-results bulk scoring, time zone tool, outreach activity
  log (account-safety rate tracking), sidebar dock quick-save.

**Output**: the full feature set as it stood before the current reliability/strategy work.

---

## Phase 4 — Data Integrity Hardening ✅ COMPLETE (this session)

**Objective**: fix a reported data-loss bug in multi-profile ICPs and the resulting cross-device
sync gap it exposed.

- Root-caused and fixed the array-aliasing bug in `loadActiveIcpProfileIntoForm` (copy, not alias).
- Added a `commitFormIntoActiveProfile()` safety net so switching/creating ICP profiles auto-commits
  pending unsaved edits.
- Found and fixed `SYNC_KEYS` missing `icpProfiles`/`activeIcpProfileId` (present in `SETTINGS_KEYS`
  but never actually pushed to the cloud — a silent, independent bug from the aliasing one).
- Populated the user's own real profile data (Job Search / Freelance / B2B / Post Creator tabs)
  from his resume and satyrontech.com, via a one-time seed page (now pending deletion — see
  `memory.md`).
- Diagnosed and fixed a real cloud-sync silent-failure: `pushSettingsToCloud` swallowed every error
  into a bare `{ok:false}`; fixed to surface the real reason, and the seed page now verifies the
  push by reading straight back from Supabase instead of trusting the response blindly.

**Output**: multi-profile ICP editing and cross-device cloud sync both verified working end-to-end.

---

## Phase 5 — Message Generation Quality & Strategy System ✅ COMPLETE (this session)

**Objective**: directly address "sometimes good, sometimes not" AI outreach — the root cause of the
BD team falling back to raw ChatGPT.

- Added an 8-strategy picker (Smart Pick + 7 named patterns, each with a one-line explanation) to
  all three generation surfaces: Connection tab, Message tab, Follow-up tool.
- Fixed temperature (0.75) on every message-writing call. *(Later removed in the OpenAI → Anthropic
  migration: `claude-sonnet-5-5` rejects the `temperature` parameter.)*
- Added automatic retry on character-cap overrun.
- Added explicit 1-2 short-paragraph formatting for first messages (was an implicit single block).
- Added a mechanical conformance check for the one strategy with a verifiable signature (Sharp
  Question must end in `?`), auto-retrying if violated.
- Fixed an internal contradiction: regenerating with an explicitly-chosen strategy no longer tells
  the model to "find a different angle entirely" (which fought the chosen strategy) — variety is now
  scoped to stay within the chosen strategy.
- Verified end-to-end (all 8 strategies × all 3 intents × all 3 surfaces) against the live unpacked
  extension with zero console errors.

**Output**: a strategy-driven, more reliable generation system, verified for correct execution but
**not yet verified for output quality against real recipients** — that's Phase 6.

---

## Phase 6 — Reliability Hardening, Round 2 🔶 IN PROGRESS

**Update 2026-11-11**: no longer blocked — evidence was generated directly with a benchmark of
realistic profiles run through the real extension (see `memory.md` → "Feature evaluation"). Shipped
from it: no-ICP score cap + banner, Team Setup share code, first-message relevance bridge, sign-off
and cliché removal, low-fit warning, About-section scrape. Still open: real bad-message examples from
the team on *live* LinkedIn data, and the conversation-scraper's live failure mode.

### Original Phase 6 notes

**Objective**: close the remaining gap between "executes correctly" (verified) and "actually
produces consistently good messages" (not yet verified with real data).

**This phase cannot proceed further on guesswork.** What's needed from the BD team before more
prompt tuning happens:

- Specific bad generated messages — the actual text, which strategy was selected, and the profile/
  conversation it was generated from.
- A screenshot of the Follow-up tool's "No open conversation found" state, next time it happens, so
  the conversation-scraper's selector set can be checked against LinkedIn's actual current DOM
  (the scraper already has 3 fallback strategies + an explicit not-found UI state — it's not
  silently failing, but it is inherently coupled to LinkedIn's markup, which changes without
  notice).
- A direct answer to the open question in `memory.md`: is the team still copy-pasting into ChatGPT
  out of habit, lack of trust in current output, or not realizing the panel already has full profile
  context? This changes whether the next fix is technical or about onboarding/visibility.

**Completion criteria**: at least one real reported bad-message case diagnosed and fixed with a
concrete root cause (not a speculative prompt tweak), and the conversation-scraper's actual failure
mode confirmed or ruled out.

---

## Phase 7 — Visual Redesign, Satyron-Branded ✅ DONE (2026-11-11, uncommitted)

**Objective**: a UI professional enough to market and demo that doesn't read as AI-generated, aligned with Satyron's brand. The user asked for it directly ("redesign the extension in a way that I can market"), which superseded the earlier "Phase 6 first" ordering.

**Delivered** (spec: `design.md`):
- **Stylesheets.** All three were rewritten from scratch on one token system: Satyron palette, light default, dark via `prefers-color-scheme`.
  - `content/styles.css`: 3,513 → ~720 lines, no `!important` override layer.
  - `options/styles.css`: 2,243 → ~470 lines.
  - `popup/styles.css`: 703 → ~210 lines.
- **Brand.**
  - New toolbar/store icon: LP monogram, `assets/icon-16/32/48/128.png`. `extension_icon.png` was overwritten with the same mark, so the old sparkle is gone everywhere.
  - Space Grotesk is self-hosted for display text.
- **Analysis tab rebuilt.**
  - A verdict block plus `<dl>` fact rows replaces the card-per-fact layout and the fake progress bars.
  - Duplicate industry row removed; numbered insights.
- **Copy cleanup.**
  - All emoji icons, sparkles, ∞ bars and glyph arrows removed.
  - Sentence case throughout.
  - AI-flavored copy tightened.
  - The false "image generation" and "Priority AI" claims removed from the pricing step.
- **Theming and responsiveness.**
  - Pipeline and popup stage colors moved to themed tone classes.
  - Settings is now responsive: it collapses to a top-bar nav at ≤860px and had 178px of horizontal overflow at 390px before the fix.
  - Drawers go full-width at ≤520px, with the dock hidden while a drawer is open.
- **Fixes found during verification.**
  - Gate icons used hardcoded neon colors.
  - Inline errors rendered below the fold. They now scroll into view.
  - A "NaNd ago" guard was added for cache records without a timestamp.
  - Host-page `li` margins were leaking into lists.

**Verified**:
- 27 screenshots per theme, reviewed.
- Rendered contrast audit: 1,256 text nodes plus all form controls on 19 surfaces × 2 themes, **0 failures**.
- 18-check functional click-through: **0 failures**.
- Team-setup verifier still passes.
- Zero page errors.

**Not verified / open**:
- Only checked against a mocked LinkedIn page, not live linkedin.com DOM/CSS.
- The panel follows the OS color scheme, not LinkedIn's own dark-mode setting. A user with LinkedIn dark and OS light gets a light panel.
- The Satyron logo has no reversed (white) variant, so it sits on a light tile.
- `assets/fonts/Sora-Bold.woff2` is now unreferenced.

---

## Phase 8 — Activity Monitoring & Learning System 🔷 SCOPED, NOT STARTED, LOW PRIORITY

Captured from an earlier planning pass (not re-derived here, just preserved so it isn't lost):

- **Activity monitoring**: diff freshly-scraped posts against a stored snapshot on a contact's next
  *user-initiated* profile visit, surface genuinely new content as an optional follow-up signal.
  Hard boundary: user-initiated only, never automated/scheduled (see `rules.md`).
- **Learning system**: log which strategy/angle was actually sent (at the Copy-to-Clipboard point,
  the existing proxy for "this was really sent"), and later mark it as having gotten a reply when
  the contact's stage moves to `replied` — an approximate heuristic, not causal attribution, local-
  only, single-user. Surface as a small "Angle Performance" view in the Pipeline tab.
- Cross-user aggregation is explicitly a separate, much larger initiative (privacy/consent/schema
  design) and not sketched further than that here.

No work has started on this phase. Do not begin it before Phases 6-7 are further along, and not
without re-confirming priority with the user first.
