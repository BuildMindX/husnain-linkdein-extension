// ── Tab Navigation ────────────────────────────────────────────────────────────
document.querySelectorAll('.snav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    document.querySelectorAll('.snav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.stab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${tab}`));
  });
});

// ── Post Creator: Personal / Company toggle ───────────────────────────────────
document.querySelectorAll('.pc-stoggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const panel = btn.dataset.panel;
    document.querySelectorAll('.pc-stoggle').forEach(b => b.classList.toggle('active', b.dataset.panel === panel));
    document.getElementById('pc-personal-section')?.classList.toggle('hidden', panel !== 'personal');
    document.getElementById('pc-company-section')?.classList.toggle('hidden', panel !== 'company');
  });
});

// ── Mode Info Box ─────────────────────────────────────────────────────────────
const MODE_INFO = {
  b2b_sales: {
    title: 'B2B Sales mode active',
    desc: 'The AI reads each LinkedIn profile and tells you exactly how valuable this contact is for your pipeline — in seconds.',
    items: [
      'Prospect score (High / Medium / Low) with AI reasoning',
      'Industry fit — does their company match your target ICP?',
      'Decision-maker level: C-level, VP, Manager, or IC',
      'Company details — name, industry, size, headcount',
      'Ready-to-send personalised connection request',
    ],
    cta: 'Fill in your ICP and business profile below for the most accurate scoring.',
  },
  b2c_sales: {
    title: 'Freelance / Consulting mode active',
    desc: 'The AI evaluates each contact as a potential client for your individual services and tells you how to approach them.',
    items: [
      'Client potential score (High / Medium / Low)',
      'Freelancer signal — do they typically work with contractors?',
      'Decision-making authority and budget signals',
      'Pain points you could address based on their situation',
      'A personalised approach angle written for your specific expertise',
    ],
    cta: 'Fill in your personal profile below to get personalised client scoring.',
  },
  job_search: {
    title: 'Job Search mode active',
    desc: 'The AI reads each profile and tells you whether this person is a recruiter, a hiring manager, or shows signals of active hiring.',
    items: [
      'Hiring signal strength (Strong / Possible / Unlikely)',
      'Recruiter identification (Yes / Likely / No)',
      'Company size and industry context',
      'Actionable tips on how to approach this specific person',
      'A natural connection request that does not sound like a template',
    ],
    cta: 'Fill in your job profile below so your outreach messages feel personal and relevant.',
  },
};

function updateModeInfoBox(intent) {
  const box = document.getElementById('mode-info-box');
  if (!box) return;
  const info = MODE_INFO[intent] || MODE_INFO.b2b_sales;
  box.innerHTML = `
    <span class="mib-icon">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
    </span>
    <div class="mib-content">
      <div class="mib-title">${info.title}</div>
      <p class="mib-desc">${info.desc}</p>
      <ul class="mib-list">${info.items.map(i => `<li>${i}</li>`).join('')}</ul>
      <div class="mib-cta">${info.cta}</div>
    </div>`;
}

// ── Mode Selector ─────────────────────────────────────────────────────────────
const modeCards = document.querySelectorAll('.mode-card');
const intentStatus = document.getElementById('intent-status');

function applyIntentVisibility(intent) {
  const isSales = intent === 'b2b_sales';
  const isB2c   = intent === 'b2c_sales';
  const isJob   = intent === 'job_search';

  document.getElementById('sales-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('business-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('message-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('b2c-config')?.classList.toggle('hidden', !isB2c);
  document.getElementById('job-config')?.classList.toggle('hidden', !isJob);

  updateModeInfoBox(intent);
}

chrome.storage.local.get('analysisIntent', result => {
  const current = result.analysisIntent || 'b2b_sales';
  modeCards.forEach(card => card.classList.toggle('active', card.dataset.intent === current));
  applyIntentVisibility(current);
});

modeCards.forEach(card => {
  card.addEventListener('click', () => {
    const intent = card.dataset.intent;
    chrome.storage.local.set({ analysisIntent: intent }, () => {
      modeCards.forEach(c => c.classList.toggle('active', c.dataset.intent === intent));
      applyIntentVisibility(intent);
      const label = { b2b_sales: 'Switched to B2B Sales mode.', b2c_sales: 'Switched to Freelance mode.', job_search: 'Switched to Job Search mode.' };
      showStatus(intentStatus, label[intent] || 'Mode saved.', 'success');
    });
  });
});

// ── ICP ───────────────────────────────────────────────────────────────────────
const DEFAULT_EXCLUDES = ['Tech service providers', 'IT outsourcing / staffing', 'Digital / marketing agencies'];
const tagState = { targets: [], excludes: [] };

function renderTags(kind) {
  const id = kind === 'targets' ? 'target-tags' : 'exclude-tags';
  const cls = kind === 'targets' ? 'tag-target' : 'tag-exclude';
  const container = document.getElementById(id);
  if (!container) return;
  container.innerHTML = tagState[kind].map((t, i) => `
    <span class="tag ${cls}">${escapeHtml(t)}
      <button type="button" class="tag-remove" data-kind="${kind}" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn =>
    btn.addEventListener('click', () => { tagState[btn.dataset.kind].splice(Number(btn.dataset.idx), 1); renderTags(btn.dataset.kind); }));
}

function wireTagInput(inputId, kind) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !tagState[kind].some(t => t.toLowerCase() === val.toLowerCase())) { tagState[kind].push(val); renderTags(kind); }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && tagState[kind].length) { tagState[kind].pop(); renderTags(kind); }
  });
}

wireTagInput('target-input', 'targets');
wireTagInput('exclude-input', 'excludes');

chrome.storage.local.get(['targetIndustries', 'excludeIndustries'], r => {
  tagState.targets = Array.isArray(r.targetIndustries) ? r.targetIndustries : [];
  tagState.excludes = Array.isArray(r.excludeIndustries) ? r.excludeIndustries : [...DEFAULT_EXCLUDES];
  renderTags('targets');
  renderTags('excludes');
});

document.getElementById('icp-save-btn')?.addEventListener('click', () => {
  chrome.storage.local.set({ targetIndustries: tagState.targets, excludeIndustries: tagState.excludes }, () =>
    showStatus(document.getElementById('icp-status'), 'ICP saved.', 'success'));
});

document.getElementById('icp-reset-btn')?.addEventListener('click', () => {
  tagState.excludes = [...DEFAULT_EXCLUDES];
  renderTags('excludes');
  showStatus(document.getElementById('icp-status'), 'Excludes reset to default — click Save ICP to keep.', 'info');
});

// ── Business Profile ──────────────────────────────────────────────────────────
const bizFields = { expertise: 'biz-expertise', offer: 'biz-offer', idealCustomer: 'biz-customer', problem: 'biz-problem', valueProp: 'biz-valueprop', senderName: 'biz-name', companyName: 'biz-company' };

chrome.storage.local.get('businessProfile', r => {
  const b = r.businessProfile || {};
  Object.entries(bizFields).forEach(([key, id]) => { const el = document.getElementById(id); if (el && b[key]) el.value = b[key]; });
});

document.getElementById('biz-save-btn')?.addEventListener('click', () => {
  const businessProfile = {};
  Object.entries(bizFields).forEach(([key, id]) => { const v = document.getElementById(id)?.value.trim(); if (v) businessProfile[key] = v; });
  chrome.storage.local.set({ businessProfile }, () => showStatus(document.getElementById('biz-status'), 'Business profile saved.', 'success'));
});

// ── Message Style ─────────────────────────────────────────────────────────────
const msgState = { tone: 'warm', length: 'standard', includeCta: false, ctaText: '' };

function renderSeg(segId, val) {
  document.querySelectorAll(`#${segId} button`).forEach(b => b.classList.toggle('active', b.dataset.val === val));
}

function wireSeg(segId, key) {
  document.querySelectorAll(`#${segId} button`).forEach(btn =>
    btn.addEventListener('click', () => { msgState[key] = btn.dataset.val; renderSeg(segId, btn.dataset.val); }));
}

wireSeg('tone-seg', 'tone');
wireSeg('length-seg', 'length');

const ctaToggle = document.getElementById('cta-toggle');
const ctaTextEl = document.getElementById('cta-text');

chrome.storage.local.get('messagePresets', r => {
  const p = r.messagePresets || {};
  msgState.tone = p.tone || 'warm';
  msgState.length = p.length || 'standard';
  msgState.includeCta = !!p.includeCta;
  msgState.ctaText = p.ctaText || '';
  renderSeg('tone-seg', msgState.tone);
  renderSeg('length-seg', msgState.length);
  if (ctaToggle) ctaToggle.checked = msgState.includeCta;
  if (ctaTextEl) ctaTextEl.value = msgState.ctaText;
});

document.getElementById('msg-save-btn')?.addEventListener('click', () => {
  const messagePresets = { tone: msgState.tone, length: msgState.length, includeCta: ctaToggle?.checked || false, ctaText: ctaTextEl?.value.trim() || '' };
  chrome.storage.local.set({ messagePresets }, () => showStatus(document.getElementById('msg-status'), 'Message style saved.', 'success'));
});

// ── B2C Profile ───────────────────────────────────────────────────────────────
const b2cFields = { expertise: 'b2c-expertise', services: 'b2c-services', targetClient: 'b2c-target', problem: 'b2c-problem', valueProp: 'b2c-valueprop', senderName: 'b2c-name' };

chrome.storage.local.get('b2cProfile', r => {
  const p = r.b2cProfile || {};
  Object.entries(b2cFields).forEach(([key, id]) => { const el = document.getElementById(id); if (el && p[key]) el.value = p[key]; });
});

document.getElementById('b2c-save-btn')?.addEventListener('click', () => {
  const b2cProfile = {};
  Object.entries(b2cFields).forEach(([key, id]) => { const v = document.getElementById(id)?.value.trim(); if (v) b2cProfile[key] = v; });
  chrome.storage.local.set({ b2cProfile }, () => showStatus(document.getElementById('b2c-status'), 'Personal profile saved.', 'success'));
});

// ── Job Profile ───────────────────────────────────────────────────────────────
const jobTagState = { roles: [], industries: [] };

function renderJobTags(kind) {
  const id = kind === 'roles' ? 'job-role-tags' : 'job-industry-tags';
  const container = document.getElementById(id);
  if (!container) return;
  container.innerHTML = jobTagState[kind].map((t, i) => `
    <span class="tag tag-target">${escapeHtml(t)}
      <button type="button" class="tag-remove" data-kind="${kind}" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn =>
    btn.addEventListener('click', () => { jobTagState[btn.dataset.kind].splice(Number(btn.dataset.idx), 1); renderJobTags(btn.dataset.kind); }));
}

function wireJobTagInput(inputId, kind) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !jobTagState[kind].some(t => t.toLowerCase() === val.toLowerCase())) { jobTagState[kind].push(val); renderJobTags(kind); }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && jobTagState[kind].length) { jobTagState[kind].pop(); renderJobTags(kind); }
  });
}

wireJobTagInput('job-role-input', 'roles');
wireJobTagInput('job-industry-input', 'industries');

chrome.storage.local.get('jobProfile', r => {
  const p = r.jobProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('job-name', p.senderName);
  setVal('job-title', p.currentTitle);
  setVal('job-background', p.background);
  setVal('job-years', p.yearsExp);
  jobTagState.roles = Array.isArray(p.targetRoles) ? p.targetRoles : [];
  jobTagState.industries = Array.isArray(p.targetIndustries) ? p.targetIndustries : [];
  renderJobTags('roles');
  renderJobTags('industries');
});

document.getElementById('job-save-btn')?.addEventListener('click', () => {
  const raw = {
    senderName: document.getElementById('job-name')?.value.trim(),
    currentTitle: document.getElementById('job-title')?.value.trim(),
    background: document.getElementById('job-background')?.value.trim(),
    yearsExp: document.getElementById('job-years')?.value,
    targetRoles: jobTagState.roles.length ? jobTagState.roles : undefined,
    targetIndustries: jobTagState.industries.length ? jobTagState.industries : undefined,
  };
  const jobProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ jobProfile }, () => showStatus(document.getElementById('job-status'), 'Job profile saved.', 'success'));
});

// ── OpenAI API Key ────────────────────────────────────────────────────────────
const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const toggleBtn = document.getElementById('toggle-visibility');
const statusMsg = document.getElementById('status-msg');

chrome.storage.local.get('openaiApiKey', result => {
  if (result.openaiApiKey) { apiKeyInput.value = result.openaiApiKey; showStatus(statusMsg, 'API key is saved and active.', 'success'); }
});

toggleBtn?.addEventListener('click', () => makeToggle(apiKeyInput, toggleBtn, 'eye-icon'));

saveBtn?.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus(statusMsg, 'Please enter an API key.', 'error'); return; }
  if (!key.startsWith('sk-')) { showStatus(statusMsg, 'Invalid format. OpenAI keys start with "sk-".', 'error'); return; }
  chrome.storage.local.set({ openaiApiKey: key }, () => showStatus(statusMsg, 'API key saved.', 'success'));
});

clearBtn?.addEventListener('click', () => {
  chrome.storage.local.remove('openaiApiKey', () => { apiKeyInput.value = ''; showStatus(statusMsg, 'API key cleared.', 'info'); });
});

apiKeyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn?.click(); });

// ── HubSpot ───────────────────────────────────────────────────────────────────
const hsKeyInput = document.getElementById('hs-key');
const hsSaveBtn = document.getElementById('hs-save-btn');
const hsClearBtn = document.getElementById('hs-clear-btn');
const hsToggleBtn = document.getElementById('hs-toggle-visibility');
const hsStatusMsg = document.getElementById('hs-status-msg');

chrome.storage.local.get('hubspotApiKey', result => {
  if (result.hubspotApiKey) { hsKeyInput.value = result.hubspotApiKey; showStatus(hsStatusMsg, 'HubSpot token is saved and active.', 'success'); }
});

hsToggleBtn?.addEventListener('click', () => makeToggle(hsKeyInput, hsToggleBtn, null));

hsSaveBtn?.addEventListener('click', () => {
  const key = hsKeyInput.value.trim();
  if (!key) { showStatus(hsStatusMsg, 'Please enter a token.', 'error'); return; }
  if (!key.startsWith('pat-')) { showStatus(hsStatusMsg, 'Invalid format. HubSpot private app tokens start with "pat-".', 'error'); return; }
  chrome.storage.local.set({ hubspotApiKey: key }, () => showStatus(hsStatusMsg, 'HubSpot token saved.', 'success'));
});

hsClearBtn?.addEventListener('click', () => {
  chrome.storage.local.remove('hubspotApiKey', () => { hsKeyInput.value = ''; showStatus(hsStatusMsg, 'HubSpot token cleared.', 'info'); });
});

hsKeyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') hsSaveBtn?.click(); });

// ── Creator Profile ───────────────────────────────────────────────────────────
const creatorDomainTagState = { domains: [] };

function renderCreatorDomainTags() {
  const container = document.getElementById('creator-domain-tags');
  if (!container) return;
  container.innerHTML = creatorDomainTagState.domains.map((t, i) => `
    <span class="tag tag-target">${escapeHtml(t)}
      <button type="button" class="tag-remove" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => btn.addEventListener('click', () => {
    creatorDomainTagState.domains.splice(Number(btn.dataset.idx), 1); renderCreatorDomainTags();
  }));
}

const creatorDomainInput = document.getElementById('creator-domain-input');
if (creatorDomainInput) {
  creatorDomainInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = creatorDomainInput.value.trim().replace(/,$/, '');
      if (val && !creatorDomainTagState.domains.some(t => t.toLowerCase() === val.toLowerCase())) { creatorDomainTagState.domains.push(val); renderCreatorDomainTags(); }
      creatorDomainInput.value = '';
    } else if (e.key === 'Backspace' && !creatorDomainInput.value && creatorDomainTagState.domains.length) { creatorDomainTagState.domains.pop(); renderCreatorDomainTags(); }
  });
}

chrome.storage.local.get('creatorProfile', r => {
  const p = r.creatorProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('creator-name', p.name);
  setVal('creator-linkedin-url', p.linkedinUrl);
  setVal('creator-audience', p.audience);
  setVal('creator-goal', p.goal);
  setVal('creator-style', p.postStyle);
  creatorDomainTagState.domains = Array.isArray(p.domains) ? p.domains : [];
  renderCreatorDomainTags();
});

document.getElementById('creator-save-btn')?.addEventListener('click', () => {
  const raw = {
    name: document.getElementById('creator-name')?.value.trim(),
    linkedinUrl: document.getElementById('creator-linkedin-url')?.value.trim(),
    audience: document.getElementById('creator-audience')?.value.trim(),
    goal: document.getElementById('creator-goal')?.value,
    postStyle: document.getElementById('creator-style')?.value,
    domains: creatorDomainTagState.domains.length ? creatorDomainTagState.domains : undefined,
  };
  const creatorProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ creatorProfile }, () => showStatus(document.getElementById('creator-status'), 'Creator profile saved.', 'success'));
});

// ── Company Profile ───────────────────────────────────────────────────────────
chrome.storage.local.get('companyProfile', r => {
  const p = r.companyProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('co-name', p.name); setVal('co-industry', p.industry); setVal('co-about', p.about);
  setVal('co-products', p.products); setVal('co-icp', p.icp); setVal('co-goal', p.goal); setVal('co-style', p.postStyle);
});

document.getElementById('co-save-btn')?.addEventListener('click', () => {
  const raw = { name: document.getElementById('co-name')?.value.trim(), industry: document.getElementById('co-industry')?.value.trim(), about: document.getElementById('co-about')?.value.trim(), products: document.getElementById('co-products')?.value.trim(), icp: document.getElementById('co-icp')?.value.trim(), goal: document.getElementById('co-goal')?.value, postStyle: document.getElementById('co-style')?.value };
  const companyProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ companyProfile }, () => showStatus(document.getElementById('co-status'), 'Company profile saved.', 'success'));
});

// ── Google Account ────────────────────────────────────────────────────────────
function renderAccountTab(user, plan) {
  const section = document.getElementById('google-auth-section');
  if (!section) return;
  const isPro = plan === 'pro';

  if (user) {
    const initial = (user.name || user.email || '?')[0].toUpperCase();
    section.innerHTML = `
      <div class="google-user-card">
        ${user.picture
          ? `<img src="${escapeHtml(user.picture)}" class="google-user-avatar" alt="Profile photo" />`
          : `<div class="google-user-avatar-placeholder">${escapeHtml(initial)}</div>`}
        <div class="google-user-info">
          <div class="google-user-name">${escapeHtml(user.name || '')}</div>
          <div class="google-user-email">${escapeHtml(user.email || '')}</div>
        </div>
        <span class="plan-badge ${isPro ? 'plan-pro' : 'plan-free'}">${isPro ? 'Pro' : 'Free'}</span>
        <button type="button" id="sign-out-btn" class="btn-signout">Sign out</button>
      </div>
      ${!isPro ? `
      <div class="upgrade-card">
        <div class="upgrade-card-title">Upgrade to LinkPilot Pro</div>
        <ul class="upgrade-features">
          <li>Unlimited profile analyses</li>
          <li>Unlimited message generation</li>
          <li>Unlimited post creation</li>
          <li>HubSpot CRM sync</li>
          <li>Priority support</li>
        </ul>
        <button type="button" id="upgrade-btn" class="btn-upgrade">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          Upgrade to Pro
        </button>
        <div id="upgrade-status" class="account-status-msg" style="display:none;margin-top:8px"></div>
      </div>` : `
      <div class="pro-active-card">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#15803d" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Pro plan active — all features unlocked
      </div>`}`;

    document.getElementById('sign-out-btn')?.addEventListener('click', handleGoogleSignOut);
    document.getElementById('upgrade-btn')?.addEventListener('click', handleUpgrade);
  } else {
    section.innerHTML = `
      <button type="button" id="google-sign-in-btn" class="btn-google">
        <svg width="18" height="18" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
          <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
        </svg>
        Continue with Google
      </button>`;
    document.getElementById('google-sign-in-btn')?.addEventListener('click', handleGoogleSignIn);
  }
}

function handleGoogleSignIn() {
  const accountStatus = document.getElementById('account-status');
  showStatus(accountStatus, 'Connecting to Google...', 'info');
  chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_IN' }, response => {
    if (chrome.runtime.lastError || !response?.success) {
      showStatus(accountStatus, response?.error || 'Sign-in failed. Make sure the extension is configured with a Google OAuth client ID.', 'error');
      return;
    }
    renderAccountTab(response.user, response.plan || 'free');
    showStatus(accountStatus, `Signed in as ${response.user.email}`, 'success');
  });
}

function handleGoogleSignOut() {
  const accountStatus = document.getElementById('account-status');
  chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_OUT' }, response => {
    if (chrome.runtime.lastError || !response?.success) {
      showStatus(accountStatus, 'Sign-out failed.', 'error');
      return;
    }
    renderAccountTab(null, 'free');
    showStatus(accountStatus, 'Signed out.', 'info');
  });
}

function handleUpgrade() {
  const statusEl = document.getElementById('upgrade-status');
  const btn = document.getElementById('upgrade-btn');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Redirecting...';
  if (statusEl) statusEl.style.display = 'none';
  chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, response => {
    btn.disabled = false;
    btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg> Upgrade to Pro`;
    if (chrome.runtime.lastError || !response?.url) {
      if (statusEl) { statusEl.textContent = response?.error || 'Upgrade failed. Try again.'; statusEl.style.display = ''; }
      return;
    }
    chrome.tabs.create({ url: response.url });
  });
}

chrome.storage.local.get(['googleUser', 'userPlan'], r => renderAccountTab(r.googleUser || null, r.userPlan || 'free'));

// ── Clear All Data ────────────────────────────────────────────────────────────
document.getElementById('clear-all-data-btn')?.addEventListener('click', () => {
  if (!confirm('This will permanently delete all your saved profiles, API keys, and settings. Are you sure?')) return;
  chrome.storage.local.clear(() => {
    showStatus(document.getElementById('clear-status'), 'All local data cleared.', 'info');
    renderAccountTab(null, 'free');
    location.reload();
  });
});

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function showStatus(el, message, type) {
  if (!el) return;
  el.textContent = message;
  el.className = `status-msg status-${type}`;
  if (type === 'success') setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 4000);
}

function makeToggle(input, btn, iconId) {
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  btn.setAttribute('aria-label', isPassword ? 'Hide' : 'Show');
  if (!iconId) return;
  const icon = document.getElementById(iconId);
  if (!icon) return;
  icon.innerHTML = isPassword
    ? `<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line>`
    : `<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle>`;
}
