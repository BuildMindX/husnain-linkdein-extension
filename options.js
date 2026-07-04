// ── Mode info box content ─────────────────────────────────────────────────────
const MODE_INFO = {
  b2b_sales: {
    icon: '💼',
    title: 'You are in B2B Sales mode',
    desc: 'The AI reads each LinkedIn profile and tells you exactly how valuable this contact is for your pipeline — in seconds. Visit any LinkedIn profile and click Analyze to see:',
    items: [
      'Prospect score (High / Medium / Low) with AI reasoning',
      'Industry fit — does their company match your target ICP?',
      'Decision-maker level: C-level, VP, Manager, or IC',
      'Company details — name, industry, size, headcount',
      'Ready-to-send personalized connection request',
    ],
    cta: '👇 Fill in your ICP and business profile below for the most accurate scoring',
  },
  b2c_sales: {
    icon: '🧑‍💻',
    title: 'You are in Freelance / Consulting mode',
    desc: 'The AI evaluates each contact as a potential client for your individual services and tells you how to approach them. On every LinkedIn profile you will see:',
    items: [
      'Client potential score (High / Medium / Low)',
      'Freelancer signal — do they typically work with contractors?',
      'Their decision-making authority and budget signals',
      'Pain points you could address based on their situation',
      'A personalized approach angle written for your specific expertise',
      'Connection request that positions you as a peer, not a vendor',
    ],
    cta: '👇 Fill in your personal profile below to get personalized client scoring',
  },
  job_search: {
    icon: '🎯',
    title: 'You are in Job Search mode',
    desc: 'The AI reads each LinkedIn profile and tells you whether this person is a recruiter, a hiring manager, or shows signals of active hiring — so you can prioritize who is worth reaching out to. You will see:',
    items: [
      'Hiring signal strength (Strong / Possible / Unlikely)',
      'Recruiter identification (Yes / Likely / No)',
      'Company size and industry context',
      'Actionable tips on how to approach this specific person',
      'A natural connection request that does not sound like a job application',
    ],
    cta: '👇 Fill in your job profile below so your outreach messages feel personal and relevant',
  },
};

function updateModeInfoBox(intent) {
  const box = document.getElementById('mode-info-box');
  if (!box) return;
  const info = MODE_INFO[intent] || MODE_INFO.b2b_sales;
  box.innerHTML = `
    <div class="mib-icon">${info.icon}</div>
    <div class="mib-content">
      <div class="mib-title">${info.title}</div>
      <p class="mib-desc">${info.desc}</p>
      <ul class="mib-list">
        ${info.items.map(item => `<li>${item}</li>`).join('')}
      </ul>
      <div class="mib-cta">${info.cta}</div>
    </div>
  `;
}

// ── Mode Selector ─────────────────────────────────────────────────────────────
const modeCards = document.querySelectorAll('.mode-card');
const intentStatus = document.getElementById('intent-status');

function applyIntentVisibility(intent) {
  const isSales = intent === 'b2b_sales';
  const isB2c = intent === 'b2c_sales';
  const isJob = intent === 'job_search';

  document.getElementById('sales-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('business-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('message-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('b2c-config')?.classList.toggle('hidden', !isB2c);
  document.getElementById('job-config')?.classList.toggle('hidden', !isJob);

  const titles = {
    b2b_sales: 'Set up your sales profile',
    b2c_sales: 'Set up your freelance profile',
    job_search: 'Set up your job search profile',
  };
  const descs = {
    b2b_sales: 'The AI uses your ICP and business profile to score every prospect and personalize your outreach. Fill in as much as you can — the more context, the better the results.',
    b2c_sales: 'Tell the AI about your expertise so it can identify the best client opportunities and suggest a personalized approach angle for each contact.',
    job_search: 'Add your background so connection requests sound natural and personal — not like a template job application.',
  };
  const t = document.getElementById('step2-title');
  const d = document.getElementById('step2-desc');
  if (t) t.textContent = titles[intent] || titles.b2b_sales;
  if (d) d.textContent = descs[intent] || descs.b2b_sales;

  updateModeInfoBox(intent);

  const step2 = document.getElementById('step2-block');
  if (step2) step2.style.visibility = '';
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
      const label = intent === 'job_search' ? 'Switched to Job Search mode.'
        : intent === 'b2c_sales' ? 'Switched to Freelance mode.'
        : 'Switched to B2B Sales mode.';
      showStatus(intentStatus, label, 'success');
    });
  });
});

// ── ICP: target / exclude industries ─────────────────────────────────────────
const DEFAULT_EXCLUDES = ['Tech service providers', 'IT outsourcing / staffing', 'Digital / marketing agencies'];
const tagState = { targets: [], excludes: [] };

function renderTags(kind) {
  const container = document.getElementById(kind === 'targets' ? 'target-tags' : 'exclude-tags');
  if (!container) return;
  container.innerHTML = tagState[kind].map((t, i) => `
    <span class="tag tag-${kind === 'targets' ? 'target' : 'exclude'}">
      ${escapeHtml(t)}
      <button type="button" class="tag-remove" data-kind="${kind}" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      tagState[btn.dataset.kind].splice(Number(btn.dataset.idx), 1);
      renderTags(btn.dataset.kind);
    });
  });
}

function wireTagInput(inputId, kind) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !tagState[kind].some(t => t.toLowerCase() === val.toLowerCase())) {
        tagState[kind].push(val);
        renderTags(kind);
      }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && tagState[kind].length) {
      tagState[kind].pop();
      renderTags(kind);
    }
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
  chrome.storage.local.set({ targetIndustries: tagState.targets, excludeIndustries: tagState.excludes }, () => {
    showStatus(document.getElementById('icp-status'), 'ICP saved.', 'success');
  });
});

document.getElementById('icp-reset-btn')?.addEventListener('click', () => {
  tagState.excludes = [...DEFAULT_EXCLUDES];
  renderTags('excludes');
  showStatus(document.getElementById('icp-status'), 'Excludes reset to default — click Save ICP to keep.', 'info');
});

// ── Business Profile ──────────────────────────────────────────────────────────
const bizFields = {
  offer: 'biz-offer',
  idealCustomer: 'biz-customer',
  problem: 'biz-problem',
  valueProp: 'biz-valueprop',
  senderName: 'biz-name',
  companyName: 'biz-company',
};

chrome.storage.local.get('businessProfile', r => {
  const b = r.businessProfile || {};
  Object.entries(bizFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && b[key]) el.value = b[key];
  });
});

document.getElementById('biz-save-btn')?.addEventListener('click', () => {
  const businessProfile = {};
  Object.entries(bizFields).forEach(([key, id]) => {
    const v = document.getElementById(id)?.value.trim();
    if (v) businessProfile[key] = v;
  });
  chrome.storage.local.set({ businessProfile }, () => {
    showStatus(document.getElementById('biz-status'), 'Business profile saved.', 'success');
  });
});

// ── Message Style ─────────────────────────────────────────────────────────────
const msgState = { tone: 'warm', length: 'standard', includeCta: false, ctaText: '' };

function renderSeg(segId, val) {
  document.querySelectorAll(`#${segId} button`).forEach(b => b.classList.toggle('active', b.dataset.val === val));
}

function wireSeg(segId, key) {
  document.querySelectorAll(`#${segId} button`).forEach(btn => {
    btn.addEventListener('click', () => {
      msgState[key] = btn.dataset.val;
      renderSeg(segId, btn.dataset.val);
    });
  });
}

wireSeg('tone-seg', 'tone');
wireSeg('length-seg', 'length');

const ctaToggle = document.getElementById('cta-toggle');
const ctaText = document.getElementById('cta-text');

chrome.storage.local.get('messagePresets', r => {
  const p = r.messagePresets || {};
  msgState.tone = p.tone || 'warm';
  msgState.length = p.length || 'standard';
  msgState.includeCta = !!p.includeCta;
  msgState.ctaText = p.ctaText || '';
  renderSeg('tone-seg', msgState.tone);
  renderSeg('length-seg', msgState.length);
  if (ctaToggle) ctaToggle.checked = msgState.includeCta;
  if (ctaText) ctaText.value = msgState.ctaText;
});

document.getElementById('msg-save-btn')?.addEventListener('click', () => {
  const messagePresets = {
    tone: msgState.tone,
    length: msgState.length,
    includeCta: ctaToggle?.checked || false,
    ctaText: ctaText?.value.trim() || '',
  };
  chrome.storage.local.set({ messagePresets }, () => {
    showStatus(document.getElementById('msg-status'), 'Message style saved.', 'success');
  });
});

// ── B2C Personal Profile ──────────────────────────────────────────────────────
const b2cFields = {
  expertise: 'b2c-expertise',
  services: 'b2c-services',
  targetClient: 'b2c-target',
  problem: 'b2c-problem',
  valueProp: 'b2c-valueprop',
  senderName: 'b2c-name',
};

chrome.storage.local.get('b2cProfile', r => {
  const p = r.b2cProfile || {};
  Object.entries(b2cFields).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el && p[key]) el.value = p[key];
  });
});

document.getElementById('b2c-save-btn')?.addEventListener('click', () => {
  const b2cProfile = {};
  Object.entries(b2cFields).forEach(([key, id]) => {
    const v = document.getElementById(id)?.value.trim();
    if (v) b2cProfile[key] = v;
  });
  chrome.storage.local.set({ b2cProfile }, () => {
    showStatus(document.getElementById('b2c-status'), 'Personal profile saved.', 'success');
  });
});

// ── Job Search Profile (NEW) ──────────────────────────────────────────────────
const jobTagState = { roles: [], industries: [] };

function renderJobTags(kind) {
  const containerId = kind === 'roles' ? 'job-role-tags' : 'job-industry-tags';
  const container = document.getElementById(containerId);
  if (!container) return;
  container.innerHTML = jobTagState[kind].map((t, i) => `
    <span class="tag tag-target">
      ${escapeHtml(t)}
      <button type="button" class="tag-remove" data-kind="${kind}" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      jobTagState[btn.dataset.kind].splice(Number(btn.dataset.idx), 1);
      renderJobTags(btn.dataset.kind);
    });
  });
}

function wireJobTagInput(inputId, kind) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = input.value.trim().replace(/,$/, '');
      if (val && !jobTagState[kind].some(t => t.toLowerCase() === val.toLowerCase())) {
        jobTagState[kind].push(val);
        renderJobTags(kind);
      }
      input.value = '';
    } else if (e.key === 'Backspace' && !input.value && jobTagState[kind].length) {
      jobTagState[kind].pop();
      renderJobTags(kind);
    }
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
  chrome.storage.local.set({ jobProfile }, () => {
    showStatus(document.getElementById('job-status'), 'Job profile saved.', 'success');
  });
});

// ── OpenAI API Key ────────────────────────────────────────────────────────────
const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const toggleBtn = document.getElementById('toggle-visibility');
const statusMsg = document.getElementById('status-msg');

chrome.storage.local.get('openaiApiKey', result => {
  if (result.openaiApiKey) {
    apiKeyInput.value = result.openaiApiKey;
    showStatus(statusMsg, 'API key is saved and active.', 'success');
  }
});

toggleBtn?.addEventListener('click', () => makeToggle(apiKeyInput, toggleBtn, 'eye-icon'));

saveBtn?.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus(statusMsg, 'Please enter an API key.', 'error'); return; }
  if (!key.startsWith('sk-')) {
    showStatus(statusMsg, 'Invalid format. OpenAI keys start with "sk-".', 'error');
    return;
  }
  chrome.storage.local.set({ openaiApiKey: key }, () => {
    showStatus(statusMsg, 'API key saved.', 'success');
  });
});

clearBtn?.addEventListener('click', () => {
  chrome.storage.local.remove('openaiApiKey', () => {
    apiKeyInput.value = '';
    showStatus(statusMsg, 'API key cleared.', 'info');
  });
});

apiKeyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') saveBtn?.click(); });

// ── HubSpot ───────────────────────────────────────────────────────────────────
const hsKeyInput = document.getElementById('hs-key');
const hsSaveBtn = document.getElementById('hs-save-btn');
const hsClearBtn = document.getElementById('hs-clear-btn');
const hsToggleBtn = document.getElementById('hs-toggle-visibility');
const hsStatusMsg = document.getElementById('hs-status-msg');

chrome.storage.local.get('hubspotApiKey', result => {
  if (result.hubspotApiKey) {
    hsKeyInput.value = result.hubspotApiKey;
    showStatus(hsStatusMsg, 'HubSpot token is saved and active.', 'success');
  }
});

hsToggleBtn?.addEventListener('click', () => makeToggle(hsKeyInput, hsToggleBtn, null));

hsSaveBtn?.addEventListener('click', () => {
  const key = hsKeyInput.value.trim();
  if (!key) { showStatus(hsStatusMsg, 'Please enter a token.', 'error'); return; }
  if (!key.startsWith('pat-')) {
    showStatus(hsStatusMsg, 'Invalid format. HubSpot private app tokens start with "pat-".', 'error');
    return;
  }
  chrome.storage.local.set({ hubspotApiKey: key }, () => {
    showStatus(hsStatusMsg, 'HubSpot token saved.', 'success');
  });
});

hsClearBtn?.addEventListener('click', () => {
  chrome.storage.local.remove('hubspotApiKey', () => {
    hsKeyInput.value = '';
    showStatus(hsStatusMsg, 'HubSpot token cleared.', 'info');
  });
});

hsKeyInput?.addEventListener('keydown', e => { if (e.key === 'Enter') hsSaveBtn?.click(); });

// ── Content Creator Profile ────────────────────────────────────────────────────
const creatorDomainTagState = { domains: [] };

function renderCreatorDomainTags() {
  const container = document.getElementById('creator-domain-tags');
  if (!container) return;
  container.innerHTML = creatorDomainTagState.domains.map((t, i) => `
    <span class="tag tag-target">
      ${escapeHtml(t)}
      <button type="button" class="tag-remove" data-idx="${i}" aria-label="Remove">&times;</button>
    </span>`).join('');
  container.querySelectorAll('.tag-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      creatorDomainTagState.domains.splice(Number(btn.dataset.idx), 1);
      renderCreatorDomainTags();
    });
  });
}

const creatorDomainInput = document.getElementById('creator-domain-input');
if (creatorDomainInput) {
  creatorDomainInput.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      const val = creatorDomainInput.value.trim().replace(/,$/, '');
      if (val && !creatorDomainTagState.domains.some(t => t.toLowerCase() === val.toLowerCase())) {
        creatorDomainTagState.domains.push(val);
        renderCreatorDomainTags();
      }
      creatorDomainInput.value = '';
    } else if (e.key === 'Backspace' && !creatorDomainInput.value && creatorDomainTagState.domains.length) {
      creatorDomainTagState.domains.pop();
      renderCreatorDomainTags();
    }
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
  chrome.storage.local.set({ creatorProfile }, () => {
    showStatus(document.getElementById('creator-status'), 'Content profile saved.', 'success');
  });
});

// ── Company Profile ────────────────────────────────────────────────────────────
chrome.storage.local.get('companyProfile', r => {
  const p = r.companyProfile || {};
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('co-name', p.name);
  setVal('co-industry', p.industry);
  setVal('co-about', p.about);
  setVal('co-products', p.products);
  setVal('co-icp', p.icp);
  setVal('co-goal', p.goal);
  setVal('co-style', p.postStyle);
});

document.getElementById('co-save-btn')?.addEventListener('click', () => {
  const raw = {
    name:      document.getElementById('co-name')?.value.trim(),
    industry:  document.getElementById('co-industry')?.value.trim(),
    about:     document.getElementById('co-about')?.value.trim(),
    products:  document.getElementById('co-products')?.value.trim(),
    icp:       document.getElementById('co-icp')?.value.trim(),
    goal:      document.getElementById('co-goal')?.value,
    postStyle: document.getElementById('co-style')?.value,
  };
  const companyProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ companyProfile }, () => {
    showStatus(document.getElementById('co-status'), 'Company profile saved.', 'success');
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
  if (type === 'success') {
    setTimeout(() => { if (el.textContent === message) el.textContent = ''; }, 4000);
  }
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
