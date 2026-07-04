const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions';
const OPENAI_MODEL = 'gpt-4o-mini';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_PROFILE') {
    handleAnalyzeProfile(msg.profileData, msg.intent).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'GENERATE_CONNECTION_REQUEST') {
    handleGenerateConnectionRequest(msg.profileData, msg.intent, msg.userNotes).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'GENERATE_COLD_MESSAGE') {
    handleGenerateColdMessage(msg.profileData, msg.intent, msg.userNotes).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_PIPELINES') {
    fetchHubSpotPipelines().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_OWNERS') {
    fetchHubSpotOwners().then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'PUSH_TO_HUBSPOT') {
    pushHubSpotDeal(msg).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'OPEN_OPTIONS_PAGE') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg.type === 'GET_API_KEY_STATUS') {
    chrome.storage.local.get('openaiApiKey').then(result => {
      sendResponse({ hasKey: !!result.openaiApiKey });
    });
    return true;
  }
  if (msg.type === 'GET_HS_KEY_STATUS') {
    chrome.storage.local.get('hubspotApiKey').then(result => {
      sendResponse({ hasKey: !!result.hubspotApiKey });
    });
    return true;
  }
  if (msg.type === 'SUGGEST_POST_TOPICS') {
    handleSuggestPostTopics(msg.creatorProfile, msg.recentPosts, msg.mode, msg.companyProfile).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'GENERATE_POST') {
    handleGeneratePost(msg).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
  if (msg.type === 'GENERATE_POST_IMAGE') {
    handleGeneratePostImage(msg.prompt).then(sendResponse).catch(err => {
      sendResponse({ error: err.message });
    });
    return true;
  }
});

async function getApiKey() {
  const result = await chrome.storage.local.get('openaiApiKey');
  if (!result.openaiApiKey) throw new Error('NO_API_KEY');
  return result.openaiApiKey;
}

// ─── Sales / ICP config ───────────────────────────────────────────────────────
const DEFAULT_EXCLUDES = ['Tech service providers', 'IT outsourcing / staffing', 'Digital / marketing agencies'];

async function getSalesConfig() {
  const r = await chrome.storage.local.get(['targetIndustries', 'excludeIndustries', 'businessProfile', 'messagePresets']);
  return {
    targets: Array.isArray(r.targetIndustries) ? r.targetIndustries : [],
    excludes: Array.isArray(r.excludeIndustries) ? r.excludeIndustries : DEFAULT_EXCLUDES,
    business: r.businessProfile || {},
    presets: r.messagePresets || {},
  };
}

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

async function getB2cProfile() {
  const r = await chrome.storage.local.get('b2cProfile');
  return r.b2cProfile || {};
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

async function getJobProfile() {
  const r = await chrome.storage.local.get('jobProfile');
  return r.jobProfile || {};
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
      max_tokens: 1500,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err?.error?.message || `API error ${response.status}`);
  }

  const data = await response.json();
  return (data.choices[0].message.content || '').trim();
}

async function handleAnalyzeProfile(profileData, intent) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch) ? await getSalesConfig() : null;
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
  ]
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
  "approachAngle": "The most compelling angle to reach out as an individual expert — specific to their situation, not generic"
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

${buildIcpContext(cfg, 'b2c')}
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
  ]
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
  if (!jsonMatch) throw new Error('Invalid AI response — could not parse JSON');
  return JSON.parse(jsonMatch[0]);
}

async function handleGenerateConnectionRequest(profileData, intent, userNotes) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;
  const jobProfile = isJobSearch ? await getJobProfile() : null;

  let systemPrompt;

  if (isJobSearch) {
    systemPrompt = `You write LinkedIn connection requests for a job seeker. Write like a real person, not a cover letter.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. If there is nothing specific to reference about their current role, write a warm, natural message using just their name, current title, and company. Always produce a message — never refuse or ask for clarification.

Rules:
- Hard limit: 200 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No corporate speak, no buzzwords
- Show genuine interest in their company or work — not desperation
- No mention of "looking for opportunities" or "open to work"
- Sound like a curious professional, not an applicant
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis

Return ONLY the connection request text. Nothing else. No quotes around it.`;

    const jobCtx = buildJobContext(jobProfile);
    if (jobCtx) systemPrompt += `\n\n${jobCtx}`;

  } else if (isB2c) {
    systemPrompt = `You write LinkedIn connection requests for an individual freelancer or consultant reaching out to a potential client. You are positioning the sender as a peer and fellow professional, not as a vendor.

PRIORITY RULE: Base the message on their CURRENT role, company, or recent activity. Never reference posts from a previous employer. If nothing specific is available, write a warm human message using their current title and company. Always produce a message — never refuse.

Rules:
- Hard limit: 200 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No selling, no pitching, no mention of services or offers
- Sound like one professional reaching out to another — collegial, not promotional
- Reference something specific about their work, company, or background if possible
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis
- Never mention "freelance", "hire me", or any engagement offer

Return ONLY the connection request text. Nothing else. No quotes around it.`;

    if (b2cProfile && Object.keys(b2cProfile).length) {
      systemPrompt += `\n\n--- YOUR PROFILE (sender context, for tone calibration only) ---\n${buildB2cContext(b2cProfile)}`;
    }

  } else {
    systemPrompt = `You write LinkedIn connection requests. Write like a real person, not a marketer.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. If there is nothing specific to reference about their current role, write a warm, natural message using just their current title and company. Always produce a message — never refuse or ask for clarification.

Rules:
- Hard limit: 200 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No corporate speak, no buzzwords
- No selling, no pitching, no mention of your own work
- Sound like a genuine human reaching out
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis

Return ONLY the connection request text. Nothing else. No quotes around it.`;

    if (cfg) systemPrompt += `\n\n--- MESSAGE STYLE & SENDER CONTEXT ---\n${buildMessageStyle(cfg)}`;
  }

  const userPrompt = buildProfileText(profileData, userNotes);
  return { text: await callAI(systemPrompt, userPrompt) };
}

async function handleGenerateColdMessage(profileData, intent, userNotes) {
  const isJobSearch = intent === 'job_search';
  const isB2c = intent === 'b2c_sales';
  const cfg = (!isJobSearch && !isB2c) ? await getSalesConfig() : null;
  const b2cProfile = isB2c ? await getB2cProfile() : null;
  const jobProfile = isJobSearch ? await getJobProfile() : null;

  let systemPrompt;

  if (isJobSearch) {
    systemPrompt = `You write first LinkedIn direct messages for a job seeker reaching out to someone they are already connected with.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. If there is nothing specific to reference, write a warm natural opener using their current title and company. Always produce a message — never refuse or ask for clarification.

Rules:
- Max 300 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No corporate speak, no buzzwords
- Do NOT say you are looking for a job, open to work, or mention opportunities
- Ask a simple, natural question that invites a reply — can be about their current role or transition
- Sound curious and human, not templated
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis

Return ONLY the message text. Nothing else. No quotes around it.`;

    const jobCtx = buildJobContext(jobProfile);
    if (jobCtx) systemPrompt += `\n\n${jobCtx}`;

  } else if (isB2c) {
    systemPrompt = `You write first LinkedIn direct messages for a freelancer or independent consultant reaching out to a potential client they are already connected with. You are positioning the sender as a trusted individual expert — knowledgeable, direct, and worth a conversation.

PRIORITY RULE: Base the message on their CURRENT role, challenges, or recent posts. Only reference posts clearly tied to their current job. If nothing specific is available, write a warm opener using their current title and company. Always produce a message — never refuse.

Rules:
- Max 300 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No buzzwords, no SDR templates, no hard pitch
- Acknowledge something specific about their situation — a challenge, a recent post, a company initiative
- End with a single soft, conversational question that invites a reply (not a meeting request)
- Sound like a trusted peer, not a vendor
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis
- Never say "freelance", "hire me", "my services", "I can help you with", or anything transactional

Return ONLY the message text. Nothing else. No quotes around it.`;

    if (b2cProfile && Object.keys(b2cProfile).length) {
      systemPrompt += `\n\n--- YOUR PROFILE (for context and tone calibration) ---\n${buildB2cContext(b2cProfile)}`;
    }

  } else {
    systemPrompt = `You write first LinkedIn direct messages for a B2B sales professional reaching out to a connection.

PRIORITY RULE: Base the message on their CURRENT role if possible. Only reference posts if they clearly relate to their current job — never reference posts from a previous employer. If there is nothing specific to reference, write a warm natural opener using their current title and company. Always produce a message — never refuse or ask for clarification.

Rules:
- Max 300 characters total (count carefully)
- Zero em dashes, zero hyphens used as dashes
- No corporate speak, no buzzwords, no pitching
- The goal is to start a genuine conversation, not sell anything
- One clear, natural question that invites a reply — can be as simple as asking about their current work
- Sound like a real person, not an SDR template
- Do not start with "Hi [Name]" or "Hey [Name]"
- No emojis

Return ONLY the message text. Nothing else. No quotes around it.`;

    if (cfg) systemPrompt += `\n\n--- MESSAGE STYLE & SENDER CONTEXT ---\n${buildMessageStyle(cfg)}`;
  }

  const userPrompt = buildProfileText(profileData, userNotes);
  return { text: await callAI(systemPrompt, userPrompt) };
}

async function getHubSpotKey() {
  const result = await chrome.storage.local.get('hubspotApiKey');
  if (!result.hubspotApiKey) throw new Error('NO_HUBSPOT_KEY');
  return result.hubspotApiKey;
}

async function hubspotFetch(path, options = {}) {
  const token = await getHubSpotKey();
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || `HubSpot API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchHubSpotPipelines() {
  const data = await hubspotFetch('/crm/v3/pipelines/deal');
  return (data.results || []).map(p => ({
    id: p.id,
    label: p.label,
    stages: (p.stages || [])
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(s => ({ id: s.id, label: s.label })),
  }));
}

async function fetchHubSpotOwners() {
  const data = await hubspotFetch('/crm/v3/owners?limit=100');
  return (data.results || []).map(o => ({
    id: o.id,
    label: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
  }));
}

async function pushHubSpotDeal({ name, linkedinUrl, contactText, remarks, pipelineId, stageId, ownerId }) {
  const dealName = name || 'LinkedIn Lead';

  // 1. Create deal
  const deal = await hubspotFetch('/crm/v3/objects/deals', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        dealname: dealName,
        pipeline: pipelineId,
        dealstage: stageId,
        ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
      },
    }),
  });

  // 2. Build note body
  const noteParts = [];
  if (remarks && remarks.trim()) noteParts.push(remarks.trim());
  noteParts.push(`LinkedIn: ${linkedinUrl}`);
  if (contactText) noteParts.push(`Connection Request:\n${contactText}`);

  // 3. Create note
  const note = await hubspotFetch('/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        hs_note_body: noteParts.join('\n\n'),
        hs_timestamp: Date.now().toString(),
      },
    }),
  });

  // 4. Associate note with deal
  await hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/deal/${deal.id}`, {
    method: 'PUT',
  });

  return { success: true };
}

function buildProfileText(p, userNotes) {
  const lines = [];

  if (p.name) lines.push(`Name: ${p.name}`);
  if (p.headline) lines.push(`Headline: ${p.headline}`);
  if (p.location) lines.push(`Location: ${p.location}`);
  if (p.connections) lines.push(`Connections: ${p.connections}`);
  if (p.followers) lines.push(`Followers: ${p.followers}`);

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

// ─── Post Creator ─────────────────────────────────────────────────────────────

async function handleSuggestPostTopics(creatorProfile, recentPosts = [], mode = 'personal', companyProfile = null) {
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
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);

  const raw = (data.choices[0]?.message?.content || '').trim();
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { topics: [] };
  }
}

async function handleGeneratePost({ topic, angle, hook, style, creatorProfile, mode, companyProfile }) {
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
  "imagePrompt": "Detailed image generation prompt for a professional LinkedIn-appropriate illustration reinforcing the post theme. No text, no logos, no people's faces. Clean, modern style."
}

Hashtag rules: 5-7 tags. ${hashtagContext}`;

  const res = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({ model: OPENAI_MODEL, temperature: 0.78, messages: [{ role: 'user', content: userPrompt }] }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `OpenAI error ${res.status}`);

  const raw = (data.choices[0]?.message?.content || '').trim();
  try { return JSON.parse(raw); } catch {
    const m = raw.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : { post: raw, hashtags: [], imagePrompt: '' };
  }
}

async function handleGeneratePostImage(prompt) {
  const apiKey = await getApiKey();
  const fullPrompt = `Professional LinkedIn post illustration: ${prompt}. Style: clean modern flat illustration, corporate yet warm color palette, no text overlay, no logos, high visual quality.`;

  const res = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: fullPrompt,
      n: 1,
      size: '1024x1024',
      quality: 'medium',
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
