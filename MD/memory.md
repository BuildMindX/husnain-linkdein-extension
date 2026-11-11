# memory.md — Persistent Project Memory

Working memory for continuing development across sessions. Read this first when picking the
project back up. Update it as work progresses — this file is only useful if kept current.

**Last updated**: 2026-11-11, after the Phase 7 UI redesign.

## Where development stopped

**Latest: Phase 7 UI redesign is done and verified, uncommitted** (see `phases.md` Phase 7 and `design.md`, which is now the shipped spec). Must-keep rules:
- Every in-page CSS rule stays scoped under our root ids.
- Stage and score colors are `tone-*` classes, never inline hex.
- No emoji or glyph icons.
- Sentence case throughout.
- Re-run the contrast audit after any color change.

Earlier status, kept for history:

Just finished migrating the entire AI backend from OpenAI to Anthropic (`claude-sonnet-5-5`), verified
end-to-end with a real key across all seven AI handlers. **Uncommitted** — the user has not asked for
a commit yet. **Nothing is mid-edit.** See "OpenAI → Anthropic migration" below. The next real work is
Phase 6
(reliability hardening, round 2), which is explicitly blocked on getting real failure evidence from
the BD team — see "Open questions" below. Do not start Phase 7 (UI redesign) before that, per the
user's own explicit prioritization.

## What's been completed (chronological, this project's recent history)

1. **Multi-profile ICP data-loss bug, fixed.** Root cause: `loadActiveIcpProfileIntoForm()` aliased
   `tagState.targets`/`excludes` to the same array objects stored in `icpProfilesState` instead of
   copying them — typing/removing tags mutated stored data with no save step, which "worked" until
   a fresh storage read (e.g. sign-in) orphaned the aliased array and silently dropped anything typed
   after. Fixed by copying (`[...array]`) instead of aliasing, plus a `commitFormIntoActiveProfile()`
   safety net on profile switch/create. Committed as `e2f71fe`.
2. **`SYNC_KEYS` vs `SETTINGS_KEYS` gap, fixed.** `icpProfiles`/`activeIcpProfileId` were in the
   cloud-restore list but missing from the cloud-push list — profile data was silently never
   reaching the cloud. Both lists are now aligned; see `rules.md` for why this needs manual
   vigilance going forward (no shared bundler enforces it).
3. **User's own profile data populated.** Job Search, Freelance/Consulting, B2B Sales, and Post
   Creator (Personal + Company) tabs were filled in from the user's resume and satyrontech.com, via
   a one-time seed page (`seed_husnain_profile.html`/`.js`, still sitting in the project root —
   **these are temporary files, pending deletion once the user confirms everything synced
   correctly**; see `rules.md` §"Must always" on not leaving disposable scripts around).
4. **Cloud-sync silent failure, diagnosed and fixed.** The user tested end-to-end (cleared local
   data, signed out, signed back in) and got nothing back — proving the push had never actually
   reached Supabase. Root cause: `pushSettingsToCloud` swallowed every error into a bare
   `{ok:false}`, and the seed script's direct `chrome.storage.local.set()` calls bypassed the real
   sync trigger entirely (the `chrome.storage.onChanged` listener that triggers a push only runs
   while an Options page tab happens to be open). Fixed: `pushSettingsToCloud` now returns the real
   error; the seed script now pushes explicitly and **verifies by reading straight back from
   Supabase** rather than trusting the push response.
5. **Message Strategy system, built.** 8 strategies (Smart Pick + 7 named patterns), each with a
   one-line UI explanation, live on Connection tab, Message tab, and Follow-up tool. Full detail in
   `architecture.md` §3 and `phases.md` Phase 5. Verified end-to-end via Playwright (all 8 strategies
   × 3 intents × 3 surfaces, zero console errors, using a fake API key to prove execution without
   spending real usage).
6. **Reliability fixes, shipped alongside the strategy system**: fixed temperature (0.75), automatic
   retry on character-cap overrun, explicit 1-2 paragraph formatting for first messages, a mechanical
   conformance check for the Sharp Question strategy, and a fix for the variety-note instruction
   contradicting an explicitly-chosen strategy on regenerate.

## Strict benchmark rounds (2026-11-11, second pass)

Extended the benchmark to every mode (B2B, Freelance, Job Search), sparse profiles, raw-paste
follow-ups, Refine, and posts, with messages repeated for consistency, graded by code checks plus a
stricter judge model (Opus 5.5). Key findings:
- **Judge ceiling ≈ 8.** Hand-crafted best-effort messages scored 7-8 with the same judge; it gave no
  10s and would send none unedited. "10/10" from an LLM judge is not reachable — product messages on
  real prospects now land 7.3-8.0, i.e. at that ceiling.
- **Thin/off-ICP profiles score ~5.5-6** — input-limited, not prompt-limited. Handled by the thin-profile
  panel hint and the low-fit warning, not more prompting.
- Fixed in this pass: ICP fit now judged against the ideal-customer description (High requires Strong
  fit) → analysis 10/10 all modes; Job Search honesty rule (0/6 → 4-5/6); today's date in profile text
  (tenure errors); closing-question enforcement; stock-phrase bans; Refine follows length/intent;
  posts get the sender's real background and may not invent stats; **a real truncation bug**
  (max_tokens 2000 with thinking) that put raw JSON in the post box.
- Round-to-round noise is about ±0.5 quality and ±2 passes at these sample sizes — further prompt
  tweaks below that level are not measurable. **The next real signal is reply-rate data from the team**
  (Phase 8's learning system), not more benchmark tuning.
- The benchmark scripts live in the session scratchpad (eval_fixtures/eval2_*.mjs) and are NOT in the
  repo — they will be lost unless copied into the project.

## Feature evaluation + fixes (2026-11-11, after the migration)

Measured, not guessed: a benchmark of 7 realistic B2B profiles with known-correct verdicts (against
Satyron's real ICP), 6 search-result rows, 19 connection/first messages, and 4 follow-up scenarios,
run through the real extension with a real key. Baseline → final:

| | baseline | final |
|---|---|---|
| ICP analysis correct (of 7) | 6 | 6 |
| Bulk search scoring (of 6) | 6 | 6 |
| First messages w/ relevance bridge | 0/10 | 7/10 |
| Name sign-offs / flagged clichés | 3 / 3 | 0 / 0 |

Root causes of the BD team's complaints, and the fixes:
- **"Doesn't analyze by ICP"** — with an ICP set, scoring is ~9/10. The real cause: each rep's
  settings live in their own browser, so a rep who never filled in the ICP got seniority-only scoring
  (a construction VP scored **High** for an AI-infra seller). Fixed two ways: no-ICP scores are capped
  at Medium in code and flagged (`icpMissing`), with a banner on the analysis tab; and a **Team Setup
  share code** (Settings → Outreach) so one person configures the ICP and reps import it.
- **"Initial messages aren't great"** — they were specific but, by an explicit no-pitch rule, never
  said why Satyron was relevant. User chose a **relevance bridge**: one short, problem-specific clause
  about what the sender builds, still no ROI/feature list/call ask. Job Search keeps no-bridge.
- **Connection requests** — signed off with the sender's name and occasionally assumed acceptance;
  both fixed (deterministic `stripSignOff` + framework rule 4).
- Added a **low-fit warning** on Connection/Message tabs, and the profile **About** section is now
  scraped and sent to the model.
- Not scored (need live data): pipeline, reminders, HubSpot. Panel banners and the About scrape are
  code-verified only — not yet seen on a real LinkedIn page.

## OpenAI → Anthropic migration (2026-11-11)

- All AI calls now go to Anthropic's Messages API (`background/config.js`: `ANTHROPIC_API_URL`,
  `ANTHROPIC_VERSION`, `ANTHROPIC_MODEL = 'claude-sonnet-5-5'` — the model the user explicitly chose).
- Every surviving call goes through the single `callAI` in `background/ai.js`. `handleSuggestPostTopics`
  and `handleGeneratePost` used to build their own raw fetches with duplicated error handling; they
  were folded into `callAI`, their single prompt split into system + user.
- Storage key renamed `openaiApiKey` → `anthropicApiKey` everywhere (incl. `SYNC_KEYS`/`SETTINGS_KEYS`).
  No data migration: an old OpenAI key is useless against Anthropic, so users must enter a new key.
  Settings validates the `sk-ant-` prefix.
- **AI image generation was removed entirely** (user's explicit choice — Anthropic has no image
  endpoint): `handleGeneratePostImage`, the `GENERATE_POST_IMAGE` route, both Post Creator "Generate
  Image" entry points, and the `imagePrompt` field in post generation are all gone.
- `manifest.json` host permission swapped `api.openai.com` → `api.anthropic.com`. **This changed
  `host_permissions`, so a Chrome Web Store update will need re-review.**
- All user-facing "OpenAI" copy (options, popup, panel errors, privacy.html) now says Anthropic.
- Three silent bugs found only via real-key testing are documented in `rules.md` → "Anthropic API —
  must-keep details" (browser-access header, no `temperature`, thinking-block parsing).
- Verified: all 7 AI handlers return real output with a real key, zero console errors.

## Open questions / needs real-world input before proceeding

- **Is the BD team's ChatGPT fallback a quality problem or a visibility/trust problem?** Not yet
  confirmed which. If they don't realize the panel already has full scraped profile context (so
  they re-paste it manually into ChatGPT out of habit), that's a different fix (onboarding/UI
  prominence) than if the generated output itself isn't good enough yet (prompt/strategy tuning).
  Ask the team directly next time this comes up.
- **Specific bad-message examples, needed before further prompt tuning.** Phase 6 is explicitly
  blocked on this — see `phases.md`. Don't speculatively tweak prompts further without a concrete
  reported failure (actual text + strategy used + profile/conversation it came from).
- **Conversation-auto-extraction reliability** ("sometimes it picks up the conversation, sometimes
  it doesn't"). Investigated — `scrapeThreadMessages()` already has 3 fallback strategies and an
  explicit "No open conversation found" UI state with manual refresh/paste, so it's not a silent
  failure as such. But it's fundamentally coupled to LinkedIn's internal DOM class names, which
  change without notice. **Needs a screenshot of the failure state (or the page HTML) next time it
  happens** to add the missing selector variant — can't be fixed blind.

## Known temporary/cleanup items

- `assets/fonts/Sora-Bold.woff2`: unreferenced since the Phase 7 redesign. Safe to delete.
- The Satyron logo PNG is dark-only. Ask Satyron for a reversed (white) variant to drop the light tile behind it in dark mode.

- `seed_husnain_profile.html` and `seed_husnain_profile.js` (project root) — one-time data-seeding
  scripts for the user's own account. Delete once the user confirms all tabs are correctly populated
  and synced to the cloud.
- `README.md` is out of date (describes an older flat-file structure, missing most current
  features). Not yet refreshed — lower priority than the phases above, but worth doing eventually so
  it doesn't mislead anyone (including future AI sessions) who reads it before this `MD/` folder.

## Important constraints to keep in mind (see `rules.md` for full detail)

- No automated/scheduled LinkedIn scraping or messaging — ever, hard boundary.
- No API keys/secrets ever written to disk, including in test scripts.
- `SYNC_KEYS` / `SETTINGS_KEYS` must stay in lockstep manually whenever a new persisted setting is
  added.
- Git: only commit when explicitly asked.

## A separate, unrelated product mentioned mid-session (not part of this project)

A "Voice Agent" / voice-ordering product test report (round 2 test results — interruption/rushing
issues, speech recognition misses, promo/notice handling gaps, app-integration notification bugs)
was shared and the user asked to fix the underlying bugs. **That product's codebase was not located
in `~/Projects/` during a quick directory scan** (candidates not yet checked: `8x`, `cto`,
`Collapa`, `veyora-admin`, `mixt-academy` — the scan was interrupted before completing). This is
**not** the LinkedIn extension project this `MD/` folder documents — if picking that work back up,
it needs its own session/context in the correct repo, not this one.

## Decisions explicitly confirmed by the user (don't re-litigate without reason)

- Reliability/generation-quality work takes priority over the UI redesign (asked directly, this was
  the answer).
- The eventual UI redesign should align with Satyron's own branding (satyrontech.com), not stay
  neutral/white-label.
