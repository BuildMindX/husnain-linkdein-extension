// How LinkPilot's messages should read, and the checks that keep them that way.
//
// Built from three research passes (Nov 2026), summarised in MD/messaging_playbook.md:
//  - Reply data (Expandi H2 2026 LinkedIn study, LinkedIn InMail data, Lavender, Gong): short wins
//    (first DM 2-4 sentences, under ~400 chars), at most one question, no pitch, interest-based ask
//    when cold and a specific time once they're engaged; follow-ups bring most replies but must add
//    something new; three messages total is the sweet spot.
//  - AI-text research (Wikipedia "Signs of AI writing", Kobak 2025, Reinhart 2025, Graphite's
//    Opus 5.5 study): readers can't reliably detect AI, but once they suspect it they judge the
//    sender harshly, and suspicion comes from stacked tells. Ban lists alone make the model swap one
//    tell for another, so this pairs a positive voice spec + real-shaped examples with a code check.
//  - Live samples from this product read as AI because the old prompts were long "never" lists
//    with no examples, forced every message to end in a question and banned "Hi <name>," — which
//    produced one formula: a clever, quotable observation + credential clause + question.

// ─── Voice ────────────────────────────────────────────────────────────────────
export const HUMAN_VOICE = `HOW IT MUST READ: like a busy professional typing a LinkedIn message on their phone. Not like a copywriter, a consultant, or an assistant.
- Plain, everyday words a 12-year-old would know. Short sentences, some very short. Uneven: don't give every sentence the same length or shape.
- Say the actual thing. No setup line, no clever one-liner, no quotable "insight", no aphorism, no wordplay, no "X never does this, Y always does" lines.
- Contractions, "I", "you", "we". Starting with "And" or "But" is fine. A fragment is fine. Repeat a word rather than swapping in a synonym.
- Mention facts the way a person does: "saw you're hiring two ML engineers", not "I noticed your company is scaling its engineering capacity".
- No compliments, no praise of their post or career, no enthusiasm words, no flattery.
- No abstract framing of why you're writing ("I'm reaching out because", "I wanted to share"). Just say it.
- One idea. One ask at most, and it can be a plain statement instead of a question.
- Don't perform casualness either: no slang (ngl, tbh), no fake typos, no emoji, no "not a pitch", no "honestly". That reads fake too.
- Punctuation: periods, commas, question marks and apostrophes only. No dashes used as punctuation, no colons, no semicolons, no exclamation marks, no ellipses, no lists, no bold.
- No sign-off and no name at the end.`;

// Words and shapes that make readers suspect AI. The prompt names them; findAiTells enforces them.
export const AI_TELLS_PROMPT = `NEVER USE (each one makes readers suspect a bot):
- Words: delve, tapestry, testament, pivotal, underscore, showcase, intricate, meticulous, landscape, realm, robust, seamless, leverage, elevate, unlock, empower, streamline, synergy, game-changer, cutting-edge, navigate, foster, dependable, thoughtful, meaningful, genuinely, remarkable, deeply, fundamentally, quietly, resonate, insightful, fascinating, impressive, inspiring, journey, passionate.
- Phrases: "this matters", "why it matters", "rather than", "not just", "not only", "more than a", "it's not X, it's Y", "adds another layer", "looking ahead", "in practice", "curious", "I noticed", "I came across", "caught my eye", "stood out", "hit home", "got me thinking", "stuck with me", "struck me", "would love to", "I'd love to", "pick your brain", "quick question", "reaching out", "touch base", "circle back", "just checking in", "following up", "bumping this", "hope you're well", "hope this finds you", "feel free", "no pressure", "let me know your thoughts", "looking forward to", "excited to", "like-minded", "value", "pain point", "game changer", "in today's".
- Shapes: a trailing "-ing" clause ("..., highlighting your focus on X"), a colon reveal ("One thing stood out: X"), a question you answer yourself ("The result? X."), groups of three ("faster, safer and cheaper"), "from X to Y" ranges, two questions in one message.`;

// ─── Examples (shape and tone only) ───────────────────────────────────────────
// Invented companies and numbers. The prompt tells the model never to reuse their facts or words.
const EXAMPLES = {
  connection: {
    b2b_sales: [
      'Hi Sara, saw Lumen is hiring ML engineers after the seed round. I run a small AI dev studio and we build for edtech teams around that stage. Would be good to connect.',
      'Hi Omar, your post about audit logs eating sprint time. We hit the same wall on a telehealth build last year. Happy to connect.',
      'Hi Dev, I build AI and web products for fintech startups with a small team in Lahore. Following what you’re doing with the lending API. Glad to connect.',
    ],
    b2c_sales: [
      'Hi Priya, saw the senior AI engineer opening on your team. I’ve shipped RAG systems in production for two fintech products. Would like to be on your radar.',
      'Hi Ben, tried Tutorly’s AI tutor last week. I’m a full-stack and AI engineer and I do contract builds for edtech teams. Glad to connect either way.',
      'Hi Lena, I see you hire for AI roles at health startups. Senior AI and full-stack engineer here, open to contract or full-time. Worth connecting?',
    ],
  },
  first: {
    b2b_sales: [
      'Thanks for connecting, Sara. Two ML hires right after a seed usually means the roadmap grew faster than the team. Some teams hand us one contained piece, like an eval setup or an internal tool, so the new people stay on the core product. Is that something you’re weighing, or all in-house for now?',
      'Hi Omar, on the audit log thing. On our telehealth build we moved logging to an event table with a nightly export and it went from a sprint of work to about a day per release. Happy to send the schema if it’s useful.',
      'Hi Dev, saw the lending API went live. I run a small studio that builds AI features for fintech teams, mostly document checks and support agents. If that’s on the list for next quarter I’d be glad to compare notes.',
    ],
    b2c_sales: [
      'Hi Ben, I tried Tutorly’s tutor. The answers are good but the first reply takes about 6 seconds on my phone, which usually means streaming is off. I fix this kind of thing on contract. Want me to send a short note on what I’d check first?',
      'Thanks Lena. Short version so you can tell if I fit anything. Senior AI and full-stack engineer, 6 years, Python and TypeScript, LLM apps in production, remote, open to contract or full-time. Working on anything like that?',
      'Hi Priya, I applied for the senior AI role this week. Most relevant bit is a RAG search I built over 40k policy documents for a fintech, it handles about 2k queries a day now. Is the team more focused on retrieval or agents right now?',
    ],
  },
};

export function examplesBlock(kind, mode) {
  const list = EXAMPLES[kind]?.[mode];
  if (!list) return '';
  return `EXAMPLES OF THE VOICE (invented people and numbers; they show tone, length and shape only. Never reuse their facts, wording, openings or structure word for word, and never copy their numbers):\n${list.map(t => `- ${t}`).join('\n')}`;
}

// ─── Follow-up playbook ───────────────────────────────────────────────────────
export const FOLLOWUP_HISTORY_RULES = `READ THE WHOLE THREAD FIRST. Each message is labeled with who sent it and, when known, when.
1. Work out the state: who sent the last message, how long ago, and whether they asked anything that hasn't been answered. If the last message is theirs, this is a REPLY to them: answer what they said or asked first, in the first line.
2. Pull out what's already known (their stack, team, timeline, problems, names, any date they gave like "ping me in January") and use it. A date they gave is the reason for this message, say so plainly.
3. Never repeat: no question they already answered, no proof point or example already used, no restating an earlier message. This message must add one thing the thread doesn't have yet.
4. Mirror them: keep length within about 1 to 1.5 times their last message, and match their formality, greeting style and use of first names. A one-line reply gets one or two lines back.
5. Gaps: under a week, just continue. One to four weeks, a light nod to the gap is optional. Over a month, re-anchor with the earlier topic in a few words ("when we talked about the quiz engine in March") plus something new. Never apologise for the gap and never blame them for it ("never heard back").
6. A clear no, "not interested" twice, or "please stop" means write a short, gracious close and nothing else.`;

export const FOLLOWUP_PLAYBOOK = `PICK THE ONE SITUATION THAT FITS, then follow it.
A. No reply yet, 1st follow-up (about 4-7 days after the first message): a new angle on the same topic, one specific observation, a short real proof point, or a sharper question. This is the most important follow-up.
B. No reply yet, 2nd follow-up (about 10-14 days): offer one small useful thing and ask if they want it ("want it?", "should I send it over?").
C. No reply yet, final (about 3-4 weeks): say you'll leave it there, then one question that's easy to answer with a no ("is X off the roadmap for this year?"). No guilt, no "last chance".
D. Connected but they never replied to anything: one specific reason to talk now from their profile or activity, and one easy question. Never just "thanks for connecting".
E. They replied with interest ("sounds interesting", "tell me more", asks how it works): answer in a line, then propose a short call with two loose options ("Thursday or Friday afternoon your time?") and say in a few words what the call is for. No deck, no link dump, no long recap.
F. They asked a question: answer it directly in the first line, add at most one line of context, then one question that moves things forward. If the honest answer depends on their situation (price, timeline, scope), give a range or a straight yes or no and suggest 15 minutes to get it right. This one can run longer.
G. "Not now" or "next quarter": accept it, ask what changes then so you get the timing right, or ask if it's okay to check back then.
H. "No budget": agree, ask whether it's a freeze or waiting for the next budget cycle, and mention a smaller first step if one fits.
I. "We have a team" or "we do it in-house": agree, ask how it's going on the specific hard part, and mention you can take one contained piece if that's ever useful.
J. "Already using someone": that's normal, ask how happy they are with it, position as an extra pair of hands, not a replacement.
K. "Send me info": say you will, and ask one question so you send the right thing, not a generic deck.
L. "Not interested": thank them, and ask once whether it's not a priority or already covered. If they say no again, close politely.
M. "Talk to X" or wrong person: thank them, ask if it's okay to mention their name to X, or offer two lines they can forward.
N. Went quiet after a good exchange: re-anchor in a few words with what you talked about, add something new (their news, or yours), and ask if it's still on their list.
O. After a call: thank them, three of their points in their words, what you'll send and when, and one dated next step.
P. Job or contract (B2C): after applying, restate the role and one piece of fit evidence (never just "any update?"); after an interview, thank them and add one useful thought on the problem they described; if the role was filled, be gracious, offer contract help if it fits, and ask to stay in touch.
Moving toward a call: when cold, ask about interest; once they've described a problem, a small low-pressure call ("would it be crazy to do 15 minutes on it?"); once they're asking about price, timing or availability, offer specific times.`;

// ─── Checks ───────────────────────────────────────────────────────────────────
const TELL_PHRASES = [
  'delve', 'tapestry', 'testament', 'pivotal', 'underscore', 'showcas', 'intricate', 'meticulous', 'landscape', ' realm', 'robust', 'seamless',
  'leverage', 'elevate', 'unlock', 'empower', 'streamline', 'synerg', 'game-changer', 'game changer', 'cutting-edge', 'cutting edge', 'navigate',
  'foster', 'dependable', 'thoughtful', 'meaningful', 'genuinely', 'remarkabl', 'deeply', 'fundamentally', 'quietly', 'resonat', 'insightful',
  'fascinating', 'impressive', 'inspiring', 'passionate', 'this matters', 'why it matters', 'matters most', 'rather than', 'not just', 'not only',
  'adds another layer', 'looking ahead', 'in practice', 'curious', 'i noticed', 'i came across', 'caught my eye', 'stood out',
  'hit home', 'got me thinking', 'stuck with me', 'struck me', 'would love to', "i'd love to", 'pick your brain', 'quick question', 'reaching out',
  'touch base', 'circle back', 'just checking in', 'following up', 'bumping this', "hope you're", 'hope you are', 'hope this finds', 'hope all is well',
  'feel free', 'no pressure', 'let me know your thoughts', 'looking forward to', 'excited to', 'thrilled', 'like-minded', 'value proposition',
  'pain point', "in today's", 'fast-paced', 'ever-evolving', "it's worth noting", "it's important to note", "here's the thing", 'the kicker',
  'not gonna lie', 'ngl', 'tbh', 'real talk', 'not a pitch', 'speaks volumes', 'says a lot about', 'a lot of moving parts', 'right in my lane',
  'familiar ground', 'great insights', 'love this', 'amazing',
];

const TELL_PATTERNS = [
  [/[—–]/, 'a dash used as punctuation'],
  [/\s-\s/, 'a hyphen used as a dash'],
  [/!/, 'an exclamation mark'],
  [/;/, 'a semicolon'],
  [/…|\.\.\./, 'an ellipsis'],
  [/:(?!\d)/, 'a colon'],
  [/\p{Extended_Pictographic}/u, 'an emoji'],
  [/\*\*|^#|^\s*[-*•]\s/m, 'markdown or a list'],
  [/\b(it'?s|this is|that'?s|that was)\s+not\b[^.?]{1,70}[,.]\s*(it'?s|this is|that'?s)\b/i, 'an "it\'s not X, it\'s Y" contrast'],
  [/\bnever\b[^.?]{2,80},\s*[^.?]{1,50}\balways\b/i, 'a "X never..., Y always..." line'],
  [/(^|[.?]\s+)not\s+[^.?]{1,40}\.\s*not\s+/i, 'a "Not X. Not Y." pattern'],
  [/,\s+(highlighting|showcasing|underscoring|reflecting|emphasizing|signaling|signalling|demonstrating|making it clear)\b/i, 'a trailing "-ing" clause'],
  [/\b\w+\?\s+(it'?s|the answer|simple|turns out)\b/i, 'a question answered by itself'],
];

export function findAiTells(text, { maxQuestions = 1 } = {}) {
  const t = String(text || '');
  const lower = t.toLowerCase().replace(/[’‘]/g, "'");
  const found = [];
  for (const p of TELL_PHRASES) {
    const re = new RegExp(`(^|[^a-z])${p.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'i');
    if (re.test(lower)) found.push(`"${p.trim()}"`);
  }
  for (const [re, label] of TELL_PATTERNS) if (re.test(t)) found.push(label);
  const questions = (t.match(/\?/g) || []).length;
  if (maxQuestions !== null && questions > maxQuestions) found.push(`${questions} questions (one at most)`);
  return found;
}

// Last-resort cleanup after the one rewrite: punctuation only, never words.
export function cleanPunctuation(text) {
  return String(text || '')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/\s+-\s+/g, ', ')
    .replace(/…|\.\.\./g, '.')
    .replace(/!+/g, '.')
    .replace(/;\s*/g, '. ')
    .replace(/\p{Extended_Pictographic}️?/gu, '')
    .replace(/[“”]/g, '"').replace(/[‘’]/g, "'")
    .replace(/,\s*,/g, ',').replace(/\.\s*\./g, '.').replace(/ {2,}/g, ' ')
    .replace(/,\s*([.?])/g, '$1')
    .trim();
}

// ─── Opening variety across the rep's outbox ─────────────────────────────────
// Every message is fine on its own; twenty that open "Saw your post on" are a template.
const OPENERS_KEY = 'recentOpeners';
const openerOf = text => String(text || '').replace(/^(hi|hey|hello|thanks|thank you)[^,.]*[,.]\s*/i, '').split(/\s+/).slice(0, 5).join(' ');

export async function recentOpenersNote() {
  try {
    const { [OPENERS_KEY]: list } = await chrome.storage.local.get(OPENERS_KEY);
    const recent = (Array.isArray(list) ? list : []).slice(0, 10);
    return recent.length
      ? `\n\nRECENT OPENINGS FROM THIS SENDER (start differently from all of these):\n${recent.map(o => `- "${o}..."`).join('\n')}`
      : '';
  } catch (_) { return ''; }
}

export async function rememberOpener(text) {
  try {
    const o = openerOf(text);
    if (!o) return;
    const { [OPENERS_KEY]: list } = await chrome.storage.local.get(OPENERS_KEY);
    const next = [o, ...(Array.isArray(list) ? list : []).filter(x => x !== o)].slice(0, 20);
    await chrome.storage.local.set({ [OPENERS_KEY]: next });
  } catch (_) { /* best effort */ }
}
