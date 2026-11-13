// Shared settings schema: the two outreach modes, the option lists behind every dropdown/chip
// group in Settings, the shape of a saved B2C/B2B profile, and the one-time migration from the
// old three-mode (B2B / Freelance / Job Search) free-text setup.
//
// Classic script that sets a global (like shared/taxonomy.js), so the same code runs in the
// options page, the content script and the background service worker. Requires LP_TAXONOMY.
(function () {
  const T = globalThis.LP_TAXONOMY;

  // ── Modes ────────────────────────────────────────────────────────────────────
  // Two modes only. Internal ids are kept from the old schema so saved contacts, cached analyses
  // and cloud backups stay readable; 'job_search' is folded into B2C by migrate().
  const MODES = {
    b2c_sales: { label: 'B2C', long: 'B2C — you, finding work', sub: 'Jobs, projects and teams that need your skills' },
    b2b_sales: { label: 'B2B', long: 'B2B — your company, finding clients', sub: 'Companies that buy what your business sells' },
  };
  const DEFAULT_INTENT = 'b2c_sales';
  // Anything that isn't explicitly B2B is B2C — including legacy 'job_search', a missing value, or
  // garbage from an old cloud backup. One rule, used everywhere, so no surface can disagree.
  const normalizeIntent = intent => (intent === 'b2b_sales' ? 'b2b_sales' : 'b2c_sales');

  // ── Option lists (labels are user-facing; ids are stored) ────────────────────
  const OPTIONS = {
    workTypes: [
      { id: 'full_time', label: 'Full-time job' },
      { id: 'contract', label: 'Contract' },
      { id: 'freelance', label: 'Freelance projects' },
      { id: 'part_time', label: 'Part-time' },
      { id: 'cofounder', label: 'Co-founder / founding team' },
      { id: 'advisory', label: 'Advisory / fractional' },
      { id: 'internship', label: 'Internship' },
    ],
    experience: [
      { id: 'student', label: 'Student / intern' },
      { id: 'entry', label: 'Entry level (0–2 yrs)' },
      { id: 'mid', label: 'Mid level (3–5 yrs)' },
      { id: 'senior', label: 'Senior (6–9 yrs)' },
      { id: 'lead', label: 'Lead / principal (10+ yrs)' },
      { id: 'manager', label: 'Manager' },
      { id: 'director', label: 'Director / head of' },
      { id: 'executive', label: 'Executive / C-level' },
    ],
    workplace: [
      { id: 'remote', label: 'Remote' },
      { id: 'hybrid', label: 'Hybrid' },
      { id: 'onsite', label: 'On-site' },
    ],
    availability: [
      { id: 'now', label: 'Available now — actively looking' },
      { id: 'soon', label: 'Available within a month' },
      { id: 'open', label: 'Open to the right thing — casually looking' },
    ],
    hirerTypes: [
      { id: 'founders', label: 'Founders & CEOs' },
      { id: 'hiring_managers', label: 'Hiring managers in my field' },
      { id: 'tech_leaders', label: 'CTOs & engineering leaders' },
      { id: 'dept_heads', label: 'Department heads & VPs' },
      { id: 'recruiters', label: 'Recruiters & talent acquisition' },
      { id: 'agency_owners', label: 'Agency owners (subcontract / white-label)' },
      { id: 'product_leads', label: 'Product & project leads' },
    ],
    offerTypes: [
      { id: 'saas', label: 'Software / SaaS product' },
      { id: 'agency', label: 'Agency (done-for-you services)' },
      { id: 'dev_services', label: 'Software development services' },
      { id: 'consulting', label: 'Consulting / advisory' },
      { id: 'staffing', label: 'Staffing / outsourcing' },
      { id: 'training', label: 'Training / coaching' },
      { id: 'physical', label: 'Physical product' },
      { id: 'other', label: 'Other' },
    ],
    problems: [
      { id: 'pipeline', label: 'Not enough qualified pipeline' },
      { id: 'manual_work', label: 'Manual, slow processes' },
      { id: 'costs', label: 'Costs too high' },
      { id: 'hiring', label: "Can't hire fast enough" },
      { id: 'churn', label: 'Customer churn' },
      { id: 'conversion', label: 'Low website / funnel conversion' },
      { id: 'tech_debt', label: 'Legacy tech / tech debt' },
      { id: 'ai_adoption', label: 'Struggling to adopt AI' },
      { id: 'reliability', label: 'Product reliability / quality issues' },
      { id: 'security', label: 'Security / compliance risk' },
      { id: 'visibility', label: 'No reporting visibility' },
      { id: 'scaling', label: "Can't scale delivery" },
    ],
    outcomes: [
      { id: 'revenue', label: 'More revenue' },
      { id: 'cost', label: 'Lower cost' },
      { id: 'time', label: 'Time saved' },
      { id: 'risk', label: 'Less risk' },
      { id: 'speed', label: 'Faster launch' },
      { id: 'cx', label: 'Better customer experience' },
    ],
    // Only signals the extension (or the model reading a profile) can actually see — buyer intent,
    // "viewed your profile" etc. live inside Sales Navigator and would only invite guessing.
    b2bSignals: [
      { id: 'new_role', label: 'New in role (last 90 days)' },
      { id: 'posting', label: 'Posted recently' },
      { id: 'hiring', label: 'Company is hiring for related roles' },
      { id: 'funding', label: 'Company recently raised funding' },
      { id: 'growing', label: 'Company is growing' },
      { id: 'pain_post', label: 'Posted about a problem I solve' },
    ],
    b2cSignals: [
      { id: 'hiring', label: 'Hiring or posted an open role' },
      { id: 'needs_help', label: 'Posted about needing help' },
      { id: 'new_role', label: 'New in role (last 90 days)' },
      { id: 'funding', label: 'Company recently raised funding' },
      { id: 'growing', label: 'Company is growing' },
      { id: 'posting', label: 'Active on LinkedIn' },
    ],
    endings: {
      b2b_sales: [
        { id: 'ask_relevant', label: 'Ask if it’s relevant (recommended)' },
        { id: 'offer_value', label: 'Offer something useful' },
        { id: 'ask_right_person', label: 'Ask who the right person is' },
        { id: 'suggest_call', label: 'Suggest a short call' },
        { id: 'no_ask', label: 'No ask — just start a conversation' },
      ],
      b2c_sales: [
        { id: 'ask_relevant', label: 'Ask if they’re hiring or need help (recommended)' },
        { id: 'offer_value', label: 'Offer a quick idea or sample' },
        { id: 'ask_right_person', label: 'Ask who the right person is' },
        { id: 'suggest_call', label: 'Suggest a short call' },
        { id: 'no_ask', label: 'No ask — just start a conversation' },
      ],
    },
    tones: [
      { id: 'warm', label: 'Warm' },
      { id: 'direct', label: 'Direct' },
      { id: 'casual', label: 'Casual' },
      { id: 'professional', label: 'Professional' },
    ],
    // Post Creator. Pillars keep topics varied but on-brand (3–5 is common practice).
    postPillars: {
      personal: [
        { id: 'lessons', label: 'Lessons from my work' },
        { id: 'howto', label: 'How-to and playbooks' },
        { id: 'deep_dive', label: 'Skill deep-dives' },
        { id: 'showcase', label: 'Work showcases' },
        { id: 'opinions', label: 'Opinions and hot takes' },
        { id: 'industry', label: 'Industry commentary' },
        { id: 'journey', label: 'Career journey' },
        { id: 'building', label: 'Building in public' },
      ],
      company: [
        { id: 'trends', label: 'Industry trends' },
        { id: 'playbooks', label: 'How-to and playbooks' },
        { id: 'results', label: 'Client results' },
        { id: 'behind_scenes', label: 'Behind the scenes' },
        { id: 'opinions', label: 'Opinions and hot takes' },
        { id: 'explainers', label: 'Explaining what we do' },
        { id: 'team', label: 'Team and hiring' },
        { id: 'announcements', label: 'Announcements' },
      ],
    },
    postEndings: [
      { id: 'question', label: 'A question for comments (recommended)' },
      { id: 'dm', label: 'Invite people to message me' },
      { id: 'follow', label: 'Ask people to follow for more' },
      { id: 'none', label: 'No call to action' },
    ],
    excludeCompanyTypes: [
      { id: 'staffing_agencies', label: 'Staffing & recruiting agencies' },
      { id: 'outsourcing_firms', label: 'Outsourcing / offshoring firms' },
      { id: 'same_service', label: 'Companies offering the same service as me' },
      { id: 'government_agency', label: 'Government agencies' },
      { id: 'non_profit', label: 'Nonprofits' },
      { id: 'educational_institution', label: 'Educational institutions' },
      { id: 'self_employed', label: 'Solo freelancers / self-employed' },
      { id: 'enterprise', label: 'Large enterprises (10,000+)' },
    ],
  };

  const BLANK_PROOFS = () => ['', '', ''];
  const optLabelOf = (list, id) => (list.find(o => o.id === id) || {}).label || '';

  function emptyIcp() {
    return {
      industries: [], customIndustries: [],         // targets: "group" or "group/sub" keys + free-text niches
      excludeIndustries: [], customExcludes: [],
      regions: [], countries: [],
      headcount: [], seniority: [], functions: [], titles: [],
      hirerTypes: [], signals: [],
      excludeCompanyTypes: [], excludeRoles: [], excludeCompanies: [],
      idealCustomer: '',                             // optional "in your own words" description
    };
  }

  function emptyB2cProfile(name = 'Default') {
    return {
      id: `b2c-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      icp: emptyIcp(),
      seeking: { workTypes: [], roles: [], level: '', workplace: [], availability: '' },
      pitch: {
        senderName: '', currentTitle: '', oneLiner: '', skills: [], services: '',
        proofPoints: BLANK_PROOFS(), uniqueAngle: '', portfolio: '', background: '', location: '', rate: '', represents: '', notes: '',
      },
    };
  }

  function emptyB2bProfile(name = 'Default') {
    return {
      id: `icp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      icp: emptyIcp(),
      businessProfile: {
        senderName: '', senderRole: '', companyName: '', offerType: '', offer: '', problems: [], problem: '',
        outcome: '', proofPoints: BLANK_PROOFS(), valueProp: '', expertise: '', serviceMap: '', trust: '', pricing: '', notes: '',
      },
      // Legacy flat arrays, kept only so older code paths and v1 team codes stay readable.
      targetIndustries: [], excludeIndustries: [],
    };
  }

  // ── Industry lookups ─────────────────────────────────────────────────────────
  const GROUP_BY_ID = Object.fromEntries(T.industries.map(g => [g.id, g]));
  function industryLabel(key) {
    const [gid, sid] = String(key).split('/');
    const g = GROUP_BY_ID[gid];
    if (!g) return null;
    if (!sid) return g.label;
    const s = g.sub.find(x => x.id === sid);
    return s ? `${g.label} › ${s.label}` : null;
  }
  const isValidIndustryKey = key => industryLabel(key) !== null;

  // Free-text → taxonomy key, for migrating old typed industries. Exact (case-insensitive) matches
  // on our labels, LinkedIn's own industry names, legacy V1 names and a short alias list only —
  // anything fuzzier stays as a custom chip so nothing the user typed is silently reinterpreted.
  const ALIASES = {
    fintech: 'fintech', healthtech: 'healthcare', 'health tech': 'healthcare', healthcare: 'healthcare',
    edtech: 'education', education: 'education', saas: 'software_saas', software: 'software_saas',
    ai: 'ai_ml', 'ai/ml': 'ai_ml', 'artificial intelligence': 'ai_ml', 'machine learning': 'ai_ml',
    'voice ai': 'ai_ml/conversational_voice_ai', 'voice/audio ai': 'ai_ml/conversational_voice_ai',
    'blockchain': 'fintech/crypto_web3', 'blockchain/crypto': 'fintech/crypto_web3', crypto: 'fintech/crypto_web3', web3: 'fintech/crypto_web3',
    proptech: 'real_estate/proptech', 'real estate': 'real_estate', ecommerce: 'ecommerce_retail', 'e-commerce': 'ecommerce_retail',
    retail: 'ecommerce_retail', logistics: 'logistics', martech: 'software_saas/martech', 'hr tech': 'software_saas/hr_tech',
    cybersecurity: 'cybersecurity', 'cyber security': 'cybersecurity', insurtech: 'fintech/insurance_insurtech',
    legaltech: 'legal/legaltech', dental: 'healthcare/dental', 'tech service providers': 'it_services',
    'it outsourcing / staffing': 'it_services/it_outsourcing_staff_aug', 'it outsourcing': 'it_services/it_outsourcing_staff_aug',
    'digital / marketing agencies': 'marketing_advertising/digital_marketing_agencies', 'marketing agencies': 'marketing_advertising/digital_marketing_agencies',
    startups: null, 'e-commerce brands': 'ecommerce_retail/d2c_ecommerce_brands',
  };
  const LOOKUP = (() => {
    const m = new Map();
    for (const g of T.industries) {
      [g.label, g.id, ...g.li, ...g.legacy].forEach(n => m.set(String(n).toLowerCase(), g.id));
      for (const s of g.sub) {
        [s.label, s.id].forEach(n => m.set(String(n).toLowerCase(), `${g.id}/${s.id}`));
        // A LinkedIn name owned by exactly one sub-segment maps to that sub-segment.
        s.li.forEach(n => { if (!m.has(n.toLowerCase())) m.set(n.toLowerCase(), `${g.id}/${s.id}`); });
      }
    }
    return m;
  })();
  function matchIndustry(text) {
    const k = String(text || '').trim().toLowerCase();
    if (!k) return undefined;
    if (Object.prototype.hasOwnProperty.call(ALIASES, k)) return ALIASES[k] || undefined;
    return LOOKUP.get(k);
  }
  // Splits a legacy string list into taxonomy keys + leftover custom strings. "AI/SaaS"-style
  // combined entries are split on "/" only when every part matches, so "Voice/Audio AI" survives.
  function splitLegacyIndustries(list) {
    const keys = new Set(); const custom = [];
    for (const raw of Array.isArray(list) ? list : []) {
      const s = String(raw || '').trim(); if (!s) continue;
      const direct = matchIndustry(s);
      if (direct) { keys.add(direct); continue; }
      const parts = s.split('/').map(p => p.trim()).filter(Boolean);
      const mapped = parts.map(matchIndustry);
      if (parts.length > 1 && mapped.every(Boolean)) { mapped.forEach(k => keys.add(k)); continue; }
      custom.push(s);
    }
    return { keys: [...keys], custom };
  }

  // ── Migration (idempotent: each step checks its own condition) ───────────────
  const YEARS_TO_LEVEL = { '0–2 years (entry-level)': 'entry', '3–5 years (mid-level)': 'mid', '6–10 years (senior)': 'senior', '10+ years (lead / principal)': 'lead' };
  const MIGRATION_KEYS = ['analysisIntent', 'icpProfiles', 'activeIcpProfileId', 'b2cProfiles', 'activeB2cProfileId',
    'b2cProfile', 'jobProfile', 'b2cTargetIndustries', 'b2cExcludeIndustries', 'targetIndustries', 'excludeIndustries',
    'businessProfile', 'savedContacts', 'messagePresets', 'b2cMessagePresets', 'jobMessagePresets'];

  function migrateB2bProfile(p) {
    if (p && p.icp && Array.isArray(p.icp.industries)) return null; // already migrated
    const base = emptyB2bProfile(p?.name || 'Default');
    const t = splitLegacyIndustries(p?.targetIndustries);
    const x = splitLegacyIndustries(p?.excludeIndustries);
    const bp = p?.businessProfile || {};
    return {
      ...base, ...p, id: p?.id || base.id,
      icp: { ...emptyIcp(), industries: t.keys, customIndustries: t.custom, excludeIndustries: x.keys, customExcludes: x.custom, idealCustomer: bp.idealCustomer || '' },
      businessProfile: { ...base.businessProfile, ...bp, proofPoints: Array.isArray(bp.proofPoints) ? bp.proofPoints : BLANK_PROOFS(), problems: Array.isArray(bp.problems) ? bp.problems : [] },
    };
  }

  function buildB2cFromLegacy(r) {
    const b = r.b2cProfile || {}; const j = r.jobProfile || {};
    const p = emptyB2cProfile('Default');
    const targets = splitLegacyIndustries([...(r.b2cTargetIndustries || []), ...(Array.isArray(j.targetIndustries) ? j.targetIndustries : [])]);
    const excludes = splitLegacyIndustries(r.b2cExcludeIndustries || []);
    p.icp.industries = targets.keys; p.icp.customIndustries = targets.custom;
    p.icp.excludeIndustries = excludes.keys; p.icp.customExcludes = excludes.custom;
    p.icp.idealCustomer = b.targetClient || '';
    p.seeking.roles = Array.isArray(j.targetRoles) ? j.targetRoles.slice(0, 5) : [];
    p.seeking.level = YEARS_TO_LEVEL[j.yearsExp] || '';
    if (j.targetRoles?.length) p.seeking.workTypes.push('full_time');
    if (b.services || b.expertise) p.seeking.workTypes.push('freelance');
    p.pitch.senderName = b.senderName || j.senderName || '';
    p.pitch.currentTitle = j.currentTitle || '';
    p.pitch.oneLiner = b.expertise || '';
    p.pitch.services = b.services || '';
    p.pitch.uniqueAngle = b.valueProp || '';
    p.pitch.background = j.background || '';
    p.pitch.notes = b.problem ? `Problem I solve: ${b.problem}` : '';
    return p;
  }

  async function migrate() {
    const r = await chrome.storage.local.get(MIGRATION_KEYS);
    const set = {};

    if (r.analysisIntent && r.analysisIntent !== normalizeIntent(r.analysisIntent)) set.analysisIntent = normalizeIntent(r.analysisIntent);

    if (!Array.isArray(r.b2cProfiles) || !r.b2cProfiles.length) {
      const hasLegacy = r.b2cProfile || r.jobProfile || (r.b2cTargetIndustries || []).length;
      const p = hasLegacy ? buildB2cFromLegacy(r) : emptyB2cProfile('Default');
      set.b2cProfiles = [p]; set.activeB2cProfileId = p.id;
    }

    let b2b = Array.isArray(r.icpProfiles) ? r.icpProfiles : [];
    if (!b2b.length && (r.targetIndustries || r.businessProfile)) {
      b2b = [{ name: 'Default', targetIndustries: r.targetIndustries || [], excludeIndustries: r.excludeIndustries || [], businessProfile: r.businessProfile || {} }];
    }
    if (!b2b.length) { const p = emptyB2bProfile('Default'); set.icpProfiles = [p]; set.activeIcpProfileId = p.id; }
    else {
      let changed = false;
      const next = b2b.map(p => { const m = migrateB2bProfile(p); if (m) { changed = true; return m; } return p; });
      if (changed || !Array.isArray(r.icpProfiles)) { set.icpProfiles = next; if (!r.activeIcpProfileId) set.activeIcpProfileId = next[0].id; }
    }

    if (Array.isArray(r.savedContacts) && r.savedContacts.some(c => c && c.intent === 'job_search')) {
      set.savedContacts = r.savedContacts.map(c => (c && c.intent === 'job_search' ? { ...c, intent: 'b2c_sales' } : c));
    }

    // Message style: the length setting is gone (short always wins) and free-text CTA text became
    // an "ending" choice. Tone carries over; job-search style folds into B2C if B2C had none.
    const fixPresets = (p, fallback) => {
      const src = p && Object.keys(p).length ? p : (fallback || {});
      if (src && src.ending && !('length' in src) && !('ctaText' in src)) return null;
      return { tone: src.tone || 'warm', ending: src.ending || 'ask_relevant' };
    };
    const m1 = fixPresets(r.messagePresets); if (m1) set.messagePresets = m1;
    const m2 = fixPresets(r.b2cMessagePresets, r.jobMessagePresets); if (m2) set.b2cMessagePresets = m2;

    // 2026-11-11 field audit: fields that didn't change targeting or message wording enough to earn
    // a place on the setup screen were removed. Their text moves into Notes, which still reaches
    // the prompts, so nothing the user typed is lost.
    const foldNotes = (notes, label, value) => (value && !String(notes || '').includes(value) ? `${notes ? `${notes}\n` : ''}${label}: ${value}` : notes || '');
    const b2cList = set.b2cProfiles || r.b2cProfiles;
    if (Array.isArray(b2cList) && b2cList.some(p => p?.pitch?.uniqueAngle || p?.seeking?.availability || (p?.seeking?.workplace || []).length)) {
      set.b2cProfiles = b2cList.map(p => {
        if (!p?.pitch) return p;
        const k = p.seeking || {};
        let notes = foldNotes(p.pitch.notes, 'What makes me different', p.pitch.uniqueAngle);
        notes = foldNotes(notes, 'Availability', optLabelOf(OPTIONS.availability, k.availability));
        notes = foldNotes(notes, 'Workplace', (k.workplace || []).map(id => optLabelOf(OPTIONS.workplace, id)).filter(Boolean).join(', '));
        return { ...p, pitch: { ...p.pitch, uniqueAngle: '', notes }, seeking: { ...k, availability: '', workplace: [] } };
      });
    }
    const b2bList = set.icpProfiles || (Array.isArray(r.icpProfiles) ? r.icpProfiles : null);
    if (Array.isArray(b2bList) && b2bList.some(p => p?.businessProfile?.valueProp || p?.businessProfile?.offerType || p?.businessProfile?.outcome)) {
      set.icpProfiles = b2bList.map(p => {
        const bp = p?.businessProfile; if (!bp) return p;
        let notes = foldNotes(bp.notes, 'What makes us different', bp.valueProp);
        notes = foldNotes(notes, 'What we sell', optLabelOf(OPTIONS.offerTypes, bp.offerType));
        notes = foldNotes(notes, 'Main outcome we deliver', optLabelOf(OPTIONS.outcomes, bp.outcome));
        return { ...p, businessProfile: { ...bp, valueProp: '', offerType: '', outcome: '', notes } };
      });
    }

    if (Object.keys(set).length) await chrome.storage.local.set(set);
    return Object.keys(set);
  }

  // ── Sanitizers (team codes, cloud restore) ───────────────────────────────────
  const str = (v, max = 600) => (typeof v === 'string' ? v.slice(0, max) : '');
  const strList = (v, maxItems = 50, maxLen = 120) => (Array.isArray(v) ? v.filter(x => typeof x === 'string').map(x => x.trim().slice(0, maxLen)).filter(Boolean).slice(0, maxItems) : []);
  const idList = (v, allowed) => strList(v, 300, 80).filter(x => allowed(x));
  const ids = list => new Set(list.map(o => o.id));
  const ALLOWED = {
    headcount: ids(T.headcount), seniority: ids(T.seniority), functions: ids(T.functions), regions: ids(T.regions),
    hirerTypes: ids(OPTIONS.hirerTypes), signals: new Set([...ids(OPTIONS.b2bSignals), ...ids(OPTIONS.b2cSignals)]),
    excludeCompanyTypes: ids(OPTIONS.excludeCompanyTypes), workTypes: ids(OPTIONS.workTypes), workplace: ids(OPTIONS.workplace),
    problems: ids(OPTIONS.problems),
  };
  const ALL_COUNTRIES = new Set(T.regions.flatMap(r => r.countries));
  const oneOf = (v, list) => (list.some(o => o.id === v) ? v : '');

  function sanitizeIcp(icp) {
    const i = icp || {};
    return {
      industries: idList(i.industries, isValidIndustryKey), customIndustries: strList(i.customIndustries),
      excludeIndustries: idList(i.excludeIndustries, isValidIndustryKey), customExcludes: strList(i.customExcludes),
      regions: idList(i.regions, x => ALLOWED.regions.has(x)), countries: idList(i.countries, x => ALL_COUNTRIES.has(x)),
      headcount: idList(i.headcount, x => ALLOWED.headcount.has(x)), seniority: idList(i.seniority, x => ALLOWED.seniority.has(x)),
      functions: idList(i.functions, x => ALLOWED.functions.has(x)), titles: strList(i.titles, 15),
      hirerTypes: idList(i.hirerTypes, x => ALLOWED.hirerTypes.has(x)), signals: idList(i.signals, x => ALLOWED.signals.has(x)),
      excludeCompanyTypes: idList(i.excludeCompanyTypes, x => ALLOWED.excludeCompanyTypes.has(x)),
      excludeRoles: strList(i.excludeRoles, 20), excludeCompanies: strList(i.excludeCompanies, 50),
      idealCustomer: str(i.idealCustomer),
    };
  }
  const proofs = v => { const a = strList(v, 3, 200); while (a.length < 3) a.push(''); return a; };

  // senderName is deliberately dropped: a shared team setup must never carry one person's name
  // into another rep's messages. The importer keeps their own.
  // senderName and senderRole are personal (each rep's own); everything else is the company's.
  function sanitizeB2bProfile(p, keepName = '', keepRole = '') {
    const b = p?.businessProfile || {};
    return {
      id: str(p?.id, 60) || emptyB2bProfile().id, name: str(p?.name, 60) || 'Imported',
      icp: sanitizeIcp(p?.icp),
      businessProfile: {
        senderName: keepName, senderRole: str(keepRole, 80), companyName: str(b.companyName, 120), offerType: oneOf(b.offerType, OPTIONS.offerTypes),
        offer: str(b.offer), problems: idList(b.problems, x => ALLOWED.problems.has(x)), problem: str(b.problem),
        outcome: oneOf(b.outcome, OPTIONS.outcomes), proofPoints: proofs(b.proofPoints), valueProp: str(b.valueProp),
        expertise: str(b.expertise), serviceMap: str(b.serviceMap, 1200), trust: str(b.trust, 400), pricing: str(b.pricing, 300), notes: str(b.notes, 1200),
      },
      targetIndustries: [], excludeIndustries: [],
    };
  }
  function sanitizeB2cProfile(p, keepName = '') {
    const s = p?.seeking || {}; const pi = p?.pitch || {};
    return {
      id: str(p?.id, 60) || emptyB2cProfile().id, name: str(p?.name, 60) || 'Imported',
      icp: sanitizeIcp(p?.icp),
      seeking: {
        workTypes: idList(s.workTypes, x => ALLOWED.workTypes.has(x)), roles: strList(s.roles, 5),
        level: oneOf(s.level, OPTIONS.experience), workplace: idList(s.workplace, x => ALLOWED.workplace.has(x)),
        availability: oneOf(s.availability, OPTIONS.availability),
      },
      pitch: {
        senderName: keepName, currentTitle: str(pi.currentTitle, 120), oneLiner: str(pi.oneLiner), skills: strList(pi.skills, 15),
        services: str(pi.services), proofPoints: proofs(pi.proofPoints), uniqueAngle: str(pi.uniqueAngle),
        portfolio: str(pi.portfolio, 300), background: str(pi.background, 1200), location: str(pi.location, 160), rate: str(pi.rate, 200), represents: str(pi.represents, 240), notes: str(pi.notes, 1200),
      },
    };
  }
  function sanitizePresets(p, intent) {
    return { tone: oneOf(p?.tone, OPTIONS.tones) || 'warm', ending: oneOf(p?.ending, OPTIONS.endings[normalizeIntent(intent)]) || 'ask_relevant' };
  }

  globalThis.LP_SCHEMA = {
    MODES, DEFAULT_INTENT, normalizeIntent, OPTIONS,
    emptyIcp, emptyB2cProfile, emptyB2bProfile,
    industryLabel, isValidIndustryKey, matchIndustry, splitLegacyIndustries,
    migrate, migrateB2bProfile, buildB2cFromLegacy, sanitizeIcp, sanitizeB2bProfile, sanitizeB2cProfile, sanitizePresets,
  };
})();
