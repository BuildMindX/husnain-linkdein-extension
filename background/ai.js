import { OPENAI_API_URL, OPENAI_MODEL } from './config.js';

// ─── Storage Helpers ──────────────────────────────────────────────────────────

async function getApiKey() {
  const result = await chrome.storage.local.get('openaiApiKey');
  if (!result.openaiApiKey) throw new Error('NO_API_KEY');
  return result.openaiApiKey;
}

const DEFAULT_EXCLUDES = ['Tech service providers', 'IT outsourcing / staffing', 'Digital / marketing agencies'];

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
- Contractions are normal ("I'm", "it's", "don't") — avoid stiff, fully-spelled-out phrasing`;

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
function buildVarietyNote(previousAttempt) {
  const trimmed = (previousAttempt || '').trim();
  if (!trimmed) return '';
  return `\n\nPREVIOUS ATTEMPT — DO NOT REPEAT ITS ANGLE:\n"${trimmed}"\nThis is being regenerated because the user wants something different, not a rewording. Lead with a different specific detail, a different opening move, or a different angle entirely — not the same idea in new words. If the previous attempt already used the one obvious hook, find a second real detail rather than manufacturing variety through synonyms.`;
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

// B2C gets its own target/exclude industries (b2cTargetIndustries/b2cExcludeIndustries), not
// B2B's — previously B2C scoring silently reused whatever was configured for B2B mode with no
// way to see or change it from the B2C settings. No B2B-style default exclude list here either:
// those defaults ("Tech service providers", "IT outsourcing", etc.) are a B2B assumption that
// doesn't obviously carry over to a freelancer's own client-fit judgment.
async function getB2cIcpConfig() {
  const r = await chrome.storage.local.get(['b2cTargetIndustries', 'b2cExcludeIndustries']);
  return {
    targets: Array.isArray(r.b2cTargetIndustries) ? r.b2cTargetIndustries : [],
    excludes: Array.isArray(r.b2cExcludeIndustries) ? r.b2cExcludeIndustries : [],
    business: {},
  };
}

// Multiple saved ICP/business profiles, for a user who sells to more than one kind of buyer
// (e.g. "Healthcare clients" vs. "Logistics clients") — one is active at a time, same
// one-config-at-a-time model as before, just switchable now instead of fixed. Message style
// (tone/length/CTA) stays a single shared setting, not per-profile — that's about how the sender
// writes, not who they're targeting, so splitting it added complexity without a real need.
//
// Migrates the old flat targetIndustries/excludeIndustries/businessProfile keys into a single
// "Default" profile on first read after this shipped, exactly once (icpProfiles.length is the
// migration marker) — the legacy keys are left in place afterward, unused but harmless, rather
// than deleted, since nothing reads them again once icpProfiles exists.
async function ensureIcpProfilesMigrated() {
  const { icpProfiles } = await chrome.storage.local.get('icpProfiles');
  if (Array.isArray(icpProfiles) && icpProfiles.length) return icpProfiles;

  const legacy = await chrome.storage.local.get(['targetIndustries', 'excludeIndustries', 'businessProfile']);
  const defaultProfile = {
    id: `icp-${Date.now()}`,
    name: 'Default',
    targetIndustries: Array.isArray(legacy.targetIndustries) ? legacy.targetIndustries : [],
    excludeIndustries: Array.isArray(legacy.excludeIndustries) ? legacy.excludeIndustries : DEFAULT_EXCLUDES,
    businessProfile: legacy.businessProfile || {},
  };
  await chrome.storage.local.set({ icpProfiles: [defaultProfile], activeIcpProfileId: defaultProfile.id });
  return [defaultProfile];
}

async function getActiveIcpProfile() {
  const profiles = await ensureIcpProfilesMigrated();
  const { activeIcpProfileId } = await chrome.storage.local.get('activeIcpProfileId');
  return profiles.find(p => p.id === activeIcpProfileId) || profiles[0] || null;
}

async function getSalesConfig() {
  const [active, r] = await Promise.all([
    getActiveIcpProfile(),
    chrome.storage.local.get('messagePresets'),
  ]);
  return {
    targets: Array.isArray(active?.targetIndustries) ? active.targetIndustries : [],
    excludes: Array.isArray(active?.excludeIndustries) ? active.excludeIndustries : DEFAULT_EXCLUDES,
    business: active?.businessProfile || {},
    presets: r.messagePresets || {},
  };
}

async function getB2cProfile() {
  const r = await chrome.storage.local.get('b2cProfile');
  return r.b2cProfile || {};
}

async function getJobProfile() {
  const r = await chrome.storage.local.get('jobProfile');
  return r.jobProfile || {};
}

// B2C and Job Search each get their own tone/length/CTA presets — deliberately separate storage
// keys from B2B's messagePresets, not a shared one, so switching modes doesn't silently carry
// one mode's style preference into another the way ICP targeting used to.
async function getB2cMessagePresets() {
  const r = await chrome.storage.local.get('b2cMessagePresets');
  return r.b2cMessagePresets || {};
}

async function getJobMessagePresets() {
  const r = await chrome.storage.local.get('jobMessagePresets');
  return r.jobMessagePresets || {};
}

// ─── Context Builders ─────────────────────────────────────────────────────────

function buildIcpContext(cfg, mode = 'b2b') {
  const lines = ['--- YOUR IDEAL CUSTOMER PROFILE (use this to judge fit) ---'];
  const fallback = mode === 'b2c'
    ? 'TARGET INDUSTRIES: not specified — judge fit on general freelance opportunity signals (founder/owner at SMB/startup preferred).'
    : 'TARGET INDUSTRIES: not specified — judge fit on general B2B buying potential.';
  lines.push(cfg.targets.length
    ? `TARGET INDUSTRIES (strong fit): ${cfg.targets.join(', ')}`
    : fallback);
  lines.push(cfg.excludes.length
    ? `EXCLUDED INDUSTRIES (poor fit — set "excluded": true and level "Poor" if their company matches any of these): ${cfg.excludes.join(', ')}`
    : 'EXCLUDED INDUSTRIES: none.');
  const b = cfg.business || {};
  const biz = [];
  if (b.offer) biz.push(`What we offer: ${b.offer}`);
  if (b.idealCustomer) biz.push(`Our ideal customer: ${b.idealCustomer}`);
  if (b.problem) biz.push(`Problem we solve: ${b.problem}`);
  if (b.valueProp) biz.push(`Value prop: ${b.valueProp}`);
  if (biz.length) { lines.push('\nOUR BUSINESS:'); lines.push(biz.join('\n')); }
  return lines.join('\n');
}

function buildMessageStyle(cfg) {
  const p = cfg.presets || {};
  const b = cfg.business || {};
  const tone = p.tone || 'warm';
  const length = p.length || 'standard';
  const lines = [`Tone: ${tone}.`];
  lines.push(`Length: ${length === 'short' ? 'very short — one or two lines.' : 'concise but complete.'}`);
  if (p.includeCta && (p.ctaText || '').trim()) {
    lines.push(`End with a soft, natural call-to-action along the lines of: "${p.ctaText.trim()}". Keep it casual, never salesy.`);
  } else {
    lines.push('Do not include a hard call-to-action.');
  }
  const who = [];
  if (b.expertise) who.push(`Sender expertise: ${b.expertise}`);
  if (b.offer) who.push(`We offer: ${b.offer}`);
  if (b.valueProp) who.push(`Value prop: ${b.valueProp}`);
  if (b.senderName) who.push(`Sender name: ${b.senderName}`);
  if (b.companyName) who.push(`Sender company: ${b.companyName}`);
  if (who.length) {
    lines.push('\nABOUT THE SENDER (weave in subtly ONLY if it strengthens the message — never pitch hard, never list features):');
    lines.push(who.join('\n'));
  }
  return lines.join('\n');
}

// Just the tone/length/CTA portion of buildMessageStyle, shared by B2C and Job Search — they
// already get their own sender-bio context from buildB2cContext/buildJobContext, so they don't
// need buildMessageStyle's "ABOUT THE SENDER" section (that's B2B-specific field names anyway).
function buildStylePresetRules(presets) {
  const p = presets || {};
  const tone = p.tone || 'warm';
  const length = p.length || 'standard';
  const lines = [`Tone: ${tone}.`];
  lines.push(`Length: ${length === 'short' ? 'very short — one or two lines.' : 'concise but complete.'}`);
  if (p.includeCta && (p.ctaText || '').trim()) {
    lines.push(`End with a soft, natural call-to-action along the lines of: "${p.ctaText.trim()}". Keep it casual, never salesy.`);
  } else {
    lines.push('Do not include a hard call-to-action.');
  }
  return lines.join('\n');
}

function buildB2cContext(p) {
  const lines = ['--- YOUR PERSONAL PROFILE (use this to personalise analysis and messaging) ---'];
  if (p.expertise) lines.push(`Your expertise / domain: ${p.expertise}`);
  if (p.services) lines.push(`Services you offer: ${p.services}`);
  if (p.targetClient) lines.push(`Your target clients: ${p.targetClient}`);
  if (p.problem) lines.push(`Problem you solve: ${p.problem}`);
  if (p.valueProp) lines.push(`Your unique angle / USP: ${p.valueProp}`);
  if (p.senderName) lines.push(`Your name: ${p.senderName}`);
  return lines.join('\n');
}

function buildJobContext(p) {
  if (!p || !Object.keys(p).length) return '';
  const lines = ['--- YOUR JOB SEARCH PROFILE (personalize messaging based on this — calibrate tone and references to the sender\'s background) ---'];
  if (p.senderName) lines.push(`Your name: ${p.senderName}`);
  if (p.currentTitle) lines.push(`Your current or target role: ${p.currentTitle}`);
  if (p.background) lines.push(`Your professional background: ${p.background}`);
  if (Array.isArray(p.targetRoles) && p.targetRoles.length) lines.push(`Roles you are looking for: ${p.targetRoles.join(', ')}`);
  if (Array.isArray(p.targetIndustries) && p.targetIndustries.length) lines.push(`Industries you are targeting: ${p.targetIndustries.join(', ')}`);
  if (p.yearsExp) lines.push(`Years of experience: ${p.yearsExp}`);
  return lines.join('\n');
}

function buildAnalysisContext(analysis, intent) {
  const lines = ['--- PROFILE ANALYSIS (use these insights to craft a personalized message) ---'];
  if (intent === 'b2b_sales') {
    if (analysis.potentialClient?.score) lines.push(`Prospect Score: ${analysis.potentialClient.score}`);
    if (analysis.potentialClient?.reasoning) lines.push(`Score reasoning: ${analysis.potentialClient.reasoning}`);
    if (analysis.decisionMaker) lines.push(`Decision Maker: ${analysis.decisionMaker}`);
    if (analysis.industryFit?.level) lines.push(`Industry Fit: ${analysis.industryFit.level} — ${analysis.industryFit.reasoning || ''}`);
    if (analysis.companySize) lines.push(`Company Size: ${analysis.companySize}`);
  } else if (intent === 'b2c_sales') {
    if (analysis.clientPotential?.score) lines.push(`Client Potential: ${analysis.clientPotential.score}`);
    if (analysis.clientPotential?.reasoning) lines.push(`Reasoning: ${analysis.clientPotential.reasoning}`);
    if (analysis.decisionMaker) lines.push(`Decision Maker: ${analysis.decisionMaker}`);
    if ((analysis.painPoints || []).length) lines.push(`Pain Points:\n${analysis.painPoints.map(p => `  - ${p}`).join('\n')}`);
    if (analysis.approachAngle) lines.push(`Recommended Approach: ${analysis.approachAngle}`);
  } else if (intent === 'job_search') {
    if (analysis.hiringSignal?.score) lines.push(`Hiring Signal: ${analysis.hiringSignal.score}`);
    if (analysis.hiringSignal?.reasoning) lines.push(`Hiring reasoning: ${analysis.hiringSignal.reasoning}`);
    if (analysis.isRecruiter) lines.push(`Is Recruiter: ${analysis.isRecruiter}`);
    if (analysis.companyName) lines.push(`Company: ${analysis.companyName}`);
  }
  if (analysis.industry) lines.push(`Industry: ${analysis.industry}`);
  if (analysis.recentActivity) lines.push(`Recent Activity: ${analysis.recentActivity}`);
  if ((analysis.keyInsights || []).length) lines.push(`Key Insights:\n${analysis.keyInsights.map(i => `  - ${i}`).join('\n')}`);
  if ((analysis.summaryPoints || []).length) lines.push(`Profile Facts:\n${analysis.summaryPoints.slice(0, 3).map(p => `  - ${p}`).join('\n')}`);
  if (analysis.timingCaution) lines.push(`TIMING CAUTION: ${analysis.timingCaution} — factor this into the WHY NOW judgment above; do not manufacture urgency that ignores it, and consider whether a lighter-touch or delayed approach fits better.`);
  return lines.join('\n');
}

function buildProfileText(p, userNotes) {
  const lines = [];
  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.connections) lines.push(`Connections: ${p.connections}`);
  if (p.followers) lines.push(`Followers: ${p.followers}`);
  if (p.mutualConnections) lines.push(`Mutual connections with sender: ${p.mutualConnections} (a real, verifiable shared-network signal — only reference it if it would sound natural, never force it in)`);
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
  if (p.rawText && lines.length < 4) {
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
  return lines.join('\n');
}

// ─── Core AI Call ─────────────────────────────────────────────────────────────

async function callAI(systemPrompt, userPrompt) {
  const apiKey = await getApiKey();
  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
      max_tokens: 2000,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });
  if (!response.ok) {
    if (response.status === 401) throw new Error('INVALID_KEY');
    if (response.status === 429) throw new Error('RATE_LIMITED');
    if (response.status === 503) throw new Error('API_DOWN');
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }
  const data = await response.json();
  return (data.choices[0].message.content || '').trim();
}

// ─── Profile Analysis ─────────────────────────────────────────────────────────

export async function handleAnalyzeProfile(profileData, intent) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cIcpCfg = isB2c ? await getB2cIcpConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;

  let systemPrompt;

  if (isJobSearch) {
    systemPrompt = `You are a job search intelligence assistant. Analyze LinkedIn profiles from the perspective of a job seeker evaluating contacts.

Respond ONLY with valid JSON. No markdown, no explanation, no extra text — just the raw JSON object.
IMPORTANT: Always return the full JSON structure. Never add an "error" field. Use "Unknown" for anything you cannot determine.

Return exactly this structure:
{
  "hiringSignal": {
    "score": "Strong | Possible | Unlikely",
    "reasoning": "One sentence max explaining the score"
  },
  "isRecruiter": "Yes | Likely | No",
  "companyName": "Current employer name, or Unknown",
  "companySize": "Startup | SMB | Mid-market | Enterprise | Unknown",
  "engagementRate": "Daily | Weekly | Occasional | Rarely",
  "industry": "Short industry label (e.g. Construction, SaaS, Finance)",
  "summaryPoints": [
    "Short chip-sized fact about their background (max 8 words)",
    "Second fact",
    "Third fact",
    "Fourth fact"
  ],
  "recentActivity": "One sentence on what they post about or engage with. If none visible, say No recent posts visible.",
  "keyInsights": [
    "Actionable job-search insight #1 — concise, specific",
    "Actionable job-search insight #2",
    "Actionable job-search insight #3"
  ],
  "timingCaution": "One sentence flagging a REAL reason right now might be bad timing to reach out — e.g. they started this exact role within the last few weeks, their company shows visible signs of layoffs or contraction, or they explicitly posted about being on leave or overwhelmed. Empty string if nothing genuinely stands out — do not invent a caution just to fill this field."
}

hiringSignal guide:
- Strong: Recruiter, HR, Talent Acquisition, or posts about hiring/open roles
- Possible: Hiring manager, team lead, or growing company with budget signals
- Unlikely: IC with no hiring signals, or company appears to be contracting

isRecruiter guide:
- Yes: Title contains Recruiter, Talent, HR, People Ops, Staffing
- Likely: HR Manager, People Partner, or posts frequently about hiring
- No: No HR/recruiting signals

companySize guide:
- Startup: <50 employees or early-stage signals
- SMB: 50-500 employees
- Mid-market: 500-5000 employees
- Enterprise: 5000+ employees or well-known large corp

keyInsights should be actionable for a job seeker — e.g. what to mention, how to approach them, what roles they hire for, growth signals.
engagementRate: infer from follower count, post frequency, and activity signals`;

  } else if (isB2c) {
    systemPrompt = `You are a B2C freelance sales intelligence assistant. Analyze LinkedIn profiles from the perspective of an individual freelancer or consultant evaluating whether this person could become a client.

Respond ONLY with valid JSON. No markdown, no explanation, no extra text — just the raw JSON object.
IMPORTANT: Always return the full JSON structure. Never add an "error" field. Use "Unknown" for anything you cannot determine.

Return exactly this structure:
{
  "clientPotential": {
    "score": "High | Medium | Low",
    "reasoning": "One sentence max explaining the score"
  },
  "freelancerSignal": {
    "signal": "Strong | Possible | Unlikely",
    "reasoning": "One sentence on how likely they are to work with individual freelancers or consultants"
  },
  "decisionMaker": "Yes | Likely | No",
  "company": {
    "name": "Current employer name, or Unknown",
    "size": "Startup | SMB | Mid-market | Enterprise | Unknown",
    "stage": "Early-stage | Growth | Established | Unknown"
  },
  "engagementRate": "Daily | Weekly | Occasional | Rarely",
  "industry": "Short industry label (e.g. SaaS, E-commerce, Healthcare)",
  "summaryPoints": [
    "Short chip-sized fact about their background (max 8 words)",
    "Second fact",
    "Third fact",
    "Fourth fact"
  ],
  "recentActivity": "One sentence on what they post about or engage with. If none visible, say No recent posts visible.",
  "painPoints": [
    "Visible pain, challenge, or gap a freelancer in your domain could address",
    "Second pain point or opportunity"
  ],
  "keyInsights": [
    "Actionable B2C insight #1 — specific to pitching your personal expertise",
    "Actionable insight #2",
    "Actionable insight #3"
  ],
  "approachAngle": "The most compelling angle to reach out as an individual expert — specific to their situation, not generic",
  "timingCaution": "One sentence flagging a REAL reason right now might be bad timing to reach out — e.g. they started this exact role within the last few weeks, their company shows visible signs of contraction or trouble, or they explicitly posted about being on leave or overwhelmed. Empty string if nothing genuinely stands out — do not invent a caution just to fill this field."
}

clientPotential scoring guide:
- High: decision-maker at a startup/SMB with visible skill gaps, budget signals, or history working with freelancers/agencies
- Medium: manager-level, growing team, relevant industry but less direct signal
- Low: large-enterprise IC with no procurement authority, or no freelance alignment

freelancerSignal guide:
- Strong: founder, co-founder, solo operator, small team with obvious gaps, or history with contractors
- Possible: manager with some autonomy, project-based work signals, growing team
- Unlikely: large enterprise, siloed role, no budget/decision signals

decisionMaker guide:
- Yes: Founder, Owner, CEO, CTO, Head of X at a small company
- Likely: Manager, Team Lead, Director at an SMB
- No: IC, junior, large-enterprise employee with no budget authority

companySize guide:
- Startup: <50 employees or early-stage
- SMB: 50-500 employees
- Mid-market: 500-5000 employees
- Enterprise: 5000+ or well-known large corp

engagementRate: infer from follower count, post frequency, and activity signals

${buildIcpContext(b2cIcpCfg, 'b2c')}
${b2cProfile && Object.keys(b2cProfile).length ? '\n' + buildB2cContext(b2cProfile) : ''}`;

  } else {
    systemPrompt = `You are a B2B SaaS sales intelligence assistant. Analyze LinkedIn profiles and return structured data for a sales dashboard.

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
    "reasoning": "One sentence on how well their company's industry matches the target ICP below",
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
  "summaryPoints": [
    "Short chip-sized fact about their background (max 8 words)",
    "Second fact",
    "Third fact",
    "Fourth fact"
  ],
  "recentActivity": "One sentence on what they post about or engage with. If none visible, say No recent posts visible.",
  "keyInsights": [
    "Actionable sales insight #1 — concise, specific",
    "Actionable sales insight #2",
    "Actionable sales insight #3"
  ],
  "timingCaution": "One sentence flagging a REAL reason right now might be bad timing to reach out — e.g. they started this exact role within the last few weeks, their company shows visible signs of layoffs or contraction, or they explicitly posted about being on leave or overwhelmed. Empty string if nothing genuinely stands out — do not invent a caution just to fill this field."
}

industryFit guide:
- Strong: their company's industry is one of the TARGET INDUSTRIES below (or closely adjacent).
- Partial: a plausible B2B buyer, but not in a listed target industry.
- Poor: their company is in an EXCLUDED industry or clearly irrelevant. Set "excluded": true and level "Poor".
- industryFit MUST influence potentialClient.score: Poor/excluded fit can never score High.

Scoring guide (combine seniority AND industry fit):
- High: decision-maker (Director/VP/C-level/Owner) AND Strong or Partial fit
- Medium: some influence or buying signals, at least Partial fit
- Low: individual contributor, OR Poor/excluded fit, OR irrelevant

decisionMaker guide:
- Yes: C-level, VP, Director, Owner, Founder
- Likely: Manager, Team Lead, Senior with procurement mentions
- No: IC, student, junior role

companySize guide:
- Startup: <50 employees or early-stage signals
- SMB: 50-500 employees
- Mid-market: 500-5000 employees
- Enterprise: 5000+ employees or well-known large corp

engagementRate: infer from follower count, post frequency, and activity signals

${buildIcpContext(cfg)}`;
  }

  const userPrompt = buildProfileText(profileData);
  const raw = await callAI(systemPrompt, userPrompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('TRUNCATED_RESPONSE');
  try {
    return JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('TRUNCATED_RESPONSE');
  }
}

// ─── Bulk Search-Results Scoring ───────────────────────────────────────────────
// Lighter-weight sibling of handleAnalyzeProfile — search result cards only expose
// name/title/company (no experience, education, posts), so this trades analysis depth
// for being able to score a whole page of results in one ICP-aware batched call instead
// of the blind title-keyword heuristic it replaces.
export async function handleBulkScoreProfiles(profiles, intent) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cIcpCfg = isB2c ? await getB2cIcpConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;

  const scoreLabels = isJobSearch ? 'Strong | Possible | Unlikely' : 'High | Medium | Low';
  const perspective = isJobSearch
    ? 'a job seeker judging how useful each contact could be as a hiring signal or relevant network connection'
    : isB2c
    ? 'an individual freelancer or consultant judging each contact\'s potential as a client'
    : 'a B2B sales rep judging each contact\'s fit as a sales prospect';

  const context = isJobSearch
    ? ''
    : isB2c
    ? buildIcpContext(b2cIcpCfg, 'b2c') + (b2cProfile && Object.keys(b2cProfile).length ? '\n\n' + buildB2cContext(b2cProfile) : '')
    : buildIcpContext(cfg);

  const systemPrompt = `You are scoring a batch of LinkedIn search results from the perspective of ${perspective}. You only have each person's name, title, and company — no full profile, no experience history, no posts. Judge primarily on seniority/title, and on fit against the context below when relevant.

${context}

Respond ONLY with valid JSON, no markdown, no explanation:
{"scores": [{"id": "<the id given for this person>", "score": "${scoreLabels}", "reasoning": "max 8 words"}]}

One entry per input person, in the same order, using the exact same "id" value given for each — never invent or alter an id.`;

  const userPrompt = profiles
    .map((p, i) => `${i + 1}. id: ${p.id} | Name: ${p.name || 'Unknown'} | Title: ${p.title || 'Unknown'} | Company: ${p.company || 'Unknown'}`)
    .join('\n');

  const raw = await callAI(systemPrompt, userPrompt);
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('TRUNCATED_RESPONSE');
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return { scores: Array.isArray(parsed.scores) ? parsed.scores : [] };
  } catch {
    throw new Error('TRUNCATED_RESPONSE');
  }
}

// ─── Connection Request ───────────────────────────────────────────────────────

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

If there is no genuine trigger for this person, a short, honest, low-key note beats a generic one dressed up to sound personalized — vague flattery performs worse than no note at all.`;

export async function handleGenerateConnectionRequest(profileData, intent, userNotes, contextMaterial, previousAttempt) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;
  const jobProfile = isJobSearch ? await getJobProfile() : null;
  const b2cPresets = isB2c ? await getB2cMessagePresets() : null;
  const jobPresets = isJobSearch ? await getJobMessagePresets() : null;

  let systemPrompt;

  if (isJobSearch) {
    systemPrompt = `You write LinkedIn connection requests for a job seeker. Write like a real person, not a cover letter.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name, current title, and company. Always produce a message — never refuse, never ask for clarification, and never leave a placeholder or note saying information is missing.

${CONNECTION_REQUEST_FRAMEWORK}

Rules:
- Hard limit: 200 characters total (count carefully)
- No corporate speak, no buzzwords
- Show genuine interest in their company or work — not desperation
- No mention of "looking for opportunities" or "open to work"
- Sound like a curious professional, not an applicant
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}

Return ONLY the connection request text. Nothing else. No quotes around it.`;
    const jobCtx = buildJobContext(jobProfile);
    if (jobCtx) systemPrompt += `\n\n${jobCtx}`;
    systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStylePresetRules(jobPresets)}`;

  } else if (isB2c) {
    systemPrompt = `You write LinkedIn connection requests for an individual freelancer or consultant reaching out to a potential client. You are positioning the sender as a peer and fellow professional, not as a vendor.

PRIORITY RULE: Base the message on their CURRENT role, company, or recent activity. Never reference posts from a previous employer. Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if nothing specific is available, write a warm human message using their current title and company. Always produce a message — never refuse, never ask for clarification, and never leave a placeholder or note saying information is missing.

${CONNECTION_REQUEST_FRAMEWORK}

Rules:
- Hard limit: 200 characters total (count carefully)
- No selling, no pitching, no mention of services or offers
- Sound like one professional reaching out to another — collegial, not promotional
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Never mention "freelance", "hire me", or any engagement offer

Return ONLY the connection request text. Nothing else. No quotes around it.`;
    if (b2cProfile && Object.keys(b2cProfile).length) {
      systemPrompt += `\n\n--- YOUR PROFILE (sender context, for tone calibration only) ---\n${buildB2cContext(b2cProfile)}`;
    }
    systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStylePresetRules(b2cPresets)}`;

  } else {
    systemPrompt = `You write LinkedIn connection requests. Write like a real person, not a marketer.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their current title and company. Always produce a message — never refuse, never ask for clarification, and never leave a placeholder or note saying information is missing.

${CONNECTION_REQUEST_FRAMEWORK}

Rules:
- Hard limit: 200 characters total (count carefully)
- No corporate speak, no buzzwords
- No selling, no pitching, no mention of your own work
- Sound like a genuine human reaching out
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}

Return ONLY the connection request text. Nothing else. No quotes around it.`;
    if (cfg) systemPrompt += `\n\n--- MESSAGE STYLE & SENDER CONTEXT ---\n${buildMessageStyle(cfg)}`;
  }

  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt);

  const userPrompt = buildProfileText(profileData, userNotes);
  return { text: await callAI(systemPrompt, userPrompt) };
}

// ─── First Message ────────────────────────────────────────────────────────────

// Grounded in current outbound-messaging research (independently corroborated across multiple
// 2026 cold-outreach playbooks): messages that pitch in the first touch — even just hinting at
// ROI, efficiency, or what the sender offers — measurably underperform ones that stay purely
// curious about the recipient. Reply rates for first-touch pitches fall below 5%; concise
// (40-70 word) messages built around one real, specific detail and closed with a low-friction
// question routinely land in the 25-40% range. This replaces the older "hint at value" guidance
// that used to live in the b2b decision-maker branch, which was itself fighting this framework.
const FIRST_MESSAGE_FRAMEWORK = `FIRST-MESSAGE FRAMEWORK — this is the actual structure of a message that gets replies, not a style suggestion:

1. SPECIFIC HOOK (first line): open on one real, individual detail — something true of THIS person that couldn't be copy-pasted to the next 1,000 profiles unchanged. If nothing specific enough exists, say so honestly (a warm, generic opener beats a faked-specific one) — never invent one.
2. THEIR SITUATION, NOT YOUR PITCH: the body stays entirely about them — an observation, a genuine question, or what you noticed about their situation. Do not describe what the sender does, offers, or has achieved, and do not hint at value, ROI, or efficiency gains — even softly. The moment a message explains the sender instead of the recipient, it reads as a pitch and reply rates collapse. That conversation happens after they reply, never in message 1.
3. ONE LOW-FRICTION QUESTION: end with a single question that's easy and low-stakes to answer — never a request for a call, a meeting, a demo, pricing, or any other real commitment. It should feel genuinely optional — the recipient should be able to ignore it without feeling rude.

LENGTH: the single most consistent finding in current outreach data. Keep the whole message to 40-70 words (tighter — 40-50 — for senior or executive recipients, who get the most outreach and scan the fastest). Every sentence past that measurably hurts reply rate rather than helping it. If a draft runs long, cut explanation before cutting personalization.

Self-check before finalizing: does the first line prove real, specific knowledge of THIS person? Does any part of the message describe the sender's company, product, or value instead of the recipient's own situation? If either check fails, rewrite before returning.`;

function buildConnectionRecencyNote(stage, daysSinceLastTouch) {
  if (stage !== 'connection_sent' || !Number.isFinite(daysSinceLastTouch) || daysSinceLastTouch <= 2) return '';
  return `CONNECTION TIMING: this connection was sent/accepted ${daysSinceLastTouch} days ago, not moments ago (tracked from the sender's saved pipeline stage) — do not write as if the connection just happened ("thanks for connecting", "just connected", etc). Open as a considered first message to someone already in their network, not a reflexive same-day follow-up.`;
}

export async function handleGenerateFirstMessage(profileData, analysis, intent, tone, userInstructions, stage, daysSinceLastTouch, contextMaterial, previousAttempt) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;
  const jobProfile = isJobSearch ? await getJobProfile() : null;
  const b2cPresets = isB2c ? await getB2cMessagePresets() : null;
  const jobPresets = isJobSearch ? await getJobMessagePresets() : null;
  const a = analysis || {};

  // The analysis schema (see the "decisionMaker" field def above) only ever produces
  // "Yes" | "Likely" | "No" — never a title string — so a regex matching title keywords like
  // "ceo"/"vp"/"founder" against it could never fire, silently treating every contact (including
  // confirmed decision-makers) as a non-decision-maker.
  const dm = a.decisionMaker || '';
  const isDecisionMaker = dm === 'Yes' || dm === 'Likely';
  const cs = a.companySize || a.company?.size || '';
  const hasBudgetSignals = isDecisionMaker || /enterprise|mid.market|series [bcd]|funded/i.test(cs + ' ' + (a.companyName || ''));

  const scoreVal = isJobSearch ? (a.hiringSignal?.score || 'Unlikely')
    : isB2c ? (a.clientPotential?.score || 'Low')
    : (a.prospectScore?.score || a.potentialClient?.score || 'Low');
  const isHighValue = scoreVal === 'High' || scoreVal === 'Strong';
  const isMidValue  = scoreVal === 'Medium' || scoreVal === 'Possible';

  const toneInstructions = {
    warm:         'Warm, genuine, like a peer talking to a peer. Human and approachable.',
    professional: 'Polished and credible. Confident, precise, zero filler.',
    casual:       'Conversational and relaxed. Like a message to a colleague you respect.',
    direct:       'Straight to the point. No pleasantries. Clear and confident.',
    bold:         'Confident and distinctive. Takes a position. Stands out from the noise.',
  };
  const toneGuide = toneInstructions[tone] || toneInstructions.warm;
  const analysisCtx = buildAnalysisContext(a, intent);

  let systemPrompt;

  if (isJobSearch) {
    const approachGuide = scoreVal === 'Strong'
      ? 'Strong hiring signal — be direct and purposeful. Reference their active hiring context or recent company move. Make it clear you are someone worth talking to, not just someone looking for a job.'
      : isMidValue
      ? 'Possible hiring signal — be curious and exploratory. Express genuine interest in their work.'
      : 'Weak hiring signal — keep it short and very low-commitment. Pure relationship-building, no hint of job-seeking.';

    systemPrompt = `You are a senior career coach who has helped hundreds of executives land roles through LinkedIn. You write first messages that get replies because they feel researched, specific, and non-desperate.

TONE: ${toneGuide}
APPROACH FOR THIS CONTACT: ${approachGuide}

${FIRST_MESSAGE_FRAMEWORK}

JOB-SEARCH-SPECIFIC RULES:
- Sound like an accomplished professional reaching out to exchange ideas — never like a job seeker asking for a favour
- Never mention "looking for opportunities", "open to work", "my next role", or anything that frames you as seeking something
- Never reference your own background, resume, or job search in this message — the specific hook and the question are both about THEM

HARD RULES:
- Max 300 characters total
- Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name/current title and company
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Never reference the analysis itself — weave the insights in naturally
- Return ONLY the message. No quotes, no explanation.`;
    const jobCtx = buildJobContext(jobProfile);
    if (jobCtx) systemPrompt += `\n\n${jobCtx}`;
    systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStylePresetRules(jobPresets)}`;

  } else if (isB2c) {
    const approachGuide = isHighValue
      ? 'High-potential client. They likely work with contractors and have budget. Be specific about a pain point or challenge you spotted — stay curious about it, don\'t position yourself as the answer to it yet.'
      : isMidValue
      ? 'Mid-tier prospect. Be exploratory — show genuine interest in their work and ask an insightful question about their situation.'
      : 'Low-tier prospect. Keep it warm and brief. Pure relationship-building message — no hints at services.';

    systemPrompt = `You are a senior business developer writing a first LinkedIn message on behalf of a freelancer or consultant. You have 15+ years of experience winning enterprise clients through relationship-based outreach.

TONE: ${toneGuide}
APPROACH FOR THIS PROSPECT: ${approachGuide}

${FIRST_MESSAGE_FRAMEWORK}

B2C-SPECIFIC RULES:
- Establish peer credibility through how the message sounds, not by stating it — position the sender as someone who works in the same domain, not a vendor
- Never say "I can help you with X", "my services include Y", or anything naming what the sender offers — that is the exact pitch pattern the framework above bans

HARD RULES:
- Max 350 characters total
- Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name/current title and company
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Return ONLY the message. No quotes, no explanation.`;
    if (b2cProfile && Object.keys(b2cProfile).length) {
      systemPrompt += `\n\n--- SENDER PROFILE ---\n${buildB2cContext(b2cProfile)}`;
    }
    systemPrompt += `\n\n--- MESSAGE STYLE ---\n${buildStylePresetRules(b2cPresets)}`;

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

    systemPrompt = `You are a senior B2B Business Development Executive with 15+ years of enterprise sales experience at high-growth SaaS companies. You write the LinkedIn first messages that actually get replies — because they feel like they were written for this specific person, not pulled from a template.

TONE: ${toneGuide}
DECISION-MAKER ASSESSMENT: ${dmGuide}
BUDGET SIGNAL: ${budgetGuide}
APPROACH FOR THIS PROSPECT: ${approachGuide}

${FIRST_MESSAGE_FRAMEWORK}

B2B-SPECIFIC RULES:
- Seniority changes tightness and directness, never how much you pitch — a decision-maker gets a shorter, sharper version of the exact same no-pitch structure, not a more "business-outcome-focused" one
- Reference at least one concrete detail from the analysis (company context, key insight, recent activity, or ICP fit signal) as the specific hook — this is what proves research, not a stated credential
- Goal of message 1 is to start a conversation, not close a deal — the pitch, if there ever is one, is reserved for when they reply

HARD RULES:
- Max 350 characters total
- Never fabricate a specific detail that isn't actually in the profile data (see GROUNDING below) — if there is nothing specific enough to reference, write a warm, natural message using just their name/current title and company
${PRECONVERSATION_GROUNDING}

${WHY_THEM_WHY_NOW_GATE}
${AUTHENTICITY_RULES}
- Return ONLY the message. No quotes, no explanation.`;
    if (cfg) systemPrompt += `\n\n--- SENDER CONTEXT ---\n${buildMessageStyle(cfg)}`;
  }

  if (userInstructions?.trim()) {
    systemPrompt += `\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly):\n${userInstructions.trim()}`;
  }
  systemPrompt += `\n\n${analysisCtx}`;
  systemPrompt += `\n\nHOW TO USE THE ANALYSIS ABOVE: "Recent Activity" and "Key Insights" are where the specific hook required by the framework should come from — they're the closest thing to a real trigger you have. Score, Decision Maker, Industry Fit, and Company Size exist purely to calibrate directness and tone (per the guidance above) — they are never something to reference, restate, or hint at in the message itself; the recipient never sees how they were scored.`;
  const recencyNote = buildConnectionRecencyNote(stage, daysSinceLastTouch);
  if (recencyNote) systemPrompt += `\n\n${recencyNote}`;
  systemPrompt += buildUserContextSection(contextMaterial);
  systemPrompt += buildVarietyNote(previousAttempt);

  const userPrompt = buildProfileText(profileData);
  return { text: await callAI(systemPrompt, userPrompt) };
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
- Keep the same core meaning and intent as the original
- Apply the tone throughout — it should feel consistent, not patchy
- Follow the user's instructions exactly
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

  return { text: await callAI(systemPrompt, userPrompt) };
}

// ─── Post Creator ─────────────────────────────────────────────────────────────

export async function handleSuggestPostTopics(creatorProfile, recentPosts = [], mode = 'personal', companyProfile = null) {
  const apiKey = await getApiKey();

  let context, styleDesc, topicTypes;

  if (mode === 'company' && companyProfile) {
    const co = companyProfile;
    const styleMap = {
      thought_leadership: 'thought leadership, authoritative industry perspective',
      industry_insight: 'data-driven industry insights and trends',
      case_study: 'client success stories and case studies',
      culture: 'company culture and employer brand storytelling',
      product_spotlight: 'product/service value and problem-solving',
    };
    styleDesc = styleMap[co.postStyle] || styleMap.thought_leadership;
    context = `Company: ${co.name || 'a B2B company'}
Industry: ${co.industry || 'technology'}
About: ${co.about || ''}
Products/Services: ${co.products || ''}
ICP (target clients): ${co.icp || 'business decision makers'}
Company goal: ${co.goal || 'attract clients and build brand awareness'}`;
    topicTypes = 'industry trends, client pain points your product solves, thought leadership, success signals, employer brand, market predictions';
  } else {
    const cp = creatorProfile || {};
    const domains = (Array.isArray(cp.domains) && cp.domains.length) ? cp.domains.join(', ') : 'AI, machine learning, technology';
    const audience = cp.audience || 'tech professionals and business leaders';
    const styleMap = { educational: 'educational, insight-driven', story: 'personal story or journey-based', hottake: 'contrarian, bold hot takes', tips: 'practical, actionable tips' };
    styleDesc = styleMap[cp.postStyle] || styleMap.educational;
    context = `Expert in: ${domains}\nTarget audience: ${audience}\nGoal: ${cp.goal || 'build personal brand'}`;
    topicTypes = 'industry trend, personal experience angle, contrarian take, practical insight, prediction';
  }

  const avoidSection = recentPosts.length
    ? `\n\nCRITICAL — these topics were already posted recently. Do NOT suggest anything similar or overlapping:\n${recentPosts.map((p, i) => `${i + 1}. "${p.slice(0, 200)}"`).join('\n')}`
    : '';

  const userPrompt = `You are a LinkedIn content strategist${mode === 'company' ? ' specializing in B2B company thought leadership' : ' for tech thought leaders'}.

${context}
Preferred style: ${styleDesc}

Suggest 5 fresh, high-performing LinkedIn post topics. Mix of: ${topicTypes}.${avoidSection}

Respond ONLY with valid JSON — no markdown, no explanation:
{
  "topics": [
    {
      "title": "Catchy topic title (max 8 words)",
      "angle": "The specific angle or unique take on this topic",
      "hook": "The opening 1-2 sentences — must stop the scroll",
      "whyNow": "Why this resonates right now (1 sentence)"
    }
  ]
}

Requirements:
- Each topic must be clearly distinct from the others
- Grounded in real current developments — no generic advice
- Phrased to appeal to the stated audience`;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.88, messages: [{ role: 'user', content: userPrompt }] }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('INVALID_KEY');
    if (res.status === 429) throw new Error('RATE_LIMITED');
    if (res.status === 503) throw new Error('API_DOWN');
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json();
  const raw = (data.choices[0]?.message?.content || '').trim();
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { topics: [] };
  }
}

export async function handleGeneratePost({ topic, angle, hook, style, creatorProfile, mode, companyProfile }) {
  const apiKey = await getApiKey();

  let systemContext, authorCtx, styleGuide, hashtagContext;

  if (mode === 'company' && companyProfile) {
    const co = companyProfile;
    const coStyleGuides = {
      thought_leadership: 'Thought Leadership: Open with a bold industry observation, unpack the insight with data or evidence, position the company as a forward-thinking authority, close with an invitation to discuss',
      industry_insight: 'Industry Insight: Lead with a striking statistic or trend, explain what it means for the industry, share the company\'s perspective, end with a question for the audience',
      case_study: 'Case Study/Success: Open with the client\'s challenge (no names needed), describe the approach and solution, quantify the result, close with the lesson or takeaway',
      culture: 'Company Culture: Open with a specific authentic moment or milestone, tell the human story behind it, tie it to company values, end with a culture-forward message',
      product_spotlight: 'Product Spotlight: Open with the pain point your product solves (not the product itself), introduce the solution naturally, show the outcome, soft CTA',
    };
    styleGuide = coStyleGuides[style] || coStyleGuides.thought_leadership;
    systemContext = `You are a professional LinkedIn content writer for ${co.name || 'a B2B company'}, a ${co.industry || 'technology'} company. Write in a polished, authoritative company voice — confident and insightful, not salesy.`;
    authorCtx = `Company: ${co.name || ''}
Industry: ${co.industry || ''}
About: ${co.about || ''}
Products/Services: ${co.products || ''}
ICP: ${co.icp || 'business decision makers'}
Goal: ${co.goal || 'attract clients, build brand awareness'}`;
    hashtagContext = `Niche company hashtags (#${(co.industry || 'Tech').replace(/\s+/g, '')}), broad (#B2B #BusinessGrowth), and topic-specific. No #LinkedIn.`;
  } else {
    const cp = creatorProfile || {};
    const domains = (Array.isArray(cp.domains) && cp.domains.length) ? cp.domains.join(', ') : 'AI, machine learning, technology';
    const personalStyleGuides = {
      educational: 'Educational/Insight: Open with a surprising fact or bold statement, explain the concept in plain terms, give a concrete example or analogy, close with a key takeaway and question',
      story: 'Personal Story: Open with a vivid specific moment (not "I"), build the narrative arc, share the lesson learned, make it universally relatable',
      hottake: 'Hot Take: Open with a bold counter-intuitive claim, dismantle the common view with evidence, offer your alternative framework, invite respectful debate',
      tips: 'Quick Tips: Lead with the value proposition ("Here\'s how to…" or "X things I wish I knew"), 3-5 numbered points, each crisp and actionable, close with a "save this" or follow CTA',
    };
    styleGuide = personalStyleGuides[style] || personalStyleGuides.educational;
    systemContext = `You are an expert LinkedIn ghostwriter for tech thought leaders. Write in a direct, confident, and human voice — never corporate or generic.`;
    authorCtx = `Author expertise: ${domains}${cp.name ? ` (written as ${cp.name})` : ''}
Target audience: ${cp.audience || 'tech professionals and business leaders'}
Goal: ${cp.goal || 'build personal brand'}`;
    hashtagContext = `Mix of niche (#MachineLearning) and broad (#AI #Tech). No #LinkedIn, no generic tags like #Motivation.`;
  }

  const wordCount = mode === 'company' ? '200-320 words' : '150-280 words';

  const userPrompt = `${systemContext}

Write a LinkedIn post on:
Topic: ${topic}
Angle: ${angle || 'your best angle'}
Opening hook to build from: ${hook || 'craft the best hook'}
Style guide: ${styleGuide}
${authorCtx}

LinkedIn format rules:
- First line = scroll-stopper hook. No opener starting with "I" or "We". No emojis at the very start.
- Short paragraphs: 1-3 lines max. White space is your friend.
- Line breaks between every thought.
- Emojis: 0-2 max, only where genuinely impactful — never decorative.
- No hashtags in body.
- End with one sharp engagement question OR a compelling CTA.
- Word count: ${wordCount}.

Return ONLY valid JSON:
{
  "post": "Full post text (use \\n for line breaks between paragraphs)",
  "hashtags": ["hashtag1", "hashtag2", "hashtag3", "hashtag4", "hashtag5"],
  "imagePrompt": "Write a detailed photorealistic image prompt for this post. Describe a cinematic, real-world scene or abstract concept visualization — dramatic lighting, depth, atmosphere, professional color grading. NOT a cartoon, NOT an illustration, NOT flat design. No text overlay, no logos, no identifiable faces. Think high-end editorial photography meets concept art. The image must feel real and visually compelling, directly reflecting the post topic."
}

Hashtag rules: 5-7 tags. ${hashtagContext}`;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.78, messages: [{ role: 'user', content: userPrompt }] }),
  });
  if (!res.ok) {
    if (res.status === 401) throw new Error('INVALID_KEY');
    if (res.status === 429) throw new Error('RATE_LIMITED');
    if (res.status === 503) throw new Error('API_DOWN');
    const err = await res.json().catch(() => ({}));
    throw new Error(err?.error?.message || `OpenAI error ${res.status}`);
  }
  const data = await res.json();
  const raw = (data.choices[0]?.message?.content || '').trim();
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { post: raw, hashtags: [], imagePrompt: '' };
  }
}

// ─── Follow-Up ────────────────────────────────────────────────────────────────
// The single handler for both follow-up entry points (the messaging-page quick action and the
// profile-panel Follow-up tool) — takes contactName/senderName explicitly rather than inferring
// sender/recipient from a "RECIPIENT PROFILE" blob, which used to let the wrong page's scraped
// profile (e.g. the account owner's own) leak in as if it belonged to the contact.

export async function handleGenerateChatFollowup({ conversationText, isRaw, contactName, senderName, intent, userInstructions, stage, daysSinceLastTouch, analysis, contextMaterial }) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;
  const jobProfile = isJobSearch ? await getJobProfile() : null;
  const b2cPresets = isB2c ? await getB2cMessagePresets() : null;
  const jobPresets = isJobSearch ? await getJobMessagePresets() : null;

  let senderCtx = '';
  if (isJobSearch) {
    if (jobProfile && Object.keys(jobProfile).length) senderCtx = buildJobContext(jobProfile);
    senderCtx += `${senderCtx ? '\n\n' : ''}${buildStylePresetRules(jobPresets)}`;
  } else if (isB2c) {
    if (b2cProfile && Object.keys(b2cProfile).length) senderCtx = buildB2cContext(b2cProfile);
    senderCtx += `${senderCtx ? '\n\n' : ''}${buildStylePresetRules(b2cPresets)}`;
  } else if (cfg) {
    senderCtx = buildMessageStyle(cfg);
  }

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

LEAD_READ LINE: after the message (and after NEED_ID if present), add one more line starting with exactly "LEAD_READ: " giving an honest, one-sentence read on how this relationship is trending — based only on real signals in the thread: whether ${recipient} has replied at all, how they replied (short/dismissive vs. detailed/curious), any questions they asked back, any timeline or urgency they mentioned, and how many unanswered touches have gone out. Do not invent a percentage, a "likelihood to close," or any numeric score — you do not have the data to support one, and a fake number is worse than no number. Say it plainly, e.g. "Warm — they've asked a specific question and haven't gone quiet" or "Cooling — three touches out with no reply, worth one higher-value message or moving on." If ${recipient} hasn't sent anything yet, base the read purely on touch count and elapsed time, and say so plainly.

Return ONLY the message text, followed by the NEED_ID and LEAD_READ lines described above (and TIMING_NOTE if that rule applies). No quotes around the message, no other labels, no explanation.`;

  const withAnalysis = analysis ? `${systemPrompt}\n\n${buildAnalysisContext(analysis, intent)}` : systemPrompt;
  const withContext = withAnalysis + buildUserContextSection(contextMaterial);

  const finalPrompt = userInstructions?.trim()
    ? `${withContext}\n\nADDITIONAL INSTRUCTIONS FROM USER (follow exactly, even if it overrides the angle guidance above):\n${userInstructions.trim()}`
    : withContext;

  return { text: await callAI(finalPrompt, `CONVERSATION:\n${conversationText || '(no messages found)'}`) };
}

export async function handleGeneratePostImage(prompt) {
  const apiKey = await getApiKey();
  const fullPrompt = `Cinematic photorealistic concept photography for a professional LinkedIn post: ${prompt}. Style: high-end editorial photography, dramatic natural or studio lighting, shallow depth of field, rich realistic textures, professional color grading. Absolutely NO cartoons, NO vector illustrations, NO flat design, NO clip art. NO text overlay, NO logos, NO identifiable human faces. The image must look like a real photograph or a hyper-realistic render — visually striking, modern, and conceptually meaningful. 4K quality, ultra-detailed.`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'high',
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `Image generation error ${res.status}`);

  const b64 = data.data?.[0]?.b64_json;
  const url = data.data?.[0]?.url;
  if (b64) return { b64 };
  if (url) return { url };
  throw new Error('No image data returned from API');
}
