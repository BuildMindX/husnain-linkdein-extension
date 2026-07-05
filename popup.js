const MODE_META = {
  b2b_sales: {
    label: 'B2B Sales',
    sub: 'Score prospects & personalise outreach',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>`,
  },
  b2c_sales: {
    label: 'Freelance / Consulting',
    sub: 'Find clients for your expertise',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`,
  },
  job_search: {
    label: 'Job Search',
    sub: 'Identify recruiters & hiring signals',
    icon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>`,
  },
};

chrome.storage.local.get(['openaiApiKey', 'hubspotApiKey', 'analysisIntent', 'creatorProfile', 'companyProfile', 'userPlan'], result => {
  // ── Connections ──
  const hasOpenAI = !!result.openaiApiKey;
  const hasHubSpot = !!result.hubspotApiKey;

  const oaiDot = document.getElementById('conn-openai-dot');
  const oaiStatus = document.getElementById('conn-openai-status');
  if (hasOpenAI) {
    oaiDot.className = 'conn-dot connected';
    oaiStatus.textContent = 'Connected';
    oaiStatus.className = 'conn-status ok';
  } else {
    oaiDot.className = 'conn-dot disconnected';
    oaiStatus.textContent = 'Not set';
    oaiStatus.className = 'conn-status warn';
  }

  const hsDot = document.getElementById('conn-hubspot-dot');
  const hsStatus = document.getElementById('conn-hubspot-status');
  if (hasHubSpot) {
    hsDot.className = 'conn-dot connected';
    hsStatus.textContent = 'Connected';
    hsStatus.className = 'conn-status ok';
  } else {
    hsDot.className = 'conn-dot';
    hsStatus.textContent = 'Not connected';
    hsStatus.className = 'conn-status';
  }

  // ── Plan badge in header ──
  const plan = result.userPlan || 'free';
  const planBadgeEl = document.getElementById('popup-plan-badge');
  if (planBadgeEl) {
    planBadgeEl.textContent = plan === 'pro' ? 'Pro' : 'Free';
    planBadgeEl.className = `popup-plan-badge ${plan === 'pro' ? 'plan-pro' : 'plan-free'}`;
  }

  // ── Active Mode ──
  const intent = result.analysisIntent || 'b2b_sales';
  const meta = MODE_META[intent] || MODE_META.b2b_sales;

  document.getElementById('mode-card').innerHTML = `
    <div class="mode-card-icon-wrap">${meta.icon}</div>
    <div class="mode-card-body">
      <div class="mode-card-label">${meta.label}</div>
      <div class="mode-card-sub">${meta.sub}</div>
    </div>
    <button class="mode-card-change" id="change-mode-btn">Change</button>`;

  document.getElementById('change-mode-btn').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ── Post mode ──
  const cp = result.creatorProfile;
  const co = result.companyProfile;
  const hasCompany = !!(co?.name);
  const postModeLabel = hasCompany ? 'Company' : 'Personal';
  const postModeIcon = hasCompany
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  document.getElementById('post-mode-row').innerHTML = `
    <span class="post-mode-label">Post as:</span>
    <span class="post-mode-badge">${postModeIcon} ${postModeLabel}</span>`;
});

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
