# architecture.md — Technical Architecture

## 1. System shape

Manifest V3 Chrome extension, **no build step, no bundler, no npm dependencies shipped** — plain
JS/HTML/CSS loaded directly by Chrome. Background logic runs as ES modules (`"type": "module"` in
the service worker); the content script is a single IIFE (`(() => { 'use strict'; ... })()`) with no
exports — everything in it is closure-scoped.

```
┌─────────────────────┐      chrome.runtime.sendMessage       ┌──────────────────────────┐
│ content/index.js     │ ─────────────────────────────────────▶│ background/index.js      │
│ (injected on         │◀───────────────────────────────────── │ (service worker)         │
│  linkedin.com/*)      │              response                 │  routes to ai.js/         │
└─────────────────────┘                                         │  auth.js/billing.js/      │
         │                                                       │  hubspot.js/reminders.js  │
         │ renders                                               └──────────┬───────────────┘
         ▼                                                                   │
   #lia-panel (slide-in, 390px)                                              │ fetch
                                                                               ▼
┌─────────────────────┐                                         ┌──────────────────────────┐
│ options/index.html    │  chrome.storage.local (settings,       │ Anthropic API (claude-sonnet-5-5) │
│ + popup/index.html    │  pipeline, ICP profiles, API keys)     │ HubSpot API               │
│ (own pages, own JS)    │                                        │ Supabase (auth/sync/      │
└─────────────────────┘                                          │  billing) + Stripe        │
                                                                   └──────────────────────────┘
```

## 2. Folder structure

```
manifest.json              MV3 config — permissions, oauth2 client, host_permissions, content_scripts
background/
  index.js                 Service worker entry — chrome.runtime.onMessage router, withUsageGate/
                            withProGate wrappers, pushSettingsToCloud, alarms (daily plan sync,
                            follow-up reminder check)
  ai.js                     All Anthropic prompt construction + calling — analysis, connection request,
                            first message, chat follow-up, refine, post creator. ~1300 lines, the
                            single largest file in the project.
  auth.js                   Google sign-in/out, SETTINGS_KEYS (cloud-restore key list), field-by-
                            field settings merge on sign-in, saved-contacts merge
  billing.js                Usage-gate check/track against Supabase, Stripe checkout/portal session
                            creation
  hubspot.js                HubSpot pipelines/owners fetch, deal push
  reminders.js               Follow-up-due detection (getDueContacts), notification firing
  config.js                 ANTHROPIC_API_URL/VERSION/MODEL, SUPABASE_URL/ANON_KEY constants (public/non-secret)
content/
  index.js                  ~4400 lines. Injected on every linkedin.com page. Owns: the slide-in
                             panel, purpose picker, all tab rendering, profile extraction, pipeline/
                             saved-contacts, messaging-page quick-action bar, Post Creator, search-
                             results bulk scoring, time zone tool, sidebar dock, HubSpot modal.
  styles.css                 ~3500 lines. Light theme is the base; a dark-theme override block
                             layers on top (see design.md).
options/
  index.html / index.js / styles.css   Full settings page (own tab) — mode selection, ICP/business
                            profiles, message style presets, Post Creator profiles, Integrations
                            (API keys), Pipeline dashboard, Account (sign-in/billing).
popup/
  index.html / index.js / styles.css   Toolbar icon popup — quick status, usage stats, upgrade CTA.
supabase/
  functions/                 Deno Edge Functions: sync-user, save-settings, track-usage,
                             create-checkout, create-portal-session, stripe-webhook, cancel-page,
                             success-page
  migrations/                 Postgres migrations (atomic usage tracking via RPC)
schema.sql                   users table (plan, stripe ids, google_id) + usage_events table
rules.json                   declarativeNetRequest rules (Stripe redirect handling)
cancel.html / success.html / privacy.html   Static pages opened via chrome.tabs.create
```

## 3. Message-generation subsystem (background/ai.js)

The core AI surface. Three user-facing message handlers, all exported and routed from
`background/index.js`:

- `handleGenerateConnectionRequest(profileData, intent, userNotes, contextMaterial, previousAttempt, strategy)`
- `handleGenerateFirstMessage(profileData, analysis, intent, tone, userInstructions, stage, daysSinceLastTouch, contextMaterial, previousAttempt, strategy)`
- `handleGenerateChatFollowup({ conversationText, isRaw, contactName, senderName, intent, userInstructions, stage, daysSinceLastTouch, analysis, contextMaterial, strategy })`

Each resolves the mode with `getModeContext(intent)` (B2C unless intent is exactly `b2b_sales` —
legacy `job_search` lands in B2C) and builds its prompt from the active profile via
`buildIcpContext` (structured targeting, with LinkedIn industry names for matching),
`buildSenderContext` (the only allowed source of anything said about the sender) and
`buildStyleRules` (tone + ending). Shapes and option lists live in `shared/schema.js` and
`shared/taxonomy.js`, loaded by the worker, the content script and the options page alike.
All handlers share:

- **`AUTHENTICITY_RULES`** — bans em-dashes, emojis, "Hi [Name]" openers, generic filler, restating
  what the recipient said, corporate jargon, fixed acknowledge-pitch-question templates.
- **`PRECONVERSATION_GROUNDING`** (connection request / first message) and a thread-scoped
  equivalent inside `buildFollowupAngleRules` (follow-up) — never invent a specific detail not
  literally present in the scraped data; fall back to honest-generic over fabricated-specific.
- **`STRATEGY_PLAYBOOK`** + `buildStrategyGuidance(strategyId)` — 8 named structural patterns
  (`smart_pick`, `curiosity_gap`, `direct_value`, `problem_first`, `shared_ground`, `sharp_question`,
  `give_first`, `relevant_pattern`), injected right after the per-message-type framework
  (`CONNECTION_REQUEST_FRAMEWORK` / `FIRST_MESSAGE_FRAMEWORK`). For follow-ups, the strategy is
  layered on top of — not a replacement for — the existing stage-driven angle system.
- **`callAIWithBannedPhraseGuard(systemPrompt, userPrompt, maxChars, strategy)`** — the single choke
  point for every message-writing call. After the first response, checks: (a) a literal banned-phrase list, (b) character-cap overrun (200 for connection
  requests, 300/350 for first messages depending on mode, 300 for follow-ups), (c)
  `violatesStrategyShape` — currently only `sharp_question` has a mechanically-checkable signature
  (must end in `?`). Any violation triggers exactly one corrective retry, never a loop.
- **`buildVarietyNote(previousAttempt, strategy)`** — on regenerate, feeds the previous attempt back
  and demands genuine variety. When a specific (non-`smart_pick`) strategy is active, variety is
  explicitly scoped to "a different detail within this strategy," not "a different strategy
  entirely" — the two would otherwise contradict each other.

The follow-up handler additionally does: full-thread reading (not just the last message),
reply-sentiment classification (INTERESTED/CURIOUS/NEUTRAL/OBJECTION/NOT_NOW/PRICE_CONCERN, never
surfaced to the user), a `NEED_ID`/`LEAD_READ`/optional `TIMING_NOTE` trailing-line protocol parsed
out by the content script, and `STAGE_TO_ANGLE` — a stage-keyed angle map (insight/curiosity →
resource/referral → direct) with a 14-day "went cold" re-engagement override for contacts who
replied once and went quiet.

Shared, non-message-specific: `handleAnalyzeProfile` / `handleBulkScoreProfiles` (JSON-returning,
call `callAI` directly, no retry guard — their output is parsed as JSON, not shown as a message) and
`handleRefineMessage` / `handleSuggestPostTopics` / `handleGeneratePost`. No `temperature` is sent
anywhere — see `rules.md` for why. (`handleGeneratePostImage` was removed with the OpenAI → Anthropic
migration; Anthropic has no image-generation endpoint.)

## 4. Settings storage & cloud sync

Everything lives in `chrome.storage.local` first; sync to Supabase is best-effort and additive.

- **Local-only truth**: `chrome.storage.local` is the source of truth for everything — ICP profiles,
  message presets, pipeline (`savedContacts`), API keys, plan status, Post Creator profiles.
- **Push path**: `options/index.js`'s `chrome.storage.onChanged` listener (only active while an
  Options page tab is open) watches `SYNC_KEYS`, stamps a `settingsFieldTimestamps` entry per
  changed key, and debounce-pushes via `chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings })`
  → `background/index.js`'s `pushSettingsToCloud` → Supabase `save-settings` function → `UPDATE users
  SET settings = ...`.
- **Restore path**: `handleGoogleSignIn` (`background/auth.js`) calls Supabase `sync-user`, which
  upserts the `users` row (creating it on first sign-in) and returns the stored `settings` JSONB.
  `mergeSettingsByField` then merges cloud vs. local **per field**, by comparing
  `settingsFieldTimestamps` — whichever side touched a given field more recently wins for that field
  only, never a blind whole-object overwrite. `savedContacts` gets its own separate per-contact merge
  (`mergeSavedContacts`, keyed by URL + `stageUpdatedAt`).
- **`SYNC_KEYS`** (`options/index.js`) and **`SETTINGS_KEYS`** (`background/auth.js`) must list the
  exact same keys — one governs what gets pushed, the other what a sign-in restore merges back in.
  There is no shared bundler/import between these two files, so this is a manually-maintained
  invariant, not an enforced one (see `rules.md`).
- **Known gotcha**: "Clear All Local Data" (Settings → Account) only calls `chrome.storage.local.clear()`
  — it does not touch the cloud copy and does not call `handleGoogleSignOut`. A full account
  reset requires both actions.

## 5. Billing & usage gating

`withUsageGate(eventType, fn)` (`background/index.js`) wraps every AI-calling message route:
requires an Anthropic key present (else `{error: 'NO_API_KEY'}`, short-circuits before `fn()` ever
runs), then for Pro users calls through immediately (usage tracked fire-and-forget, never blocking);
for Free users calls Supabase `track-usage`, which does an atomic check-and-insert (Postgres RPC,
avoids a check-then-insert race) against a 50/month limit **per event type** (`analysis`, `message`,
`post` — tracked independently, not pooled). `withProGate(fn)` is a simpler Pro-only check, used for
HubSpot sync and AI image generation.

Stripe flow: `handleStartCheckout`/`handleOpenBillingPortal` (`background/billing.js`) both require
an interactive or cached Google auth token, then hit Supabase `create-checkout` /
`create-portal-session`, which return a Stripe-hosted URL opened via `chrome.tabs.create`.
`stripe-webhook` (Supabase function) is the write path that actually flips `users.plan` on
subscription events — not covered in depth here since it wasn't touched this session.

## 6. Testing approach (no automated test suite in this project)

The established, repeatedly-used pattern this session:
1. `node --check <file>` on every touched JS file — catches syntax errors immediately.
2. Load the real unpacked extension via Playwright (`chromium.launchPersistentContext`, a pinned
   Chrome-for-Testing binary matching the installed `playwright-core`'s expected revision —
   check `node_modules/playwright-core/browsers.json` for the exact revision number, cached under
   `~/Library/Caches/ms-playwright/chromium-<rev>/`), `--load-extension=<path>`, extension ID read
   from `context.serviceWorkers()[0].url()`.
3. Exercise the real `chrome.runtime.sendMessage` message types with a fake/invalid Anthropic key
   seeded into `chrome.storage.local` (not a real key) — a clean `{error: 'INVALID_KEY'}` (not a
   thrown JS exception, not `undefined`) proves the full prompt-construction code path executed
   without error, all the way to the real network call, with zero real API usage.
4. For UI-only changes, seed state via an extension page (`popup/index.html` or
   `options/index.html`) + `page.evaluate()` (the only contexts with `chrome.storage` access outside
   a content script's isolated world), then screenshot.

This project has no CI and no formal test files — every verification is a disposable script written
to the scratchpad directory for that session, not committed to the repo.
