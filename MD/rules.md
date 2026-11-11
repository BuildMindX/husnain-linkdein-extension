# rules.md — Development Rules & Standards

These are hard-won, codebase-specific rules — most were learned from real bugs found and fixed in
this project, not generic best practice. Follow them exactly; where a rule explains *why*, that why
is the reason it exists, not decoration.

## Must never

- **Never alias arrays/objects when loading stored state into editable form state.**
  `tagState.targets = active.targetIndustries` makes both variables point at the same array — typing
  into the form then silently mutates the stored profile with no save step, until the in-memory
  state gets rebuilt from a fresh storage read (e.g. on sign-in) and the aliased array is orphaned,
  silently losing anything typed after that point. Always copy: `[...active.targetIndustries]`. This
  was a real, shipped data-loss bug (fixed, commit `e2f71fe`).
- **Never let `SYNC_KEYS` (`options/index.js`) and `SETTINGS_KEYS` (`background/auth.js`) drift.**
  They must list the exact same storage keys. There is no shared bundler between background/content/
  options scripts in this codebase, so nothing enforces this automatically — a key present in one
  but not the other means that data silently never reaches the cloud (or never restores on sign-in)
  with no error anywhere. Check both files any time a new persisted setting is added.
- **Two modes, separate storage.** B2C (`b2cProfiles`, `activeB2cProfileId`, `b2cMessagePresets`)
  and B2B (`icpProfiles`, `activeIcpProfileId`, `messagePresets`) never share keys. Shapes, option
  lists and the legacy migration live only in `shared/schema.js`; taxonomy ids in
  `shared/taxonomy.js` are stored in user data and team codes, so never rename or reuse an id —
  only add. Read the mode through `normalizeIntent` everywhere (anything not `b2b_sales` is B2C).
- **Settings cloud sync is owned by the background worker** (storage.onChanged in
  background/index.js), so a change from any surface syncs. A write batch that includes
  `settingsFieldTimestamps` is a cloud restore and must not be re-stamped.
- **Never write inline `<script>` in an extension HTML page.** Manifest V3's default CSP
  (`script-src 'self'`) blocks it outright with no visible error — the page just silently does
  nothing. All JS in an extension page must live in an external `.js` file referenced via
  `<script src="...">`.
- **Never write a real API key or secret to disk**, in a committed file, a test script, or anywhere
  persistent. For testing, use an obviously-fake placeholder (e.g. `'sk-test-DO-NOT-USE'`) and
  verify success via the resulting `INVALID_KEY`/401 error — that proves the code path executed
  correctly without ever needing (or risking) a real key.
- **Never add automated or scheduled LinkedIn scraping/messaging.** No `chrome.alarms` that
  re-visit profiles, no background tab-opening, no automated re-checking without the user physically
  present and having just triggered it. This is a hard boundary, not a style preference — it's a
  real account-restriction risk for the user, not just an engineering tradeoff to revisit later.
- **Never fabricate a specific detail in generated outreach.** `PRECONVERSATION_GROUNDING` and the
  follow-up engine's thread-scoped `GROUNDING` rule exist because a fabricated specific (a fake
  mutual connection, a fake shared interest) is worse than an honest generic message — it only takes
  one wrong detail for the whole message to read as obviously mass-produced. Any new prompt content
  must not weaken or route around this.
- **Never aggregate data across users.** Any future cross-user analytics/learning system needs its
  own privacy/consent design and is explicitly out of scope until that exists — local-only,
  single-user, always.
- **Never commit, push, or run destructive git operations without being explicitly asked.** This
  includes `git commit`, `--force`, `--no-verify`, `git reset --hard`. Check in before any of these
  even when a change feels "obviously" done.

## Must always

- **Verify live before calling anything done.** `node --check` on every touched file is the floor,
  not the ceiling — for anything touching `chrome.storage`, UI rendering, or prompt construction,
  load the real unpacked extension in Playwright (see `architecture.md` §6) and confirm zero console
  errors before telling the user it works. Code review alone has missed real bugs in this project
  (the CSP inline-script issue was only caught this way).
- **Keep per-mode storage keys and per-field cloud-sync timestamps in sync with any new setting.**
  Any new persisted field needs: a storage key, an entry in both `SYNC_KEYS`/`SETTINGS_KEYS`, and —
  if it's form-editable — a copy-not-alias load pattern.
- **Route all user-facing message generation through `callAIWithBannedPhraseGuard`.** Never call
  `callAI` directly for text a user will read as a finished message — the retry guard lives in that
  wrapper. Direct `callAI` calls are reserved for JSON-returning analysis calls.
- **Follow the existing "named pattern selected by key" shape for any new selectable system**
  (mirrors `STAGE_TO_ANGLE`/`buildFollowupAngleRules` and `STRATEGY_PLAYBOOK`/`buildStrategyGuidance`):
  a keyed object of instruction strings + a lookup function with a safe default fallback. Don't
  invent a new mechanism for something structurally the same.
- **Delete one-off seed/test scripts after they've served their purpose.** Files like
  `seed_husnain_profile.html`/`.js` are explicitly temporary — written to solve a specific one-time
  data-population problem, never meant to ship as part of the product. Flag them for deletion once
  their job is done; don't leave disposable scripts sitting in the project root.
- **Push real product changes through the actual app flow**, not ad-hoc one-off scripts, wherever
  possible. When a one-off script is genuinely necessary (e.g. seeding a specific account's data),
  it should call the same functions/message types the real UI uses (e.g. trigger a real
  `SAVE_SETTINGS` push) rather than reimplementing storage writes separately — a reimplementation
  that skips the real sync step is exactly what caused the cloud-sync silent-failure bug this
  session.
- **Surface real errors instead of swallowing them.** `pushSettingsToCloud` used to return a bare
  `{ok: false}` on any failure, making a real bug indistinguishable from "nothing happened" — fixed
  to return the actual error reason. Apply the same standard to new error-handling code: a caught
  error should carry enough information to actually diagnose it later.
- **Ask for real failure evidence before tuning prompts further on a hunch.** When a user reports
  inconsistent AI output ("sometimes good, sometimes not") without a reproducible example, the right
  move is requesting the specific bad output (and its inputs/strategy/profile) — not guessing at
  more prompt tweaks. Several concrete, verifiable fixes (length-cap retry, strategy
  system) came from reading the actual code; further tuning needs actual failure cases, not more
  speculation.
- **Match scope to what was asked.** A bug report is a bug fix, not an invitation to refactor
  surrounding code. A UI redesign is a separate, explicitly-scoped initiative (see `phases.md`) —
  don't fold it into unrelated backend work without the user choosing to prioritize it.

## Codebase conventions

- No build step, no bundler, no new npm dependencies in the shipped extension — plain JS/HTML/CSS
  only. (Playwright is a dev-only testing tool, never shipped.)
- `content/index.js` is one IIFE with no exports — anything in it can only be exercised through
  `chrome.runtime.sendMessage`/DOM interaction, not direct import.
- `background/*.js` are ES modules (`"type": "module"`), can use `import`/`export` normally.
- Comments in this codebase are used deliberately to capture *why*, especially around past bugs —
  follow that convention; don't strip these comments as "unnecessary," and write new ones the same
  way when fixing something non-obvious.
- The project's own `README.md` is out of date (describes an older flat-file structure without the
  current `background/`/`content/`/`options/` folder layout, and is missing most current features).
  Treat the actual code — and these `MD/` docs once current — as source of truth, not the README.

## Anthropic API — must-keep details in `callAI` (`background/ai.js`)

Each of these silently broke the extension during the OpenAI → Anthropic migration. None produces an
obvious error; all three were found only by testing against the real API with a real key.

- **Keep the `anthropic-dangerous-direct-browser-access: true` header.** An extension service worker
  sends a browser Origin, and Anthropic rejects browser-origin requests without this header with a
  **401** — which our error mapping reports as `INVALID_KEY`, so it looks exactly like a bad key even
  when the key is valid.
- **Never send `temperature`.** `claude-sonnet-5-5` rejects it ("`temperature` is deprecated for this
  model"). Re-check this before re-adding it if the model is ever changed.
- **Never read the answer as `content[0].text`.** The model can emit a `thinking` block before its
  answer (`content = [thinking, text]`), so `content[0].text` is empty and the handler silently
  returns `""` — no error at all. Always join every `type === 'text'` block.

## ICP scoring, messaging, and team setup — must-keep details

- **Keep the no-ICP cap** in `handleAnalyzeProfile` and `handleBulkScoreProfiles`: with no target
  industries, "High" becomes "Medium" and `icpMissing` is set. Without it, scoring is seniority-only
  and looks identical to a real ICP match.
- **The first-message relevance bridge must stay specific.** Never put a literal example sentence in
  that instruction — the model copied the last one into 8 of 10 messages ("…so this one's familiar").
  Stock bridge phrases are on `BANNED_PHRASES`.
- **Team Setup is a whitelist.** It may only carry targeting/business config. Never add API keys,
  `savedContacts`, `jobProfile`, or `creatorProfile`, and keep stripping `senderName` on export /
  restoring the importer's own on import, or reps end up signing messages as each other.
- Re-run the benchmark (see `memory.md` → "Feature evaluation") after any prompt change; a prompt
  tweak that fixes one message often introduces a pattern across many.

- **Keep `max_tokens` high (8000) and keep the `stop_reason === 'max_tokens'` check.** Sonnet 5.5's
  thinking shares the output budget: at 2000, a post spent 1,477 tokens thinking and was cut off
  mid-JSON, which surfaced as raw JSON in the post box. Truncation must throw `TRUNCATED_RESPONSE`.
- **Never tell a generation prompt to use statistics, data, or quantified results it wasn't given.**
  The post style guides once said "lead with a striking statistic" / "quantify the result", and the
  model invented an incident ("looped 47 times on a single support ticket"). Proof points come only
  from the sender's saved background.
- **Thin profiles get a DATA NOTE, not a push for specificity.** Asking for a "specific hook" when only
  titles and companies exist made the model invent what the company works on.

Verification must use a real key at least once after any change to `callAI`: a fake key only proves
the code path runs, and all three bugs above pass a fake-key test cleanly.

## AI/codebase interaction expectations

- Read the actual relevant code before changing or documenting it — this project's history includes
  several cases where an assumption ("it must be silently failing") turned out wrong once the code
  was actually read (e.g. the follow-up conversation scraper already has 3 fallback strategies and an
  explicit "not found" UI state — not a silent failure, just inherently DOM-coupled).
- Prefer direct, grounded fixes with a clear before/after over broad speculative rewrites.
- When a request is large or spans genuinely different kinds of work (e.g. "fix reliability" +
  "redesign the UI" + "investigate a DOM scraping bug" arriving in one message), separate them
  explicitly and sequence or scope-check rather than attempting all of it in one undifferentiated
  pass.
