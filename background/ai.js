import { ANTHROPIC_API_URL, ANTHROPIC_VERSION, ANTHROPIC_MODEL } from './config.js';
import '../shared/taxonomy.js';
import '../shared/schema.js';
import { HUMAN_VOICE, AI_TELLS_PROMPT, examplesBlock, FOLLOWUP_HISTORY_RULES, FOLLOWUP_PLAYBOOK, findAiTells, cleanPunctuation, recentOpenersNote, rememberOpener } from './writing.js';

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
// The voice spec, the AI-tells list and the examples live in writing.js (with the research behind
// them). These few rules are kept from earlier rounds because each fixed a real, observed failure.
const AUTHENTICITY_RULES = `${HUMAN_VOICE}

${AI_TELLS_PROMPT}

ALSO:
- Never read their profile back to them (their title, tenure, team size or stats followed by a judgment). They know their own résumé. A detail is only worth mentioning as the reason you're writing.
- Never assume something they haven't said is true (don't ask how their agents perform if nothing says they run agents).
- If you mention how long they've been somewhere, compute it from today's date in the profile data or leave it out.
- Mutual connections are people you're both connected to, not people you know. Say "we're both connected to Simon", never "we both know Simon".
- Never restate or sympathise with what they just said before answering ("Thanks for sharing", "That sounds frustrating"). Answer.`;

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

// Shared by handleGenerateConnectionRequest and handleGenerateFirstMessage only — a user-selectable
// structural pattern for *how* to open a pre-relationship message, same "pick a named instructional
// block by key" shape as STAGE_TO_SITUATION below, just chosen by the user up front instead of derived
// from tracked stage. CONNECTION_REQUEST_FRAMEWORK/FIRST_MESSAGE_FRAMEWORK still govern length/
// no-pitch/grounding; a strategy only decides which kind of opening detail to lead with.
const STRATEGY_PLAYBOOK = {
  smart_pick: `STRATEGY: pick the opening yourself from what's actually in the data. Something they posted or a recent change (new role, funding, a hire, a launch) is the best reason to write. A mutual connection or shared employer is next. With little else, say plainly who you are and why them. Don't mention that you chose.`,
  curiosity_gap: `STRATEGY: open with one specific thing about their work you noticed, in plain words, and ask the one thing about it you'd actually want to know.`,
  direct_value: `STRATEGY: first sentence says plainly who you are and why you're writing to them. No warm-up. Then stop or ask one easy question.`,
  problem_first: `STRATEGY: name one problem people in their exact situation usually hit (grounded in their profile, not a generic industry line), then ask plainly if it's true for them. No solution, no pitch.`,
  shared_ground: `STRATEGY: start from something you really share that's in the data (mutual connections, a past employer, a group). If nothing real is there, write a plain direct message instead and don't mention it.`,
  sharp_question: `STRATEGY: the message is one specific question about a real detail in their profile or posts. A question you could send to anyone doesn't count.`,
  give_first: `STRATEGY: give one useful, specific thing (a tip, a number, a fix) that fits their situation, from the sender's real experience. No ask, or a very soft one.`,
  relevant_pattern: `STRATEGY: share one thing the sender has seen in their own work (only from the sender context, never invented) that applies to this person, then ask if it matches what they see.`,
};

function buildStrategyGuidance(strategyId) {
  return STRATEGY_PLAYBOOK[strategyId] || STRATEGY_PLAYBOOK.smart_pick;
}

// Stage values come from content/index.js's saved-contact pipeline (STAGE_ORDER). They point at
// the likely playbook situation (writing.js FOLLOWUP_PLAYBOOK); the thread itself has the final say.
const STAGE_TO_SITUATION = {
  connection_sent: 'D (connected, no reply yet) unless the thread shows otherwise',
  messaged: 'A (no reply yet, 1st follow-up)',
  followup_1: 'B (no reply yet, 2nd follow-up)',
  followup_2: 'C (no reply yet, final message)',
  followup_3plus: 'C (no reply yet, final message), or nothing more should be sent',
};

function buildFollowupAngleRules(stage, daysSinceLastTouch, recipient) {
  const who = recipient || 'the recipient';
  const sections = [];
  sections.push(`GROUNDING: only use what is literally in the conversation, the sender context, or the ADDITIONAL CONTEXT section. Never invent that ${who} said, asked or shared something. If ${who} hasn't written anything yet, don't thank them or react to anything from them.`);

  const wentCold = stage === 'replied' && Number.isFinite(daysSinceLastTouch) && daysSinceLastTouch >= 14;
  if (wentCold) sections.push(`PIPELINE: ${who} replied before, then ${daysSinceLastTouch} days of silence. Most likely situation N (went quiet after a good exchange). Don't keep digging into the same detail as last time.`);
  else if (STAGE_TO_SITUATION[stage]) sections.push(`PIPELINE: tracked stage points to situation ${STAGE_TO_SITUATION[stage]}. If the thread shows ${who} has replied since, follow the thread instead.`);
  if (stage === 'followup_3plus') sections.push(`Three or more messages have gone out with no reply. More follow-ups do worse than none. Write only a short, graceful last message (situation C).`);

  if (Number.isFinite(daysSinceLastTouch)) {
    sections.push(`It has been ${daysSinceLastTouch} day${daysSinceLastTouch === 1 ? '' : 's'} since the last message to ${who} (tracked, not a guess).`);
    sections.push(`TIMING_NOTE: if it has been fewer than 3 days since the sender's last message and ${who} hasn't replied, still write the message, then add one line starting exactly "TIMING_NOTE: " telling the user to wait a few days before sending (for the user only). Otherwise no TIMING_NOTE line.`);
  }
  sections.push(`NEED_ID: after the message, add one line starting exactly "NEED_ID: " with, in one sentence, what ${who} actually needs or cares about that this message moves toward. Leave it out only on a cold thread with nothing to infer from.`);
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
    const r = await chrome.storage.local.get(['icpProfiles', 'activeIcpProfileId', 'messagePresets', 'googleUser']);
    const list = Array.isArray(r.icpProfiles) ? r.icpProfiles : [];
    const profile = list.find(p => p.id === r.activeIcpProfileId) || list[0] || S.emptyB2bProfile();
    return finishContext(mode, profile, r.messagePresets, r.googleUser);
  }
  const r = await chrome.storage.local.get(['b2cProfiles', 'activeB2cProfileId', 'b2cMessagePresets', 'googleUser']);
  const list = Array.isArray(r.b2cProfiles) ? r.b2cProfiles : [];
  const profile = list.find(p => p.id === r.activeB2cProfileId) || list[0] || S.emptyB2cProfile();
  return finishContext(mode, profile, r.b2cMessagePresets, r.googleUser);
}

// First name of the signed-in account — the fallback when "Your first name" was left blank
// (e.g. a rep who imported a team setup, which never carries anyone's name).
const accountFirstName = user => String(user?.name || '').trim().split(/\s+/)[0] || '';

function finishContext(mode, profile, presets, googleUser) {
  const icp = { ...S.emptyIcp(), ...(profile.icp || {}) };
  const isB2b = mode === 'b2b_sales';
  const sender = isB2b ? (profile.businessProfile || {}) : (profile.pitch || {});
  const hasIndustries = !!(icp.industries.length || icp.customIndustries.length);
  // B2C fit can be judged from who hires (founders, hiring managers…) even without industries.
  const hasTargets = isB2b ? hasIndustries : (hasIndustries || icp.hirerTypes.length > 0);
  const hasSender = isB2b
    ? !!(sender.offer || sender.expertise || (sender.proofPoints || []).some(Boolean))
    : !!(sender.oneLiner || sender.services || sender.background || sender.currentTitle || (sender.skills || []).length);
  return { mode, isB2b, profile, icp, sender, seeking: profile.seeking || {}, presets: S.sanitizePresets(presets, mode), hasTargets, hasSender, senderName: sender.senderName || accountFirstName(googleUser) };
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
    L.push('--- ABOUT THE SENDER (a person writing on behalf of their company) ---');
    if (ctx.senderName) L.push(`Sender's first name: ${ctx.senderName}`);
    L.push(`Sender's role: ${s.senderRole || 'not given (say they are from the company, never invent a title)'}`);
    if (s.companyName) L.push(`Company: ${s.companyName}`);
    if (s.offerType) L.push(`What they sell: ${optLabel(S.OPTIONS.offerTypes, s.offerType)}`);
    if (s.offer) L.push(`Offer in one line: ${s.offer}`);
    const probs = [...optLabels(S.OPTIONS.problems, s.problems), s.problem].filter(Boolean);
    if (probs.length) L.push(`Problems they solve: ${probs.join('; ')}`);
    if (s.outcome) L.push(`Main outcome delivered: ${optLabel(S.OPTIONS.outcomes, s.outcome)}`);
    if (s.valueProp) L.push(`What makes them different: ${s.valueProp}`);
    if (s.expertise) L.push(`What the company's team works with: ${s.expertise}`);
    const proofs = (s.proofPoints || []).filter(Boolean);
    if (proofs.length) L.push(`Company proof points (real work. Use at most one, the closest match to this person's industry or problem, in "we" form, as a comparable project (what kind of company, what was built, one concrete result). Never a bare percentage. If none is close, use a general one or none):\n${proofs.map(p => `  - ${p}`).join('\n')}`);
    if (s.serviceMap) L.push(`Service matching guide (pick the ONE service whose situation matches what you found on their profile):\n${s.serviceMap}`);
    if (s.trust) L.push(`Why clients trust the company (use from the second message on, one at a time, never in a connection note): ${s.trust}`);
    if (s.pricing) L.push(`Typical pricing (only when they ask about price or budget, never before): ${s.pricing}`);
    if (s.notes) L.push(`Other notes from the company: ${s.notes}`);
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
    if (proofs.length) L.push(`Proof points (real work. Use at most one, the closest match to this person's industry or problem, as a comparable project (what kind of company, what was built, one concrete result). Never a bare percentage. If none is close, leave proof out):\n${proofs.map(p => `  - ${p}`).join('\n')}`);
    if (s.location) L.push(`Based in / time-zone overlap: ${s.location}`);
    if (s.rate) L.push(`Rate (only when they ask about rates or budget, never before): ${s.rate}`);
    if (s.portfolio) L.push(`Portfolio link (only ever share in a follow-up when they show interest — never in a first touch): ${s.portfolio}`);
    if (s.notes) L.push(`Other notes from the sender: ${s.notes}`);
  }
  return L.length > 1 ? L.join('\n') : '';
}

// B2B messages used to be written like a lone founder chatting ("I run a small studio", "I built"),
// and the no-pitch rules kept the company and its services out of them. The BD team's verdict
// (Nov 2026): it doesn't sound like a company presenting itself. These rules make the rep speak
// for the company: who they are, which company, the one relevant service, one matched proof.
// From Satyron's BD team (Nov 2026): which profile detail to lead with, and what never to mention.
const B2B_DETAIL_PRIORITY = `HOW TO PICK THE DETAIL. Scan their headline, About, recent posts and company info, and use the ONE strongest detail, in this order:
1. A recent post where they share a problem, a frustration or a goal (strongest, use it if it exists).
2. Something new at their company: a product launch, a new feature, a funding round, an expansion, a new market.
3. Hiring, especially engineers, developers, data or AI roles.
4. A role change or new position in the last few months.
5. What their About or headline says they focus on (only if nothing above exists).
Then match that detail to the ONE service that fits it best.
Never mention: generic praise of their profile, follower counts, their job title on its own, anything older than about 3 months unless it is still clearly relevant, or anything about their personal life.
If nothing specific is found, say their company's focus in one line and ask one question about their current priorities.`;

const roleCanClaimBuild = role => /\b(founder|co-?founder|cto|ceo|engineer|developer|architect|lead)\b/i.test(role || '');
function b2bVoice(ctx) {
  const name = ctx.senderName || 'the sender';
  const co = ctx.sender.companyName || 'their company';
  const role = ctx.sender.senderRole;
  return `HOW A COMPANY REP TALKS (this is B2B, the sender speaks for ${co}):
- ${name} writes as themselves, on behalf of ${co}. Make clear where you're from, using the company name exactly: "I'm ${name} from ${co}", "I work at ${co}" or "at ${co} we"${role ? `, or with the role ("I'm ${name}, ${role} at ${co}")` : ''}.
- Say what ${co} does in one plain sentence about the ONE service that fits the detail you picked (use the service matching guide in the sender context if there is one). Never the full service list.
- "We" for anything ${co} builds or has built ("we built a clinical dashboard for a health startup"). "I" only for what ${name} personally does.${roleCanClaimBuild(role) ? '' : ` Never say "I built", "I developed" or "I shipped". ${name} is not the engineer.`}
- Describe the problem the company fixes or the concrete thing it builds ("we build the AI tutor and the app around it"), not a category ("we build custom software", "AI-powered solutions", "a platform").
- One proof point at most, a comparable project: the kind of company, what was built, one concrete result. The closest match to their industry or problem. A proof from an unrelated industry doesn't count as fit (a vet app is not edtech proof). Never a bare percentage.
- Never name a client or a client's product, even if a proof point names one. Describe the project instead ("a vet-tech startup's multi-agent diagnostic system").
- Don't lead with where the team is based and don't open on price. Affordability comes up only when they ask about price or budget.
- Confident and specific, like a real person at a real studio. Not a marketing page: no "leading", "top-rated", "cost-effective", "offshore", "we help companies like yours", "partner with you", "solutions", "take it to the next level", "I'd love to show you". Never assume a problem ("are you struggling with").`;
}
// B2C got the same complaint: messages hid who the sender is and what they do. The sender's own
// title, one-liner and matched proof are now always part of the introduction.
function b2cVoice(ctx) {
  const name = ctx.senderName || 'the sender';
  return `HOW AN INDIVIDUAL PRESENTS THEMSELVES (B2C, ${name} is looking for work):
- Say plainly who you are and what you do in a few words, from the title and one-liner in the sender context ("I'm ${name}, an AI and full-stack engineer").
- Name only the one or two skills or services that fit this person's company or need. Never a skill list, never a résumé.
- One proof point at most, the closest match to their industry or problem, with one real number if there is one. Leave it out if nothing fits.
- When it fits the situation, say honestly what kind of work you're open to (contract, full-time, freelance), using only the sender context.
- Writing to a founder, hiring manager or recruiter about remote work: say where you're based and the time-zone overlap once, in one short clause, only if the sender context gives it. Never mention a rate in a first message, never sell on being cheap.
- Never name a client or a client's product, even if a proof point names one. Describe the project instead ("an AI tutoring product", "a health startup's clinical dashboard"). Your own current employer in your title is fine.
- Proof is a comparable project (the kind of company, what you built, one concrete result), never an adjective ("highly skilled", "results-driven") and never a bare percentage.
- A confident peer, not an applicant. No "I'm writing to express my interest", no "I'd be a great fit", no "any opportunity", no "hire me", no "open to work".`;
}

// Client names the sender doesn't want shared: the "Name:" prefix of a proof point, or a capitalised
// name right after "Built"/"for". Messages describe the project instead.
function clientNamesIn(proofs) {
  const names = new Set();
  for (const p of (proofs || []).filter(Boolean)) {
    const lead = p.match(/^\s*([A-Z][\w.&'-]*(?:\s+[A-Z][\w.&'-]*){0,3})\s*:/);
    if (lead) names.add(lead[1]);
    for (const m of p.matchAll(/\b(?:[Bb]uilt|for)\s+([A-Z][\w.&'-]*(?:\s+(?:AI|[A-Z][\w.&'-]*))?)/g)) names.add(m[1]);
  }
  return [...names].filter(n => n.length > 2 && !/^(A|An|The|We|I|LLM|AI|RAG|HIPAA)$/.test(n));
}

const firstPersonBuild = text => /\bI(?:'ve| have)? (built|developed|coded|designed|shipped|engineered)\b/i.test(text || '');

// LinkedIn's own InMail data: under 400 characters gets 22% more replies, over 1,200 gets 11% fewer
// — so length is no longer a setting. Gong's 304k cold-email study: an interest question beats a
// meeting ask on a first touch, which is why "ask if it's relevant" is the default ending.
const ENDING_RULES = {
  b2b_sales: {
    ask_relevant: 'End with one easy, low-pressure check on whether this is relevant for them right now. A question or a plain sentence. Never ask for a call or meeting.',
    offer_value: 'End by offering one small, specific, useful thing (an example, a short teardown, a schema) they can accept with one word.',
    ask_right_person: 'End by asking who the right person to talk to about this would be.',
    suggest_call: 'End with a light, easy-to-decline suggestion of a short call.',
    no_ask: 'No ask. End on a normal remark or question about their work.',
  },
  b2c_sales: {
    ask_relevant: 'End with one easy check on whether they are hiring or bringing in help for this kind of work, or an honest line that you\'d be up for it. Never ask for a job outright.',
    offer_value: 'End by offering one small, specific, useful thing (a quick idea, a sample, a short note on what you\'d check) they can accept with one word.',
    ask_right_person: 'End by asking who on their team would be the right person to talk to about this kind of work.',
    suggest_call: 'End with a light, easy-to-decline suggestion of a short call.',
    no_ask: 'No ask. End on a normal remark or question about their work.',
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
// Text is trimmed with .slice() in many places (post excerpts, profile sections). A cut through
// the middle of an emoji leaves half a UTF-16 surrogate pair; JSON.stringify writes it as a lone
// "\ud83d" escape and Anthropic rejects the whole request ("unexpected end of hex escape"). Seen
// live on a real profile whose posts used emoji. Repair every prompt here, once, for all callers.
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g;
export function wellFormed(text) {
  const s = String(text ?? '');
  return typeof s.toWellFormed === 'function' ? s.toWellFormed() : s.replace(LONE_SURROGATE, '�');
}

async function callAI(systemPrompt, userPrompt) {
  systemPrompt = wellFormed(systemPrompt);
  userPrompt = wellFormed(userPrompt);
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
function violatesStrategyShape(text, strategy) {
  const trimmed = (text || '').trim();
  if (strategy === 'sharp_question' && trimmed && !/[?？]\s*$/.test(trimmed)) return 'was written as the Sharp Question strategy but doesn\'t end in a question';
  return null;
}

// Every outreach message goes through here: the banned list above, the AI-tells check from
// writing.js, length, question count and strategy shape. One rewrite with the exact problems
// named, never a loop; then punctuation-only cleanup so a stray dash or "!" can't survive.
async function callAIWithBannedPhraseGuard(systemPrompt, userPrompt, maxChars, strategy, { maxQuestions = 1, maxSentences = null, rememberOpening = false, mustMention = '', noFirstPersonBuild = false, noPrice = false, avoidNames = [], noLinks = false, wordRange = null, endWithQuestion = false } = {}) {
  const problemsOf = text => {
    const body = stripMetaLines(text);
    const out = [];
    const hit = findBannedPhrase(body);
    if (hit) out.push(`used a banned phrase: "${hit}"`);
    const tells = findAiTells(body, { maxQuestions });
    if (tells.length) out.push(`read as AI-written because it used ${tells.slice(0, 8).join(', ')}`);
    if (typeof maxChars === 'number' && body.length > maxChars) out.push(`ran ${body.length} characters, over the ${maxChars}-character limit`);
    const sentences = (body.match(/[^.?!]+[.?!]+/g) || []).filter(x => x.trim().split(/\s+/).length > 1).length;
    if (maxSentences && sentences > maxSentences) out.push(`had ${sentences} sentences, more than ${maxSentences}`);
    const shape = violatesStrategyShape(body, strategy);
    if (shape) out.push(shape);
    if (mustMention && !body.toLowerCase().includes(mustMention.toLowerCase())) out.push(`never said the sender is from ${mustMention}`);
    if (noFirstPersonBuild && firstPersonBuild(body)) out.push('said "I built" (or similar) about company work, use "we"');
    if (noLinks && /https?:\/\/|www\.|calendly|\.com\b/i.test(body)) out.push('included a link, which never goes in a first message');
    if (wordRange) { const n = body.split(/\s+/).filter(Boolean).length; if (n < wordRange[0] || n > wordRange[1]) out.push(`was ${n} words, it must be ${wordRange[0]} to ${wordRange[1]}`); }
    if (endWithQuestion && !/\?\s*$/.test(body)) out.push('did not end with a question about their work or plans');
    const named = (avoidNames || []).find(n => new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(body));
    if (named) out.push(`named the client "${named}", describe the project instead`);
    if (noPrice && /\$\s?\d|\b\d+\s?(k|usd|pkr)\b|per hour|\/\s?hr\b|hourly rate/i.test(body)) out.push('mentioned a price or rate, which never goes in a first message');
    return out;
  };
  let text = await callAI(systemPrompt, userPrompt);
  const problems = problemsOf(text);
  if (problems.length) {
    const retryPrompt = `${systemPrompt}\n\nYour previous attempt was:\n"${stripMetaLines(text)}"\nIt ${problems.join('; and it ')}. Rewrite it from scratch in plain words, the way a person would type it, fixing all of that.`;
    text = await callAI(retryPrompt, userPrompt);
  }
  const { body, meta } = splitMetaLines(text);
  const clean = cleanPunctuation(body);
  if (rememberOpening) rememberOpener(clean);
  return meta ? `${clean}\n${meta}` : clean;
}

// Follow-ups carry NEED_ID / LEAD_READ / TIMING_NOTE lines after the message for the panel; the
// checks and the cleanup apply to the message only.
const META_LINE = /^(NEED_ID|LEAD_READ|TIMING_NOTE):/;
function splitMetaLines(text) {
  const lines = String(text || '').split('\n');
  const i = lines.findIndex(l => META_LINE.test(l.trim()));
  if (i === -1) return { body: String(text || '').trim(), meta: '' };
  return { body: lines.slice(0, i).join('\n').trim(), meta: lines.slice(i).join('\n').trim() };
}
const stripMetaLines = text => splitMetaLines(text).body;

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
const B2C_OPPORTUNITY_RULE = `WHICH SITUATION IS THIS (decide from the profile data only):
(a) They visibly need what the sender does: hiring for a matching role, a post asking for help, a project in the sender's area. Say plainly you saw it, give ONE concrete fit fact from the sender's real background, and ask about it.
(b) They could hire or bring the sender in (founder, CTO, engineering or product lead, hiring manager or recruiter at a relevant company) but nothing shows an opening. Give the specific reason you're writing, say in a few words what kind of work the sender does, and make a soft, honest ask ("are you bringing in outside help for that?", "if you ever need an extra pair of hands on the AI side, I'd be up for it").
(c) A peer with no say in hiring: a normal conversation about their work. No ask for work.
(d) A recruiter or talent person: a short factual summary, no small talk and no story. Target role and level, contract or full-time, where you're based and remote, and ask whether they recruit for roles like that.
(e) An employee at a company the sender wants to join (not the hiring manager): never ask a stranger for a referral in a first message. Ask one specific question about their team or work that helps the sender judge the fit. A referral ask only comes later, after they reply.
Never sound desperate ("any opportunity", "please consider me"), never "open to work" or "hire me", never a résumé dump.`;

// Grounded in 2026 LinkedIn acceptance-rate research (Leadriver's 50,000+ request benchmark,
// Belkins' 20M+ outreach study, Closely's connection-request psychology data): acceptance barely
// moves for a note vs. no note at all (~26% either way) UNLESS the note is genuinely trigger-based
// — a real, recent, individual signal, not just their name or title restated. Trigger-based
// personalization adds 12-20% acceptance on top of basic company/role context, layered on top of
// each other; a note that sells is the fastest way to get ignored, even faster than in a first
// message, since there isn't even a relationship yet to justify it.
// Research (MD/messaging_playbook.md): a note barely changes acceptance but lifts later replies
// (Belkins 2026: 8.2% vs 5.3%); honest stated-reason notes book more calls than vague ones (La
// Growth Machine); notes themselves rarely get replies, so the note's job is acceptance + context.
const CONNECTION_REQUEST_FRAMEWORK_B2B = `WHAT A GOOD NOTE FROM A COMPANY REP DOES (an invitation, they haven't accepted yet):
- Start with "Hi <first name>," using their real first name.
- The real reason you're writing to THEM: one specific thing from their profile or activity (a launch, a hire, a post, what their product does). Say it plainly.
- Who you are: your first name, the company, and in a few words what the company does that connects to them ("I'm Ahmed from Northbeam, we build AI features for edtech apps"). Either order is fine, reason first or introduction first.
- End simply: "Happy to connect.", "Would be good to connect." or one short question.
- 130 to 200 characters. 200 is the hard limit.
- No results or numbers, no list of services, no ask for a call, no link. Never write as if they already accepted.
- If nothing specific is in the data, introduce yourself and the company and say why their kind of company is relevant. Never invent a detail.`;

const CONNECTION_REQUEST_FRAMEWORK = `WHAT A GOOD NOTE DOES (it's an invitation, they haven't accepted yet):
- Start with "Hi <first name>," using their real first name.
- Give the real reason you're writing to THEM: one specific thing from their profile or activity (a post, a role they're hiring for, a launch, a move, their company's focus). Say it plainly.
- Say who you are in a few words (what you do, for whom), so they know why you're connecting.
- End however a person would: "Happy to connect.", "Would be good to connect.", "Glad to connect either way." or one short question. A question is optional.
- 100 to 180 characters is ideal. 200 is the hard limit.
- No pitch: no services list, no results, no ask for a call, no link. Never write as if they already accepted ("thanks for connecting").
- If nothing specific is in the data, keep it short and honest: who you are and why their kind of company is relevant to you. Never invent a detail.`;

export async function handleGenerateConnectionRequest(profileData, intent, userNotes, contextMaterial, previousAttempt, strategy) {
  const ctx = await getModeContext(intent);
  const senderCtx = buildSenderContext(ctx);
  const who = ctx.isB2b
    ? 'You write LinkedIn connection notes for a business development rep (or founder) at a services company, to people who could become clients. The note introduces the rep and the company and gives the real reason for connecting.'
    : 'You write LinkedIn connection notes for an individual professional who wants work (a job, contract or freelance projects, a place on a team) from people who could hire them, refer them or bring them in. It may be honest that they do this kind of work, but it never reads like a cover letter or begs.';
  let systemPrompt = `${who}

${ctx.isB2b ? `${CONNECTION_REQUEST_FRAMEWORK_B2B}\n\n${B2B_DETAIL_PRIORITY}\n\n${b2bVoice(ctx)}` : `${CONNECTION_REQUEST_FRAMEWORK}\n\n${b2cVoice(ctx)}`}

${ctx.isB2b && (!strategy || strategy === 'smart_pick') ? '' : buildStrategyGuidance(strategy)}\n${ctx.isB2b ? 'The strategy only shapes the opening. The note still says who you are and which company.' : 'The strategy only shapes the opening. The note still says who you are and what you do.'}

${PRECONVERSATION_GROUNDING}

${AUTHENTICITY_RULES}

${examplesBlock('connection', ctx.mode)}

Base it on their CURRENT role and company. Never reference posts from a previous employer. Always produce a note: never refuse, never ask for clarification, never leave a placeholder.
Return ONLY the note text. No quotes around it.`;
  systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStyleRules(ctx, { connection: true })}`;
  if (senderCtx) systemPrompt += `\n\n${senderCtx}\n(${ctx.isB2b ? 'In a note, use only the company name and a few words of what it does. Never list services.' : 'In a note, use only a few words of this to say what the sender does. Never list it.'})`;
  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt, strategy);
  systemPrompt += await recentOpenersNote();

  const text = await callAIWithBannedPhraseGuard(systemPrompt, buildProfileText(profileData, userNotes), 200, strategy, { maxSentences: 3, rememberOpening: true, noPrice: true, ...b2bChecks(ctx) });
  return { text: stripSignOff(text, ctx.senderName) };
}

function b2bChecks(ctx) {
  const avoidNames = clientNamesIn(ctx.sender.proofPoints);
  if (!ctx.isB2b) return { avoidNames };
  return { avoidNames, mustMention: ctx.sender.companyName || '', noFirstPersonBuild: !roleCanClaimBuild(ctx.sender.senderRole) };
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

// Research (MD/messaging_playbook.md): best first DMs are 2-4 short sentences, ~25-60 words, under
// ~400 characters; pitching cuts replies sharply; an interest question beats a meeting ask when
// cold; zero or one question both work, two or more hurt. After a note, the first message refers
// back to it lightly and never repeats it.
const FIRST_MESSAGE_FRAMEWORK = `WHAT A GOOD FIRST MESSAGE DOES, in this order:
1. "Hi <first name>,". Never open with "thanks for connecting".
2. Why them, now: one specific real detail (an opening, a launch, funding, a post, what their product does), in plain words. If the connection note used a detail, use a different one or move on from it in a few words.
3. Who you are: what you do, in a few words, and the one or two skills that fit that detail. If the connection note already said it, a few words is enough.
4. One proof that fits them (closest industry or problem), stated plainly: what was built, for whom, one number if real. Leave it out if nothing fits. No claims about results you'd get for them.
5. One ask that fits the situation above, or an offer they can say yes to in one word ("want me to send it?"). A question or a plain sentence. Never ask for a call or meeting unless the MESSAGE STYLE ending below asks for one.
- 3 to 5 short sentences, about 40 to 80 words, under 450 characters. One question at most. Senior people get the shorter end.
- No links, no résumé, no attachments, no rate in a first message.
- The strategy below only shapes step 2. Steps 3 and 5 are always there (in situation (c), step 5 is a normal question, not an ask for work).`;

// B2B: the BD team needs the company presented (who, which company, the relevant service, one
// matched proof). Longer than the cold-outreach ideal on purpose; still one idea and one ask.
// Satyron BD team's spec (Nov 2026): start a real conversation, not sell. Three lines, 50-75
// words, one service matched to their situation, framed as the outcome for them, then a question.
const FIRST_MESSAGE_FRAMEWORK_B2B = `THE GOAL OF THIS FIRST MESSAGE: start a real conversation, not sell.
STRUCTURE, after "Hi <first name>,":
1. One short, natural line about something specific they posted, built, launched or are hiring for (the detail picked by HOW TO PICK THE DETAIL below). If the connection note used a detail, use the next one down the list.
2. One line on how the company's work connects to that, framed as the outcome for them, not a service list. Make clear you're with the company ("I work at Satyron and we...", "at Satyron we..."). Pick only the ONE service that fits their situation best. Don't default to AI: if their need is web, mobile, hiring help, data, DevOps or security, use that.
3. End with one easy, curious question about their work or plans.
RULES:
- 50 to 75 words. "I" for the sender, "we" for the company. No sign-off and no name at the end.
- No links, no call or meeting request, no calendar or Calendly link, no proof point or client example in this message (those come later).
- No em dashes, no emojis, minimal punctuation, no random capital letters (only names and the start of sentences).
- Don't explain their own business back to them.
- Never open with "thanks for connecting".
- A chosen strategy below (if any) only shapes line 1. Lines 2 and 3 are always there.`;

function buildConnectionRecencyNote(stage, daysSinceLastTouch) {
  if (stage !== 'connection_sent' || !Number.isFinite(daysSinceLastTouch) || daysSinceLastTouch <= 2) return '';
  return `CONNECTION TIMING: they connected ${daysSinceLastTouch} days ago, not today. Don't open with "thanks for connecting" or "just connected".`;
}

export async function handleGenerateFirstMessage(profileData, analysis, intent, tone, userInstructions, stage, daysSinceLastTouch, contextMaterial, previousAttempt, strategy, connectionNote) {
  const ctx = await getModeContext(intent);
  // The panel's per-message tone picker overrides the saved default for this one message.
  if (tone && TONE_RULES[tone]) ctx.presets = { ...ctx.presets, tone };
  const a = analysis || {};
  const dm = a.decisionMaker || '';
  const isDecisionMaker = dm === 'Yes' || dm === 'Likely';
  const scoreVal = ctx.isB2b
    ? (a.prospectScore?.score || a.potentialClient?.score || 'Low')
    : (a.clientPotential?.score || ({ Strong: 'High', Possible: 'Medium', Unlikely: 'Low' })[a.hiringSignal?.score] || 'Low');
  const senderCtx = buildSenderContext(ctx);
  const maxChars = ctx.isB2b ? 520 : 450; // B2B is held to 50-75 words by the word check

  const who = ctx.isB2b
    ? `You write the first LinkedIn message from a business development rep (or founder) at a services company to a person who could become a client. After reading it, the person knows which company is writing, how its work connects to them, and why they got this message now. The goal is a real conversation, not a sale. ${scoreVal === 'Low' ? 'They are a weak fit: keep it light and make no ask for work.' : ''}`
    : `You write the first LinkedIn message for an individual professional who wants work (a job, contract or freelance projects, a place on a team). The goal is a reply from someone who could hire, refer or bring them in.\n\n${B2C_OPPORTUNITY_RULE}`;

  let systemPrompt = `${who}

${ctx.isB2b ? `${FIRST_MESSAGE_FRAMEWORK_B2B}\n\n${B2B_DETAIL_PRIORITY}\n\n${b2bVoice(ctx)}` : `${FIRST_MESSAGE_FRAMEWORK}\n\n${b2cVoice(ctx)}`}

${ctx.isB2b && (!strategy || strategy === 'smart_pick') ? '' : buildStrategyGuidance(strategy)}

${PRECONVERSATION_GROUNDING}

${AUTHENTICITY_RULES}

${examplesBlock('first', ctx.mode)}

Return ONLY the message. No quotes, no explanation.`;

  systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStyleRules(ctx, { connection: ctx.isB2b })}`;
  if (senderCtx) systemPrompt += `\n\n${senderCtx}`;
  if (userInstructions?.trim()) systemPrompt += `\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly):\n${userInstructions.trim()}`;
  systemPrompt += `\n\n${buildAnalysisContext(a, ctx.mode)}`;
  systemPrompt += `\n\nHOW TO USE THE ANALYSIS: it's background notes, not wording. Take at most one fact from it, in your own plain words, and only if it's true in the profile. Never repeat its phrases, scores, labels or conclusions.`;
  const recencyNote = buildConnectionRecencyNote(stage, daysSinceLastTouch);
  if (recencyNote) systemPrompt += `\n\n${recencyNote}`;
  const note = String(connectionNote || '').trim();
  if (note) {
    systemPrompt += `\n\nCONNECTION NOTE ALREADY SENT OR DRAFTED FOR THIS PERSON:\n"${note.slice(0, 400)}"\nThis message comes after it. Don't reuse its detail, its question or its wording. Build on it or move to a different specific reason.`;
  }
  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt, strategy);
  systemPrompt += await recentOpenersNote();

  const text = await callAIWithBannedPhraseGuard(systemPrompt, buildProfileText(profileData), maxChars, strategy, { maxSentences: 5, rememberOpening: true, noPrice: true, noLinks: true, ...(ctx.isB2b ? { wordRange: [50, 75], endWithQuestion: true } : {}), ...b2bChecks(ctx) });
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
  const refineMax = 450;

  const systemPrompt = `You are refining a LinkedIn outreach message. Apply the requested tone and follow the user's instructions precisely.

TONE: ${tone?.toUpperCase() || 'WARM'}
Tone definition: ${toneGuide}

Rules:
- Keep the same core meaning and intent as the original, including its main question — and do not add claims, opinions, or credentials it didn't make (e.g. turning curiosity into "I have strong opinions on this")
- Apply the tone throughout — it should feel consistent, not patchy
- Follow the user's instructions exactly, and treat length instructions as measurable: "shorter" means cutting at least a third of the words; "longer" means meaningfully more. Measured: "make it shorter" once went from 36 words to 35.
- If the instruction adds an ask (such as a call), attach it naturally to the message's existing question rather than stacking a second request, and skip softeners like "no pressure at all"
- Use the recipient's name and company only as they appear in the profile below
- Max ${refineMax} characters unless the instructions explicitly request more
${AUTHENTICITY_RULES}
- Return ONLY the refined message text. No quotes, no explanation.`;

  const userPrompt = `ORIGINAL MESSAGE:
"${originalMessage}"

RECIPIENT PROFILE:
${buildProfileText(profileData)}

USER INSTRUCTIONS:
${instructions?.trim() || 'No specific instructions — just apply the tone consistently.'}

${analysis ? `ANALYSIS CONTEXT:\n${buildAnalysisContext(analysis, intent)}` : ''}`;

  return { text: await callAIWithBannedPhraseGuard(systemPrompt, userPrompt, refineMax) };
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
    if (s.expertise) facts.push(`What the company's team works with: ${s.expertise}`);
    if (!isCompany && s.senderRole) facts.push(`Author's role at the company: ${s.senderRole}`);
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
  // B2B posts are written by a rep, from their own profile, about their company — so the author is
  // always the person; the company is the subject.
  const name = (isCompany ? ctx.senderName || creatorProfile?.name : settings.name || ctx.senderName) || '';
  const companyName = companyProfile?.name || s.companyName || '';
  return { isCompany, ctx, facts, proofs, audience, pillars, ending, goal, realPosts, generated, voiceSample, name, companyName };
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

  const systemPrompt = `You are a LinkedIn content strategist for ${pc.isCompany ? `a member of ${pc.companyName || 'a company'}'s team who posts about the company's work from their own personal profile` : 'one professional writing as themselves'}. Suggest 5 post topics this author can write credibly and that serve their goal.

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
- whyNow must be honest: never invent news, statistics, launches or dates. If you're not sure something is current, tie it to a durable problem this audience has instead.
- The person reading these topics IS the author. Write title, angle, hook and whyNow speaking to them as "you"/"your" (or "we"/"our" for the company), never "the author", "the user" or their name in the third person.`;

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
    systemContext = `You are a LinkedIn ghostwriter writing as ${pc.name || 'a team member'}, who works at ${pc.companyName || 'the company'} and is posting about the company's work from their OWN personal profile — not the company page. First person: "I" for their own view and experience, "we" for what the team does. It should read like a practitioner sharing what their team is seeing and doing, never like a press release, an ad, or company-page copy. Mention the company by name at most once, only where it's natural.`;
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

const B2B_FOLLOWUP_RULES = ctx => {
  const co = ctx.sender.companyName || 'the company';
  return `SPEAKING FOR ${co.toUpperCase()} (B2B):
- If the thread hasn't yet made clear who you are and what ${co} does, say it in one line.
- The second message is where fuller credibility goes: one trust point from the sender context (code ownership, overlap hours, seniority) or one comparable project with a result. One at a time, never a stack.
- Good moves for a services company, when they fit the situation: one case study that matches their industry or problem (the kind of company, what was built, one result), one quick idea for their product, two specific times for a 20-minute call once they're interested, and a straight answer on how ${co} works (a fixed-scope project, a dedicated team, or an audit first) when they ask about process.
- Asked what it costs: ${ctx.sender.pricing ? 'answer from the sender context. If it gives numbers, give the honest range and the main thing that moves it (scope, integrations, timeline). If it only describes the pricing (for example budget-friendly hourly rates, hourly or contract), say that plainly in everyday words ("our rates are budget-friendly, and we work hourly or on a fixed contract"), say the real number depends on scope, and suggest 15 minutes to give one. Then one scoping question. Never dodge a price question and never make up a figure.' : 'no pricing is in the sender context, so say plainly it depends on scope, name what drives it, and suggest 15 minutes to give a real number. Never make up a figure.'}
- Never invent prices, timelines, team sizes, client names or results that aren't in the sender context.`;
};

const B2C_FOLLOWUP_RULES = ctx => {
  const portfolio = ctx.sender.portfolio;
  return `SPEAKING FOR YOURSELF (B2C, looking for work):
- If the thread hasn't yet made clear what you do, say it in one line.
- Good moves, when they fit the situation: a project from the proof points that matches their industry or problem (what it was, one result), ${portfolio ? `the portfolio link (${portfolio}) once they show interest, never before` : 'offering examples of past work once they show interest'}, one quick idea for their product, two specific times for a 20-minute call once they're interested, and a straight answer on availability and the kinds of work you're open to.
- Asked about rates: ${ctx.sender.rate ? 'answer from the sender context. If it gives a number, give it and add that a fixed price is possible once scope is clear. If it only describes the rate (for example budget-friendly), say that plainly and that the number depends on scope. Then one scoping question ("a few weeks, or ongoing?"). Never dodge it and never make up a figure.' : 'no rate is in the sender context, so say it depends on scope and suggest a short call to pin it down. Never make up a number.'}
- Never invent rates, start dates, years of experience, employers or results that aren't in the sender context.`;
};

export async function handleGenerateChatFollowup({ conversationText, isRaw, contactName, senderName, intent, userInstructions, stage, daysSinceLastTouch, analysis, contextMaterial, strategy }) {
  const ctx = await getModeContext(intent);
  const senderCtx = [buildSenderContext(ctx), buildStyleRules(ctx)].filter(Boolean).join('\n\n');
  const writer = senderName || ctx.senderName || 'the user';
  const recipient = contactName || 'the contact';

  const conversationFormat = isRaw
    ? `The conversation below is raw text copied from LinkedIn messaging, with timestamps and sender names. "${writer}" is the person you write for, "${recipient}" is the other person.`
    : `In the conversation below, "You" is ${writer} and "${recipient}" is the other person. Lines start with [date, time] when LinkedIn showed one. Use the dates to see gaps.`;

  const goal = ctx.isB2b
    ? `${writer} works for ${ctx.sender.companyName || 'a services company'} and wants ${recipient} as a client. Every message should move one small step toward a call or a project, without pushing.`
    : `${writer} wants work from ${recipient} (a job, a contract, freelance projects, or a referral). Every message should move one small step toward that, without pushing or begging.`;

  const systemPrompt = `You ghostwrite ${writer}'s next LinkedIn message to ${recipient}. ${goal}

Never write as ${recipient}. Everything from "You" is ${writer}'s own words about ${writer}'s own situation. Never praise or react to it as if ${recipient} said it.

${conversationFormat}

${FOLLOWUP_HISTORY_RULES}

${FOLLOWUP_PLAYBOOK}

${ctx.isB2b ? `${B2B_FOLLOWUP_RULES(ctx)}\n\n${b2bVoice({ ...ctx, senderName: writer })}` : `${B2C_FOLLOWUP_RULES(ctx)}\n\n${b2cVoice({ ...ctx, senderName: writer })}`}

LENGTH: ${ctx.isB2b ? 'usually 150 to 350 characters. Answering their question or sharing a case study can run up to 550.' : 'usually 150 to 300 characters. Answering their question or sharing a project can run up to 500.'} Never longer than the situation needs.

${senderCtx ? `ABOUT ${writer.toUpperCase()}:\n${senderCtx}\n\n` : ''}${AUTHENTICITY_RULES}

${buildFollowupAngleRules(stage, daysSinceLastTouch, recipient)}

${strategy && strategy !== 'smart_pick' ? `${buildStrategyGuidance(strategy)}\nThis only shapes the opening move; the thread rules and the situation above come first.\n\n` : ''}LEAD_READ: after the message (and after NEED_ID), add one line starting exactly "LEAD_READ: " with an honest one-sentence read on where this is heading, based only on real signals (did they reply, how, did they ask anything, any timeline, how many unanswered messages). No percentages or scores.

Return ONLY the message, then the NEED_ID and LEAD_READ lines (and TIMING_NOTE if it applies). No quotes, no labels on the message, no explanation.`;

  const withAnalysis = analysis ? `${systemPrompt}\n\n${buildAnalysisContext(analysis, intent)}\nThe analysis is background notes: never repeat its wording or conclusions.` : systemPrompt;
  const withContext = withAnalysis + buildUserContextSection(contextMaterial);
  const finalPrompt = userInstructions?.trim()
    ? `${withContext}\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly, even over the situation guidance):\n${userInstructions.trim()}`
    : withContext;

  return { text: await callAIWithBannedPhraseGuard(finalPrompt, `CONVERSATION:\n${conversationText || '(no messages found)'}`, ctx.isB2b ? 550 : 500, strategy, { noFirstPersonBuild: ctx.isB2b && !roleCanClaimBuild(ctx.sender.senderRole), avoidNames: clientNamesIn(ctx.sender.proofPoints) }) };
}
