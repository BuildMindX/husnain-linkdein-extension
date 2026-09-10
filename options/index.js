// ── Onboarding flow ───────────────────────────────────────────────────────────
function showOnboarding(googleUser) {
  const overlay = document.getElementById('onboarding-overlay');
  if (!overlay) return;
  overlay.style.display = 'flex';

  // Populate user row
  const userRow = document.getElementById('ob-user-row');
  if (userRow && googleUser) {
    userRow.innerHTML = `
      ${googleUser.picture ? `<img src="${googleUser.picture}" width="40" height="40" alt="" class="ob-avatar" />` : ''}
      <div class="ob-user-info">
        <div class="ob-user-name">${googleUser.name || ''}</div>
        <div class="ob-user-email">${googleUser.email || ''}</div>
      </div>
    `;
  }

  // Step navigation — Welcome → Mode choice → Connect OpenAI → Pricing
  function goToObStep(id) {
    overlay.querySelectorAll('.ob-step').forEach(s => s.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
  }

  document.getElementById('ob-welcome-next').addEventListener('click', () => goToObStep('ob-step-mode'));

  // Mode choice — asks explicitly instead of silently defaulting to B2B Sales the way an empty
  // analysisIntent used to. The click handling/persistence itself is the existing global
  // modeCards logic further down this file (these buttons share the same .mode-card markup and
  // data-intent attribute) — this only needs to unlock the Continue button once a real choice
  // has been made.
  const obModeNextBtn = document.getElementById('ob-mode-next');
  overlay.querySelectorAll('#ob-mode-selector .mode-card').forEach(card => {
    card.addEventListener('click', () => { obModeNextBtn.disabled = false; });
  });
  obModeNextBtn.addEventListener('click', () => goToObStep('ob-step-apikey'));

  // Connect OpenAI — the product does nothing without this key, and previously nothing in
  // onboarding ever said so; a user could sail through Welcome/Pricing and only discover the
  // requirement after a confusing failure back on LinkedIn.
  const obApiKeyInput = document.getElementById('ob-api-key-input');
  const obApiKeyStatus = document.getElementById('ob-apikey-status');
  document.getElementById('ob-apikey-save').addEventListener('click', () => {
    const key = obApiKeyInput.value.trim();
    if (!key) { showStatus(obApiKeyStatus, 'Please enter an API key.', 'error'); return; }
    if (!key.startsWith('sk-')) { showStatus(obApiKeyStatus, 'Invalid format. OpenAI keys start with "sk-".', 'error'); return; }
    chrome.storage.local.set({ openaiApiKey: key }, () => {
      if (apiKeyInput) apiKeyInput.value = key; // keep the Integrations tab in sync
      goToObStep('ob-step-pricing');
    });
  });
  document.getElementById('ob-apikey-skip').addEventListener('click', () => goToObStep('ob-step-pricing'));

  // Start Free — land on the mode picker (Outreach tab) rather than a blank Account
  // tab, so a new free user is immediately prompted to pick a mode and fill in the
  // basic config that mode needs, instead of seeing nothing to do.
  document.getElementById('ob-start-free').addEventListener('click', () => {
    chrome.storage.local.remove('pendingOnboarding');
    overlay.style.display = 'none';
    switchTab('outreach');
  });

  // Skip — same landing spot as Start Free, for the same reason.
  document.getElementById('ob-skip').addEventListener('click', () => {
    chrome.storage.local.remove('pendingOnboarding');
    overlay.style.display = 'none';
    switchTab('outreach');
  });

  // Upgrade to Pro
  document.getElementById('ob-start-pro').addEventListener('click', () => {
    const btn = document.getElementById('ob-start-pro');
    const status = document.getElementById('ob-pro-status');
    btn.disabled = true;
    btn.textContent = 'Opening checkout…';
    status.textContent = '';
    chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, res => {
      if (res?.url) {
        chrome.storage.local.remove('pendingOnboarding');
        chrome.tabs.create({ url: res.url, active: true });
        overlay.style.display = 'none';
      } else {
        btn.disabled = false;
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Upgrade to Pro`;
        status.textContent = res?.error || 'Couldn\'t start checkout — try again in a moment.';
        status.style.color = '#f87171';
      }
    });
  });
}

// Check for pending onboarding on page load
chrome.storage.local.get(['pendingOnboarding', 'googleUser'], r => {
  if (r.pendingOnboarding) showOnboarding(r.googleUser || null);
});

// ── Auth State ────────────────────────────────────────────────────────────────
let _signedIn = false;

let _pipelineHashHandled = false;
function maybeOpenPipelineFromHash() {
  if (_pipelineHashHandled || !_signedIn || location.hash !== '#pipeline') return;
  _pipelineHashHandled = true;
  switchTab('pipeline');
}

function setAuthState(signedIn) {
  _signedIn = signedIn;
  // Lock/unlock nav items
  document.querySelectorAll('.snav-item').forEach(btn => {
    const isAccount = btn.dataset.tab === 'account';
    btn.classList.toggle('nav-locked', !signedIn && !isAccount);
  });
  if (!signedIn) switchTab('account');
  else maybeOpenPipelineFromHash();
}

// ── Tab Navigation ────────────────────────────────────────────────────────────
function switchTab(tab) {
  document.querySelectorAll('.snav-item').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.stab-panel').forEach(p => p.classList.toggle('hidden', p.id !== `panel-${tab}`));
}

document.querySelectorAll('.snav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (!_signedIn && btn.dataset.tab !== 'account') return;
    switchTab(btn.dataset.tab);
  });
});

// ── Auth Gate: check on load and react to sign-in/sign-out in real time ───────
chrome.storage.local.get('googleUser', r => setAuthState(!!r.googleUser));

// Per-field last-modified timestamps for everything in SYNC_KEYS — pushed to the cloud alongside
// the settings themselves so a sign-in restore (background/auth.js's handleGoogleSignIn) can merge
// field-by-field (keep whichever side edited that specific field more recently) instead of the
// cloud snapshot blindly overwriting every local field, sales-config included, just because one
// field changed on another device. Same per-field-timestamp philosophy as mergeSavedContacts, just
// applied to the settings blob instead of the contacts array.
let _fieldTimestamps = {};
chrome.storage.local.get('settingsFieldTimestamps', r => { _fieldTimestamps = r.settingsFieldTimestamps || {}; });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('googleUser' in changes) setAuthState(!!changes.googleUser.newValue);
  const changedKeys = SYNC_KEYS.filter(k => k in changes);
  if (changedKeys.length) {
    const now = Date.now();
    changedKeys.forEach(k => { _fieldTimestamps[k] = now; });
    chrome.storage.local.set({ settingsFieldTimestamps: _fieldTimestamps });
  }
  if (_signedIn && changedKeys.length) syncSettingsToCloud();
});

// Must stay identical to background/auth.js's SETTINGS_KEYS — this is what actually gets pushed
// to the cloud (syncSettingsToCloud below), while SETTINGS_KEYS governs what a sign-in restore
// merges back in. icpProfiles/activeIcpProfileId were added to SETTINGS_KEYS when multi-profile
// support shipped but missed here, meaning profile data was never actually reaching the cloud at
// all despite editing it locally — a real, silent cross-device sync gap, separate from the
// tagState reference-aliasing bug fixed above.
const SYNC_KEYS = [
  'analysisIntent',
  'targetIndustries', 'excludeIndustries', 'businessProfile',
  'icpProfiles', 'activeIcpProfileId',
  'messagePresets', 'b2cProfile', 'jobProfile',
  'b2cMessagePresets', 'jobMessagePresets', 'b2cTargetIndustries', 'b2cExcludeIndustries',
  'creatorProfile', 'companyProfile', 'reminderSettings',
  'openaiApiKey', 'hubspotApiKey',
];

let _syncDebounceTimer = null;
function syncSettingsToCloud() {
  clearTimeout(_syncDebounceTimer);
  _syncDebounceTimer = setTimeout(() => {
    chrome.storage.local.get([...SYNC_KEYS, 'settingsFieldTimestamps'], settings => {
      chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
    });
  }, 1500);
}

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
    desc: 'The AI reads each LinkedIn profile and tells you exactly how valuable this contact is for your pipeline — in seconds. Works on standard LinkedIn profiles and search; Sales Navigator support is coming soon.',
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
// Scoped to the Outreach tab's own selector, not just `.mode-card` — the onboarding overlay's
// mode-choice step (added below) reuses the same card markup/class for visual consistency but
// needs its own independent click handling, not this one.
const modeCards = document.querySelectorAll('#mode-selector .mode-card');
const intentStatus = document.getElementById('intent-status');

function applyIntentVisibility(intent) {
  const isSales = intent === 'b2b_sales';
  const isB2c   = intent === 'b2c_sales';
  const isJob   = intent === 'job_search';

  document.getElementById('icp-profile-switcher')?.classList.toggle('hidden', !isSales);
  document.getElementById('sales-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('business-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('message-config')?.classList.toggle('hidden', !isSales);
  document.getElementById('b2c-config')?.classList.toggle('hidden', !isB2c);
  document.getElementById('b2c-icp-config')?.classList.toggle('hidden', !isB2c);
  document.getElementById('b2c-message-config')?.classList.toggle('hidden', !isB2c);
  document.getElementById('job-config')?.classList.toggle('hidden', !isJob);
  document.getElementById('job-message-config')?.classList.toggle('hidden', !isJob);

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

document.getElementById('icp-save-btn')?.addEventListener('click', () => {
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState);
  if (!active) return;
  active.targetIndustries = tagState.targets;
  active.excludeIndustries = tagState.excludes;
  persistIcpProfiles().then(() => showStatus(document.getElementById('icp-status'), 'ICP saved.', 'success'));
});

document.getElementById('icp-reset-btn')?.addEventListener('click', () => {
  tagState.excludes = [...DEFAULT_EXCLUDES];
  renderTags('excludes');
  showStatus(document.getElementById('icp-status'), 'Excludes reset to default — click Save ICP to keep.', 'info');
});

// Generic version of the tag-input ICP setup above, reusable for Freelance's own target/exclude
// industries — kept separate from tagState/renderTags/wireTagInput above (B2B-only, already wired
// with a default-excludes reset button that doesn't apply to B2C) rather than generalizing working
// code just to add one more caller.
function setupTagCard({ targetsId, targetInputId, excludesId, excludeInputId, saveBtnId, statusId, storageKeys }) {
  const state = { targets: [], excludes: [] };
  const [targetKey, excludeKey] = storageKeys;

  function render(kind) {
    const id = kind === 'targets' ? targetsId : excludesId;
    const cls = kind === 'targets' ? 'tag-target' : 'tag-exclude';
    const container = document.getElementById(id);
    if (!container) return;
    container.innerHTML = state[kind].map((t, i) => `
      <span class="tag ${cls}">${escapeHtml(t)}
        <button type="button" class="tag-remove" data-kind="${kind}" data-idx="${i}" aria-label="Remove">&times;</button>
      </span>`).join('');
    container.querySelectorAll('.tag-remove').forEach(btn =>
      btn.addEventListener('click', () => { state[btn.dataset.kind].splice(Number(btn.dataset.idx), 1); render(btn.dataset.kind); }));
  }

  function wireInput(inputId, kind) {
    const input = document.getElementById(inputId);
    if (!input) return;
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ',') {
        e.preventDefault();
        const val = input.value.trim().replace(/,$/, '');
        if (val && !state[kind].some(t => t.toLowerCase() === val.toLowerCase())) { state[kind].push(val); render(kind); }
        input.value = '';
      } else if (e.key === 'Backspace' && !input.value && state[kind].length) { state[kind].pop(); render(kind); }
    });
  }

  function load(targets, excludes) {
    state.targets = Array.isArray(targets) ? targets : [];
    state.excludes = Array.isArray(excludes) ? excludes : [];
    render('targets');
    render('excludes');
  }

  wireInput(targetInputId, 'targets');
  wireInput(excludeInputId, 'excludes');
  chrome.storage.local.get(storageKeys, r => load(r[targetKey], r[excludeKey]));

  document.getElementById(saveBtnId)?.addEventListener('click', () => {
    chrome.storage.local.set({ [targetKey]: state.targets, [excludeKey]: state.excludes }, () =>
      showStatus(document.getElementById(statusId), 'Target industries saved.', 'success'));
  });

  return { load };
}

const b2cIcpCard = setupTagCard({
  targetsId: 'b2c-target-tags', targetInputId: 'b2c-target-input',
  excludesId: 'b2c-exclude-tags', excludeInputId: 'b2c-exclude-input',
  saveBtnId: 'b2c-icp-save-btn', statusId: 'b2c-icp-status',
  storageKeys: ['b2cTargetIndustries', 'b2cExcludeIndustries'],
});

// ── Business Profile ──────────────────────────────────────────────────────────
const bizFields = { expertise: 'biz-expertise', offer: 'biz-offer', idealCustomer: 'biz-customer', problem: 'biz-problem', valueProp: 'biz-valueprop', senderName: 'biz-name', companyName: 'biz-company' };

document.getElementById('biz-save-btn')?.addEventListener('click', () => {
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState);
  if (!active) return;
  const businessProfile = {};
  Object.entries(bizFields).forEach(([key, id]) => { const v = document.getElementById(id)?.value.trim(); if (v) businessProfile[key] = v; });
  active.businessProfile = businessProfile;
  persistIcpProfiles().then(() => showStatus(document.getElementById('biz-status'), 'Business profile saved.', 'success'));
});

// ── ICP / Business Profiles (multiple saved targeting profiles) ────────────────
// One "active" profile at a time, same model the ICP/Business Profile cards above always had —
// this just makes it possible to save more than one and switch, for a user who sells to more than
// one kind of buyer. Migrates the old flat targetIndustries/excludeIndustries/businessProfile keys
// into a single "Default" profile the first time this runs, exactly once (mirrors the same
// migration in background/ai.js's ensureIcpProfilesMigrated, since content/background/options share
// no bundler here — same duplication pattern already used for SETTINGS_KEYS elsewhere).
let icpProfilesState = [];
let activeIcpProfileIdState = null;

function genIcpProfileId() {
  return `icp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function persistIcpProfiles() {
  return new Promise(resolve => {
    chrome.storage.local.set({ icpProfiles: icpProfilesState, activeIcpProfileId: activeIcpProfileIdState }, resolve);
  });
}

function renderIcpProfileSelect() {
  const sel = document.getElementById('icp-profile-select');
  if (!sel) return;
  sel.innerHTML = icpProfilesState.map(p =>
    `<option value="${escapeHtml(p.id)}" ${p.id === activeIcpProfileIdState ? 'selected' : ''}>${escapeHtml(p.name)}</option>`
  ).join('');
}

function loadActiveIcpProfileIntoForm() {
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState) || icpProfilesState[0];
  if (!active) return;
  // Copy, never alias — assigning active.targetIndustries directly made tagState.targets the
  // SAME array object, so every tag typed/removed mutated the profile in storage in place, with
  // no Save click involved at all. That looked like it "just worked" — until icpProfilesState got
  // rebuilt from a fresh storage read (initIcpProfiles() re-running after sign-in), which replaces
  // every profile with newly-deserialized objects and leaves tagState pointing at a now-detached,
  // orphaned array. Anything typed after that point had nothing real to land in and was silently
  // lost — the exact "filled it in, refreshed, gone" bug this fixes.
  tagState.targets = Array.isArray(active.targetIndustries) ? [...active.targetIndustries] : [];
  tagState.excludes = Array.isArray(active.excludeIndustries) ? [...active.excludeIndustries] : [...DEFAULT_EXCLUDES];
  renderTags('targets');
  renderTags('excludes');
  const b = active.businessProfile || {};
  Object.entries(bizFields).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = b[k] || ''; });
}

// Safety net for switching away from a profile with edits still sitting in the form, unsaved —
// commits whatever's currently typed into the OLD active profile before the switch, so creating
// or picking a different profile can never silently discard in-progress work just because the
// user didn't click Save ICP / Save Business Profile first.
function commitFormIntoActiveProfile() {
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState);
  if (!active) return;
  active.targetIndustries = [...tagState.targets];
  active.excludeIndustries = [...tagState.excludes];
  const businessProfile = {};
  Object.entries(bizFields).forEach(([key, id]) => { const v = document.getElementById(id)?.value.trim(); if (v) businessProfile[key] = v; });
  active.businessProfile = businessProfile;
}

function initIcpProfiles() {
  chrome.storage.local.get(['icpProfiles', 'activeIcpProfileId', 'targetIndustries', 'excludeIndustries', 'businessProfile'], r => {
    if (Array.isArray(r.icpProfiles) && r.icpProfiles.length) {
      icpProfilesState = r.icpProfiles;
      activeIcpProfileIdState = r.activeIcpProfileId && icpProfilesState.some(p => p.id === r.activeIcpProfileId)
        ? r.activeIcpProfileId : icpProfilesState[0].id;
    } else {
      const defaultProfile = {
        id: genIcpProfileId(),
        name: 'Default',
        targetIndustries: Array.isArray(r.targetIndustries) ? r.targetIndustries : [],
        excludeIndustries: Array.isArray(r.excludeIndustries) ? r.excludeIndustries : [...DEFAULT_EXCLUDES],
        businessProfile: r.businessProfile || {},
      };
      icpProfilesState = [defaultProfile];
      activeIcpProfileIdState = defaultProfile.id;
      persistIcpProfiles();
    }
    renderIcpProfileSelect();
    loadActiveIcpProfileIntoForm();
  });
}
initIcpProfiles();

document.getElementById('icp-profile-select')?.addEventListener('change', (e) => {
  commitFormIntoActiveProfile();
  activeIcpProfileIdState = e.target.value;
  loadActiveIcpProfileIntoForm();
  persistIcpProfiles();
});

document.getElementById('icp-profile-new-btn')?.addEventListener('click', () => {
  const name = (window.prompt('Name this profile — e.g. "Healthcare clients"', '') || '').trim();
  if (!name) return;
  commitFormIntoActiveProfile();
  const newProfile = { id: genIcpProfileId(), name, targetIndustries: [], excludeIndustries: [...DEFAULT_EXCLUDES], businessProfile: {} };
  icpProfilesState.push(newProfile);
  activeIcpProfileIdState = newProfile.id;
  renderIcpProfileSelect();
  loadActiveIcpProfileIntoForm();
  persistIcpProfiles();
  showStatus(document.getElementById('icp-profile-status'), `Created "${name}" — fill in its ICP and Business Profile below, then save each.`, 'success');
});

document.getElementById('icp-profile-rename-btn')?.addEventListener('click', () => {
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState);
  if (!active) return;
  const name = (window.prompt('Rename this profile', active.name) || '').trim();
  if (!name) return;
  active.name = name;
  renderIcpProfileSelect();
  persistIcpProfiles();
  showStatus(document.getElementById('icp-profile-status'), 'Renamed.', 'success');
});

document.getElementById('icp-profile-delete-btn')?.addEventListener('click', () => {
  if (icpProfilesState.length <= 1) {
    showStatus(document.getElementById('icp-profile-status'), "Can't delete your only profile.", 'info');
    return;
  }
  const active = icpProfilesState.find(p => p.id === activeIcpProfileIdState);
  if (!active) return;
  if (!window.confirm(`Delete "${active.name}"? This can't be undone.`)) return;
  icpProfilesState = icpProfilesState.filter(p => p.id !== active.id);
  activeIcpProfileIdState = icpProfilesState[0].id;
  renderIcpProfileSelect();
  loadActiveIcpProfileIntoForm();
  persistIcpProfiles();
  showStatus(document.getElementById('icp-profile-status'), 'Deleted.', 'success');
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

// Generic version of the tone/length/CTA setup above, reusable for B2C and Job Search's own
// message-style cards — kept separate from msgState/wireSeg/renderSeg above (those are B2B-only
// and already wired) rather than generalizing working code just to add two more callers.
function setupStyleCard({ toneSegId, lengthSegId, ctaToggleId, ctaTextId, saveBtnId, statusId, storageKey }) {
  const state = { tone: 'warm', length: 'standard', includeCta: false, ctaText: '' };
  const ctaToggleEl = document.getElementById(ctaToggleId);
  const ctaTextInput = document.getElementById(ctaTextId);

  function render() {
    document.querySelectorAll(`#${toneSegId} button`).forEach(b => b.classList.toggle('active', b.dataset.val === state.tone));
    document.querySelectorAll(`#${lengthSegId} button`).forEach(b => b.classList.toggle('active', b.dataset.val === state.length));
  }

  function load(presets) {
    const p = presets || {};
    state.tone = p.tone || 'warm';
    state.length = p.length || 'standard';
    state.includeCta = !!p.includeCta;
    state.ctaText = p.ctaText || '';
    render();
    if (ctaToggleEl) ctaToggleEl.checked = state.includeCta;
    if (ctaTextInput) ctaTextInput.value = state.ctaText;
  }

  document.querySelectorAll(`#${toneSegId} button`).forEach(btn =>
    btn.addEventListener('click', () => { state.tone = btn.dataset.val; render(); }));
  document.querySelectorAll(`#${lengthSegId} button`).forEach(btn =>
    btn.addEventListener('click', () => { state.length = btn.dataset.val; render(); }));

  chrome.storage.local.get(storageKey, r => load(r[storageKey]));

  document.getElementById(saveBtnId)?.addEventListener('click', () => {
    const presets = { tone: state.tone, length: state.length, includeCta: ctaToggleEl?.checked || false, ctaText: ctaTextInput?.value.trim() || '' };
    chrome.storage.local.set({ [storageKey]: presets }, () => showStatus(document.getElementById(statusId), 'Message style saved.', 'success'));
  });

  return { load };
}

const b2cStyleCard = setupStyleCard({
  toneSegId: 'b2c-tone-seg', lengthSegId: 'b2c-length-seg',
  ctaToggleId: 'b2c-cta-toggle', ctaTextId: 'b2c-cta-text',
  saveBtnId: 'b2c-msg-save-btn', statusId: 'b2c-msg-status',
  storageKey: 'b2cMessagePresets',
});
const jobStyleCard = setupStyleCard({
  toneSegId: 'job-tone-seg', lengthSegId: 'job-length-seg',
  ctaToggleId: 'job-cta-toggle', ctaTextId: 'job-cta-text',
  saveBtnId: 'job-msg-save-btn', statusId: 'job-msg-status',
  storageKey: 'jobMessagePresets',
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

hsToggleBtn?.addEventListener('click', () => makeToggle(hsKeyInput, hsToggleBtn, 'hs-eye-icon'));

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

// Post Creator's creatorProfile/companyProfile and the messaging businessProfile are separate
// storage keys with no shared source of truth — a user fills out "what I do / who I sell to"
// twice, and the two can silently drift. Rather than merging the schemas (real risk of breaking
// either flow), this is a one-click, blanks-only prefill: existing values are never overwritten.
document.getElementById('creator-prefill-btn')?.addEventListener('click', () => {
  // Reads whichever ICP profile is currently active (see "ICP / Business Profiles" above) —
  // in-memory state already populated by initIcpProfiles(), which runs at load regardless of
  // which settings tab happens to be visible.
  const b = (icpProfilesState.find(p => p.id === activeIcpProfileIdState) || {}).businessProfile || {};
  if (!Object.keys(b).length) {
    showStatus(document.getElementById('creator-status'), 'No Business Profile found — fill it in under Outreach settings first.', 'info');
    return;
  }
  const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
  fillIfEmpty('creator-name', b.senderName);
  fillIfEmpty('creator-audience', b.idealCustomer);
  if (b.expertise && !creatorDomainTagState.domains.length) {
    b.expertise.split(',').map(s => s.trim()).filter(Boolean).forEach(t => {
      if (!creatorDomainTagState.domains.some(existing => existing.toLowerCase() === t.toLowerCase())) creatorDomainTagState.domains.push(t);
    });
    renderCreatorDomainTags();
  }
  showStatus(document.getElementById('creator-status'), 'Filled in from your Business Profile — review and save.', 'success');
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

document.getElementById('co-prefill-btn')?.addEventListener('click', () => {
  const b = (icpProfilesState.find(p => p.id === activeIcpProfileIdState) || {}).businessProfile || {};
  if (!Object.keys(b).length) {
    showStatus(document.getElementById('co-status'), 'No Business Profile found — fill it in under Outreach settings first.', 'info');
    return;
  }
  const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
  fillIfEmpty('co-name', b.companyName);
  fillIfEmpty('co-products', b.offer);
  fillIfEmpty('co-icp', b.idealCustomer);
  showStatus(document.getElementById('co-status'), 'Filled in from your Business Profile — review and save.', 'success');
});

document.getElementById('co-save-btn')?.addEventListener('click', () => {
  const raw = { name: document.getElementById('co-name')?.value.trim(), industry: document.getElementById('co-industry')?.value.trim(), about: document.getElementById('co-about')?.value.trim(), products: document.getElementById('co-products')?.value.trim(), icp: document.getElementById('co-icp')?.value.trim(), goal: document.getElementById('co-goal')?.value, postStyle: document.getElementById('co-style')?.value };
  const companyProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ companyProfile }, () => showStatus(document.getElementById('co-status'), 'Company profile saved.', 'success'));
});

// ── Reload all form fields from storage (called after sign-in) ────────────────
function loadAllSettings() {
  chrome.storage.local.get([
    'analysisIntent', 'messagePresets', 'b2cProfile', 'jobProfile',
    'b2cMessagePresets', 'jobMessagePresets', 'b2cTargetIndustries', 'b2cExcludeIndustries',
    'openaiApiKey', 'hubspotApiKey', 'creatorProfile', 'companyProfile', 'reminderSettings',
  ], r => {
    // Mode
    const intent = r.analysisIntent || 'b2b_sales';
    modeCards.forEach(c => c.classList.toggle('active', c.dataset.intent === intent));
    applyIntentVisibility(intent);

    // ICP / Business profile — re-fetches its own keys (icpProfiles may have just changed via
    // cloud sync restore, which this generic loop above doesn't know how to merge itself)
    initIcpProfiles();

    // Message presets
    const mp = r.messagePresets || {};
    msgState.tone = mp.tone || 'warm';
    msgState.length = mp.length || 'standard';
    msgState.includeCta = !!mp.includeCta;
    msgState.ctaText = mp.ctaText || '';
    renderSeg('tone-seg', msgState.tone);
    renderSeg('length-seg', msgState.length);
    if (ctaToggle) ctaToggle.checked = msgState.includeCta;
    if (ctaTextEl) ctaTextEl.value = msgState.ctaText;

    // B2C profile
    const b2c = r.b2cProfile || {};
    Object.entries(b2cFields).forEach(([k, id]) => { const el = document.getElementById(id); if (el) el.value = b2c[k] || ''; });

    // Job profile
    const job = r.jobProfile || {};
    const sv = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    sv('job-name', job.senderName); sv('job-title', job.currentTitle);
    sv('job-background', job.background); sv('job-years', job.yearsExp);
    jobTagState.roles = Array.isArray(job.targetRoles) ? job.targetRoles : [];
    jobTagState.industries = Array.isArray(job.targetIndustries) ? job.targetIndustries : [];
    renderJobTags('roles');
    renderJobTags('industries');

    // B2C / Job Search message style (separate presets from B2B's)
    b2cStyleCard.load(r.b2cMessagePresets);
    jobStyleCard.load(r.jobMessagePresets);

    // B2C's own target/exclude industries (separate from B2B's ICP)
    b2cIcpCard.load(r.b2cTargetIndustries, r.b2cExcludeIndustries);

    // Reminder settings
    loadReminderSettingsUI(r.reminderSettings);

    // API keys
    if (apiKeyInput) {
      apiKeyInput.value = r.openaiApiKey || '';
      if (r.openaiApiKey) showStatus(statusMsg, 'API key is saved and active.', 'success');
    }
    if (hsKeyInput) {
      hsKeyInput.value = r.hubspotApiKey || '';
      if (r.hubspotApiKey) showStatus(hsStatusMsg, 'HubSpot token is saved and active.', 'success');
    }

    // Creator profile
    const cp = r.creatorProfile || {};
    const svc = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    svc('creator-name', cp.name); svc('creator-linkedin-url', cp.linkedinUrl);
    svc('creator-audience', cp.audience); svc('creator-goal', cp.goal); svc('creator-style', cp.postStyle);
    creatorDomainTagState.domains = Array.isArray(cp.domains) ? cp.domains : [];
    renderCreatorDomainTags();

    // Company profile
    const co = r.companyProfile || {};
    const sco = (id, v) => { const el = document.getElementById(id); if (el) el.value = v || ''; };
    sco('co-name', co.name); sco('co-industry', co.industry); sco('co-about', co.about);
    sco('co-products', co.products); sco('co-icp', co.icp); sco('co-goal', co.goal); sco('co-style', co.postStyle);
  });
}

// ── Google Account ────────────────────────────────────────────────────────────
function renderAccountTab(user, plan) {
  const section = document.getElementById('google-auth-section');
  if (!section) return;
  const isPro = plan === 'pro';

  const subEl = document.getElementById('account-panel-sub');
  if (subEl) {
    subEl.textContent = user
      ? `Signed in as ${user.name || user.email || 'your Google account'} — manage your account and subscription below.`
      : 'Sign in with Google to sync your settings across devices and enable personalized features.';
  }

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
        <button type="button" id="manage-sub-btn" class="btn-manage-sub">Manage subscription</button>
        <div id="manage-sub-status" class="account-status-msg" style="display:none;margin-top:6px"></div>
      </div>`}
      <button type="button" id="view-plans-btn" class="btn-view-plans">View plans &amp; pricing</button>`;

    document.getElementById('sign-out-btn')?.addEventListener('click', handleGoogleSignOut);
    document.getElementById('upgrade-btn')?.addEventListener('click', handleUpgrade);
    document.getElementById('manage-sub-btn')?.addEventListener('click', handleManageSubscription);
    document.getElementById('view-plans-btn')?.addEventListener('click', () => {
      const overlay = document.getElementById('onboarding-overlay');
      if (overlay) overlay.style.display = 'flex';
    });
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
    loadAllSettings();
    // Signing in straight from the Account tab skips the popup's new-user onboarding path —
    // surface the same overlay here so a brand-new user still gets it.
    if (response.isNew) showOnboarding(response.user);
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
    chrome.tabs.create({ url: response.url, active: true });
  });
}

function handleManageSubscription() {
  const btn = document.getElementById('manage-sub-btn');
  const statusEl = document.getElementById('manage-sub-status');
  if (!btn) return;
  btn.disabled = true;
  btn.textContent = 'Opening…';
  if (statusEl) statusEl.style.display = 'none';
  chrome.runtime.sendMessage({ type: 'OPEN_BILLING_PORTAL' }, response => {
    btn.disabled = false;
    btn.textContent = 'Manage subscription';
    if (chrome.runtime.lastError || !response?.url) {
      if (statusEl) { statusEl.textContent = response?.error || 'Could not open billing portal. Try again.'; statusEl.style.display = ''; }
      return;
    }
    chrome.tabs.create({ url: response.url, active: true });
  });
}

chrome.storage.local.get(['googleUser', 'userPlan'], r => {
  renderAccountTab(r.googleUser || null, r.userPlan || 'free');
  if (r.googleUser) {
    chrome.runtime.sendMessage({ type: 'SYNC_PLAN' }, res => {
      if (res?.plan && res.plan !== (r.userPlan || 'free')) {
        renderAccountTab(r.googleUser, res.plan);
      }
    });
  }
});

// ── Privacy Policy ────────────────────────────────────────────────────────────
document.getElementById('open-privacy-btn')?.addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('privacy.html'), active: true });
});

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

// ── Pipeline Dashboard ─────────────────────────────────────────────────────────
// Stage constants duplicated from popup/index.js (same values as content/index.js's
// STAGE_ORDER) — no shared-module bundler here, same pattern already used for
// SETTINGS_KEYS/SYNC_KEYS between auth.js and options/index.js.
const STAGE_META = {
  new:             { label: 'New',            color: '#94a3b8' },
  connection_sent: { label: 'Connection Sent', color: '#38bdf8' },
  messaged:        { label: 'Messaged',        color: '#38bdf8' },
  followup_1:      { label: 'Follow-up 1',     color: '#d97706' },
  followup_2:      { label: 'Follow-up 2',     color: '#d97706' },
  followup_3plus:  { label: 'Follow-up 3+',    color: '#d97706' },
  replied:         { label: 'Replied',         color: '#16a34a' },
  booked:          { label: 'Booked',          color: '#16a34a' },
  closed:          { label: 'Closed',          color: '#6b7280' },
};
const STAGE_ORDER = Object.keys(STAGE_META);
// "Booked"/"Closed" are sales-deal language that don't map onto a job seeker's mental model —
// swap in interview/hired framing for job_search contacts. Same override, duplicated in
// content/index.js and popup/index.js alongside their own STAGE_META copies.
const JOB_STAGE_LABELS = { booked: 'Interview', closed: 'Hired' };
function stageLabel(stage, intent) {
  if (intent === 'job_search' && JOB_STAGE_LABELS[stage]) return JOB_STAGE_LABELS[stage];
  return STAGE_META[stage]?.label || 'New';
}

// Transparent, explainable "how warm is this relationship right now" signal — built only from
// data already tracked (stage, days since last touch, AI fit score). Duplicated in
// content/index.js, same pattern as STAGE_META/stageLabel above. Deliberately NOT framed as a
// "% chance to close": there's no historical outcome data to calibrate a real probability from,
// and a fabricated number would be worse than none — it could mislead a rep into dropping a good
// lead or chasing a dead one. booked/closed aren't scored — the stage itself already says "done,"
// a warmth number there would just add noise.
const STAGE_ENGAGEMENT_BASE = {
  new: 25, connection_sent: 25,
  messaged: 45,
  followup_1: 55,
  followup_2: 60,
  followup_3plus: 40,
  replied: 80,
};
const ENGAGEMENT_TIER_COLOR = { Hot: '#ef4444', Warm: '#f59e0b', Cooling: '#38bdf8', Stalled: '#6b7280' };

function computeEngagementScore(contact) {
  const stage = STAGE_META[contact?.stage] ? contact.stage : 'new';
  if (stage === 'booked' || stage === 'closed') return null;
  const base = STAGE_ENGAGEMENT_BASE[stage] ?? 25;
  const hasReplied = stage === 'replied';

  let recencyPenalty = 0;
  let recencyDays = null;
  if (!hasReplied) {
    const ts = contact?.stageUpdatedAt || contact?.savedAt;
    if (ts) {
      recencyDays = Math.floor((Date.now() - ts) / 86400000);
      // Bases above assume a healthy, on-track touch, so a fresh message never reads as
      // "cooling" — this penalty is what actually pulls the score down as real silence
      // accumulates, not the base stage value itself.
      recencyPenalty = -Math.min(30, Math.max(0, recencyDays - 3) * 2);
    }
  }

  const fitLevel = contact?.score;
  const fitAdjustment = ['High', 'Strong'].includes(fitLevel) ? 8 : ['Low', 'Unlikely'].includes(fitLevel) ? -8 : 0;

  const score = Math.max(0, Math.min(100, Math.round(base + recencyPenalty + fitAdjustment)));
  const tier = score >= 75 ? 'Hot' : score >= 45 ? 'Warm' : score >= 20 ? 'Cooling' : 'Stalled';

  let reason;
  if (hasReplied) {
    reason = 'They’ve replied — the strongest signal there is.';
  } else if (recencyDays !== null && recencyDays > 10 && (stage === 'followup_2' || stage === 'followup_3plus')) {
    reason = `${STAGE_META[stage].label} sent, no reply in ${recencyDays} days — likely time for one final high-value message or to move on.`;
  } else if (stage === 'followup_3plus') {
    reason = 'Several touches sent with no reply yet.';
  } else if (stage === 'new' || stage === 'connection_sent') {
    reason = 'No outreach sent yet.';
  } else {
    reason = `${STAGE_META[stage].label} sent, still inside a normal reply window.`;
  }

  return { score, tier, reason, color: ENGAGEMENT_TIER_COLOR[tier] };
}

// Groups the 9 exact stages into 5 scannable board columns, mirroring STAGE_META's
// existing color families rather than inventing a new taxonomy.
const PIPELINE_COLUMNS = [
  { label: 'New',             color: '#94a3b8', stages: ['new'] },
  { label: 'Reaching Out',    color: '#38bdf8', stages: ['connection_sent', 'messaged'] },
  { label: 'Following Up',    color: '#d97706', stages: ['followup_1', 'followup_2', 'followup_3plus'] },
  { label: 'Replied / Booked',jobLabel: 'Replied / Interview', color: '#16a34a', stages: ['replied', 'booked'] },
  { label: 'Closed',          jobLabel: 'Hired',                color: '#6b7280', stages: ['closed'] },
];

// Only rename a column header when the board is filtered to a single intent — with mixed
// intents on screen, the sales-flavored default is the least-wrong shared label.
function columnLabel(col, intentFilter) {
  return (intentFilter === 'job_search' && col.jobLabel) ? col.jobLabel : col.label;
}

const PIPELINE_SCORE_COLOR = {
  High: '#16a34a', Medium: '#d97706', Low: '#6b7280',
  Strong: '#16a34a', Possible: '#d97706', Unlikely: '#6b7280',
};

function daysInStage(ts) {
  if (!ts) return '';
  const d = Math.floor((Date.now() - ts) / 86400000);
  if (d <= 0) return 'today';
  return d === 1 ? '1d in stage' : `${d}d in stage`;
}

let _pipelineContacts = [];

// Kept in sync with background/reminders.js's REMINDER_STAGES — no shared module between
// background/ and options/, so small constants like this are duplicated per the project's
// existing pattern rather than introducing a bundler for one array.
const REMINDER_STAGES = ['connection_sent', 'messaged', 'followup_1', 'followup_2'];

function renderPipelineBoard() {
  const board = document.getElementById('pipeline-board');
  const empty = document.getElementById('pipeline-empty');
  if (!board) return;

  if (!_pipelineContacts.length) {
    board.innerHTML = '';
    empty?.classList.remove('hidden');
    return;
  }
  empty?.classList.add('hidden');

  const filter = (document.getElementById('pipeline-search')?.value || '').trim().toLowerCase();
  const intentFilter = document.getElementById('pipeline-intent-filter')?.value || '';
  const filtered = _pipelineContacts.filter(c => {
    if (intentFilter && (c.intent || 'b2b_sales') !== intentFilter) return false;
    if (!filter) return true;
    return (c.name || '').toLowerCase().includes(filter) || (c.company || '').toLowerCase().includes(filter);
  });

  board.innerHTML = PIPELINE_COLUMNS.map(col => {
    const items = filtered.filter(c => col.stages.includes(STAGE_META[c.stage] ? c.stage : 'new'));
    const cards = items.map(c => {
      const stage = STAGE_META[c.stage] ? c.stage : 'new';
      const stageColor = STAGE_META[stage].color;
      const scoreColor = PIPELINE_SCORE_COLOR[c.score] || '#6b7280';
      const days = daysInStage(c.stageUpdatedAt || c.savedAt);
      const detail = c.company || c.headline || '';
      const snoozed = c.snoozedUntil && c.snoozedUntil > Date.now();
      const snoozeDaysLeft = snoozed ? Math.max(1, Math.ceil((c.snoozedUntil - Date.now()) / 86400000)) : 0;
      const showSnooze = REMINDER_STAGES.includes(stage);
      const engagement = computeEngagementScore(c);
      return `
        <div class="pipeline-card">
          <div class="pipeline-card-top">
            <span class="pipeline-card-name">${escapeHtml(c.name || 'Unknown')}</span>
            <span class="pipeline-card-top-right">
              <span class="pipeline-card-score" style="color:${scoreColor};border-color:${scoreColor}40;background:${scoreColor}12">${escapeHtml(c.score || '–')}</span>
              <button type="button" class="pipeline-card-remove" data-url="${escapeHtml(c.url)}" title="Remove from pipeline" aria-label="Remove from pipeline">&times;</button>
            </span>
          </div>
          ${detail ? `<div class="pipeline-card-detail">${escapeHtml(detail.slice(0, 60))}</div>` : ''}
          ${engagement ? `<div class="pipeline-card-engagement" title="${escapeHtml(engagement.reason)} — based on your tracked pipeline stage.">
            <span class="pipeline-card-engagement-dot" style="background:${engagement.color}"></span>
            ${engagement.tier} · ${engagement.score}
          </div>` : ''}
          <div class="pipeline-card-bottom">
            <select class="pipeline-card-select" data-url="${escapeHtml(c.url)}" style="color:${stageColor};border-color:${stageColor}55">
              ${STAGE_ORDER.map(s => `<option value="${s}" ${s === stage ? 'selected' : ''}>${stageLabel(s, c.intent)}</option>`).join('')}
            </select>
            ${days ? `<span class="pipeline-card-days">${days}</span>` : ''}
          </div>
          ${showSnooze ? `<button type="button" class="pipeline-card-snooze${snoozed ? ' pipeline-card-snooze-active' : ''}" data-url="${escapeHtml(c.url)}" title="${snoozed ? 'Click to cancel snooze' : ''}">${snoozed ? `😴 Snoozed ${snoozeDaysLeft}d — click to cancel` : '😴 Snooze reminder 3d'}</button>` : ''}
          <a href="${escapeHtml(c.url)}" target="_blank" class="pipeline-card-link">Open on LinkedIn ↗</a>
        </div>`;
    }).join('');

    return `
      <div class="pipeline-column">
        <div class="pipeline-column-header" style="border-color:${col.color}55">
          <span class="pipeline-column-dot" style="background:${col.color}"></span>
          <span>${columnLabel(col, intentFilter)}</span>
          <span class="pipeline-column-count">${items.length}</span>
        </div>
        <div class="pipeline-column-cards">${cards || '<div class="pipeline-column-empty">No contacts</div>'}</div>
      </div>`;
  }).join('');

  board.querySelectorAll('.pipeline-card-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const url = sel.dataset.url;
      await patchSavedContacts(contacts => {
        const entry = contacts.find(c => c.url === url);
        if (entry) { entry.stage = sel.value; entry.stageUpdatedAt = Date.now(); }
      });
    });
  });

  board.querySelectorAll('.pipeline-card-snooze').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      await patchSavedContacts(contacts => {
        const entry = contacts.find(c => c.url === url);
        if (!entry) return;
        // Clicking again while already snoozed cancels it, instead of silently pushing the
        // reminder out another 3 days from whenever it happened to be clicked.
        const currentlySnoozed = entry.snoozedUntil && entry.snoozedUntil > Date.now();
        entry.snoozedUntil = currentlySnoozed ? undefined : Date.now() + 3 * 24 * 60 * 60 * 1000;
      });
      renderPipelineBoard();
    });
  });

  board.querySelectorAll('.pipeline-card-remove').forEach(btn => {
    btn.addEventListener('click', async () => {
      const url = btn.dataset.url;
      const entry = _pipelineContacts.find(c => c.url === url);
      if (!entry) return;
      if (!confirm(`Remove ${entry.name || 'this contact'} from the pipeline?`)) return;
      await patchSavedContacts(contacts => {
        const idx = contacts.findIndex(c => c.url === url);
        if (idx !== -1) contacts.splice(idx, 1);
      });
      renderPipelineBoard();
      renderNotificationsPanel();
    });
  });
}

// Re-reads storage immediately before writing, instead of trusting the possibly-stale
// _pipelineContacts cache (only refreshed by the storage.onChanged listener, which can lag) —
// the content script, popup, and this page can all write this same list independently, so
// writing back a snapshot older than what's actually in storage risks silently discarding
// another surface's more recent edit to a *different* contact.
async function patchSavedContacts(mutateFn) {
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  const fresh = Array.isArray(savedContacts) ? savedContacts : [];
  mutateFn(fresh);
  await chrome.storage.local.set({ savedContacts: fresh });
  _pipelineContacts = fresh;
}

function exportPipelineCSV() {
  const rows = [['Name', 'URL', 'Score', 'Stage', 'Intent', 'Headline', 'Company', 'Saved Date']];
  _pipelineContacts.forEach(c => {
    rows.push([
      c.name || '', c.url || '', c.score || '',
      stageLabel(c.stage, c.intent),
      c.intent || '', c.headline || '', c.company || '',
      c.savedAt ? new Date(c.savedAt).toLocaleDateString() : '',
    ]);
  });
  const csv = rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `linkpilot-pipeline-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

chrome.storage.local.get('savedContacts', r => {
  _pipelineContacts = Array.isArray(r.savedContacts) ? r.savedContacts : [];
  renderPipelineBoard();
  renderNotificationsPanel();
  maybeOpenPipelineFromHash();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('savedContacts' in changes)) return;
  _pipelineContacts = Array.isArray(changes.savedContacts.newValue) ? changes.savedContacts.newValue : [];
  renderPipelineBoard();
  renderNotificationsPanel();
});

document.getElementById('pipeline-search')?.addEventListener('input', renderPipelineBoard);
document.getElementById('pipeline-intent-filter')?.addEventListener('change', renderPipelineBoard);
document.getElementById('pipeline-export-btn')?.addEventListener('click', exportPipelineCSV);

// ── Reminder settings (threshold / enable-disable) ─────────────────────────────
let _reminderSettings = { enabled: true, thresholdDays: 3 };

function loadReminderSettingsUI(reminderSettings) {
  const s = { enabled: true, thresholdDays: 3, ...(reminderSettings || {}) };
  _reminderSettings = s;
  const enabledEl = document.getElementById('reminder-enabled-toggle');
  const thresholdEl = document.getElementById('reminder-threshold-input');
  if (enabledEl) enabledEl.checked = s.enabled;
  if (thresholdEl) thresholdEl.value = s.thresholdDays;
  renderNotificationsPanel();
}

chrome.storage.local.get('reminderSettings', r => loadReminderSettingsUI(r.reminderSettings));

document.getElementById('reminder-settings-save-btn')?.addEventListener('click', () => {
  const enabled = document.getElementById('reminder-enabled-toggle')?.checked ?? true;
  const thresholdDays = Math.max(1, Math.min(30, parseInt(document.getElementById('reminder-threshold-input')?.value, 10) || 3));
  _reminderSettings = { enabled, thresholdDays };
  chrome.storage.local.set({ reminderSettings: _reminderSettings }, () => {
    showStatus(document.getElementById('reminder-settings-status'), 'Reminder settings saved.', 'success');
    renderNotificationsPanel();
  });
});

// ── Outreach safety bar — LinkedIn account-safety tracking ─────────────────────
// Safe ranges from current outreach research (mirrored from content/index.js's own copy of the
// same constants — no shared bundler between content/ and options/ here, same pattern already
// used for SETTINGS_KEYS/SYNC_KEYS elsewhere in this codebase).
const OUTREACH_SAFE_LIMITS = {
  connection: { day: { caution: 25, risky: 40 }, week: { caution: 100, risky: 150 } },
  message:    { day: { caution: 40, risky: 60 } },
};

function outreachLevel(count, limits) {
  if (!limits) return 'ok';
  if (count >= limits.risky) return 'risky';
  if (count >= limits.caution) return 'caution';
  return 'ok';
}

function renderOutreachSafetyBar(log) {
  const now = Date.now();
  const DAY = 86400000, WEEK = 7 * DAY;
  const list = Array.isArray(log) ? log : [];
  const countSince = (type, since) => list.filter(a => a.type === type && now - a.ts < since).length;

  const connDay = countSince('connection', DAY);
  const connWeek = countSince('connection', WEEK);
  const msgDay = countSince('message', DAY);

  const connDayLevel = outreachLevel(connDay, OUTREACH_SAFE_LIMITS.connection.day);
  const connWeekLevel = outreachLevel(connWeek, OUTREACH_SAFE_LIMITS.connection.week);
  const msgDayLevel = outreachLevel(msgDay, OUTREACH_SAFE_LIMITS.message.day);
  const connLevel = connWeekLevel === 'risky' || connDayLevel === 'risky' ? 'risky'
    : connWeekLevel === 'caution' || connDayLevel === 'caution' ? 'caution' : 'ok';

  const connEl = document.getElementById('outreach-safety-conn');
  const connTextEl = document.getElementById('outreach-safety-conn-text');
  const msgEl = document.getElementById('outreach-safety-msg');
  const msgTextEl = document.getElementById('outreach-safety-msg-text');
  const weekEl = document.getElementById('outreach-safety-week');

  if (connEl) connEl.className = `outreach-safety-stat${connLevel !== 'ok' ? ` ${connLevel}` : ''}`;
  if (connTextEl) connTextEl.textContent = `${connDay} connection request${connDay === 1 ? '' : 's'}`;
  if (msgEl) msgEl.className = `outreach-safety-stat${msgDayLevel !== 'ok' ? ` ${msgDayLevel}` : ''}`;
  if (msgTextEl) msgTextEl.textContent = `${msgDay} message${msgDay === 1 ? '' : 's'}`;
  if (weekEl) weekEl.textContent = `· ${connWeek} connections this week`;
}

chrome.storage.local.get('outreachActionLog', r => renderOutreachSafetyBar(r.outreachActionLog));

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('outreachActionLog' in changes)) return;
  renderOutreachSafetyBar(changes.outreachActionLog.newValue);
});

// ── Notifications: "who's due today" on demand, not just the once-daily OS notification ───────
function getDueContactsLocal(contacts, settings) {
  const now = Date.now();
  const dueAfterMs = (settings.thresholdDays || 3) * 24 * 60 * 60 * 1000;
  return contacts.filter(c => {
    if (!REMINDER_STAGES.includes(c.stage)) return false;
    if (c.snoozedUntil && c.snoozedUntil > now) return false;
    return now - (c.stageUpdatedAt || c.savedAt || now) >= dueAfterMs;
  });
}

// Set by content/index.js's passive reply detection (updateFollowupTag) — checked only against
// LinkedIn's own open thread, never via background polling — whenever an inbound message advances
// a contact's stage to Replied on its own. "Seen" here just means the user opened this dropdown
// with it visible, not that they've necessarily acted on it.
function getNewRepliesLocal(contacts) {
  return contacts.filter(c => c.newReply === true);
}

function dismissNewReply(url) {
  chrome.storage.local.get('savedContacts', r => {
    const contacts = Array.isArray(r.savedContacts) ? r.savedContacts : [];
    const entry = contacts.find(c => c.url === url);
    if (!entry) return;
    delete entry.newReply;
    chrome.storage.local.set({ savedContacts: contacts });
  });
}

function renderNotificationsPanel() {
  const countEl = document.getElementById('notifications-count');
  const listEl = document.getElementById('notifications-list');
  if (!countEl || !listEl) return;

  const due = _reminderSettings.enabled ? getDueContactsLocal(_pipelineContacts, _reminderSettings) : [];
  const replies = getNewRepliesLocal(_pipelineContacts);
  countEl.textContent = String(due.length + replies.length);
  countEl.classList.toggle('hidden', due.length + replies.length === 0);

  if (!due.length && !replies.length) {
    listEl.innerHTML = `<div class="notifications-empty">${_reminderSettings.enabled ? "Nothing due today — you're caught up." : 'Reminders are turned off.'}</div>`;
    return;
  }

  const repliesHtml = replies.length ? `
    <div class="notifications-section-label">Replied</div>
    ${replies.map(c => `
      <div class="notifications-item notifications-item-reply">
        <div class="notifications-item-info">
          <span class="notifications-item-name">${escapeHtml(c.name || 'Unknown')}</span>
          <span class="notifications-item-detail">${escapeHtml(c.company || c.headline || '')}</span>
        </div>
        <a href="${escapeHtml(c.url)}" target="_blank" class="notifications-item-open" data-dismiss-url="${escapeHtml(c.url)}">Open ↗</a>
      </div>`).join('')}` : '';

  const dueHtml = due.length ? `
    ${replies.length ? '<div class="notifications-section-label">Due for follow-up</div>' : ''}
    ${due.map(c => {
      const days = Math.floor((Date.now() - (c.stageUpdatedAt || c.savedAt || Date.now())) / 86400000);
      return `
      <div class="notifications-item">
        <div class="notifications-item-info">
          <span class="notifications-item-name">${escapeHtml(c.name || 'Unknown')}</span>
          <span class="notifications-item-detail">${escapeHtml(c.company || c.headline || '')}</span>
        </div>
        <span class="notifications-item-days">${days}d · ${stageLabel(c.stage, c.intent)}</span>
        <a href="${escapeHtml(c.url)}" target="_blank" class="notifications-item-open">Open ↗</a>
      </div>`;
    }).join('')}` : '';

  listEl.innerHTML = repliesHtml + dueHtml;
  listEl.querySelectorAll('[data-dismiss-url]').forEach(el => {
    el.addEventListener('click', () => dismissNewReply(el.dataset.dismissUrl));
  });
}

document.getElementById('notifications-btn')?.addEventListener('click', e => {
  e.stopPropagation();
  const panel = document.getElementById('notifications-panel');
  if (!panel) return;
  const opening = panel.classList.contains('hidden');
  panel.classList.toggle('hidden', !opening);
  if (opening) renderNotificationsPanel();
});
document.addEventListener('click', e => {
  const wrap = document.getElementById('notifications-btn')?.closest('.notifications-wrap');
  if (wrap && !wrap.contains(e.target)) document.getElementById('notifications-panel')?.classList.add('hidden');
});

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
