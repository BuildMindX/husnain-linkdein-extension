# PRD.md — LinkPilot AI Product Requirements

## 1. What this is

**LinkPilot AI** is a Chrome extension (Manifest V3) built by Satyron Private Limited that brings
AI-powered intelligence and outreach generation directly onto LinkedIn. It runs as a panel injected
into `linkedin.com/*` pages, backed by a Supabase + Stripe account system for sign-in, cloud sync,
and billing, and Anthropic (`claude-sonnet-5-5`) for every AI call.

Internal extension ID: `cidjcnappdecphoecngmnpkgcnhnmipd` (fixed via `manifest.json`'s `key` field).

## 2. Why it exists

The direct trigger for the current push: an internal BD team was using the extension, found the
AI-generated outreach inconsistent ("sometimes good, sometimes not"), and some team members had
started falling back to copy-pasting LinkedIn profile text into raw ChatGPT instead of trusting the
extension's own generation. The product's reason to exist is to make that fallback unnecessary — it
already has the scraped profile/analysis data ChatGPT doesn't, so it should produce consistently
better, more specific outreach without the copy-paste step, and do it inside a UI good enough to
also be sold, not just used internally.

## 3. Target users — three modes, one tool

The extension operates in exactly one of three **modes** at a time (set in Settings, drives which
scoring rubric, ICP config, and outreach framing is used):

| Mode | Who | What they need |
|---|---|---|
| **B2B Sales** | Sales/BD reps prospecting on LinkedIn | Prospect scoring vs. their ICP, decision-maker signal, personalized outreach that doesn't read as a pitch |
| **Freelance / Consulting** | Independent freelancers/consultants | Client-potential scoring, pain-point signals, peer-to-peer (not vendor) outreach |
| **Job Search** | Active job seekers | Hiring-signal detection, recruiter identification, non-desperate networking messages |

The current primary real-world user is Satyron's own internal BD team (Husnain Ali's company); the
product is also intended to be sold externally, which is why UI polish and reliability both matter —
an internal tool's bar is lower than a sellable one.

## 4. Problems solved

- Manually researching a LinkedIn profile and hand-writing (or ChatGPT-assisted) outreach is slow
  and inconsistent across a team.
- Generic AI outreach reads as generic — recipients can tell. The product's differentiator is using
  real scraped profile signal (experience, recent posts, mutual connections) plus a deliberately
  anti-AI-tell prompt system, not just "write a LinkedIn message about X."
  Decision makers get large messages, which are generally ignored.
- No structured way to track where each prospect/contact sits in an outreach sequence, or to be
  reminded when a follow-up is overdue.
- No systematic prospect scoring against a configurable ideal-customer profile.

## 5. Core features (as implemented today)

- **Profile Analysis** — AI scores the currently-viewed profile against the active mode's rubric
  (prospect score / client potential / hiring signal), returns decision-maker level, industry fit,
  company context, key insights, and a timing caution when relevant.
- **Connection Request generation** — ≤200-character, strategy-driven connection note.
- **First Message generation** — a tailored cold first message (300-350 char cap depending on mode),
  formatted as 1-2 short paragraphs, strategy-driven, tone-selectable.
- **Follow-up / conversation-aware messaging** — reads an auto-extracted (or pasted) LinkedIn
  conversation thread, classifies the recipient's last reply sentiment, and writes a contextual
  follow-up using a stage-driven angle system (see `architecture.md`), with the same strategy picker
  available as an optional override.
- **Message Strategy system** — 8 named, research-grounded outreach patterns (Smart Pick, Curiosity
  Gap, Direct & Clear, Problem-First, Shared Ground, Sharp Question, Give First, Relevant Pattern),
  each with a one-line explanation, selectable live on all three generation surfaces above.
- **Refine with AI** — post-hoc tone/wording rewrite of an already-generated message, with optional
  custom instructions, separate from strategy selection (generation-time vs. post-hoc).
- **Multi-profile ICP / Business Profile support (B2B mode)** — multiple named ICP configurations
  (target/exclude industries, business description) the user can switch between.
- **Message Style presets** — per-mode (B2B / Freelance / Job Search) saved defaults for tone,
  length, and call-to-action behavior, read into every generation prompt.
- **Team Setup share code** — one person configures the ICP/business profiles, copies a code, and
  each rep imports it in Settings; API keys, pipeline, and personal profiles are never included.
- **ICP safeguards** — prospects scored with no ICP configured are capped at Medium and labeled, and
  the Connection/Message tabs warn before writing to a Low-fit or excluded prospect.
- **Pipeline tracking** — saved contacts move through a 9-stage sequence (`new` → `connection_sent`
  → `messaged` → `followup_1` → `followup_2` → `followup_3plus` → `replied` → `booked` → `closed`),
  with per-field-timestamp cloud sync.
- **Follow-up reminders** — OS notifications + toolbar badge for contacts sitting in an actionable
  stage past a configurable threshold (default 3 days), with per-contact snooze.
- **Post Creator** — generates LinkedIn posts in two modes: Personal Brand (for the signed-in user's
  own voice/domain) and Company Brand (on behalf of the company, B2B-style), with topic suggestion,
  style selection, and optional AI image generation (Pro-gated).
- **HubSpot integration** — push a scored/saved contact to HubSpot as a deal (pipeline, stage, owner,
  notes) in one click.
- **Search-results bulk scoring** — scores an entire LinkedIn search-results page against the active
  ICP/rubric in one batched AI call, instead of one-by-one.
- **Messaging-page quick-action bar** — a lighter floating control injected directly on LinkedIn's own
  `/messaging/` thread view, for generating/inserting a follow-up without opening the full panel.
- **Contact extraction** — surfaces visible email/phone/social links from a profile page.
- **Time zone / world clock tool** — a utility panel for checking contacts' local time before
  scheduling outreach, with a free-text timezone converter.
- **Outreach activity log** — local rate tracking of connection requests / messages sent, an
  account-safety signal (LinkedIn can restrict accounts that send too fast).
- **Google Sign-In + cloud settings sync** — settings/pipeline sync across devices via a Supabase
  backend, merged field-by-field (not a blind overwrite) based on per-field timestamps.
- **Billing (Stripe via Supabase)** — Free tier: 50 analysis + 50 message + 50 post events per
  calendar month (tracked separately per event type). Pro: unlimited, via Stripe subscription,
  managed through a Stripe customer portal.

## 6. Non-functional requirements

- **Privacy**: the user's own Anthropic API key is used directly from the browser — never routed
  through Satyron's own servers. HubSpot and Anthropic keys live only in `chrome.storage.local`.
  Supabase is used only for account/billing/settings-sync, not for AI calls.
- **Reliability**: AI message generation gets an automatic retry on banned-phrase, character-cap, or
  detectable strategy-shape violations — see `rules.md` for the exact mechanism. Analysis calls
  (JSON-returning) intentionally do not get this treatment. (Temperature control is not available on
  the current model — see `rules.md`.)
- **Account safety**: the product must never perform automated/scheduled LinkedIn scraping or
  messaging without the user actively present and triggering it — a hard, non-negotiable boundary
  (see `rules.md`), since LinkedIn restricts accounts that show bot-like automated behavior.
- **No build step**: the extension ships as vanilla JS/HTML/CSS with no bundler — this is a
  deliberate simplicity choice (see `architecture.md`), not an oversight.

## 7. Explicit non-goals (as of this writing)

- No cross-user data aggregation or "what works across all users" analytics — any future learning
  system stays local-only, single-user, explicitly deferred (see `phases.md`).
- No background/scheduled re-visiting of LinkedIn profiles for activity monitoring — only
  user-initiated, in-session actions.
- No in-house LLM — Anthropic only, bring-your-own-key. (Image generation, previously via
  OpenAI, was dropped entirely during the Anthropic migration — no provider offers an equivalent.)

## 8. Open product question (unresolved)

The BD team's real behavior (falling back to raw ChatGPT) is the core signal this product is
failing to fully displace yet. Whether that's purely a generation-quality gap (being actively
worked on) or partly a trust/visibility gap (team not realizing the panel already has full scraped
profile context, so they re-paste it manually) is not yet confirmed — see `memory.md` for the
standing question to resolve with the team.
