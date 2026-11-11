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

  // Step navigation — Welcome → Mode choice → Connect Anthropic → Pricing
  function goToObStep(id) {
    overlay.querySelectorAll('.ob-step').forEach(s => s.classList.add('hidden'));
    document.getElementById(id)?.classList.remove('hidden');
  }

  document.getElementById('ob-welcome-next').addEventListener('click', () => goToObStep('ob-step-mode'));

  // Mode choice — B2C is preselected (it's the default mode); clicking a card is handled by
  // options/setup.js, which shares this markup. Continue is always available.
  const obModeNextBtn = document.getElementById('ob-mode-next');
  obModeNextBtn.addEventListener('click', () => goToObStep('ob-step-apikey'));

  // Connect Anthropic — the product does nothing without this key, and previously nothing in
  // onboarding ever said so; a user could sail through Welcome/Pricing and only discover the
  // requirement after a confusing failure back on LinkedIn.
  const obApiKeyInput = document.getElementById('ob-api-key-input');
  const obApiKeyStatus = document.getElementById('ob-apikey-status');
  document.getElementById('ob-apikey-save').addEventListener('click', () => {
    const key = obApiKeyInput.value.trim();
    if (!key) { showStatus(obApiKeyStatus, 'Please enter an API key.', 'error'); return; }
    if (!key.startsWith('sk-ant-')) { showStatus(obApiKeyStatus, 'Invalid format. Anthropic keys start with "sk-ant-".', 'error'); return; }
    chrome.storage.local.set({ anthropicApiKey: key }, () => {
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
        status.classList.add('status-error');
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

// Field timestamps and cloud sync for settings are owned by the background worker now (see
// background/index.js), so a change made from the panel or popup — e.g. the B2C/B2B toggle —
// syncs the same way as one made here. This page only tracks sign-in state.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if ('googleUser' in changes) setAuthState(!!changes.googleUser.newValue);
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

// ── Outreach setup ─────────────────────────────────────────────────────────────
// The B2C/B2B toggle, targeting profiles and message style live in options/setup.js.

// ── Anthropic API Key ──────────────────────────────────────────────────────────
const apiKeyInput = document.getElementById('api-key');
const saveBtn = document.getElementById('save-btn');
const clearBtn = document.getElementById('clear-btn');
const toggleBtn = document.getElementById('toggle-visibility');
const statusMsg = document.getElementById('status-msg');

chrome.storage.local.get('anthropicApiKey', result => {
  if (result.anthropicApiKey) { apiKeyInput.value = result.anthropicApiKey; showStatus(statusMsg, 'API key is saved and active.', 'success'); }
});

toggleBtn?.addEventListener('click', () => makeToggle(apiKeyInput, toggleBtn, 'eye-icon'));

saveBtn?.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (!key) { showStatus(statusMsg, 'Please enter an API key.', 'error'); return; }
  if (!key.startsWith('sk-ant-')) { showStatus(statusMsg, 'Invalid format. Anthropic keys start with "sk-ant-".', 'error'); return; }
  chrome.storage.local.set({ anthropicApiKey: key }, () => showStatus(statusMsg, 'API key saved.', 'success'));
});

clearBtn?.addEventListener('click', () => {
  chrome.storage.local.remove('anthropicApiKey', () => { apiKeyInput.value = ''; showStatus(statusMsg, 'API key cleared.', 'info'); });
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

// ── Post settings shared by personal and company: pillars (chips), ending, voice sample ──
const postFields = {
  personal: { pillars: 'creator-pillars', ending: 'creator-ending', voice: 'creator-voice' },
  company: { pillars: 'co-pillars', ending: 'co-ending', voice: 'co-voice' },
};
const pillarState = { personal: [], company: [] };
function renderPillars(kind) {
  const el = document.getElementById(postFields[kind].pillars);
  if (!el) return;
  const max = 5;
  const sel = pillarState[kind];
  el.innerHTML = LP_SCHEMA.OPTIONS.postPillars[kind].map(o => {
    const on = sel.includes(o.id);
    return `<button type="button" class="choice" aria-pressed="${on}" data-id="${o.id}"${!on && sel.length >= max ? ' disabled' : ''}>${escapeHtml(o.label)}</button>`;
  }).join('');
}
['personal', 'company'].forEach(kind => {
  document.getElementById(postFields[kind].pillars)?.addEventListener('click', e => {
    const b = e.target.closest('.choice'); if (!b || b.disabled) return;
    const list = pillarState[kind];
    const i = list.indexOf(b.dataset.id);
    if (i >= 0) list.splice(i, 1); else list.push(b.dataset.id);
    renderPillars(kind);
  });
  const ending = document.getElementById(postFields[kind].ending);
  if (ending) ending.innerHTML = LP_SCHEMA.OPTIONS.postEndings.map(o => `<option value="${o.id}">${escapeHtml(o.label)}</option>`).join('');
});
function loadPostFields(kind, p) {
  pillarState[kind] = Array.isArray(p.pillars) ? p.pillars.slice(0, 5) : [];
  renderPillars(kind);
  const f = postFields[kind];
  const ending = document.getElementById(f.ending); if (ending) ending.value = p.postEnding || 'question';
  const voice = document.getElementById(f.voice); if (voice) voice.value = p.voiceSample || '';
}
function readPostFields(kind) {
  const f = postFields[kind];
  return {
    pillars: pillarState[kind].length ? [...pillarState[kind]] : undefined,
    postEnding: document.getElementById(f.ending)?.value || undefined,
    voiceSample: (document.getElementById(f.voice)?.value || '').trim().slice(0, 3000) || undefined,
  };
}

// ── Your posts (captured from the user's own activity page by the content script) ──
function renderOwnPosts(list) {
  const el = document.getElementById('own-posts-list');
  if (!el) return;
  const posts = Array.isArray(list) ? list : [];
  el.innerHTML = posts.length
    ? `<p class="own-posts-count">${posts.length} saved</p><ol class="own-posts">${posts.slice(0, 5).map(p => `<li>${escapeHtml(p.text.replace(/\s+/g, ' ').slice(0, 180))}${p.text.length > 180 ? '…' : ''}</li>`).join('')}</ol>${posts.length > 5 ? `<p class="hint">and ${posts.length - 5} more</p>` : ''}`
    : '<p class="own-posts-empty">None saved yet. Add your profile URL above, then use “Read my posts” in Post Creator on LinkedIn.</p>';
  document.getElementById('own-posts-clear')?.toggleAttribute('disabled', !posts.length);
}
chrome.storage.local.get('ownPosts', r => renderOwnPosts(r.ownPosts));
chrome.storage.onChanged.addListener((changes, area) => { if (area === 'local' && 'ownPosts' in changes) renderOwnPosts(changes.ownPosts.newValue); });
document.getElementById('own-posts-clear')?.addEventListener('click', () => {
  if (!confirm('Clear all saved posts? Drafts will stop matching your voice until you read them again.')) return;
  chrome.storage.local.remove('ownPosts', () => { renderOwnPosts([]); showStatus(document.getElementById('own-posts-status'), 'Saved posts cleared.', 'info'); });
});
document.getElementById('own-posts-open')?.addEventListener('click', () => {
  const url = (document.getElementById('creator-linkedin-url')?.value || '').trim();
  const m = url.match(/linkedin\.com\/in\/([^/?#]+)/i);
  if (!m) { showStatus(document.getElementById('own-posts-status'), 'Add your LinkedIn profile URL above first.', 'error'); return; }
  chrome.tabs.create({ url: `https://www.linkedin.com/in/${m[1]}/recent-activity/shares/` });
});

chrome.storage.local.get('creatorProfile', r => {
  const p = r.creatorProfile || {};
  loadPostFields('personal', p);
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
async function activeProfileFor(intent) {
  const k = intent === 'b2b_sales' ? ['icpProfiles', 'activeIcpProfileId'] : ['b2cProfiles', 'activeB2cProfileId'];
  const r = await chrome.storage.local.get(k);
  const list = r[k[0]] || [];
  return list.find(p => p.id === r[k[1]]) || list[0] || null;
}

// Personal-brand posts are about you, so they prefill from the active B2C profile. Blanks only —
// existing values are never overwritten.
document.getElementById('creator-prefill-btn')?.addEventListener('click', async () => {
  const p = await activeProfileFor('b2c_sales');
  const pitch = p?.pitch || {};
  if (!pitch.oneLiner && !pitch.senderName && !(pitch.skills || []).length) {
    showStatus(document.getElementById('creator-status'), 'Fill in your B2C pitch under Outreach first.', 'info');
    return;
  }
  const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
  fillIfEmpty('creator-name', pitch.senderName);
  fillIfEmpty('creator-audience', p.icp?.idealCustomer);
  if ((pitch.skills || []).length && !creatorDomainTagState.domains.length) {
    creatorDomainTagState.domains = pitch.skills.slice(0, 10);
    renderCreatorDomainTags();
  }
  showStatus(document.getElementById('creator-status'), 'Filled in from your B2C pitch. Review and save.', 'success');
});

document.getElementById('creator-save-btn')?.addEventListener('click', () => {
  const raw = {
    name: document.getElementById('creator-name')?.value.trim(),
    linkedinUrl: document.getElementById('creator-linkedin-url')?.value.trim(),
    audience: document.getElementById('creator-audience')?.value.trim(),
    goal: document.getElementById('creator-goal')?.value,
    postStyle: document.getElementById('creator-style')?.value,
    domains: creatorDomainTagState.domains.length ? creatorDomainTagState.domains : undefined,
    ...readPostFields('personal'),
  };
  if (raw.linkedinUrl && !/linkedin\.com\/in\/[^/?#]+/i.test(raw.linkedinUrl)) {
    showStatus(document.getElementById('creator-status'), 'Use your profile link, like https://www.linkedin.com/in/your-name/', 'error');
    return;
  }
  const creatorProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ creatorProfile }, () => showStatus(document.getElementById('creator-status'), 'Creator profile saved.', 'success'));
});

// ── Company Profile ───────────────────────────────────────────────────────────
chrome.storage.local.get('companyProfile', r => {
  const p = r.companyProfile || {};
  loadPostFields('company', p);
  const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
  setVal('co-name', p.name); setVal('co-industry', p.industry); setVal('co-about', p.about);
  setVal('co-products', p.products); setVal('co-icp', p.icp); setVal('co-goal', p.goal); setVal('co-style', p.postStyle);
});

// Company posts prefill from the active B2B profile.
document.getElementById('co-prefill-btn')?.addEventListener('click', async () => {
  const p = await activeProfileFor('b2b_sales');
  const b = p?.businessProfile || {};
  if (!b.offer && !b.companyName) {
    showStatus(document.getElementById('co-status'), 'Fill in your B2B offer under Outreach first.', 'info');
    return;
  }
  const fillIfEmpty = (id, val) => { const el = document.getElementById(id); if (el && val && !el.value.trim()) el.value = val; };
  fillIfEmpty('co-name', b.companyName);
  fillIfEmpty('co-products', b.offer);
  fillIfEmpty('co-icp', p.icp?.idealCustomer);
  showStatus(document.getElementById('co-status'), 'Filled in from your B2B offer. Review and save.', 'success');
});

document.getElementById('co-save-btn')?.addEventListener('click', () => {
  const raw = { name: document.getElementById('co-name')?.value.trim(), industry: document.getElementById('co-industry')?.value.trim(), about: document.getElementById('co-about')?.value.trim(), products: document.getElementById('co-products')?.value.trim(), icp: document.getElementById('co-icp')?.value.trim(), goal: document.getElementById('co-goal')?.value, postStyle: document.getElementById('co-style')?.value, ...readPostFields('company') };
  const companyProfile = Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined && v !== ''));
  chrome.storage.local.set({ companyProfile }, () => showStatus(document.getElementById('co-status'), 'Company profile saved.', 'success'));
});

// ── Reload all form fields from storage (called after sign-in) ────────────────
function loadAllSettings() {
  globalThis.LPSetup?.reload();
  chrome.storage.local.get([
    'anthropicApiKey', 'hubspotApiKey', 'creatorProfile', 'companyProfile', 'reminderSettings',
  ], r => {
    // Reminder settings
    loadReminderSettingsUI(r.reminderSettings);

    // API keys
    if (apiKeyInput) {
      apiKeyInput.value = r.anthropicApiKey || '';
      if (r.anthropicApiKey) showStatus(statusMsg, 'API key is saved and active.', 'success');
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
    loadPostFields('personal', cp);
    loadPostFields('company', r.companyProfile || {});

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
        <div class="upgrade-card-title">Upgrade to Pro</div>
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
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Pro plan active
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

// ── Team Setup (share ICP + business profiles across a BD team) ───────────────
// Every setting lives in one rep's own browser, so a team member who never typed in the ICP got
// seniority-only scoring (measured: a construction VP scored "High" for an AI-infra seller). This
// lets one person configure targeting once and hand it out as a paste-able code. Whitelist only:
// API keys, the pipeline, and personal profiles (job search, personal-brand creator) never leave.
// senderName is stripped on export and the importer's own is kept, so reps don't sign as each other.
// v2 carries the structured two-mode setup. v1 codes (free-text industries, three modes) are still
// accepted and converted with the same migration the extension itself uses.
const TEAM_CODE_V2 = 'LINKPILOT-TEAM-2:';
const TEAM_CODE_V1 = 'LINKPILOT-TEAM-1:';

function toBase64Utf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  bytes.forEach(b => { bin += String.fromCharCode(b); });
  return btoa(bin);
}

function fromBase64Utf8(b64) {
  const bin = atob(b64);
  return new TextDecoder().decode(Uint8Array.from(bin, c => c.charCodeAt(0)));
}

const TEAM_KEYS = ['icpProfiles', 'activeIcpProfileId', 'messagePresets', 'b2cProfiles', 'activeB2cProfileId', 'b2cMessagePresets', 'companyProfile'];
const companyFields = obj => {
  const out = {};
  ['name', 'industry', 'about', 'products', 'icp', 'goal', 'postStyle', 'voiceSample'].forEach(k => { if (typeof obj?.[k] === 'string' && obj[k].trim()) out[k] = obj[k].slice(0, 3000); });
  const pillarIds = new Set(LP_SCHEMA.OPTIONS.postPillars.company.map(o => o.id));
  if (Array.isArray(obj?.pillars)) out.pillars = obj.pillars.filter(id => pillarIds.has(id)).slice(0, 5);
  if (LP_SCHEMA.OPTIONS.postEndings.some(o => o.id === obj?.postEnding)) out.postEnding = obj.postEnding;
  return out;
};

document.getElementById('team-copy-btn')?.addEventListener('click', async () => {
  const status = document.getElementById('team-setup-status');
  const S = globalThis.LP_SCHEMA;
  await globalThis.LPSetup?.save?.(); // include anything typed but not yet saved
  const r = await chrome.storage.local.get(TEAM_KEYS);
  const data = {
    icpProfiles: (r.icpProfiles || []).map(p => S.sanitizeB2bProfile(p, '')),
    activeIcpProfileId: r.activeIcpProfileId,
    messagePresets: S.sanitizePresets(r.messagePresets, 'b2b_sales'),
    b2cProfiles: (r.b2cProfiles || []).map(p => S.sanitizeB2cProfile(p, '')),
    activeB2cProfileId: r.activeB2cProfileId,
    b2cMessagePresets: S.sanitizePresets(r.b2cMessagePresets, 'b2c_sales'),
    companyProfile: companyFields(r.companyProfile),
  };
  const hasAny = [...data.icpProfiles, ...data.b2cProfiles].some(p => p.icp.industries.length || p.icp.customIndustries.length || p.icp.hirerTypes.length);
  if (!hasAny) { showStatus(status, 'Nothing to share yet. Set up your targeting first.', 'error'); return; }
  const code = TEAM_CODE_V2 + toBase64Utf8(JSON.stringify({ v: 2, data }));
  navigator.clipboard.writeText(code)
    .then(() => showStatus(status, 'Team setup code copied. Paste it to your team.', 'success'))
    .catch(() => showStatus(status, 'Could not copy to the clipboard.', 'error'));
});

// v1 payload → v2 shapes, reusing the extension's own legacy migration.
function teamV1ToV2(d) {
  const S = globalThis.LP_SCHEMA;
  const icpProfiles = (Array.isArray(d.icpProfiles) ? d.icpProfiles : []).map(p => S.migrateB2bProfile(p) || p);
  const b2c = S.buildB2cFromLegacy({ b2cProfile: d.b2cProfile, b2cTargetIndustries: d.b2cTargetIndustries, b2cExcludeIndustries: d.b2cExcludeIndustries });
  return {
    icpProfiles, activeIcpProfileId: d.activeIcpProfileId,
    messagePresets: { tone: d.messagePresets?.tone }, b2cProfiles: [b2c], activeB2cProfileId: b2c.id,
    b2cMessagePresets: { tone: d.b2cMessagePresets?.tone }, companyProfile: d.companyProfile,
  };
}

document.getElementById('team-import-btn')?.addEventListener('click', async () => {
  const status = document.getElementById('team-setup-status');
  const S = globalThis.LP_SCHEMA;
  const raw = (document.getElementById('team-import-input')?.value || '').trim();
  const prefix = raw.startsWith(TEAM_CODE_V2) ? TEAM_CODE_V2 : raw.startsWith(TEAM_CODE_V1) ? TEAM_CODE_V1 : null;
  if (!prefix) { showStatus(status, 'That is not a LinkPilot team setup code.', 'error'); return; }
  let data;
  try {
    const parsed = JSON.parse(fromBase64Utf8(raw.slice(prefix.length)));
    if (!parsed?.data || (parsed.v !== 1 && parsed.v !== 2)) throw new Error('bad version');
    data = parsed.v === 1 ? teamV1ToV2(parsed.data) : parsed.data;
  } catch {
    showStatus(status, 'This code is damaged or incomplete. Ask for a fresh copy.', 'error');
    return;
  }
  if (!confirm('Replace your B2C and B2B targeting profiles and message style with this team setup? Your API keys, pipeline and name are not affected.')) return;

  const mine = await chrome.storage.local.get(['icpProfiles', 'activeIcpProfileId', 'b2cProfiles', 'activeB2cProfileId']);
  const myB2b = (mine.icpProfiles || []).find(p => p.id === mine.activeIcpProfileId) || (mine.icpProfiles || [])[0];
  const myB2c = (mine.b2cProfiles || []).find(p => p.id === mine.activeB2cProfileId) || (mine.b2cProfiles || [])[0];
  const b2bName = myB2b?.businessProfile?.senderName || '';
  const b2cName = myB2c?.pitch?.senderName || '';

  const update = { companyProfile: companyFields(data.companyProfile) };
  const icpProfiles = (Array.isArray(data.icpProfiles) ? data.icpProfiles : []).map(p => S.sanitizeB2bProfile(p, b2bName));
  if (icpProfiles.length) {
    update.icpProfiles = icpProfiles;
    update.activeIcpProfileId = icpProfiles.some(p => p.id === data.activeIcpProfileId) ? data.activeIcpProfileId : icpProfiles[0].id;
    update.messagePresets = S.sanitizePresets(data.messagePresets, 'b2b_sales');
  }
  const b2cProfiles = (Array.isArray(data.b2cProfiles) ? data.b2cProfiles : []).map(p => S.sanitizeB2cProfile(p, b2cName));
  if (b2cProfiles.length) {
    update.b2cProfiles = b2cProfiles;
    update.activeB2cProfileId = b2cProfiles.some(p => p.id === data.activeB2cProfileId) ? data.activeB2cProfileId : b2cProfiles[0].id;
    update.b2cMessagePresets = S.sanitizePresets(data.b2cMessagePresets, 'b2c_sales');
  }
  await chrome.storage.local.set(update);
  showStatus(status, 'Team setup imported. Reloading.', 'success');
  setTimeout(() => location.reload(), 700);
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
  // `tone` maps to a themed CSS class (tone-*) so stage colors stay AA-legible in light and dark.
  new:             { label: 'New',             tone: 'neutral' },
  connection_sent: { label: 'Connection sent', tone: 'info' },
  messaged:        { label: 'Messaged',        tone: 'info' },
  followup_1:      { label: 'Follow-up 1',     tone: 'warn' },
  followup_2:      { label: 'Follow-up 2',     tone: 'warn' },
  followup_3plus:  { label: 'Follow-up 3+',    tone: 'warn' },
  replied:         { label: 'Replied',         tone: 'good' },
  booked:          { label: 'Booked',          tone: 'good' },
  closed:          { label: 'Closed',          tone: 'muted' },
};
const STAGE_ORDER = Object.keys(STAGE_META);
function stageLabel(stage) {
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
const ENGAGEMENT_TIER_TONE = { Hot: 'hot', Warm: 'warn', Cooling: 'info', Stalled: 'muted' };

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

  return { score, tier, reason, tone: ENGAGEMENT_TIER_TONE[tier] };
}

// Groups the 9 exact stages into 5 scannable board columns, mirroring STAGE_META's
// existing color families rather than inventing a new taxonomy.
const PIPELINE_COLUMNS = [
  { label: 'New',              tone: 'neutral', stages: ['new'] },
  { label: 'Reaching out',     tone: 'info',    stages: ['connection_sent', 'messaged'] },
  { label: 'Following up',     tone: 'warn',    stages: ['followup_1', 'followup_2', 'followup_3plus'] },
  { label: 'Replied / booked', tone: 'good',  stages: ['replied', 'booked'] },
  { label: 'Closed',           tone: 'muted', stages: ['closed'] },
];

function columnLabel(col) {
  return col.label;
}

const PIPELINE_SCORE_TONE = {
  High: 'good', Medium: 'warn', Low: 'muted',
  Strong: 'good', Possible: 'warn', Unlikely: 'muted',
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
    // Contacts saved before modes existed had no intent and were B2B (the old default).
    if (intentFilter && (c.intent ? globalThis.LP_SCHEMA.normalizeIntent(c.intent) : 'b2b_sales') !== intentFilter) return false;
    if (!filter) return true;
    return (c.name || '').toLowerCase().includes(filter) || (c.company || '').toLowerCase().includes(filter);
  });

  board.innerHTML = PIPELINE_COLUMNS.map(col => {
    const items = filtered.filter(c => col.stages.includes(STAGE_META[c.stage] ? c.stage : 'new'));
    const cards = items.map(c => {
      const stage = STAGE_META[c.stage] ? c.stage : 'new';
      const stageTone = STAGE_META[stage].tone;
      const scoreTone = PIPELINE_SCORE_TONE[c.score] || 'muted';
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
              <span class="pipeline-card-score tone-${scoreTone}">${escapeHtml(c.score || '–')}</span>
              <button type="button" class="pipeline-card-remove" data-url="${escapeHtml(c.url)}" title="Remove from pipeline" aria-label="Remove from pipeline"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button>
            </span>
          </div>
          ${detail ? `<div class="pipeline-card-detail">${escapeHtml(detail.slice(0, 60))}</div>` : ''}
          ${engagement ? `<div class="pipeline-card-engagement" title="${escapeHtml(engagement.reason)} — based on your tracked pipeline stage.">
            <span class="pipeline-card-engagement-dot tone-${engagement.tone}"></span>
            ${engagement.tier} · ${engagement.score}
          </div>` : ''}
          <div class="pipeline-card-bottom">
            <select class="pipeline-card-select tone-${stageTone}" data-url="${escapeHtml(c.url)}" aria-label="Outreach stage">
              ${STAGE_ORDER.map(s => `<option value="${s}" ${s === stage ? 'selected' : ''}>${stageLabel(s, c.intent)}</option>`).join('')}
            </select>
            ${days ? `<span class="pipeline-card-days">${days}</span>` : ''}
          </div>
          ${showSnooze ? `<button type="button" class="pipeline-card-snooze${snoozed ? ' pipeline-card-snooze-active' : ''}" data-url="${escapeHtml(c.url)}" title="${snoozed ? 'Click to cancel snooze' : ''}">${snoozed ? `Snoozed ${snoozeDaysLeft}d · cancel` : 'Snooze reminder 3 days'}</button>` : ''}
          <a href="${escapeHtml(c.url)}" target="_blank" class="pipeline-card-link">Open on LinkedIn</a>
        </div>`;
    }).join('');

    return `
      <div class="pipeline-column">
        <div class="pipeline-column-header">
          <span class="pipeline-column-dot tone-${col.tone}"></span>
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
        <a href="${escapeHtml(c.url)}" target="_blank" class="notifications-item-open" data-dismiss-url="${escapeHtml(c.url)}">Open</a>
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
        <a href="${escapeHtml(c.url)}" target="_blank" class="notifications-item-open">Open</a>
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
