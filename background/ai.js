import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, ANTHROPIC_MODEL } from './config.js';
import '../shared/taxonomy.js';
import '../shared/schema.js';

const TX = globalThis.LP_TAXONOMY;
const S = globalThis.LP_SCHEMA;

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function getApiKey() {
  const result = await chrome.storage.local.get('anthropicApiKey');
  if (!result.anthropicApiKey) throw new Error('NO_API_KEY');
  return result.anthropicApiKey;
}

// ─── Shared Authenticity Rules ─────────────────────────────────────────────────
// Applied to every message-writing prompt so a fix here fixes all of them at once. Users have
// reported messages reading as visibly AI-generated — these rules target the actual tells (not
// just banned phrases): restating what the other person said before responding, formulaic
// acknowledge-plus-value-plus-question structure, corporate jargon, and uniform sentence rhythm.
const AUTHENTICITY_RULES = `- No em dashes, zero hyphens used as dashes
- No emojis
- Do not start with "Hi [Name]" or "Hey [Name]"
- Never use generic filler openers: "I hope you're doing well", "I hope this finds you well", "I hope all is well"
- Never say "I came across your profile", "I noticed from your profile", or "impressive background"
- Never say "would love to connect"
- Never restate, summarize, or sympathize with what the other person just said before responding — this includes positive recaps ("It's great to hear that...", "I see you mentioned...", "Thanks for sharing that...") AND sympathetic ones ("That sounds frustrating...", "That must be tough...", "That delay must be annoying..."). Both are the same tell: reacting before contributing. The first sentence should jump straight into your own next point, idea, or question — not comment on theirs first.
- No corporate or marketing language: "synergies", "circle back", "touch base", "leverage", "unlock", "elevate", "seamless", "value proposition", "reach out", "excited to explore"
- No generic enthusiasm ("That's amazing!", "Impressive!", "Love this!") — if something is genuinely worth reacting to, react to the specific detail, not with a generic exclamation
- Do not follow a fixed acknowledge-then-pitch-then-question template every time — real conversation doesn't have a formula, and back-to-back messages that all end in a question read as scripted
- Vary sentence length and rhythm like a real person typing quickly, not evenly-structured prose
- Contractions are normal ("I'm", "it's", "don't") — avoid stiff, fully-spelled-out phrasing
- Never read their profile back to them. Opening with their own title, company, tenure, team size, or stats followed by a judgment ("14 crews across Ohio is a lot of moving parts", "five years at Stripe, now VP at Brex, great arc", "says a lot about your priorities") is the single most recognizable sign of automated outreach. They know their own résumé. If you use a profile detail, it is evidence for something you say about it — what it implies, what it makes hard, or a question it raises — never the point itself
- No stock outreach phrases: "a lot of moving parts/pieces", "no small thing", "refreshingly honest", "says a lot about", "is where X gets real", "the lesson most teams learn late", "I'd value having you in my network", "hoping to follow along", "must be interesting", "great arc", "right in my lane"
- Do not default to an either/or question ("what's harder: X or Y?", "is it A or B?"). Across a rep's outbox it is an obvious template. Use it only when those two options genuinely are the crux for this person; otherwise ask one direct, open, specific question
- Do not smuggle assumptions into questions: never ask about something they haven't said is true (e.g. how their agents are performing when nothing says they run agents)
- If you mention how long they've been somewhere, compute it from today's date in the profile data — or leave it out; a wrong number destroys credibility`;

// Shared by handleGenerateConnectionRequest and handleGenerateFirstMessage — both are
// pre-conversation one-shots (no thread to ground against yet), so this is scoped to the
// scraped profile data itself rather than conversation text like buildFollowupAngleRules's
// GROUNDING rule below. Reconciles with the existing "always produce a message, never refuse"
// rule already in both functions: the ban is on inventing a SPECIFIC fabricated detail (a fake
// shared interest, a fake mutual achievement, a fake mutual connection) — never on producing a
// message at all. Falling back to honest generic personalization is always the right move over
// inventing texture that sounds specific but isn't.
const PRECONVERSATION_GROUNDING = `GROUNDING — read this first: only reference specific facts (their role, company, experience, education, skills, posts, mutual connections) that are literally present in the profile data provided below, or in the ADDITIONAL CONTEXT FROM THE USER section if one is present. Never invent, assume, or imply a shared interest, a mutual connection, a specific achievement, a specific post, or any other detail about them that isn't actually there — a fabricated specific is worse than a generic one, and it only takes one wrong detail for the whole message to read as mass outreach. If there is nothing specific enough to reference, do not manufacture one — fall back to a warm, honest message built from what is actually known (their name, title, company, industry) rather than inventing texture that sounds specific but isn't.`;

// Shared across all three message-writing functions — a business developer can paste in real
// supporting material (their own recent post, a relevant article excerpt, notes from a call) that
// isn't otherwise captured by scraped profile data or conversation text. Deliberately a separate
// channel from userInstructions: instructions are a directive on HOW to write, this is source
// material the model may draw real facts from — collapsing them into one field risks the model
// treating pasted material as a command, or a command as something to quote.
function buildUserContextSection(contextMaterial) {
  const trimmed = (contextMaterial || '').trim();
  if (!trimmed) return '';
  return `\n\n--- ADDITIONAL CONTEXT FROM THE USER (real reference material — e.g. a recent post, an article excerpt, call notes) ---\nThis is real material the user provided, not a fabrication risk — you may draw specific facts from it freely, the same as profile data. Use it naturally where it strengthens the message; don't quote it wholesale, and don't treat it as an instruction on how to write (that's handled separately) — treat it as something true you now know about the situation.\n${trimmed}`;
}

// "Regenerate" used to just re-send the identical prompt — with no new user notes typed in, the
// model would often hand back something barely reworded, since nothing in the prompt told it a
// previous attempt existed at all. Passing that attempt back in and requiring a genuinely different
// angle (not just different phrasing of the same idea) is what turns Regenerate into an actual
// alternative rather than a re-roll of the same output.
function buildVarietyNote(previousAttempt, strategy) {
  const trimmed = (previousAttempt || '').trim();
  if (!trimmed) return '';
  // When a specific strategy was explicitly chosen (not Smart Pick), "find a different angle
  // entirely" would directly contradict the strategy instruction telling it to stay in that
  // pattern — this scopes the variety requirement to stay inside the chosen strategy instead of
  // offering a full angle swap as an option, which it otherwise would.
  const scoped = strategy && strategy !== 'smart_pick';
  const varietyOptions = scoped
    ? 'Lead with a different specific detail or a different opening move within the same chosen strategy above — not a different strategy, and not the same idea in new words.'
    : 'Lead with a different specific detail, a different opening move, or a different angle entirely — not the same idea in new words.';
  return `\n\nPREVIOUS ATTEMPT — DO NOT REPEAT ITS ANGLE:\n"${trimmed}"\nThis is being regenerated because the user wants something different, not a rewording. ${varietyOptions} If the previous attempt already used the one obvious hook, find a second real detail rather than manufacturing variety through synonyms.`;
}

// Internal reasoning gate — never surfaced to the user, no trailing-line UI change (unlike the
// follow-up engine's NEED_ID/LEAD_READ lines): a connection request and a first message are
// pre-relationship one-shots, not a tracked sequence, so there's no "is this worth pursuing"
// signal to report back the way there is mid-conversation. This exists purely to shape which
// detail the model leads with before it starts writing.
const WHY_THEM_WHY_NOW_GATE = `BEFORE YOU WRITE — WHY THEM / WHY NOW: silently answer three questions before drafting (never write the answers into the message, never label or restate them, never let them show up as meta-commentary):
1. Why THIS person — what's actually specific to their situation, not just their job title in general, makes them worth reaching out to?
2. Why NOW — is there a real, current reason this outreach makes sense at this moment (their role, their company's stage, a live signal in their profile), or is the timing arbitrary? If it's arbitrary, don't manufacture urgency — write a message that doesn't lean on false timeliness.
3. Why THIS angle — of everything you could open with, why does the specific detail or question you're about to use matter to THEM, not just to the sender's own goal?
Let the answers decide which detail you lead with and what you ask. The message itself should read like the natural product of that thinking, not like the reasoning was skipped.`;

// Shared by handleGenerateConnectionRequest and handleGenerateFirstMessage only — a user-selectable
// structural pattern for *how* to open a pre-relationship message, same "pick a named instructional
// block by key" shape as STAGE_TO_ANGLE below, just chosen by the user up front instead of derived
// from tracked stage. CONNECTION_REQUEST_FRAMEWORK/buildFirstMessageFramework() still govern length/
// no-pitch/grounding; a strategy only decides which kind of opening detail to lead with.
const STRATEGY_PLAYBOOK = {
  smart_pick: `STRATEGY — SMART PICK: no strategy was chosen, so you choose one. Before writing, privately judge which of the approaches below best fits what you actually know about this person: a recent post or specific activity available → lead with CURIOSITY GAP or SHARP QUESTION; a senior/time-poor title with little other signal → DIRECT & CLEAR; almost no usable signal at all → GIVE FIRST or DIRECT & CLEAR (never force a different one just to seem personalized when the data isn't there); a genuine mutual connection or shared context visible in the data → SHARED GROUND. Pick exactly one, commit to it fully, and do not mention or hint that you made this choice.`,
  curiosity_gap: `STRATEGY — CURIOSITY GAP: open with one concrete, specific, slightly unexpected observation about this person or their recent activity — not a compliment, not a restatement of their title. The observation should create a genuine open loop (something the reader wants to know more about), not just state a fact. Close with a question that only they, specifically, could answer — never a generic one that could go to anyone.`,
  direct_value: `STRATEGY — DIRECT & CLEAR: skip any warm-up, scene-setting, or compliment. The first sentence must name the concrete reason for this message — the specific thing about them you're writing about and why it matters — so it could not be mistaken for flattery. Then stop. This does not mean pitching: "clear" means the reader instantly understands why you're messaging them, not what you're selling. Best suited to senior or clearly time-poor recipients; still follows every no-pitch rule elsewhere in this prompt.`,
  problem_first: `STRATEGY — PROBLEM-FIRST: name one specific challenge or friction point that someone in their actual role, industry, or company stage plausibly deals with right now — grounded in their real profile data, not a generic industry template that could apply to anyone in that field. State it as an observation, then ask directly whether it resonates for them. Never follow it with a solution, a pitch, or any hint of what the sender offers — that conversation only happens if they reply.`,
  shared_ground: `STRATEGY — SHARED GROUND: reference a real mutual connection, shared context, or overlap that is ACTUALLY present in the profile data below (a stated mutual-connections count, an overlapping employer in their experience history, a shared group or interest literally visible in the data) — never one you infer or assume. A mutual-connections count in the data is real and usable: mentioning it plainly (e.g. the number you share) is a valid shared-ground opener. If nothing genuine like this exists in the data, do not force it: silently switch to the DIRECT & CLEAR approach instead and write that kind of message, without mentioning the switch.`,
  sharp_question: `STRATEGY — SHARP QUESTION: the message IS the question — there is no separate observation before it. Ask one specific, well-researched question that references a real, concrete detail from their profile or activity, proving you actually looked. Never a generic conversation-starter question ("How's business?", "What are you working on these days?") — if the question could be sent to 1,000 other people unchanged, it is not specific enough.`,
  give_first: `STRATEGY — GIVE FIRST: share one genuinely specific insight, observation, or useful point relevant to their actual situation — something that gives them something, not something that asks for their time. No ask at the end, or at most one extremely soft, easy-to-ignore one. Works especially well written peer-to-peer rather than vendor-to-prospect.`,
  relevant_pattern: `STRATEGY — RELEVANT PATTERN: briefly mention a pattern or trend the SENDER has genuinely noticed, drawn only from the sender's own stated background/expertise provided below (never invented client names, counts, or testimonials) — phrase it as an honest observation ("I've noticed...", "A few people in [X]...") not a credential or a pitch. If no real sender background is available to draw from, do not invent one — fall back to DIRECT & CLEAR instead.`,
};

function buildStrategyGuidance(strategyId) {
  return STRATEGY_PLAYBOOK[strategyId] || STRATEGY_PLAYBOOK.smart_pick;
}

// Stage values come from content/index.js's saved-contact pipeline tracking (STAGE_ORDER).
// When a tracked stage is available it gives the model ground truth instead of asking it to
// count messages in scraped conversation text — a heuristic that's proven noisy in practice.
const STAGE_TO_ANGLE = {
  messaged:      { n: '1st', angle: 'INSIGHT/CURIOSITY angle — surface a new observation, thought, or question. Do not repeat the opener\'s ask.' },
  followup_1:    { n: '2nd', angle: 'RESOURCE/REFERRAL angle — offer something specific and low-friction (a relevant point, a useful angle, an easy specific question).' },
  followup_2:    { n: '3rd+', angle: 'DIRECT angle — either a specific, concrete ask, or a low-pressure graceful exit (e.g. acknowledging the timing might be off) — pick whichever fits the conversation\'s tone.' },
  followup_3plus:{ n: '3rd+', angle: 'DIRECT angle — either a specific, concrete ask, or a low-pressure graceful exit (e.g. acknowledging the timing might be off) — pick whichever fits the conversation\'s tone.' },
};

function buildFollowupAngleRules(stage, daysSinceLastTouch, recipient) {
  const who = recipient || 'the recipient';
  const grounding = `GROUNDING — read this first: only reference things that are literally present in the conversation text below, or in the ADDITIONAL CONTEXT FROM THE USER section if one is present. Never invent, assume, or imply that the recipient said, shared, replied with, or asked something that isn't actually there. If the recipient has not sent any message at all yet, the follow-up must not thank them, react to something they said, or reference any input from them — it is a continuation of the sender's own outreach, not a reply to one. When in doubt, keep it generic rather than fabricating a specific detail.`;

  // Real LinkedIn outreach data: the follow-ups that actually get replies are the ones built
  // around what the prospect specifically needs, not a template nudge that could go to anyone.
  // This runs BEFORE angle selection — decide what to write toward before deciding how.
  const needFirst = `BEFORE YOU WRITE — IDENTIFY THE NEED: read the conversation and figure out what ${who} actually needs, wants, or is concerned about right now — their situation, any pain or friction they've named or implied, and what's actually at stake for them if it goes unaddressed. This is about ${who}'s situation, not the sender's pitch. If ${who} has sent a real reply in the thread, ground this in what they specifically said. If there's no reply yet (a cold sequence), ground it in what's reasonably inferable from their role, their company, or the sender's own stated reason for reaching out — never invent a need that isn't supportable from what's actually there. Then write the follow-up so it visibly moves toward that identified need — it should read like the one natural next thing to say to THIS specific person, not a generic nudge.`;

  // A contact who replied once and then went quiet for weeks isn't mid-conversation anymore —
  // treating it as thread continuation reads as oblivious to the silence. Checked before the
  // normal stage lookup since 'replied' has no entry in STAGE_TO_ANGLE.
  const WENT_COLD_THRESHOLD_DAYS = 14;
  const wentCold = stage === 'replied' && Number.isFinite(daysSinceLastTouch) && daysSinceLastTouch >= WENT_COLD_THRESHOLD_DAYS;

  const known = STAGE_TO_ANGLE[stage];
  const angleSection = wentCold
    ? `${who} replied before, but it's been ${daysSinceLastTouch} days of silence since — this is a genuine re-engagement, not a continuation of a live thread, even though the topic below is the only thing you have to go on. Concretely: do NOT ask another question that digs deeper into the same specific detail ${who} raised last time (e.g. do not keep probing the same pain point, tool gap, or process they described) — that is what a live-thread reply looks like, and it is wrong here. Instead, either (a) bring something adjacent but new — a different angle on the same broad topic, a relevant idea or resource, a question about how things have evolved since — or (b) keep it short and open-ended about whether it's still worth talking, without re-litigating the old specifics. Acknowledge the gap only if it helps rather than drawing attention to it, and keep the ask low-pressure — the goal is to see if the door is still open, not to push for a decision.`
    : known
    ? `This is the ${known.n} follow-up in this outreach (tracked from the sender's saved pipeline stage, not guessed) — use the ${known.angle}\nNever repeat the angle, ask, or phrasing of an earlier message in the thread.`
    : `Determine which follow-up this is by counting how many messages the sender has already sent in this thread, then pick the angle accordingly — never repeat the angle, ask, or phrasing of an earlier message in the thread:
- 1st follow-up: INSIGHT/CURIOSITY angle — surface a new observation, thought, or question. Do not repeat the opener's ask.
- 2nd follow-up: RESOURCE/REFERRAL angle — offer something specific and low-friction (a relevant point, a useful angle, an easy specific question).
- 3rd+ follow-up: DIRECT angle — either a specific, concrete ask, or a low-pressure graceful exit (e.g. acknowledging the timing might be off) — pick whichever fits the conversation's tone.`;

  const newReasonRule = `Don't just avoid repeating the previous angle — actively find a NEW, distinct reason this specific message is worth ${who}'s time right now. If you can't articulate a genuinely new reason beyond "checking in again," that itself is a signal: lean toward the graceful-exit half of the DIRECT angle instead of sending another content-free nudge.`;

  // Grounded in real outreach data, not just style preference: 55% of replies on LinkedIn come
  // from follow-ups, not the first message, and reply rates keep climbing through the 2nd-3rd
  // well-spaced follow-up before falling off — so every touch has to earn its place, not just
  // exist.
  const goalFraming = `The goal of this outreach sequence is to earn a real next step (a reply, a call, a closed opportunity) — every follow-up should feel like a deliberate step toward that, not a random check-in. Most replies come from a good 2nd or 3rd follow-up, not the first message — this touch matters as much as the opener did.`;
  const formatting = `Write the message as two short paragraphs separated by a blank line — never one dense block. Each paragraph carries one idea.`;
  const closing = `Never use dead follow-up phrases: "just following up", "just checking in", "wanted to circle back", "touching base", "bumping this to the top of your inbox".
End with exactly one CTA, placed as the final sentence.`;

  const sections = [grounding, needFirst, angleSection, newReasonRule, goalFraming, formatting, closing];

  if (Number.isFinite(daysSinceLastTouch)) {
    sections.push(`It has been ${daysSinceLastTouch} day${daysSinceLastTouch === 1 ? '' : 's'} since the last message was sent to this person — this is real tracked elapsed time, not a guess. Use it to judge tone (a follow-up after 2 days reads differently than one after 6 weeks).`);
    sections.push(`TIMING CHECK: if it has been fewer than 2 days since the last message with no reply, still write the follow-up exactly as instructed above, then add one final line starting with exactly "TIMING_NOTE: " briefly explaining why the user may want to hold off a few more days before sending — this note is for the user only, never part of the message itself. If the elapsed time is reasonable, do not include a TIMING_NOTE line at all; most of the time there should be no note.`);
  }

  sections.push(`NEED_ID LINE: after the message, on its own new line, add exactly one line starting with "NEED_ID: " stating in one sentence the specific need you identified and wrote toward. Omit this line entirely only if the thread has zero replies and zero usable signal to infer a need from (a true cold first touch with nothing to go on) — in every other case, include it.`);

  return sections.join('\n\n');
}

// ─── Outreach profiles (structured ICP) ───────────────────────────────────────
// Two modes: B2C (an individual finding work — jobs, projects, teams) and B2B (a company finding
// clients). Each mode has its own list of saved profiles with one active, plus its own message
// style. Shapes, option lists and the migration from the old free-text three-mode setup live in
// shared/schema.js so Settings, the panel and this file can never disagree about them.

let migrationOnce = null;
export function ensureMigrated() {
  if (!migrationOnce) migrationOnce = S.migrate().catch(e => { migrationOnce = null; console.warn('[LinkPilot] migration failed', e); });
  return migrationOnce;
}
// Cloud restore can bring back old-shaped settings after this worker already migrated once.
export function resetMigration() { migrationOnce = null; }

async function getModeContext(intent) {
  await ensureMigrated();
  const mode = S.normalizeIntent(intent);
  if (mode === 'b2b_sales') {
    const r = await chrome.storage.local.get(['icpProfiles', 'activeIcpProfileId', 'messagePresets']);
    const list = Array.isArray(r.icpProfiles) ? r.icpProfiles : [];
    const profile = list.find(p => p.id === r.activeIcpProfileId) || list[0] || S.emptyB2bProfile();
    return finishContext(mode, profile, r.messagePresets);
  }
  const r = await chrome.storage.local.get(['b2cProfiles', 'activeB2cProfileId', 'b2cMessagePresets']);
  const list = Array.isArray(r.b2cProfiles) ? r.b2cProfiles : [];
  const profile = list.find(p => p.id === r.activeB2cProfileId) || list[0] || S.emptyB2cProfile();
  return finishContext(mode, profile, r.b2cMessagePresets);
}

function finishContext(mode, profile, presets) {
  const icp = { ...S.emptyIcp(), ...(profile.icp || {}) };
  const isB2b = mode === 'b2b_sales';
  const sender = isB2b ? (profile.businessProfile || {}) : (profile.pitch || {});
  const hasIndustries = !!(icp.industries.length || icp.customIndustries.length);
  // B2C fit can be judged from who hires (founders, hiring managers…) even without industries.
  const hasTargets = isB2b ? hasIndustries : (hasIndustries || icp.hirerTypes.length > 0);
  const hasSender = isB2b
    ? !!(sender.offer || sender.expertise || (sender.proofPoints || []).some(Boolean))
    : !!(sender.oneLiner || sender.services || sender.background || sender.currentTitle || (sender.skills || []).length);
  return { mode, isB2b, profile, icp, sender, seeking: profile.seeking || {}, presets: S.sanitizePresets(presets, mode), hasTargets, hasSender, senderName: sender.senderName || '' };
}

const optLabel = (list, id) => (list.find(o => o.id === id) || {}).label || '';
const optLabels = (list, ids) => (ids || []).map(id => optLabel(list, id)).filter(Boolean);

// Renders one industry key ("fintech" or "fintech/payments") with the official LinkedIn industry
// names it covers, so the model can match what a profile or company page actually displays.
function describeIndustry(key) {
  const [gid, sid] = key.split('/');
  const g = TX.industries.find(x => x.id === gid);
  if (!g) return null;
  if (!sid) return `${g.label} (any segment) — LinkedIn industries: ${g.li.slice(0, 8).join('; ')}`;
  const sub = g.sub.find(x => x.id === sid);
  if (!sub) return null;
  return `${g.label} › ${sub.label}${sub.li.length ? ` — LinkedIn industries: ${sub.li.slice(0, 6).join('; ')}` : ''}`;
}

function buildIcpContext(ctx) {
  const { icp, isB2b } = ctx;
  const L = ['--- YOUR TARGETING (ICP) — use this to judge fit ---'];
  const targets = [...icp.industries.map(describeIndustry).filter(Boolean), ...icp.customIndustries.map(c => `${c} (user's own words)`)];
  if (targets.length) {
    L.push(`TARGET INDUSTRIES (strong fit):\n${targets.map(t => `- ${t}`).join('\n')}`);
    L.push(`INDUSTRY MATCHING: judge the industry by what their company actually does — headline, About, company description, role descriptions — not only by the LinkedIn industry label. Many startups list "Software Development" or "IT Services and IT Consulting" whatever market they serve, so a HealthTech or FinTech startup can show a generic software label and still be a strong match.`);
  } else {
    L.push(isB2b ? 'TARGET INDUSTRIES: not specified.' : 'TARGET INDUSTRIES: not specified — judge mainly on whether they can hire or bring in someone with the sender\'s skills.');
  }
  if (icp.regions.length || icp.countries.length) {
    const regions = icp.regions.map(id => (TX.regions.find(r => r.id === id) || {}).label).filter(Boolean);
    L.push(`TARGET LOCATIONS: ${[...regions, ...icp.countries].join(', ')} (judge by the person's or company's location; an unknown location is not a mismatch)`);
  }
  if (icp.headcount.length) L.push(`TARGET COMPANY SIZE (employees): ${optLabels(TX.headcount, icp.headcount).join(', ')}`);
  if (icp.seniority.length) L.push(`TARGET SENIORITY: ${optLabels(TX.seniority, icp.seniority).join(', ')}`);
  if (icp.functions.length) L.push(`TARGET FUNCTIONS: ${optLabels(TX.functions, icp.functions).join(', ')}`);
  if (icp.titles.length) L.push(`EXAMPLE TARGET TITLES: ${icp.titles.join(', ')}`);
  if (!isB2b && icp.hirerTypes.length) L.push(`PEOPLE WHO CAN HIRE THE SENDER (who to reach): ${optLabels(S.OPTIONS.hirerTypes, icp.hirerTypes).join(', ')}`);
  if (icp.signals.length) L.push(`TIMING SIGNALS TO PRIORITISE (count only if visible in the data): ${optLabels(isB2b ? S.OPTIONS.b2bSignals : S.OPTIONS.b2cSignals, icp.signals).join(', ')}`);
  if (icp.idealCustomer) L.push(`${isB2b ? 'IDEAL CUSTOMER' : 'WHO THE SENDER WANTS TO REACH'} (user's own words — the most specific description): ${icp.idealCustomer}`);

  const ex = [];
  const exInd = [...icp.excludeIndustries.map(k => S.industryLabel(k)).filter(Boolean), ...icp.customExcludes];
  if (exInd.length) ex.push(`industries: ${exInd.join(', ')}`);
  if (icp.excludeCompanyTypes.length) ex.push(`company types: ${optLabels(S.OPTIONS.excludeCompanyTypes, icp.excludeCompanyTypes).join(', ')}`);
  if (icp.excludeRoles.length) ex.push(`roles: ${icp.excludeRoles.join(', ')}`);
  if (icp.excludeCompanies.length) ex.push(`specific companies: ${icp.excludeCompanies.join(', ')}`);
  L.push(ex.length ? `EXCLUDED (set "excluded": true and fit "Poor" if they clearly match any of these): ${ex.join(' | ')}` : 'EXCLUDED: none.');
  return L.join('\n');
}

// What the sender does and why they're credible — the only allowed source for any "relevance
// bridge" or proof in messages and posts (the grounding rules forbid inventing it).
function buildSenderContext(ctx) {
  const s = ctx.sender; const L = [];
  if (ctx.isB2b) {
    L.push('--- ABOUT THE SENDER (a business) ---');
    if (s.senderName) L.push(`Sender name: ${s.senderName}`);
    if (s.companyName) L.push(`Company: ${s.companyName}`);
    if (s.offerType) L.push(`What they sell: ${optLabel(S.OPTIONS.offerTypes, s.offerType)}`);
    if (s.offer) L.push(`Offer in one line: ${s.offer}`);
    const probs = [...optLabels(S.OPTIONS.problems, s.problems), s.problem].filter(Boolean);
    if (probs.length) L.push(`Problems they solve: ${probs.join('; ')}`);
    if (s.outcome) L.push(`Main outcome delivered: ${optLabel(S.OPTIONS.outcomes, s.outcome)}`);
    if (s.valueProp) L.push(`What makes them different: ${s.valueProp}`);
    if (s.expertise) L.push(`Sender's own background: ${s.expertise}`);
    const proofs = (s.proofPoints || []).filter(Boolean);
    if (proofs.length) L.push(`Proof points (real results — use at most one, lightly, never as a brag):\n${proofs.map(p => `  - ${p}`).join('\n')}`);
    if (s.notes) L.push(`Other notes from the sender: ${s.notes}`);
  } else {
    const k = ctx.seeking || {};
    L.push('--- ABOUT THE SENDER (an individual professional looking for work) ---');
    if (s.senderName) L.push(`Name: ${s.senderName}`);
    if (s.currentTitle) L.push(`Current / target title: ${s.currentTitle}`);
    if (s.oneLiner) L.push(`In one line: ${s.oneLiner}`);
    if ((k.workTypes || []).length) L.push(`Open to: ${optLabels(S.OPTIONS.workTypes, k.workTypes).join(', ')}`);
    if ((k.roles || []).length) L.push(`Target roles: ${k.roles.join(', ')}`);
    if (k.level) L.push(`Experience level: ${optLabel(S.OPTIONS.experience, k.level)}`);
    if ((k.workplace || []).length) L.push(`Workplace: ${optLabels(S.OPTIONS.workplace, k.workplace).join(', ')}`);
    if (k.availability) L.push(`Availability: ${optLabel(S.OPTIONS.availability, k.availability)}`);
    if ((s.skills || []).length) L.push(`Top skills: ${s.skills.join(', ')}`);
    if (s.services) L.push(`What they can do for a team or client: ${s.services}`);
    if (s.uniqueAngle) L.push(`What makes them different: ${s.uniqueAngle}`);
    if (s.background) L.push(`Background: ${s.background}`);
    const proofs = (s.proofPoints || []).filter(Boolean);
    if (proofs.length) L.push(`Proof points (real results — use at most one, lightly, never as a brag):\n${proofs.map(p => `  - ${p}`).join('\n')}`);
    if (s.portfolio) L.push(`Portfolio link (only ever share in a follow-up when they show interest — never in a first touch): ${s.portfolio}`);
    if (s.notes) L.push(`Other notes from the sender: ${s.notes}`);
  }
  return L.length > 1 ? L.join('\n') : '';
}

// LinkedIn's own InMail data: under 400 characters gets 22% more replies, over 1,200 gets 11% fewer
// — so length is no longer a setting. Gong's 304k cold-email study: an interest question beats a
// meeting ask on a first touch, which is why "ask if it's relevant" is the default ending.
const ENDING_RULES = {
  b2b_sales: {
    ask_relevant: 'End with one low-friction interest question — whether this is a priority or relevant for them right now. Never ask for a call or meeting.',
    offer_value: 'End by offering one small, specific, useful thing (an idea, an example, a short teardown) they can accept with a one-word reply — phrased as a question.',
    ask_right_person: 'End by asking, as a question, who the right person to talk to about this would be.',
    suggest_call: 'End with a light suggestion of a short call, phrased as an easy-to-decline question.',
    no_ask: 'No ask at all — end on a genuine question about their work.',
  },
  b2c_sales: {
    ask_relevant: 'End with one low-friction question about whether they are building or hiring in this area, or could use help with it. Never ask for a job outright and never sound like an application.',
    offer_value: 'End by offering one small, specific, useful thing (a quick idea, a sample, a short teardown of something they posted) they can accept with a one-word reply — phrased as a question.',
    ask_right_person: 'End by asking, as a question, who the right person on their team would be to talk to about this kind of work.',
    suggest_call: 'End with a light suggestion of a short call, phrased as an easy-to-decline question.',
    no_ask: 'No ask at all — end on a genuine question about their work.',
  },
};
const TONE_RULES = {
  warm: 'Warm, genuine, like a peer talking to a peer.',
  direct: 'Straight to the point. Clear and confident, no pleasantries.',
  casual: 'Conversational and relaxed, like a message to a colleague you respect.',
  professional: 'Polished and credible. Precise, zero filler.',
  bold: 'Confident and distinctive. Takes a clear position.',
};
function buildStyleRules(ctx, { connection = false } = {}) {
  const p = ctx.presets;
  const L = [`Tone: ${TONE_RULES[p.tone] || TONE_RULES.warm}`, 'Length: short. Every sentence must earn its place.'];
  if (!connection) L.push(`Ending: ${ENDING_RULES[ctx.mode][p.ending] || ENDING_RULES[ctx.mode].ask_relevant}`);
  return L.join('\n');
}

function buildAnalysisContext(analysis, intent) {
  const lines = ['--- PROFILE ANALYSIS (use these insights to craft a personalized message) ---'];
  if (S.normalizeIntent(intent) === 'b2b_sales') {
    if (analysis.potentialClient?.score) lines.push(`Prospect Score: ${analysis.potentialClient.score}`);
    if (analysis.potentialClient?.reasoning) lines.push(`Score reasoning: ${analysis.potentialClient.reasoning}`);
    if (analysis.decisionMaker) lines.push(`Decision Maker: ${analysis.decisionMaker}`);
    if (analysis.companySize) lines.push(`Company Size: ${analysis.companySize}`);
  } else {
    // Legacy job-search analyses (hiringSignal) still render through here after migration.
    const score = analysis.clientPotential?.score || analysis.hiringSignal?.score;
    const why = analysis.clientPotential?.reasoning || analysis.hiringSignal?.reasoning;
    if (score) lines.push(`Opportunity Score: ${score}`);
    if (why) lines.push(`Reasoning: ${why}`);
    if (analysis.hirerType) lines.push(`Who they are to the sender: ${analysis.hirerType}`);
    if (analysis.opportunityType) lines.push(`Likely opportunity: ${analysis.opportunityType}`);
    if (analysis.decisionMaker) lines.push(`Can hire / buy: ${analysis.decisionMaker}`);
    if ((analysis.hiringSignals || []).length) lines.push(`Visible hiring / need signals:\n${analysis.hiringSignals.map(p => `  - ${p}`).join('\n')}`);
    if ((analysis.painPoints || []).length) lines.push(`Needs the sender could help with:\n${analysis.painPoints.map(p => `  - ${p}`).join('\n')}`);
    if (analysis.approachAngle) lines.push(`Recommended Approach: ${analysis.approachAngle}`);
  }
  if (analysis.industryFit?.level) lines.push(`Industry Fit: ${analysis.industryFit.level} — ${analysis.industryFit.reasoning || ''}`);
  if (analysis.industry) lines.push(`Industry: ${analysis.industry}`);
  if (analysis.recentActivity) lines.push(`Recent Activity: ${analysis.recentActivity}`);
  if ((analysis.keyInsights || []).length) lines.push(`Key Insights:\n${analysis.keyInsights.map(i => `  - ${i}`).join('\n')}`);
  if ((analysis.summaryPoints || []).length) lines.push(`Profile Facts:\n${analysis.summaryPoints.slice(0, 3).map(p => `  - ${p}`).join('\n')}`);
  if (analysis.timingCaution) lines.push(`TIMING CAUTION: ${analysis.timingCaution} — factor this into the WHY NOW judgment above; do not manufacture urgency that ignores it, and consider whether a lighter-touch or delayed approach fits better.`);
  return lines.join('\n');
}

function buildProfileText(p, userNotes) {
  // Without today's date the model guessed tenure from "2021 - Present" and stated it as fact
  // ("four years" on one run, "five years" on the next).
  const lines = [`Today's date: ${new Date().toISOString().slice(0, 10)}`];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.connections) lines.push(`Connections: ${p.connections}`);
  if (p.followers) lines.push(`Followers: ${p.followers}`);
  if (p.mutualConnections) lines.push(`Mutual connections with sender: ${p.mutualConnections} (a real, verifiable shared-network signal — only reference it if it would sound natural, never force it in)`);
  if (p.about) lines.push(`\nAbout (their own words): ${p.about.slice(0, 1000)}`);
  if (p.experience?.length) {
    lines.push('\nExperience:');
    p.experience.forEach((e, i) => {
      const label = i === 0 ? '  [CURRENT ROLE] ' : '  [PREVIOUS] ';
      lines.push(`${label}${e.title} at ${e.company}${e.duration ? ` (${e.duration})` : ''}${e.description ? `: ${e.description.slice(0, 200)}` : ''}`);
    });
  }
  if (p.education?.length) {
    lines.push('\nEducation:');
    p.education.forEach(e => {
      lines.push(`  - ${e.school}${e.degree ? `, ${e.degree}` : ''}`);
    });
  }
  if (p.skills?.length) {
    lines.push(`\nSkills: ${p.skills.slice(0, 10).join(', ')}`);
  }
  if (p.posts?.length) {
    lines.push('\nRecent Posts/Activity (only use if relevant to CURRENT ROLE):');
    p.posts.slice(0, 3).forEach((post, i) => {
      lines.push(`  Post ${i + 1}: ${post.slice(0, 300)}`);
    });
  }
  if (p.rawText && lines.length < 5) { // 5, not 4: the date line above is always present
    lines.push('\nRaw profile text (extract all details from this):');
    lines.push(p.rawText.slice(0, 3000));
  } else if (p.rawText) {
    lines.push('\nAdditional raw profile text:');
    lines.push(p.rawText.slice(0, 1500));
  }
  if (userNotes && userNotes.trim()) {
    lines.push('\n--- User notes (prioritize these when crafting the message) ---');
    lines.push(userNotes.trim());
  }
  // Measured: on profiles with only titles and companies, pushing for a "specific hook" made the
  // model invent what the person or company works on (e.g. claiming Brex is building AI agents for
  // expense review). Saying so explicitly is what keeps a thin profile honest instead of creative.
  if (isThinProfile(p) && !(userNotes && userNotes.trim())) {
    lines.push('\nDATA NOTE: this profile has no posts, no About section, and no role descriptions — only titles and companies. Unless an ADDITIONAL CONTEXT FROM THE USER section supplies real detail, there is no specific detail to anchor on. Do NOT invent what they work on, what their company is building internally, or what they care about. Write a short, honest message about what is actually visible (their role and company), and ask about their actual work.');
  }
  return lines.join('\n');
}

function isThinProfile(p) {
  return !(p.posts?.length) && !p.about && !(p.experience || []).some(e => (e.description || '').trim());
}

// ─── Core AI Call ─────────────────────────────────────────────────────────────

// No `temperature` is sent: the configured model (claude-sonnet-5-5) rejects the parameter as
// deprecated, so sampling is left to the API and output consistency comes from the prompts plus
// the retry guard in callAIWithBannedPhraseGuard.
async function callAI(systemPrompt, userPrompt) {
  const apiKey = await getApiKey();
  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      // Required for any request with a browser Origin, which includes an extension service
      // worker — without it Anthropic rejects the call with a 401 even for a valid key.
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      // Thinking shares this budget with the answer. At 2000, one post spent 1,477 tokens thinking
      // and was cut off mid-JSON; several others came within 100 tokens. Only used tokens are billed.
      max_tokens: 8000,
      messages: [
        { role: 'user', content: userPrompt },
      ],
      system: systemPrompt,
    }),
  });
  if (!response.ok) {
    // Anthropic's own status-code vocabulary, not OpenAI's — notably 529 (overloaded), not 503,
    // is the "service temporarily down" signal here. Internal error-code strings stay the same
    // (NO_API_KEY/INVALID_KEY/RATE_LIMITED/API_DOWN) so nothing downstream needs to know the
    // provider changed.
    if (response.status === 401) throw new Error('INVALID_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 500 || response.status === 529) throw new Error('API_DOWN');
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  // A truncated answer must fail loudly: returned as-is, a half-written post showed up in the UI as
  // raw JSON. TRUNCATED_RESPONSE already has user-facing copy ("cut short — try again").
  if (data.stop_reason === 'max_tokens') throw new Error('TRUNCATED_RESPONSE');
  // The model may emit a thinking block before its answer (content = [thinking, text]), so the
  // answer is not reliably content[0] — collect every text block instead.
  return (data.content || [])
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('')
    .trim();
}

// A small, deliberately narrow set of literal phrases confirmed via live testing to slip through
// despite being explicitly banned in AUTHENTICITY_RULES — negative instructions are weakly
// enforced by LLMs generally (documented earlier this session with the same model on the same
// phrase), but a literal string match is one place that's cheaply and reliably catchable after
// the fact, unlike fuzzier style violations ("don't restate what they said") with no reliable
// programmatic check. One silent retry only, never a loop — a retry loop is a worse failure mode
// than one imperfect message getting through.
const BANNED_PHRASES = [
  'would love to connect',
  "i'd love to connect",
  "i hope you're doing well",
  'i hope this finds you well',
  'i hope all is well',
  'i came across your profile',
  'i noticed from your profile',
  'impressive background',
  'caught my eye',
  'glad to have you in my network',
  "this one's familiar",
  'familiar ground',
  'a lot of moving parts',
  'a lot of moving pieces',
  'refreshingly honest',
  "i'd value having you in my network",
  'right in my lane',
  'says a lot about',
  'no pressure at all',
];

function findBannedPhrase(text) {
  const lower = (text || '').toLowerCase();
  return BANNED_PHRASES.find(p => lower.includes(p)) || null;
}

// Only one strategy has a structural signature reliable enough to check mechanically without
// real risk of false positives: SHARP QUESTION explicitly requires the message to BE a question,
// so "does it end in a question mark" is a fair, cheap check. The other 7 strategies don't have an
// equally crisp, unambiguous signature (e.g. "no pitch" or "grounded in real data" can't be
// verified by a string check) — better to leave those to the instructions
// than add a brittle heuristic that could false-positive on a genuinely good message.
function violatesStrategyShape(text, strategy, requireQuestion) {
  const trimmed = (text || '').trim();
  const endsInQuestion = /[?？]\s*$/.test(trimmed);
  if (strategy === 'sharp_question' && trimmed && !endsInQuestion) return 'was written as the Sharp Question strategy but doesn\'t end in a question';
  // First messages must close on one low-friction question (the framework's rule 3) — measured: ~1
  // in 10 ended on a statement instead. Give First is exempt: it deliberately may carry no ask.
  if (requireQuestion && strategy !== 'give_first' && trimmed && !endsInQuestion) return 'did not end with the one low-friction question the framework requires';
  return null;
}

async function callAIWithBannedPhraseGuard(systemPrompt, userPrompt, maxChars, strategy, { requireQuestion = false } = {}) {
  const first = await callAI(systemPrompt, userPrompt);
  const hit = findBannedPhrase(first);
  const overLength = typeof maxChars === 'number' && first.length > maxChars;
  const shapeViolation = violatesStrategyShape(first, strategy, requireQuestion);
  if (!hit && !overLength && !shapeViolation) return first;

  const violations = [];
  if (hit) violations.push(`used a banned phrase: "${hit}"`);
  if (overLength) violations.push(`ran ${first.length} characters, over the ${maxChars}-character limit`);
  if (shapeViolation) violations.push(shapeViolation);
  const retryPrompt = `${systemPrompt}\n\nYour previous attempt ${violations.join(' and ')}. Rewrite from scratch fixing this — don't just trim or swap words, write a genuinely tighter version that respects every rule above.`;
  return callAI(retryPrompt, userPrompt);
}

// ─── Profile Analysis ─────────────────────────────────────────────────────────

const COMMON_ANALYSIS_TAIL = `companySize guide:
- Startup: <50 employees or early-stage signals
- SMB: 50-500 employees
- Mid-market: 500-5000 employees
- Enterprise: 5000+ employees or well-known large corp

engagementRate: infer from follower count, post frequency, and activity signals.`;

// Applies to both modes: structured targeting beyond industry (location, size, seniority, function,
// exclusions) is the user's explicit filter, so it gates the top score rather than being a hint.
const FIT_GUIDE = `industryFit guide (judge against the TARGET INDUSTRIES and the user's own-words description below — the description is the more specific of the two):
- Strong: their company is in a target industry or sub-segment (or clearly does that kind of work even under a generic LinkedIn label) and nothing contradicts the description.
- Partial: not a listed target, but clearly the KIND of company the description names. "Could in theory need something" is not Partial.
- Poor: clearly irrelevant, or matches an EXCLUDED item. Set "excluded": true ONLY when they clearly match an EXCLUDED industry, company type, role or company; irrelevant-but-not-listed is "Poor" with "excluded": false.
- If no target industries are set, judge fit from the rest of the targeting and set level "Partial" unless something is clearly wrong.
Other targeting (locations, company size, seniority, functions, titles): when set, someone clearly outside them can never score High; clearly outside on two or more is Low. Unknown data is not a mismatch.`;

export async function handleAnalyzeProfile(profileData, intent) {
  const ctx = await getModeContext(intent);
  let systemPrompt;

  if (!ctx.isB2b) {
    systemPrompt = `You are an opportunity-intelligence assistant for an individual professional who uses their own LinkedIn to find work: a job, freelance or contract projects, or a place on a team. Analyze this LinkedIn profile from the sender's side: could this person hire the sender, give them a project, refer them, or bring them onto their team — and what is the best way to approach them?

Respond ONLY with valid JSON. No markdown, no explanation, no extra text — just the raw JSON object.
IMPORTANT: Always return the full JSON structure. Never add an "error" field. Use "Unknown" for anything you cannot determine.

Return exactly this structure:
{
  "clientPotential": {
    "score": "High | Medium | Low",
    "reasoning": "One sentence max explaining the opportunity score"
  },
  "hirerType": "Founder / CEO | Hiring manager | Engineering / tech leader | Department head | Recruiter | Agency owner | Peer / possible referral | Unlikely to hire",
  "decisionMaker": "Yes | Likely | No",
  "opportunityType": "Job | Freelance / contract | Team / co-founder | Referral | Unclear",
  "industryFit": {
    "level": "Strong | Partial | Poor",
    "reasoning": "One sentence on how well their company matches the sender's targeting",
    "excluded": false
  },
  "hiringSignals": ["Concrete, visible signal that they are hiring or need help (an open role, a post asking for help, team growth) — empty array if none is visible"],
  "isRecruiter": "Yes | Likely | No",
  "company": {
    "name": "Current employer name, or Unknown",
    "size": "Startup | SMB | Mid-market | Enterprise | Unknown",
    "stage": "Early-stage | Growth | Established | Unknown"
  },
  "companySize": "Startup | SMB | Mid-market | Enterprise | Unknown",
  "engagementRate": "Daily | Weekly | Occasional | Rarely",
  "industry": "Short industry label (e.g. SaaS, E-commerce, Healthcare)",
  "summaryPoints": ["Short chip-sized fact about their background (max 8 words)", "Second fact", "Third fact", "Fourth fact"],
  "recentActivity": "One sentence on what they post about or engage with. If none visible, say No recent posts visible.",
  "painPoints": ["A visible need, gap or project the sender's skills could address", "Second one"],
  "keyInsights": ["Actionable insight #1 for approaching this person — specific", "Insight #2", "Insight #3"],
  "approachAngle": "The most compelling honest angle for the sender to reach out — specific to this person, never generic",
  "timingCaution": "One sentence flagging a REAL reason right now might be bad timing — e.g. they started this exact role within the last few weeks, visible layoffs or contraction, or they posted about being on leave or overwhelmed. Empty string if nothing genuinely stands out — never invent one."
}

decisionMaker means "can this person hire the sender or approve paying for their work":
- Yes: founder, owner, CEO/CTO, head of the team the sender would join, agency owner, a recruiter hiring for the sender's kind of role
- Likely: manager or team lead in the sender's field, director at an SMB
- No: individual contributor outside the sender's field, junior, or no hiring influence

Opportunity scoring guide (clientPotential.score):
- High: can hire or buy (decisionMaker Yes/Likely) AND industryFit Strong AND a visible reason now (a hiring signal, growth, or a post about a need the sender's skills meet)
- Medium: can influence hiring with Partial fit, OR Strong fit but no visible need yet, OR a recruiter or peer in an adjacent field who could refer
- Low: no hiring influence and no referral value, Poor or excluded fit, an unrelated field, or not enough data to judge — a title alone never earns Medium
Never invent hiring signals: a "#hiring" headline, an open-role post, or a stated need must actually be in the data.

${FIT_GUIDE}

${COMMON_ANALYSIS_TAIL}

${buildIcpContext(ctx)}
${ctx.hasSender ? '\n' + buildSenderContext(ctx) : ''}`;

  } else {
    systemPrompt = `You are a B2B sales intelligence assistant. Analyze LinkedIn profiles as prospects for the sender's business and return structured data for a sales dashboard.

Respond ONLY with valid JSON. No markdown, no explanation, no extra text — just the raw JSON object.
IMPORTANT: Always return the full JSON structure. Never add an "error" field. Use "Unknown" for anything you cannot determine.

Return exactly this structure:
{
  "potentialClient": {
    "score": "High | Medium | Low",
    "reasoning": "One sentence max explaining the score"
  },
  "industryFit": {
    "level": "Strong | Partial | Poor",
    "reasoning": "One sentence on how well their company matches the targeting below",
    "excluded": false
  },
  "decisionMaker": "Yes | Likely | No",
  "company": {
    "name": "Current employer name, or Unknown",
    "domain": "Likely website domain (e.g. acme.com) only if obvious from the company name, else Unknown",
    "headcount": "Estimated employee range (e.g. 11-50, 51-200, 1000+), or Unknown",
    "industry": "Their company's industry (e.g. Healthcare, Dental, Construction, Fintech, Ecommerce)"
  },
  "companySize": "Startup | SMB | Mid-market | Enterprise | Unknown",
  "engagementRate": "Daily | Weekly | Occasional | Rarely",
  "industry": "Short industry label (e.g. Construction, SaaS, Finance)",
  "summaryPoints": ["Short chip-sized fact about their background (max 8 words)", "Second fact", "Third fact", "Fourth fact"],
  "recentActivity": "One sentence on what they post about or engage with. If none visible, say No recent posts visible.",
  "keyInsights": ["Actionable sales insight #1 — concise, specific", "Insight #2", "Insight #3"],
  "timingCaution": "One sentence flagging a REAL reason right now might be bad timing to reach out — e.g. they started this exact role within the last few weeks, visible layoffs or contraction, or they posted about being on leave or overwhelmed. Empty string if nothing genuinely stands out — never invent one."
}

${FIT_GUIDE}
- industryFit MUST influence potentialClient.score: Poor/excluded fit is always Low; Partial fit can never score High.

Scoring guide (combine seniority AND fit):
- High: decision-maker (Director/VP/C-level/Owner, or the target seniority if set) AND Strong fit
- Medium: decision-maker with Partial fit, OR a manager/influencer with Strong fit
- Low: individual contributor, OR Poor/excluded fit, OR irrelevant, OR not enough data to judge fit at all (no company, no industry, no description) — a title alone never earns Medium

decisionMaker guide:
- Yes: C-level, VP, Director, Owner, Founder
- Likely: Manager, Team Lead, Senior with procurement mentions
- No: IC, student, junior role

${COMMON_ANALYSIS_TAIL}

${buildIcpContext(ctx)}
${ctx.hasSender ? '\n' + buildSenderContext(ctx) : ''}`;
  }

  const raw = await callAI(systemPrompt, buildProfileText(profileData));
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('TRUNCATED_RESPONSE');
  let result;
  try { result = JSON.parse(jsonMatch[0]); } catch { throw new Error('TRUNCATED_RESPONSE'); }

  // With no targeting configured the rubric collapses to seniority alone — measured: a VP at a
  // concrete-paving company scored "High" for an AI-infrastructure seller. Capped here in code (not
  // just asked of the model) and flagged so the panel can say the score wasn't checked against an ICP.
  if (!ctx.hasTargets) {
    result.icpMissing = true;
    const key = ctx.isB2b ? 'potentialClient' : 'clientPotential';
    if (result[key]?.score === 'High') {
      result[key].score = 'Medium';
      result[key].reasoning = `${result[key].reasoning || ''} (Capped at Medium: no targeting is set, so fit is unverified.)`.trim();
    }
  }
  return result;
}

// ─── Bulk Search-Results Scoring ───────────────────────────────────────────────
// Lighter-weight sibling of handleAnalyzeProfile — search result cards only expose
// name/title/company (no experience, education, posts), so this trades analysis depth
// for being able to score a whole page of results in one ICP-aware batched call.
export async function handleBulkScoreProfiles(profiles, intent) {
  const ctx = await getModeContext(intent);
  const perspective = ctx.isB2b
    ? 'a B2B sales rep judging each contact\'s fit as a sales prospect for the sender\'s business'
    : 'an individual professional judging whether each person could hire them, give them a project, or bring them onto a team';
  const context = buildIcpContext(ctx) + (ctx.hasSender ? '\n\n' + buildSenderContext(ctx) : '');

  const systemPrompt = `You are scoring a batch of LinkedIn search results from the perspective of ${perspective}. You only have each person's name, title, and company — no full profile, no experience history, no posts. Judge primarily on title, seniority and company, and on fit against the targeting below. Anyone clearly matching an EXCLUDED item scores Low.

${context}

Respond ONLY with valid JSON, no markdown, no explanation:
{"scores": [{"id": "<the id given for this person>", "score": "High | Medium | Low", "reasoning": "max 8 words"}]}

One entry per input person, in the same order, using the exact same "id" value given for each — never invent or alter an id.`;

  const userPrompt = profiles
    .map((p, i) => `${i + 1}. id: ${p.id} | Name: ${p.name || 'Unknown'} | Title: ${p.title || 'Unknown'} | Company: ${p.company || 'Unknown'}`)
    .join('\n');

  const raw = await callAI(systemPrompt, userPrompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('TRUNCATED_RESPONSE');
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
    if (!ctx.hasTargets) {
      scores.forEach(s => { if (s.score === 'High') s.score = 'Medium'; });
      return { scores, icpMissing: true };
    }
    return { scores };
  } catch {
    throw new Error('TRUNCATED_RESPONSE');
  }
}

// ─── Connection Request ───────────────────────────────────────────────────────

// B2C (finding work) used to be split into Job Search and Freelance. Job Search forbade any mention
// of the sender, even to someone who had just posted the sender's exact role — measured: the model
// either broke the rule or wrote a "just networking" note a strict reviewer read as a disguised
// application. Honest interest beats a disguise when the need is public; otherwise stay peer-to-peer.
const B2C_OPPORTUNITY_RULE = `OPPORTUNITY RULE — first decide which situation this is, from their profile data only:
(a) They visibly need what the sender does: hiring for a matching role, a post asking for help, a project or problem in the sender's area (a recruiter or hiring manager whose headline, role description or posts mention it). Be honest about the interest — pretending to "just network" with someone who publicly posted the need reads as a disguised application. In one short clause name the role or need, give ONE concrete reason the sender fits (only from the sender's real background below), then ask one specific question about it. No résumé dump, nothing desperate ("any opportunity", "please consider me"), never "open to work" or "hire me".
(b) Anyone else: pure peer conversation about their work, with no job-seeking and no pitch. The sender is a fellow professional in the same field, not a candidate or a vendor.`;

// Grounded in 2026 LinkedIn acceptance-rate research (Leadriver's 50,000+ request benchmark,
// Belkins' 20M+ outreach study, Closely's connection-request psychology data): acceptance barely
// moves for a note vs. no note at all (~26% either way) UNLESS the note is genuinely trigger-based
// — a real, recent, individual signal, not just their name or title restated. Trigger-based
// personalization adds 12-20% acceptance on top of basic company/role context, layered on top of
// each other; a note that sells is the fastest way to get ignored, even faster than in a first
// message, since there isn't even a relationship yet to justify it.
const CONNECTION_REQUEST_FRAMEWORK = `CONNECTION REQUEST FRAMEWORK — a recipient decides in 3-7 seconds, so every word has to earn its place:

1. ONE REAL TRIGGER: name one specific, individual, ideally recent reason for reaching out — a post they made, a role change, something concrete about their current work. A real trigger beats a static fact (their title or company name alone) every time — static facts barely move acceptance on their own.
2. NO SELLING: a connection note that pitches, offers, or explains what the sender does gets ignored faster here than anywhere else in the sequence — there isn't even a relationship yet to justify it. The trigger itself is the reason to connect; it doesn't need a value pitch attached.
3. SHORTER THAN THE LIMIT: the character cap below is a ceiling, not a target to fill. The strongest notes in the data run 140-180 characters — well under most limits — not padded out to the maximum. Only use more of the budget if there's a second real, specific detail worth adding, never to sound more thorough.

If there is no genuine trigger for this person, a short, honest, low-key note beats a generic one dressed up to sound personalized — vague flattery performs worse than no note at all.

4. IT IS AN INVITATION, NOT A MESSAGE: they have not accepted yet. Never write as if they have ("glad to have you in my network", "thanks for connecting", "great to be connected"). Never sign off with your name — LinkedIn already shows who sent it, and a sign-off wastes characters.`;

export async function handleGenerateConnectionRequest(profileData, intent, userNotes, contextMaterial, previousAttempt, strategy) {
  const ctx = await getModeContext(intent);
  const senderCtx = buildSenderContext(ctx);
  let systemPrompt;

  if (!ctx.isB2b) {
    systemPrompt = `You write LinkedIn connection requests for an individual professional who is finding work — a job, freelance or contract projects, or a place on a team — by connecting with people who could hire them, refer them, or bring them in. Write like a real person in the same field, never like a cover letter or a vendor.

PRIORITY RULE: Base the message on their CURRENT role, company, or recent activity. Never reference posts from a previous employer. Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if nothing specific is available, write a warm, natural message using their current title and company. Always produce a message — never refuse, never ask for clarification, and never leave a placeholder or note saying information is missing.

${CONNECTION_REQUEST_FRAMEWORK}

${buildStrategyGuidance(strategy)}

Rules:
- Hard limit: 200 characters total (count carefully)
- No corporate speak, no buzzwords, no links
- Never say "looking for opportunities", "open to work", "hire me", or describe services
${B2C_OPPORTUNITY_RULE}
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}

Return ONLY the connection request text. Nothing else. No quotes around it.`;
  } else {
    systemPrompt = `You write LinkedIn connection requests. Write like a real person, not a marketer.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their current title and company. Always produce a message — never refuse, never ask for clarification, and never leave a placeholder or note saying information is missing.

${CONNECTION_REQUEST_FRAMEWORK}

${buildStrategyGuidance(strategy)}

Rules:
- Hard limit: 200 characters total (count carefully)
- No corporate speak, no buzzwords, no links
- No selling, no pitching, no mention of your own work
- Sound like a genuine human reaching out
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}

Return ONLY the connection request text. Nothing else. No quotes around it.`;
  }
  systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStyleRules(ctx, { connection: true })}`;
  if (senderCtx) systemPrompt += `\n\n${senderCtx}\n(Sender context is for calibration and, in B2C case (a) only, one honest fit reason — never pitch it in a connection note.)`;
  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt, strategy);

  const text = await callAIWithBannedPhraseGuard(systemPrompt, buildProfileText(profileData, userNotes), 200, strategy);
  return { text: stripSignOff(text, ctx.senderName) };
}

// Connection requests and first messages both still signed off with the sender's name in testing ("…shakes
// out. Husnain") — a trailing-name check is cheap and certain, so it's removed here rather than
// trusted to the instruction alone. Only strips a name sitting at the very end on its own.
function stripSignOff(text, senderName) {
  const name = (senderName || '').trim().split(/\s+/)[0];
  if (!name) return text;
  const n = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .replace(new RegExp(`([.!?])\\s*[—–-]?\\s*${n}[.!]?\\s*$`, 'i'), '$1')
    .replace(new RegExp(`\\n\\s*[—–-]?\\s*${n}[.!]?\\s*$`, 'i'), '')
    .trim();
}

// ─── First Message ────────────────────────────────────────────────────────────

// Grounded in 2026 cold-outreach data: first touches that pitch (features, ROI, "we help companies
// like yours", a call ask) fall below 5% reply; concise 40-70 word messages built on one real detail
// and a low-friction question land around 25-40%. The pure no-pitch version of this, though, made
// every message read as a curious peer with no reason to be writing — the BD team's direct complaint
// was that messages never said why the sender was relevant. allowBridge permits exactly one short
// relevance clause (sender's real expertise tied to THEIR situation) without crossing into a pitch.
// Job Search passes false: a job seeker's first message stays entirely about the recipient.
function buildFirstMessageFramework(allowBridge) {
  const situation = allowBridge
    ? `2. THEIR SITUATION FIRST, PLUS ONE RELEVANCE BRIDGE: keep the message mostly about them — an observation, or what you noticed about their situation. Then add exactly ONE short clause (about 15 words max) that connects what the sender genuinely does (taken only from the sender context provided — never invented) to THIS person's specific situation, so they understand why you, specifically, are writing. Make it specific to THEIR problem — name the particular thing the sender has built or worked on that relates to what this person described — not a generic company tagline. Test it: if the bridge would read the same in a message to a different prospect, it is a tagline — rewrite it to name the specific part of THEIR problem the sender works on. Phrase it fresh every time: never use stock bridge phrasing like "so this is familiar", "familiar ground", "this one's familiar", or "I think about this a lot". It is context, not a pitch: no feature lists, no ROI or efficiency claims, no "we help companies like yours", no pricing, no request for a call or meeting. If there is no sender context, or the bridge would feel forced for this person, leave it out entirely.`
    : `2. THEIR SITUATION, NOT YOUR PITCH: the body stays entirely about them — an observation, a genuine question, or what you noticed about their situation. Do not describe what the sender does, offers, or has achieved, and do not hint at value, ROI, or efficiency gains — even softly. That conversation happens after they reply, never in message 1.`;
  const selfCheck = allowBridge
    ? `Self-check before finalizing: does the first line prove real, specific knowledge of THIS person? Does the message describe the sender in more than one short clause, or make any value, ROI, or "we help" claim? If either check fails, rewrite before returning.`
    : `Self-check before finalizing: does the first line prove real, specific knowledge of THIS person? Does any part of the message describe the sender's company, product, or value instead of the recipient's own situation? If either check fails, rewrite before returning.`;
  return `FIRST-MESSAGE FRAMEWORK — this is the actual structure of a message that gets replies, not a style suggestion:

1. SPECIFIC HOOK (first line): open on one real, individual detail — something true of THIS person that couldn't be copy-pasted to the next 1,000 profiles unchanged. If nothing specific enough exists, say so honestly (a warm, generic opener beats a faked-specific one) — never invent one.
${situation}
3. ONE LOW-FRICTION QUESTION: end with a single question that's easy and low-stakes to answer — never a request for a meeting, a demo, pricing, or any other real commitment (a light, easy-to-decline call suggestion only if the MESSAGE STYLE ending below explicitly asks for one). It should feel genuinely optional — the recipient should be able to ignore it without feeling rude.

LENGTH: the single most consistent finding in current outreach data. Keep the whole message to 40-70 words (tighter — 40-50 — for senior or executive recipients, who get the most outreach and scan the fastest). Every sentence past that measurably hurts reply rate rather than helping it. If a draft runs long, cut explanation before cutting personalization.

FORMAT: write as 1 short paragraph, or 2 short paragraphs separated by a blank line only if there are genuinely two distinct beats (the hook, then the question) — never one dense wall of text, and never pad to a second paragraph just to have one when the whole thought is naturally a single beat.

${selfCheck}`;
}

function buildConnectionRecencyNote(stage, daysSinceLastTouch) {
  if (stage !== 'connection_sent' || !Number.isFinite(daysSinceLastTouch) || daysSinceLastTouch <= 2) return '';
  return `CONNECTION TIMING: this connection was sent/accepted ${daysSinceLastTouch} days ago, not moments ago (tracked from the sender's saved pipeline stage) — do not write as if the connection just happened ("thanks for connecting", "just connected", etc). Open as a considered first message to someone already in their network, not a reflexive same-day follow-up.`;
}

export async function handleGenerateFirstMessage(profileData, analysis, intent, tone, userInstructions, stage, daysSinceLastTouch, contextMaterial, previousAttempt, strategy) {
  const ctx = await getModeContext(intent);
  // The panel's per-message tone picker overrides the saved default for this one message.
  if (tone && TONE_RULES[tone]) ctx.presets = { ...ctx.presets, tone };
  const a = analysis || {};

  // decisionMaker is only ever "Yes" | "Likely" | "No" — never a title string.
  const dm = a.decisionMaker || '';
  const isDecisionMaker = dm === 'Yes' || dm === 'Likely';
  const cs = a.companySize || a.company?.size || '';
  const hasBudgetSignals = isDecisionMaker || /enterprise|mid.market|series [bcd]|funded/i.test(cs + ' ' + (a.companyName || ''));

  const scoreVal = ctx.isB2b
    ? (a.prospectScore?.score || a.potentialClient?.score || 'Low')
    : (a.clientPotential?.score || ({ Strong: 'High', Possible: 'Medium', Unlikely: 'Low' })[a.hiringSignal?.score] || 'Low');
  const isHighValue = scoreVal === 'High';
  const isMidValue = scoreVal === 'Medium';
  const analysisCtx = buildAnalysisContext(a, ctx.mode);
  const senderCtx = buildSenderContext(ctx);
  const maxChars = 350;
  let systemPrompt;

  if (!ctx.isB2b) {
    const visibleNeed = (a.hiringSignals || []).length > 0 || (a.painPoints || []).length > 0;
    const approachGuide = isHighValue && visibleNeed
      ? 'Strong opportunity with a visible need. Follow case (a) of the OPPORTUNITY RULE: honest interest in the specific role or need, one concrete fit reason, one specific question.'
      : isHighValue || isMidValue
      ? 'Possible opportunity, no explicit opening yet. Be curious about their work and what they are building; let the relevance bridge carry who the sender is. No job ask.'
      : 'Weak opportunity. Keep it short and low-commitment. Pure peer conversation, no hint of job-seeking or selling.';

    systemPrompt = `You write first LinkedIn messages for an individual professional who is finding work — a job, freelance or contract projects, or a place on a team — through people who could hire, refer or bring them in. You have helped hundreds of people land roles and clients this way; your messages get replies because they read as researched, specific and peer-to-peer, never as an application or a pitch.

APPROACH FOR THIS PERSON: ${approachGuide}

${buildFirstMessageFramework(ctx.hasSender)}

${buildStrategyGuidance(strategy)}

B2C RULES:
- Sound like an accomplished professional in the same field, never like someone asking for a favour
- Never say "looking for opportunities", "open to work", "my next role", "hire me", "my services include"
- Use at most ONE proof point from the sender context, only if it directly relates to their need, and phrase it as context rather than a brag
- Never include links in a first message
${B2C_OPPORTUNITY_RULE}

HARD RULES:
- Max 350 characters total
- Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name/current title and company
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Never reference the analysis itself — weave the insights in naturally
- Return ONLY the message. No quotes, no explanation.`;

  } else {
    const dmGuide = isDecisionMaker
      ? `Decision-maker detected (${dm === 'Yes' ? 'confirmed' : 'likely'}). They get the most outreach of anyone on LinkedIn and scan the fastest — be tighter and more direct than usual (aim for the low end of the framework's word range below), never more explanatory.`
      : `Not a final decision-maker. Be more exploratory and relationship-focused — a slightly longer, more curious message reads fine here.`;
    const budgetGuide = hasBudgetSignals
      ? 'Budget signals: company size and role suggest budget authority. This changes nothing about whether to pitch — it never justifies mentioning value or ROI in message 1 — only that a real conversation, if it starts, has somewhere to go.'
      : 'Budget unclear. Stay in pure curiosity mode — start a conversation, not a sales process.';
    const approachGuide = isHighValue
      ? 'High-value prospect. Strong ICP fit and decision-making authority. Write with confidence. Reference their specific business context. End with a question that opens a conversation about their priority or challenge.'
      : isMidValue
      ? 'Mid-tier prospect. Partial fit. Be curious and helpful. Reference something specific from their profile or company. End with an open question about their current focus.'
      : 'Low-priority prospect. Short, warm, no-commitment message. Pure relationship-building — no hints at a pitch.';

    systemPrompt = `You are a senior B2B Business Development Executive with 15+ years of enterprise sales experience. You write the LinkedIn first messages that actually get replies — because they feel like they were written for this specific person, not pulled from a template.

DECISION-MAKER ASSESSMENT: ${dmGuide}
BUDGET SIGNAL: ${budgetGuide}
APPROACH FOR THIS PROSPECT: ${approachGuide}

${buildFirstMessageFramework(ctx.hasSender)}

${buildStrategyGuidance(strategy)}

B2B-SPECIFIC RULES:
- Seniority changes tightness and directness, never how much you pitch — a decision-maker gets a shorter, sharper version of the exact same no-pitch structure
- Reference at least one concrete detail from the analysis (company context, key insight, recent activity, or ICP fit signal) as the specific hook — this is what proves research, not a stated credential
- Use at most ONE proof point from the sender context, only if it maps to their situation, phrased as context rather than a claim
- Goal of message 1 is to start a conversation, not close a deal

HARD RULES:
- Max 350 characters total
- Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name/current title and company
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Return ONLY the message. No quotes, no explanation.`;
  }

  systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStyleRules(ctx)}`;
  if (senderCtx) systemPrompt += `\n\n${senderCtx}`;
  if (userInstructions?.trim()) {
    systemPrompt += `\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly):\n${userInstructions.trim()}`;
  }
  systemPrompt += `\n\n${analysisCtx}`;
  systemPrompt += `\n\nHOW TO USE THE ANALYSIS ABOVE: "Recent Activity", "Key Insights" and any visible hiring or need signals are where the specific hook required by the framework should come from — they're the closest thing to a real trigger you have. Scores, decision-maker, fit and company size exist purely to calibrate directness and tone — never reference, restate, or hint at them in the message; the recipient never sees how they were scored.`;
  const recencyNote = buildConnectionRecencyNote(stage, daysSinceLastTouch);
  if (recencyNote) systemPrompt += `\n\n${recencyNote}`;
  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt, strategy);

  const text = await callAIWithBannedPhraseGuard(systemPrompt, buildProfileText(profileData), maxChars, strategy, { requireQuestion: true });
  return { text: stripSignOff(text, ctx.senderName) };
}

// ─── Refine Message ───────────────────────────────────────────────────────────

export async function handleRefineMessage(originalMessage, profileData, analysis, intent, tone, instructions) {
  const TONE_GUIDE = {
    professional: 'Polished, formal, and credible. Every word earns its place. Zero filler.',
    warm: 'Friendly, genuine, and human. Reads like a message from a trusted peer.',
    casual: 'Relaxed and conversational. Like texting a colleague you respect.',
    direct: 'Straight to the point. No pleasantries, no softening. Clear and confident.',
    bold: 'Confident and memorable. Takes a position. Not afraid to be different.',
  };
  const toneGuide = TONE_GUIDE[tone] || TONE_GUIDE.warm;

  const systemPrompt = `You are refining a LinkedIn outreach message. Apply the requested tone and follow the user's instructions precisely.

TONE: ${tone?.toUpperCase() || 'WARM'}
Tone definition: ${toneGuide}

Rules:
- Keep the same core meaning and intent as the original, including its main question — and do not add claims, opinions, or credentials it didn't make (e.g. turning curiosity into "I have strong opinions on this")
- Apply the tone throughout — it should feel consistent, not patchy
- Follow the user's instructions exactly, and treat length instructions as measurable: "shorter" means cutting at least a third of the words; "longer" means meaningfully more. Measured: "make it shorter" once went from 36 words to 35.
- If the instruction adds an ask (such as a call), attach it naturally to the message's existing question rather than stacking a second request, and skip softeners like "no pressure at all"
- Use the recipient's name and company only as they appear in the profile below
- Max 350 characters unless the instructions explicitly request more
${AUTHENTICITY_RULES}
- Return ONLY the refined message text. No quotes, no explanation.`;

  const userPrompt = `ORIGINAL MESSAGE:
"${originalMessage}"

RECIPIENT PROFILE:
${buildProfileText(profileData)}

USER INSTRUCTIONS:
${instructions?.trim() || 'No specific instructions — just apply the tone consistently.'}

${analysis ? `ANALYSIS CONTEXT:\n${buildAnalysisContext(analysis, intent)}` : ''}`;

  return { text: await callAIWithBannedPhraseGuard(systemPrompt, userPrompt, 350) };
}

// ─── Post Creator ─────────────────────────────────────────────────────────────

// ─── Posts ────────────────────────────────────────────────────────────────────
// Posts work in both modes. Personal posts are written as the user, from the active profile of
// their current mode (B2C pitch or B2B background); company posts from the active B2B profile plus
// the company profile. The user's own real posts (captured from their activity page, see content
// script) are the voice reference; real + generated history is the "don't repeat" list.

const POST_ENDING_RULES = {
  question: 'End with one specific question the audience can answer from their own experience — never a lazy "Thoughts?" or "Agree?".',
  dm: 'End with one low-key line inviting people working on this problem to message the author. No hard sell, no link.',
  follow: 'End with one line saying what the author will cover next and inviting people to follow. No begging.',
  none: 'No call to action — end on the strongest final line.',
};

async function getPostContext(mode, creatorProfile, companyProfile) {
  const isCompany = mode === 'company';
  const { analysisIntent, ownPosts, postHistory } = await chrome.storage.local.get(['analysisIntent', 'ownPosts', 'postHistory']);
  const ctx = await getModeContext(isCompany ? 'b2b_sales' : analysisIntent);
  const settings = (isCompany ? companyProfile : creatorProfile) || {};
  const s = ctx.sender; const icp = ctx.icp;

  const facts = [];
  if (ctx.isB2b) {
    if (s.companyName) facts.push(`Company: ${s.companyName}`);
    if (s.offer) facts.push(`What the business does: ${s.offer}`);
    const probs = [...optLabels(S.OPTIONS.problems, s.problems), s.problem].filter(Boolean);
    if (probs.length) facts.push(`Problems it solves: ${probs.join('; ')}`);
    if (s.valueProp) facts.push(`What makes it different: ${s.valueProp}`);
    if (!isCompany && s.expertise) facts.push(`Author's own background: ${s.expertise}`);
  } else {
    if (s.currentTitle) facts.push(`Author's title: ${s.currentTitle}`);
    if (s.oneLiner) facts.push(`Author in one line: ${s.oneLiner}`);
    if ((s.skills || []).length) facts.push(`Skills: ${s.skills.join(', ')}`);
    if (s.services) facts.push(`What the author does for teams and clients: ${s.services}`);
    if (s.uniqueAngle) facts.push(`What makes the author different: ${s.uniqueAngle}`);
    if (s.background) facts.push(`Background: ${s.background}`);
  }
  if (isCompany) {
    const co = companyProfile || {};
    if (co.name) facts.push(`Company name: ${co.name}`);
    if (co.industry) facts.push(`Industry: ${co.industry}`);
    if (co.about) facts.push(`About the company: ${co.about}`);
    if (co.products) facts.push(`Products / services: ${co.products}`);
  } else if (Array.isArray(settings.domains) && settings.domains.length) {
    facts.push(`Topics the author posts about: ${settings.domains.join(', ')}`);
  }
  const proofs = (s.proofPoints || []).filter(Boolean);

  // Audience: what the user typed, else derived from who they're targeting in this mode.
  let audience = isCompany ? (companyProfile?.icp || '') : (settings.audience || '');
  if (!audience) {
    const parts = [];
    if (!ctx.isB2b && icp.hirerTypes.length) parts.push(optLabels(S.OPTIONS.hirerTypes, icp.hirerTypes).join(', '));
    if (ctx.isB2b && icp.seniority.length) parts.push(`${optLabels(TX.seniority, icp.seniority).join(', ')}-level people`);
    if (icp.titles.length) parts.push(icp.titles.join(', '));
    const inds = icp.industries.map(k => S.industryLabel(k)).filter(Boolean);
    if (inds.length) parts.push(`in ${inds.join(', ')}`);
    if (icp.idealCustomer) parts.push(`(${icp.idealCustomer})`);
    audience = parts.join(' ');
  }

  const kind = isCompany ? 'company' : 'personal';
  const pillars = optLabels(S.OPTIONS.postPillars[kind], settings.pillars);
  const ending = POST_ENDING_RULES[settings.postEnding] || POST_ENDING_RULES.question;
  const goal = settings.goal || (isCompany ? 'attract clients and build authority' : (ctx.isB2b ? 'build authority with potential clients' : 'get noticed by people who could hire me'));
  const realPosts = isCompany ? [] : (Array.isArray(ownPosts) ? ownPosts : []).map(p => p.text).filter(Boolean);
  const generated = (Array.isArray(postHistory) ? postHistory : []).filter(h => (h.mode || 'personal') === kind);
  const voiceSample = (settings.voiceSample || '').trim();
  const name = isCompany ? (companyProfile?.name || s.companyName || '') : (settings.name || ctx.senderName || '');
  return { isCompany, ctx, facts, proofs, audience, pillars, ending, goal, realPosts, generated, voiceSample, name };
}

function previousPostsBlock(pc, { forTopics }) {
  const lines = [];
  if (pc.realPosts.length) lines.push(`The author's own published posts (most recent first):\n${pc.realPosts.slice(0, 15).map((t, i) => `${i + 1}. ${t.replace(/\s+/g, ' ').slice(0, forTopics ? 220 : 160)}`).join('\n')}`);
  if (pc.generated.length) lines.push(`Posts already drafted with this tool:\n${pc.generated.slice(0, 15).map((h, i) => `${i + 1}. ${h.topic || ''} — ${(h.post || '').replace(/\s+/g, ' ').slice(0, 120)}`).join('\n')}`);
  return lines.length ? `--- PREVIOUS POSTS (never repeat or closely overlap their subject, angle or hook) ---\n${lines.join('\n\n')}` : '';
}

export async function handleSuggestPostTopics(creatorProfile, recentPosts = [], mode = 'personal', companyProfile = null) {
  const pc = await getPostContext(mode, creatorProfile, companyProfile);
  // Posts visible on the page the user is looking at count too (e.g. their feed), deduped.
  const pagePosts = (recentPosts || []).filter(p => !pc.realPosts.some(r => r.slice(0, 80) === p.slice(0, 80)));
  if (pagePosts.length) pc.realPosts = [...pagePosts, ...pc.realPosts];

  const systemPrompt = `You are a LinkedIn content strategist for ${pc.isCompany ? 'a company page' : 'one professional writing as themselves'}. Suggest 5 post topics this author can write credibly and that serve their goal.

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "topics": [
    {
      "title": "Topic title (max 8 words)",
      "pillar": "Which content pillar it belongs to (from the list below, or 'Other')",
      "angle": "The specific take — what the author argues or shows",
      "hook": "Opening 1-2 sentences, concrete and specific",
      "whyNow": "Why this audience cares about it now (1 sentence)"
    }
  ]
}

Requirements:
- Every topic must be something THIS author can write from first-hand knowledge in the AUTHOR FACTS — a practitioner's angle, not generic commentary anyone could post.
- ${pc.pillars.length ? `Spread topics across these content pillars: ${pc.pillars.join(', ')}. Don't use the same pillar twice unless there are fewer than 5 pillars.` : 'Mix topic types: a lesson, a how-to, an opinion, a showcase of real work, and commentary on the field.'}
- Serve the goal: ${pc.goal}.
- Never repeat or closely overlap a previous post listed below — not the same subject, angle, or hook pattern.
- Hooks must be concrete. No stock templates: then-vs-now ("Six months ago… now…"), "Most people think…", "Unpopular opinion:", one-line dramatic reveals.
- whyNow must be honest: never invent news, statistics, launches or dates. If you're not sure something is current, tie it to a durable problem this audience has instead.`;

  const userPrompt = [
    `--- AUTHOR FACTS ---\n${pc.facts.join('\n') || '(none provided — keep topics broad but practical)'}`,
    pc.proofs.length ? `Real results the author can draw on:\n${pc.proofs.map(p => `- ${p}`).join('\n')}` : '',
    `Audience: ${pc.audience || 'professionals in the author\'s field'}`,
    previousPostsBlock(pc, { forTopics: true }),
  ].filter(Boolean).join('\n\n');

  const raw = await callAI(systemPrompt, userPrompt);
  const parsed = parseJsonObject(raw);
  return { topics: Array.isArray(parsed.topics) ? parsed.topics : [] };
}

export async function handleGeneratePost({ topic, angle, hook, style, creatorProfile, mode, companyProfile }) {
  const pc = await getPostContext(mode, creatorProfile, companyProfile);
  let systemContext, styleGuide;

  if (pc.isCompany) {
    const coStyleGuides = {
      thought_leadership: 'Thought Leadership: Open with a sharp industry observation, unpack it with clear reasoning (and evidence only if it is real — see credibility rules), close by inviting discussion',
      industry_insight: 'Industry Insight: Lead with a trend (cite a statistic only if it is widely known and verifiable — never a made-up figure), explain what it means for the industry, share the company\'s perspective',
      case_study: 'Case Study/Success: Open with the client\'s challenge (no names needed), describe the approach and solution, state the result — with numbers only if they come from the real results provided, otherwise qualitatively — close with the lesson',
      culture: 'Company Culture: Open with a specific authentic moment or milestone, tell the human story behind it, tie it to how the company works',
      product_spotlight: 'Product Spotlight: Open with the pain point the product solves (not the product itself), introduce the solution naturally, show the outcome',
    };
    styleGuide = coStyleGuides[style] || coStyleGuides.thought_leadership;
    systemContext = `You write LinkedIn posts for ${pc.name || 'a company'}'s company page. Write in a confident, insightful company voice — specific, never salesy or corporate.`;
  } else {
    const personalStyleGuides = {
      educational: 'Educational/Insight: Open with a sharp, true claim, explain the concept in plain terms, give a concrete example or analogy, close with the key takeaway',
      story: 'Personal Story: Open with a vivid specific moment (not "I"), build the narrative, share the lesson, make it relatable',
      hottake: 'Hot Take: Open with a bold but defensible claim, dismantle the common view with reasoning, offer the author\'s alternative',
      tips: 'Quick Tips: Lead with what the reader will be able to do, 3-5 numbered points, each crisp and actionable',
    };
    styleGuide = personalStyleGuides[style] || personalStyleGuides.educational;
    systemContext = `You are a LinkedIn ghostwriter writing as ${pc.name || 'the author'}, in the first person. Direct, confident, human — never corporate or generic.`;
  }

  const wordCount = pc.isCompany ? '200-320 words' : '150-280 words';
  const voiceRef = pc.voiceSample || pc.realPosts.slice(0, 3).map(t => t.slice(0, 700)).join('\n---\n');

  const systemPrompt = `${systemContext}

LinkedIn format rules:
- First line = a concrete hook. Don't open with "I" or "We". No emojis at the very start.
- Short paragraphs: 1-3 lines max, with a line break between every thought.
- Emojis: 0-2 max, only where genuinely useful — never decorative.
- No hashtags in the body.
- ${pc.ending}
- Word count: ${wordCount}.
- Serve the goal: ${pc.goal}. Audience: ${pc.audience || 'professionals in the author\'s field'}.

Credibility rules:
- Write from real experience. Where it strengthens the post, use ONE concrete proof point from the REAL RESULTS or AUTHOR FACTS provided. Never invent stories, clients, metrics, or "I once saw a team that..." anecdotes. If nothing real fits, make the argument on its merits instead of faking experience.
- If you use a proof point, make clear it is the author's own work, not a vague "teams I know".
- Never invent incidents, numbers, or quotes. A scenario that isn't from the real facts must be framed as hypothetical ("picture a team that...").
- Every technical claim must be precisely true — no "solves", "fixes", or "for free" unless it actually does.
- Avoid the stock AI-written LinkedIn template: one-line dramatic reveals, then-vs-now hooks of any timeframe, "→" arrow bullet lists, "winners won't be X, they'll be Y" closers, symmetrical aphorisms, and drama words like "quietly", "silently", "obsolete".
${voiceRef ? `
VOICE: the VOICE REFERENCE below is how the author actually writes. Match its sentence length, formatting habits (line breaks, lists, emoji use), vocabulary level and tone. Never copy its phrases, claims, stories or topics.` : ''}

Return ONLY valid JSON:
{
  "post": "Full post text (use \\n for line breaks between paragraphs)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"]
}

Hashtag rules: 3-5 tags specific to this post's subject and the author's field. No generic tags like #LinkedIn, #Motivation, #Innovation, #B2B, #BusinessGrowth.`;

  const userPrompt = [
    `Write a LinkedIn post on:\nTopic: ${topic}\nAngle: ${angle || 'your best angle'}\nOpening hook to build from: ${hook || 'craft the best hook'}\nStyle guide: ${styleGuide}`,
    `--- AUTHOR FACTS ---\n${pc.facts.join('\n') || '(none provided)'}`,
    pc.proofs.length ? `REAL RESULTS (the only allowed source of numbers and outcomes):\n${pc.proofs.map(p => `- ${p}`).join('\n')}` : '',
    voiceRef ? `--- VOICE REFERENCE ---\n${voiceRef}` : '',
    previousPostsBlock(pc, { forTopics: false }),
  ].filter(Boolean).join('\n\n');

  const raw = await callAI(systemPrompt, userPrompt);
  const parsed = parseJsonObject(raw);
  if (typeof parsed.post !== 'string' || !parsed.post.trim()) throw new Error('TRUNCATED_RESPONSE');
  return { post: parsed.post, hashtags: Array.isArray(parsed.hashtags) ? parsed.hashtags : [] };
}

// Both post handlers ask for JSON. Anything that doesn't parse into an object is an error the UI
// already explains — never raw model text, which previously landed in the post box as literal JSON.
function parseJsonObject(raw) {
  const candidates = [raw, (raw.match(/\{[\s\S]*\}/) || [])[0]].filter(Boolean);
  for (const c of candidates) {
    try { const v = JSON.parse(c); if (v && typeof v === 'object') return v; } catch {}
  }
  throw new Error('TRUNCATED_RESPONSE');
}

// ─── Follow-Up ────────────────────────────────────────────────────────────────
// The single handler for both follow-up entry points (the messaging-page quick action and the
// profile-panel Follow-up tool) — takes contactName/senderName explicitly rather than inferring
// sender/recipient from a "RECIPIENT PROFILE" blob, which used to let the wrong page's scraped
// profile (e.g. the account owner's own) leak in as if it belonged to the contact.

export async function handleGenerateChatFollowup({ conversationText, isRaw, contactName, senderName, intent, userInstructions, stage, daysSinceLastTouch, analysis, contextMaterial, strategy }) {
  const ctx = await getModeContext(intent);
  const senderCtx = [buildSenderContext(ctx), buildStyleRules(ctx)].filter(Boolean).join('\n\n');

  const writer = senderName || 'the user';
  const recipient = contactName || 'the contact';

  const conversationFormat = isRaw
    ? `The conversation below is raw text copied from LinkedIn messaging. It includes timestamps and sender names. Identify who said what based on the names: "${writer}" = the person you are writing for, "${recipient}" = the other person.`
    : `In the conversation below: messages labeled "You" were sent by ${writer}. Messages labeled "${recipient}" were sent by the contact.`;

  const systemPrompt = `You are an elite LinkedIn outreach strategist ghostwriting this message for ${writer}. You've read thousands of real LinkedIn conversations and know exactly how a sharp, busy professional actually talks — never like a chatbot or an email template.

CRITICAL — never write as ${recipient}. You are writing FOR ${writer}, TO ${recipient}. Everything in the conversation labeled as coming from ${writer} (or "You") is ${writer}'s own words about ${writer}'s own situation — never treat it as something ${recipient} said or shared, and never compliment or react to ${writer}'s own experience, skills, or story as though it belongs to ${recipient}. If ${writer} shared their own background, resume, or an ask (e.g. "I'm looking for X"), the next message continues advancing THAT, addressed to ${recipient} — it does not praise ${writer} for it.

${conversationFormat}

Read the ENTIRE conversation below before writing anything — not just the last message. Understand the full arc: what's already been said by each side, where the conversation actually stands right now, and what the one natural next beat is. A follow-up that ignores earlier context (repeats something already covered, misses a question that was already answered, or restarts a thread that's already moved on) is worse than no follow-up at all.

BEFORE YOU WRITE — CLASSIFY ${recipient.toUpperCase()}'S LAST REAL RESPONSE: if ${recipient} has replied at all, silently classify their most recent message as INTERESTED (asked a question, proposed a next step, clear enthusiasm), CURIOUS (engaged but noncommittal, asking for more info), NEUTRAL (short acknowledgment, no clear signal), OBJECTION (raised a concern or a "but"), NOT_NOW (explicitly said timing is bad), or PRICE_CONCERN (raised cost/budget/value directly). Never write this label into the message. Let it shape tone: INTERESTED/CURIOUS earns a direct, forward-moving reply; OBJECTION or PRICE_CONCERN should be addressed honestly, never glossed over; NOT_NOW should be respected with a light touch, never pushed past; NEUTRAL should not be over-read as more enthusiasm than it shows. If ${recipient} hasn't replied yet, skip this step.

${senderCtx ? `CONTEXT ABOUT ${writer.toUpperCase()}:\n${senderCtx}\n\n` : ''}Rules:
- Max 300 characters
- Sound like a real person typing a quick, thoughtful message — not a template
- If ${recipient} has not replied yet: write a natural follow-up to ${writer}'s last message (never copy-paste the previous message)
- If ${recipient} has replied: respond to what they specifically said and keep the conversation moving naturally, grounded in the whole thread so far — not just their most recent line
${AUTHENTICITY_RULES}

${buildFollowupAngleRules(stage, daysSinceLastTouch, recipient)}

${strategy && strategy !== 'smart_pick' ? `${buildStrategyGuidance(strategy)}\nApply this only to shape WHAT the opening move draws on — the angle, need-identification, formatting, and closing rules above still govern the rest of the message; don't let the strategy override those.\n\n` : ''}LEAD_READ LINE: after the message (and after NEED_ID if present), add one more line starting with exactly "LEAD_READ: " giving an honest, one-sentence read on how this relationship is trending — based only on real signals in the thread: whether ${recipient} has replied at all, how they replied (short/dismissive vs. detailed/curious), any questions they asked back, any timeline or urgency they mentioned, and how many unanswered touches have gone out. Do not invent a percentage, a "likelihood to close," or any numeric score — you do not have the data to support one, and a fake number is worse than no number. Say it plainly, e.g. "Warm — they've asked a specific question and haven't gone quiet" or "Cooling — three touches out with no reply, worth one higher-value message or moving on." If ${recipient} hasn't sent anything yet, base the read purely on touch count and elapsed time, and say so plainly.

Return ONLY the message text, followed by the NEED_ID and LEAD_READ lines described above (and TIMING_NOTE if that rule applies). No quotes around the message, no other labels, no explanation.`;

  const withAnalysis = analysis ? `${systemPrompt}\n\n${buildAnalysisContext(analysis, intent)}` : systemPrompt;
  const withContext = withAnalysis + buildUserContextSection(contextMaterial);

  const finalPrompt = userInstructions?.trim()
    ? `${withContext}\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly, even if it overrides the angle guidance above):\n${userInstructions.trim()}`
    : withContext;

  return { text: await callAIWithBannedPhraseGuard(finalPrompt, `CONVERSATION:\n${conversationText || '(no messages found)'}`, 300, strategy) };
}
