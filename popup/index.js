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

function showSignInGate() {
  document.getElementById('sign-in-gate').style.display = 'flex';
  document.getElementById('popup-main').style.display = 'none';

  const btn = document.getElementById('sig-google-btn');
  const status = document.getElementById('sig-status');

  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    status.style.display = 'none';

    chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_IN' }, response => {
      if (chrome.runtime.lastError || !response?.success) {
        btn.disabled = false;
        btn.innerHTML = `<svg width="17" height="17" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg> Sign in with Google`;
        status.textContent = response?.error || 'Sign-in failed. Please try again.';
        status.style.display = 'block';
        return;
      }
      // New user → open onboarding in options page, then reload
      if (response.isNew) {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
      }
      window.location.reload();
    });
  });
}

function renderMainContent(result) {
  // ── User line in header ──
  const user = result.googleUser;
  const userLine = document.getElementById('popup-user-line');
  if (userLine && user?.name) {
    userLine.textContent = user.name;
  }

  // ── Upgrade CTA for free users ──
  const plan = result.userPlan || 'free';
  const ctaEl = document.getElementById('popup-upgrade-cta');
  if (ctaEl && plan !== 'pro') {
    ctaEl.style.display = '';
    document.getElementById('popup-upgrade-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('popup-upgrade-btn');
      const statusEl = document.getElementById('popup-upgrade-status');
      btn.disabled = true;
      btn.textContent = '…';
      chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, res => {
        if (chrome.runtime.lastError || !res?.url) {
          btn.disabled = false;
          btn.textContent = 'Upgrade';
          if (statusEl) { statusEl.textContent = res?.error || 'Try again.'; statusEl.style.display = ''; }
          return;
        }
        chrome.tabs.create({ url: res.url, active: true });
        window.close();
      });
    });
  }

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
  const co = result.companyProfile;
  const hasCompany = !!(co?.name);
  const postModeLabel = hasCompany ? 'Company' : 'Personal';
  const postModeIcon = hasCompany
    ? `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`
    : `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>`;

  document.getElementById('post-mode-row').innerHTML = `
    <span class="post-mode-label">Post as:</span>
    <span class="post-mode-badge">${postModeIcon} ${postModeLabel}</span>`;
}

function renderUsageStats(plan, usageStats) {
  const section = document.getElementById('usage-section');
  const grid = document.getElementById('usage-grid');
  if (!section || !grid) return;

  const isPro = plan === 'pro';
  const FREE_LIMIT = 50;

  const items = [
    { key: 'analysis', label: 'Analyses' },
    { key: 'message',  label: 'Messages' },
    { key: 'post',     label: 'Posts' },
  ];

  const hasAnyUsage = items.some(i => (usageStats[i.key] ?? 0) > 0);
  if (!hasAnyUsage && !isPro) { section.style.display = 'none'; return; }

  grid.innerHTML = items.map(({ key, label }) => {
    const used = usageStats[key] ?? 0;
    const pct = isPro ? 100 : Math.min(100, Math.round((used / FREE_LIMIT) * 100));
    const barColor = isPro ? '#7c3aed' : pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#7c3aed';
    const limitLabel = isPro ? '∞' : `/ ${FREE_LIMIT}`;
    return `
      <div class="usage-row">
        <div class="usage-row-top">
          <span class="usage-label">${label}</span>
          <span class="usage-count">${used} ${limitLabel}</span>
        </div>
        <div class="usage-bar-track">
          <div class="usage-bar-fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      </div>`;
  }).join('');

  section.style.display = '';
}

// ── Boot: check auth before rendering anything ────────────────────────────────
chrome.storage.local.get(
  ['googleUser', 'openaiApiKey', 'hubspotApiKey', 'analysisIntent', 'creatorProfile', 'companyProfile', 'userPlan', 'usageStats'],
  result => {
    if (!result.googleUser) {
      showSignInGate();
      return;
    }
    renderMainContent(result);
    renderUsageStats(result.userPlan || 'free', result.usageStats || {});
  }
);

document.getElementById('open-settings').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});
