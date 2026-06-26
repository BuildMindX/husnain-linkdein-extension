(() => {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────
  let triggerBtn = null;
  let panel = null;
  let currentProfileUrl = null;
  let activeTab = 'analysis';

  // ─── IndexedDB ────────────────────────────────────────────────────────────────
  const DB_NAME = 'lia-db';
  const DB_VERSION = 1;
  const STORE = 'profiles';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'url' });
        }
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function dbGet(url) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(url);
      req.onsuccess = e => resolve(e.target.result || null);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function dbPut(url, data) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE)
        .put({ url, ...data, timestamp: Date.now() });
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  async function dbDelete(url) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(url);
      req.onsuccess = () => resolve();
      req.onerror = e => reject(e.target.error);
    });
  }

  function timeAgo(ts) {
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  function isProfilePage() {
    return /linkedin\.com\/in\/[^\/]+/.test(location.href);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  function init() {
    if (!isProfilePage()) return;
    currentProfileUrl = location.href.split('?')[0];
    injectTriggerButton();
  }

  // ─── SPA Navigation (singleton — created once, never recreated) ───────────────
  const getPath = () => location.pathname.replace(/\/$/, '');

  let _navLastPath = getPath();
  new MutationObserver(() => {
    const path = getPath();
    if (path === _navLastPath) return;
    _navLastPath = path;
    if (isProfilePage()) {
      currentProfileUrl = location.href.split('?')[0];
      resetUI();
      init();
    } else {
      removeAll();
    }
  }).observe(document.body, { subtree: true, childList: true });

  // ─── Trigger Button ───────────────────────────────────────────────────────────
  function injectTriggerButton() {
    if (triggerBtn) return;
    triggerBtn = document.createElement('button');
    triggerBtn.id = 'lia-trigger';
    triggerBtn.setAttribute('aria-label', 'Open Husnain LinkedIn Helper');
    triggerBtn.innerHTML = `
      <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
      </svg>
      <span>Analyze</span>
    `;
    triggerBtn.addEventListener('click', handleTriggerClick);
    document.body.appendChild(triggerBtn);
  }

  // ─── Main Click Handler ───────────────────────────────────────────────────────
  async function handleTriggerClick() {
    if (panel) {
      togglePanel(!panel.classList.contains('lia-open'));
      return;
    }
    createPanel();
    togglePanel(true);
    renderPurposePicker();
  }

  // ─── Purpose Picker ───────────────────────────────────────────────────────────
  async function renderPurposePicker() {
    const body = document.getElementById('lia-body');
    if (!body) return;

    // Hide tabs — not needed until analysis is loaded
    const tabs = panel.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = 'none';

    // Check if we have a cached analysis matching the current intent
    const stored = await dbGet(currentProfileUrl).catch(() => null);
    const { analysisIntent: savedIntent } = await chrome.storage.local.get('analysisIntent').catch(() => ({}));
    const currentIntent = savedIntent || 'b2b_sales';
    const cacheIntentMatches = !stored?.intent || stored.intent === currentIntent;
    const hasCache = !!(stored?.analysis) && cacheIntentMatches;
    const cacheAge = hasCache ? `· ${timeAgo(stored.timestamp)}` : '';

    const modeLabel = currentIntent === 'job_search' ? '🎯 Job Search mode'
      : currentIntent === 'b2c_sales' ? '🧑‍💻 Freelance mode'
      : '💼 B2B Sales mode';

    const analyzeDesc = hasCache
      ? `View analysis ${cacheAge}`
      : currentIntent === 'job_search' ? 'Check hiring signals — is this person recruiting or hiring?'
      : currentIntent === 'b2c_sales' ? 'Score this contact as a potential client for your services'
      : 'Score this prospect — potential, fit, and decision-maker level';

    const connectionDesc = currentIntent === 'job_search'
      ? 'Get a natural note that doesn\'t sound like a job application'
      : currentIntent === 'b2c_sales'
      ? 'Get a warm note positioning you as a fellow expert'
      : 'Get a personalized note to send with a connection invite';

    const coldDesc = currentIntent === 'job_search'
      ? 'Already connected — start a casual, genuine conversation'
      : currentIntent === 'b2c_sales'
      ? 'Already connected — reach out as a trusted consultant'
      : 'Already connected — write a first outreach message';

    body.innerHTML = `
      <div class="lia-purpose-picker">
        <div class="lia-mode-indicator">${modeLabel}</div>
        <p class="lia-purpose-intro">What do you want to do with this profile?</p>
        <button class="lia-purpose-tile" id="lia-purpose-analyze">
          <span class="lia-purpose-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              <line x1="11" y1="8" x2="11" y2="14"></line>
              <line x1="8" y1="11" x2="14" y2="11"></line>
            </svg>
          </span>
          <span class="lia-purpose-content">
            <span class="lia-purpose-title">${hasCache ? 'View Analysis' : 'Analyze Profile'}</span>
            <span class="lia-purpose-desc">${analyzeDesc}</span>
          </span>
        </button>
        <button class="lia-purpose-tile" id="lia-purpose-connection">
          <span class="lia-purpose-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
              <circle cx="9" cy="7" r="4"></circle>
              <line x1="19" y1="8" x2="19" y2="14"></line>
              <line x1="22" y1="11" x2="16" y2="11"></line>
            </svg>
          </span>
          <span class="lia-purpose-content">
            <span class="lia-purpose-title">Connection Request</span>
            <span class="lia-purpose-desc">${connectionDesc}</span>
          </span>
        </button>
        <button class="lia-purpose-tile" id="lia-purpose-cold">
          <span class="lia-purpose-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
          </span>
          <span class="lia-purpose-content">
            <span class="lia-purpose-title">First Message</span>
            <span class="lia-purpose-desc">${coldDesc}</span>
          </span>
        </button>
        <button class="lia-purpose-tile" id="lia-purpose-dm">
          <span class="lia-purpose-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
              <polyline points="22,6 12,13 2,6"></polyline>
            </svg>
          </span>
          <span class="lia-purpose-content">
            <span class="lia-purpose-title">Open Messaging</span>
            <span class="lia-purpose-desc">Jump straight into LinkedIn messaging with this person</span>
          </span>
        </button>
        ${hasCache ? `<button class="lia-purpose-refresh" id="lia-purpose-reanalyze">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          Run fresh analysis
        </button>` : ''}
      </div>
    `;

    body.querySelector('#lia-purpose-connection').addEventListener('click', () => runForPurpose('connection'));
    body.querySelector('#lia-purpose-cold').addEventListener('click', () => runForPurpose('cold'));
    body.querySelector('#lia-purpose-dm').addEventListener('click', () => runForPurpose('dm'));
    body.querySelector('#lia-purpose-analyze').addEventListener('click', () => runForPurpose('analyze'));
    body.querySelector('#lia-purpose-reanalyze')?.addEventListener('click', async () => {
      const prev = await dbGet(currentProfileUrl).catch(() => null);
      await dbDelete(currentProfileUrl).catch(() => {});
      if (prev?.hubspotPushed) {
        await dbPut(currentProfileUrl, { url: currentProfileUrl, hubspotPushed: true, hubspotPushedAt: prev.hubspotPushedAt }).catch(() => {});
      }
      await runAnalysis();
    });
  }

  async function runForPurpose(purpose, userNotes = '', forceRefresh = false) {
    // DM: just open LinkedIn messaging — no API key needed
    if (purpose === 'dm') {
      openLinkedInDM();
      return;
    }

    const hasKey = await checkApiKey();
    if (!hasKey) { renderNoApiKey(); return; }

    const { analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get('analysisIntent');

    if (purpose === 'analyze') {
      const tabs = panel.querySelector('.lia-tabs');
      if (tabs) tabs.style.display = '';
      const stored = await dbGet(currentProfileUrl).catch(() => null);
      // Use cache only if the stored intent matches the current intent
      if (stored && stored.analysis && (stored.intent === intent || !stored.intent)) {
        renderResults(stored.analysis, stored.connectionRequest, stored.timestamp, stored.intent || intent);
        return;
      }
      await runAnalysis();
      return;
    }

    // For connection / cold — show single result view
    const tabs = panel.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = 'none';

    const stored = await dbGet(currentProfileUrl).catch(() => null);

    // Use cache only if no custom notes, not a forced regenerate, and intent matches
    const intentMatches = !stored?.intent || stored.intent === intent;
    if (!userNotes && !forceRefresh && intentMatches) {
      if (purpose === 'connection' && stored?.connectionRequest) {
        renderSingleText('connection', stored.connectionRequest, intent);
        return;
      }
      if (purpose === 'cold' && stored?.coldMessage) {
        renderSingleText('cold', stored.coldMessage, intent);
        return;
      }
    }

    // Generate fresh
    const body = document.getElementById('lia-body');
    if (body) body.innerHTML = `
      <div class="lia-loading">
        <div class="lia-spinner"></div>
        <p>${purpose === 'cold' ? 'Writing cold message...' : 'Writing connection request...'}</p>
      </div>
    `;

    try {
      const profileData = extractProfile();
      const msgType = purpose === 'cold' ? 'GENERATE_COLD_MESSAGE' : 'GENERATE_CONNECTION_REQUEST';
      const result = await sendMessage(msgType, profileData, { intent, userNotes: userNotes || undefined });
      if (result.error) throw new Error(result.error);

      // Cache it (skip cache if user notes were used — notes-based results are ephemeral)
      if (!userNotes) {
        const current = await dbGet(currentProfileUrl).catch(() => null) || { url: currentProfileUrl };
        const updateKey = purpose === 'cold' ? 'coldMessage' : 'connectionRequest';
        await dbPut(currentProfileUrl, { ...current, [updateKey]: result.text, intent }).catch(() => {});
      }

      renderSingleText(purpose, result.text, intent);
    } catch (err) {
      renderError(err.message);
    }
  }

  function openLinkedInDM() {
    // Try to click the Message button on the page first
    const msgBtn = [...document.querySelectorAll('button')].find(b =>
      b.textContent.trim().toLowerCase() === 'message' ||
      b.getAttribute('aria-label')?.toLowerCase().includes('message')
    );
    if (msgBtn) {
      msgBtn.click();
      togglePanel(false);
      return;
    }
    // Fallback: open messaging page in a new tab
    const profileSlug = location.pathname.replace(/\/$/, '').split('/in/')[1];
    if (profileSlug) {
      window.open(`https://www.linkedin.com/messaging/compose/?to=${profileSlug}`, '_blank');
    } else {
      window.open('https://www.linkedin.com/messaging/', '_blank');
    }
    togglePanel(false);
  }

  function renderSingleText(purpose, text, intent) {
    const body = document.getElementById('lia-body');
    if (!body) return;

    const isCold = purpose === 'cold';
    const label = isCold ? 'First Cold Message' : 'Connection Request';
    const charLimit = isCold ? 300 : 200;
    const charCount = (text || '').length;
    const charClass = charCount > charLimit ? 'char-over' : charCount > charLimit * 0.8 ? 'char-warn' : 'char-ok';

    body.innerHTML = `
      <div class="lia-back-row">
        <button class="lia-back-btn" id="lia-back-btn">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Back
        </button>
      </div>
      <div class="lia-section">
        <div class="lia-label">${label}</div>
        <div class="lia-connection-box">
          <p id="lia-single-text">${escHtml(text || '')}</p>
          <div class="lia-char-count ${charClass}">${charCount} / ${charLimit} chars</div>
        </div>
        <button class="lia-btn-primary lia-copy-btn" id="lia-single-copy">Copy to Clipboard</button>
      </div>
      <div class="lia-section lia-regen-section">
        <div class="lia-label">Your findings <span class="lia-optional">(optional — guides the rewrite)</span></div>
        <textarea
          class="lia-notes-input"
          id="lia-notes-input"
          placeholder="e.g. They just launched a new product, recently moved from X to Y, mentioned budget issues in a post..."
          rows="3"
        ></textarea>
        <button class="lia-btn-secondary lia-regen-btn" id="lia-single-regen">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"></polyline>
            <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
          </svg>
          Regenerate
        </button>
      </div>
    `;

    body.querySelector('#lia-back-btn').addEventListener('click', renderPurposePicker);

    body.querySelector('#lia-single-copy').addEventListener('click', async () => {
      const btn = body.querySelector('#lia-single-copy');
      await navigator.clipboard.writeText(text || '');
      btn.textContent = 'Copied!';
      btn.classList.add('copied');
      setTimeout(() => { btn.textContent = 'Copy to Clipboard'; btn.classList.remove('copied'); }, 2000);
    });

    body.querySelector('#lia-single-regen').addEventListener('click', async () => {
      const btn = body.querySelector('#lia-single-regen');
      const notes = body.querySelector('#lia-notes-input').value.trim();
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Regenerating...`;
      btn.disabled = true;
      await runForPurpose(purpose, notes, true);
    });
  }

  async function runAnalysis() {
    const hasKey = await checkApiKey();
    if (!hasKey) { renderNoApiKey(); return; }

    // Make sure tabs are visible for full analysis
    const tabs = panel?.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = '';

    setLoadingState();
    const profileData = extractProfile();

    const { analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get('analysisIntent');

    try {
      const [analysis, connectionResult] = await Promise.all([
        sendMessage('ANALYZE_PROFILE', profileData, { intent }),
        sendMessage('GENERATE_CONNECTION_REQUEST', profileData, { intent }),
      ]);

      if (analysis.error) throw new Error(analysis.error);
      if (connectionResult.error) throw new Error(connectionResult.error);

      const prevRec = await dbGet(currentProfileUrl).catch(() => null);
      const record = { ...(prevRec || {}), analysis, connectionRequest: connectionResult.text, intent };
      await dbPut(currentProfileUrl, record).catch(() => {});
      renderResults(record.analysis, record.connectionRequest, Date.now(), intent);
    } catch (err) {
      renderError(err.message);
    }
  }

  // ─── Panel ────────────────────────────────────────────────────────────────────
  function createPanel() {
    panel = document.createElement('div');
    panel.id = 'lia-panel';
    panel.innerHTML = `
      <div class="lia-header">
        <div class="lia-header-title">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
          </svg>
          <span>Husnain LinkedIn Helper</span>
        </div>
        <div class="lia-header-actions">
          <button class="lia-reanalyze-btn" id="lia-reanalyze-btn" aria-label="Re-analyze profile" title="Re-analyze">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button class="lia-hs-btn" id="lia-hs-btn" aria-label="Push to HubSpot" title="Push to HubSpot">
            <svg width="15" height="15" viewBox="0 0 512 512" fill="currentColor">
              <path d="M267.4 211.6c-25.1 23.7-40.8 57-40.8 94 0 29.3 9.7 56.3 26 78L203 434c-4.4-1.6-9.1-2.5-14-2.5-22.1 0-40 17.9-40 40s17.9 40 40 40 40-17.9 40-40c0-4-.6-7.9-1.6-11.6l50.1-50.2c21.7 14.2 47.4 22.5 75 22.5 76.2 0 138-61.8 138-138s-61.8-138-138-138c-30.2 0-58.2 9.7-80.8 26.1l.7-.7zM353.4 414c-52.9 0-96-43.1-96-96s43.1-96 96-96 96 43.1 96 96-43.1 96-96 96zM260 75.2l30.6 10.3-2.2-31.9 25.9 19.3 11.2-30.3 15.6 27.7 22.2-23.6-.7 32.1 31.4-7.7-16.2 27.4 30.7 9.9-28.5 14.1 20.9 24.3-31.8-2.7 4.5 31.7-26.4-18.6-10.4 30.5-16.4-27.3-21.5 24.3.1-32.1-31.5 8.2L278 153l-30.9-9.4 28.9-13.6L256 106l32 2.2-4.9-31.7L260 75.2zM119.1 160.7l19 6.4-1.4-19.8 16.1 12 7-18.8 9.7 17.2 13.8-14.7-.4 19.9 19.5-4.8-10.1 17 19.1 6.2-17.7 8.7 13 15.1-19.7-1.7 2.8 19.7-16.4-11.6-6.4 18.9-10.2-16.9-13.3 15.1.1-19.9-19.6 5.1 9.6-16.9-19.2-5.8 17.9-8.5-8.1-15.6 19.9 1.4-3-19.6-5.3 5.3zM27.1 335.2l13.7 4.6-1-14.3L51.4 334l5-13.6 7 12.4 10-10.6-.3 14.4L87.2 333l-7.3 12.3 13.8 4.5-12.8 6.3 9.4 10.9-14.3-1.2 2 14.3L66.1 371l-4.7 13.7-7.3-12.2-9.6 10.9.1-14.4-14.2 3.7 6.9-12.2-13.8-4.2 12.9-6.1L27.1 335.2z"/>
            </svg>
          </button>
          <button class="lia-close" aria-label="Close">&times;</button>
        </div>
      </div>
      <div class="lia-tabs">
        <button class="lia-tab active" data-tab="analysis">Analysis</button>
        <button class="lia-tab" data-tab="connection">Connection</button>
        <button class="lia-tab" data-tab="contact">Contact</button>
        <span class="lia-analyzed-at" id="lia-analyzed-at"></span>
      </div>
      <div class="lia-body" id="lia-body">
        <div class="lia-loading">
          <div class="lia-spinner"></div>
          <p>Extracting profile & analyzing...</p>
        </div>
      </div>
    `;

    panel.querySelector('.lia-close').addEventListener('click', () => togglePanel(false));
    panel.querySelectorAll('.lia-tab').forEach(tab => {
      tab.addEventListener('click', () => switchTab(tab.dataset.tab));
    });
    panel.querySelector('#lia-hs-btn').addEventListener('click', openHubSpotModal);
    panel.querySelector('#lia-reanalyze-btn').addEventListener('click', () => {
      const body = document.getElementById('lia-body');
      if (body) body._rendered = null;
      renderPurposePicker();
    });

    document.body.appendChild(panel);
    reflectHubSpotState();
  }

  function togglePanel(show) {
    if (!panel) return;
    panel.classList.toggle('lia-open', show);
    if (triggerBtn) triggerBtn.classList.toggle('lia-active', show);
  }

  function switchTab(tab) {
    activeTab = tab;
    panel.querySelectorAll('.lia-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
    const body = panel.querySelector('#lia-body');
    if (body._rendered) renderTabContent(body._rendered.analysis, body._rendered.connectionRequest, tab, body._rendered.intent || 'b2b_sales');
  }

  // ─── Render States ────────────────────────────────────────────────────────────
  function setLoadingState() {
    const body = document.getElementById('lia-body');
    if (body) body.innerHTML = `
      <div class="lia-loading">
        <div class="lia-spinner"></div>
        <p>Analyzing with OpenAI...</p>
      </div>
    `;
  }

  function renderNoApiKey() {
    const body = document.getElementById('lia-body');
    if (!body) return;
    body.innerHTML = `
      <div class="lia-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#0A66C2" stroke-width="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"></path>
        </svg>
        <h3>API Key Required</h3>
        <p>Enter your OpenAI API key to enable AI analysis.</p>
        <button class="lia-btn-primary" id="lia-open-settings">Open Settings</button>
      </div>
    `;
    body.querySelector('#lia-open-settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    });
  }

  function renderError(message) {
    const body = document.getElementById('lia-body');
    if (!body) return;
    const isNoKey = message === 'NO_API_KEY';
    if (isNoKey) { renderNoApiKey(); return; }

    const isStale = /context invalidated|Extension context/i.test(message);

    body.innerHTML = `
      <div class="lia-empty">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="${isStale ? '#d97706' : '#dc2626'}" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h3>${isStale ? 'Extension Updated' : 'Analysis Failed'}</h3>
        <p>${isStale ? 'The extension was reloaded. Refresh this page to reconnect.' : escHtml(message)}</p>
        <button class="lia-btn-primary" id="lia-retry">${isStale ? 'Refresh Page' : 'Try Again'}</button>
      </div>
    `;
    body.querySelector('#lia-retry').addEventListener('click', async () => {
      if (isStale) { location.reload(); return; }
      await dbDelete(currentProfileUrl).catch(() => {});
      panel.remove();
      panel = null;
      handleTriggerClick();
    });
  }

  function renderResults(analysis, connectionRequest, timestamp, intent = 'b2b_sales') {
    const body = document.getElementById('lia-body');
    if (!body) return;
    body._rendered = { analysis, connectionRequest, timestamp, intent };

    const tsEl = panel.querySelector('#lia-analyzed-at');
    if (tsEl && timestamp) tsEl.textContent = `Analyzed ${timeAgo(timestamp)}`;

    renderTabContent(analysis, connectionRequest, activeTab, intent);
  }

  function renderTabContent(analysis, connectionRequest, tab, intent = 'b2b_sales') {
    const body = document.getElementById('lia-body');
    if (!body) return;

    if (tab === 'analysis') {
      const csVal = analysis.companySize || analysis.company?.size || 'Unknown';
      const csClass = { Enterprise: 'cs-enterprise', 'Mid-market': 'cs-mid', SMB: 'cs-smb', Startup: 'cs-startup', Unknown: 'cs-unknown' }[csVal] || 'cs-unknown';

      const erVal = analysis.engagementRate || 'Rarely';
      const erClass = { Daily: 'er-daily', Weekly: 'er-weekly', Occasional: 'er-occasional', Rarely: 'er-rarely' }[erVal] || 'er-rarely';
      const erDots = { Daily: 4, Weekly: 3, Occasional: 2, Rarely: 1 }[erVal] || 1;

      const chips = (analysis.summaryPoints || []).slice(0, 5);

      let primaryCard = '';
      let secondaryRow = '';
      let fitCard = '';
      let companyCard = '';
      let excludedBanner = '';

      if (intent === 'job_search') {
        const hs = analysis.hiringSignal?.score || 'Unlikely';
        const hsClass = { Strong: 'score-high', Possible: 'score-medium', Unlikely: 'score-low' }[hs] || 'score-low';
        const hsBarWidth = { Strong: '90%', Possible: '55%', Unlikely: '20%' }[hs] || '20%';
        const hsBarColor = { Strong: '#16a34a', Possible: '#d97706', Unlikely: '#dc2626' }[hs] || '#dc2626';

        const irVal = analysis.isRecruiter || 'No';
        const irClass = { Yes: 'dm-yes', Likely: 'dm-likely', No: 'dm-no' }[irVal] || 'dm-no';

        primaryCard = `
          <div class="lia-indicator-card">
            <div class="ind-label">Hiring Signal</div>
            <div class="ind-score-bar-track">
              <div class="ind-score-bar-fill" style="width:${hsBarWidth};background:${hsBarColor}"></div>
            </div>
            <div class="ind-score-badge ${hsClass}">${hs}</div>
            <div class="ind-reasoning">${escHtml(analysis.hiringSignal?.reasoning || '')}</div>
          </div>`;

        secondaryRow = `
          <div class="lia-indicator-row">
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Recruiter</div>
              <div class="ind-value ${irClass}">${irVal}</div>
            </div>
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Company Size</div>
              <div class="ind-value ${csClass}">${escHtml(csVal)}</div>
            </div>
          </div>`;

        const jsCompany = analysis.companyName;
        if (jsCompany && jsCompany !== 'Unknown') {
          companyCard = `
            <div class="lia-section">
              <div class="lia-label">Company</div>
              <div class="lia-company-grid">
                <div class="lia-company-cell" style="grid-column:1/-1">
                  <span class="lia-company-key">Name</span>
                  <span class="lia-company-val">${escHtml(jsCompany)}</span>
                </div>
              </div>
            </div>`;
        }
      } else if (intent === 'b2c_sales') {
        const score = analysis.clientPotential?.score || 'Low';
        const scoreClass = { High: 'score-high', Medium: 'score-medium', Low: 'score-low' }[score] || 'score-low';
        const scoreBarWidth = { High: '90%', Medium: '55%', Low: '20%' }[score] || '20%';
        const scoreBarColor = { High: '#16a34a', Medium: '#d97706', Low: '#dc2626' }[score] || '#dc2626';

        const fsVal = analysis.freelancerSignal?.signal || 'Unlikely';
        const fsClass = { Strong: 'fit-strong', Possible: 'fit-partial', Unlikely: 'fit-poor' }[fsVal] || 'fit-poor';
        const fsBarWidth = { Strong: '90%', Possible: '55%', Unlikely: '20%' }[fsVal] || '20%';
        const fsBarColor = { Strong: '#16a34a', Possible: '#d97706', Unlikely: '#dc2626' }[fsVal] || '#dc2626';

        const dmVal = analysis.decisionMaker || 'No';
        const dmClass = { Yes: 'dm-yes', Likely: 'dm-likely', No: 'dm-no' }[dmVal] || 'dm-no';

        primaryCard = `
          <div class="lia-indicator-card">
            <div class="ind-label">Client Potential</div>
            <div class="ind-score-bar-track">
              <div class="ind-score-bar-fill" style="width:${scoreBarWidth};background:${scoreBarColor}"></div>
            </div>
            <div class="ind-score-badge ${scoreClass}">${score}</div>
            <div class="ind-reasoning">${escHtml(analysis.clientPotential?.reasoning || '')}</div>
          </div>`;

        fitCard = `
          <div class="lia-indicator-card">
            <div class="ind-label">Freelancer Signal</div>
            <div class="ind-score-bar-track">
              <div class="ind-score-bar-fill" style="width:${fsBarWidth};background:${fsBarColor}"></div>
            </div>
            <div class="ind-score-badge ${fsClass}">${escHtml(fsVal)}</div>
            <div class="ind-reasoning">${escHtml(analysis.freelancerSignal?.reasoning || '')}</div>
          </div>`;

        secondaryRow = `
          <div class="lia-indicator-row">
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Decision Maker</div>
              <div class="ind-value ${dmClass}">${dmVal}</div>
            </div>
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Company Size</div>
              <div class="ind-value ${csClass}">${escHtml(csVal)}</div>
            </div>
          </div>`;

        // Company details card (B2C has size + stage instead of headcount + domain)
        const co = analysis.company || {};
        const coRows = [
          ['Company', co.name],
          ['Stage', co.stage],
          ['Size', co.size],
        ].filter(([, v]) => v && v !== 'Unknown');

        if (coRows.length) {
          companyCard = `
            <div class="lia-section">
              <div class="lia-label">Company</div>
              <div class="lia-company-grid">
                ${coRows.map(([k, v]) => `<div class="lia-company-cell"><span class="lia-company-key">${k}</span><span class="lia-company-val">${escHtml(v)}</span></div>`).join('')}
              </div>
            </div>`;
        }

      } else {
        const score = analysis.potentialClient?.score || 'Low';
        const scoreClass = { High: 'score-high', Medium: 'score-medium', Low: 'score-low' }[score] || 'score-low';
        const scoreBarWidth = { High: '90%', Medium: '55%', Low: '20%' }[score] || '20%';
        const scoreBarColor = { High: '#16a34a', Medium: '#d97706', Low: '#dc2626' }[score] || '#dc2626';

        const dmVal = analysis.decisionMaker || 'No';
        const dmClass = { Yes: 'dm-yes', Likely: 'dm-likely', No: 'dm-no' }[dmVal] || 'dm-no';

        primaryCard = `
          <div class="lia-indicator-card">
            <div class="ind-label">Prospect Score</div>
            <div class="ind-score-bar-track">
              <div class="ind-score-bar-fill" style="width:${scoreBarWidth};background:${scoreBarColor}"></div>
            </div>
            <div class="ind-score-badge ${scoreClass}">${score}</div>
            <div class="ind-reasoning">${escHtml(analysis.potentialClient?.reasoning || '')}</div>
          </div>`;

        secondaryRow = `
          <div class="lia-indicator-row">
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Decision Maker</div>
              <div class="ind-value ${dmClass}">${dmVal}</div>
            </div>
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Company Size</div>
              <div class="ind-value ${csClass}">${escHtml(csVal)}</div>
            </div>
          </div>`;

        // Industry Fit (ICP) — B2B sales only
        const fit = analysis.industryFit || {};
        const fitLevel = fit.level || 'Partial';
        const fitClass = { Strong: 'fit-strong', Partial: 'fit-partial', Poor: 'fit-poor' }[fitLevel] || 'fit-partial';
        const fitBarWidth = { Strong: '90%', Partial: '55%', Poor: '20%' }[fitLevel] || '55%';
        const fitBarColor = { Strong: '#16a34a', Partial: '#d97706', Poor: '#dc2626' }[fitLevel] || '#d97706';

        fitCard = `
          <div class="lia-indicator-card">
            <div class="ind-label">Industry Fit</div>
            <div class="ind-score-bar-track">
              <div class="ind-score-bar-fill" style="width:${fitBarWidth};background:${fitBarColor}"></div>
            </div>
            <div class="ind-score-badge ${fitClass}">${escHtml(fitLevel)} fit</div>
            <div class="ind-reasoning">${escHtml(fit.reasoning || '')}</div>
          </div>`;

        if (fit.excluded) {
          excludedBanner = `
            <div class="lia-excluded-banner">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
                <circle cx="12" cy="12" r="10"></circle>
                <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line>
              </svg>
              <span>Excluded industry — flagged as a poor fit for your ICP.</span>
            </div>`;
        }

        // Company details card
        const co = analysis.company || {};
        const coRows = [
          ['Company', co.name],
          ['Industry', co.industry],
          ['Headcount', co.headcount],
          ['Website', co.domain],
        ].filter(([, v]) => v && v !== 'Unknown');

        if (coRows.length) {
          companyCard = `
            <div class="lia-section">
              <div class="lia-label">Company</div>
              <div class="lia-company-grid">
                ${coRows.map(([k, v]) => {
                  const isDomain = k === 'Website' && /\./.test(v) && !/\s/.test(v);
                  const valHtml = isDomain
                    ? `<a class="lia-company-link" href="https://${escHtml(v.replace(/^https?:\/\//, ''))}" target="_blank" rel="noopener">${escHtml(v)}</a>`
                    : escHtml(v);
                  return `<div class="lia-company-cell"><span class="lia-company-key">${k}</span><span class="lia-company-val">${valHtml}</span></div>`;
                }).join('')}
              </div>
            </div>`;
        }
      }

      body.innerHTML = `
        ${excludedBanner}
        <div class="lia-indicators">

          ${primaryCard}

          ${fitCard}

          ${secondaryRow}

          <div class="lia-indicator-row">
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Engagement</div>
              <div class="ind-dots">
                ${[1,2,3,4].map(i => `<span class="ind-dot ${i <= erDots ? 'filled' : ''}"></span>`).join('')}
              </div>
              <div class="ind-value ${erClass}">${escHtml(erVal)}</div>
            </div>
            <div class="lia-indicator-card lia-ind-half">
              <div class="ind-label">Industry</div>
              <div class="ind-value ind-industry">${escHtml(analysis.industry || 'Unknown')}</div>
            </div>
          </div>

        </div>

        ${companyCard}

        ${chips.length ? `
        <div class="lia-section">
          <div class="lia-label">Profile Facts</div>
          <div class="lia-chips">
            ${chips.map(c => `<span class="lia-chip">${escHtml(c)}</span>`).join('')}
          </div>
        </div>` : ''}

        <div class="lia-section">
          <div class="lia-label">Recent Activity</div>
          <p class="lia-text">${escHtml(analysis.recentActivity || 'No recent activity detected.')}</p>
        </div>

        ${intent === 'b2c_sales' && (analysis.painPoints || []).length ? `
        <div class="lia-section">
          <div class="lia-label">Pain Points</div>
          <div class="lia-callouts">
            ${analysis.painPoints.map((p, i) => `
              <div class="lia-callout">
                <span class="callout-num">${i + 1}</span>
                <span class="callout-text">${escHtml(p)}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}

        ${intent === 'b2c_sales' && analysis.approachAngle ? `
        <div class="lia-section">
          <div class="lia-label">Approach Angle</div>
          <p class="lia-text">${escHtml(analysis.approachAngle)}</p>
        </div>` : ''}

        ${(analysis.keyInsights || []).length ? `
        <div class="lia-section">
          <div class="lia-label">${intent === 'job_search' ? 'Job Search Insights' : intent === 'b2c_sales' ? 'Freelance Insights' : 'Key Insights'}</div>
          <div class="lia-callouts">
            ${analysis.keyInsights.map((insight, i) => `
              <div class="lia-callout">
                <span class="callout-num">${i + 1}</span>
                <span class="callout-text">${escHtml(insight)}</span>
              </div>
            `).join('')}
          </div>
        </div>` : ''}
      `;
    } else if (tab === 'connection') {
      const charCount = (connectionRequest || '').length;
      const charClass = charCount > 200 ? 'char-over' : charCount > 160 ? 'char-warn' : 'char-ok';

      body.innerHTML = `
        <div class="lia-section">
          <div class="lia-label">Connection Request</div>
          <div class="lia-connection-box">
            <p id="lia-connection-text">${escHtml(connectionRequest || '')}</p>
            <div class="lia-char-count ${charClass}">${charCount} / 200 chars</div>
          </div>
          <button class="lia-btn-primary lia-copy-btn" id="lia-copy-btn">Copy to Clipboard</button>
        </div>
        <div class="lia-section lia-regen-section">
          <div class="lia-label">Your findings <span class="lia-optional">(optional — guides the rewrite)</span></div>
          <textarea class="lia-notes-input" id="lia-conn-notes" placeholder="e.g. They just posted about hiring, recently changed roles, mentioned a budget review..." rows="3"></textarea>
          <button class="lia-btn-secondary lia-regen-btn" id="lia-regen-btn">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
            Regenerate
          </button>
        </div>
      `;

      body.querySelector('#lia-copy-btn').addEventListener('click', async () => {
        const btn = body.querySelector('#lia-copy-btn');
        await navigator.clipboard.writeText(connectionRequest || '');
        btn.textContent = 'Copied!';
        btn.classList.add('copied');
        setTimeout(() => { btn.textContent = 'Copy to Clipboard'; btn.classList.remove('copied'); }, 2000);
      });

      body.querySelector('#lia-regen-btn').addEventListener('click', async () => {
        const btn = body.querySelector('#lia-regen-btn');
        const notes = body.querySelector('#lia-conn-notes')?.value.trim() || '';
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Regenerating...`;
        btn.disabled = true;
        try {
          const profileData = extractProfile();
          const result = await sendMessage('GENERATE_CONNECTION_REQUEST', profileData, { intent, userNotes: notes || undefined });
          if (result.error) throw new Error(result.error);
          body._rendered.connectionRequest = result.text;
          if (!notes) {
            const stored = await dbGet(currentProfileUrl).catch(() => null);
            if (stored) await dbPut(currentProfileUrl, { ...stored, connectionRequest: result.text }).catch(() => {});
          }
          renderTabContent(analysis, result.text, 'connection', intent);
        } catch (e) {
          btn.textContent = e.message || 'Error — try again';
          btn.disabled = false;
        }
      });
    } else if (tab === 'contact') {
      const contactInfo = extractContactInfo();
      body.innerHTML = `
        <div class="lia-section">
          <div class="lia-label">Visible Contact Info</div>
          ${contactInfo.length
            ? `<ul class="lia-contact-list">${contactInfo.map(c => `
                <li>
                  <span class="contact-type">${escHtml(c.type)}</span>
                  <span class="contact-value">${escHtml(c.value)}</span>
                </li>`).join('')}</ul>`
            : `<p class="lia-text lia-muted">No contact info visible on this profile. LinkedIn may require a connection to see contact details.</p>`
          }
        </div>
      `;
    }
  }

  // ─── HubSpot Modal ────────────────────────────────────────────────────────────
  async function openHubSpotModal() {
    const existing = document.getElementById('lia-hs-modal');
    if (existing) { existing.remove(); return; }

    const { hasKey: hsKey } = await sendMessage('GET_HS_KEY_STATUS', {});

    if (!hsKey) {
      showHsModal(`
        <div class="lia-hs-modal-body">
          <p class="lia-hs-notice">No HubSpot token found. Add it in Settings to push deals.</p>
          <button class="lia-btn-primary" id="lia-hs-go-settings">Open Settings</button>
        </div>
      `, false);
      document.getElementById('lia-hs-go-settings').addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
      });
      return;
    }

    showHsModal(`<div class="lia-hs-modal-body"><div class="lia-hs-loading"><div class="lia-spinner"></div><span>Loading pipelines...</span></div></div>`, false);

    const [pipelinesResult, ownersResult] = await Promise.all([
      sendMessage('FETCH_HUBSPOT_PIPELINES', {}),
      sendMessage('FETCH_HUBSPOT_OWNERS', {}),
    ]);

    if (pipelinesResult.error) {
      document.querySelector('.lia-hs-modal-body').innerHTML = `
        <p class="lia-hs-error">Failed to load pipelines: ${escHtml(pipelinesResult.error)}</p>
        <button class="lia-btn-secondary" id="lia-hs-close-err">Close</button>
      `;
      document.getElementById('lia-hs-close-err').addEventListener('click', () => {
        document.getElementById('lia-hs-modal')?.remove();
      });
      return;
    }

    const pipelines = pipelinesResult;
    const owners = Array.isArray(ownersResult) ? ownersResult : [];
    const body = document.getElementById('lia-body');
    const rendered = body?._rendered;
    const connectionText = rendered?.connectionRequest || '';

    const pushedRec = await dbGet(currentProfileUrl).catch(() => null);
    const alreadyPushed = !!pushedRec?.hubspotPushed;
    const pushedNotice = alreadyPushed ? `
      <div class="lia-hs-pushed-notice">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <polyline points="9 12 11 14 15 10"></polyline>
        </svg>
        <span>Already pushed to HubSpot${pushedRec.hubspotPushedAt ? ` ${timeAgo(pushedRec.hubspotPushedAt)}` : ''}. You can push again if you want.</span>
      </div>` : '';

    // Get name from stored analysis summary, page h2/h1, or fallback
    const _profilePath = location.pathname.replace(/\/$/, '');
    const profileName =
      document.querySelector(`a[href*="${_profilePath}"] h2`)?.textContent.trim() ||
      document.querySelector('main h2')?.textContent.trim() ||
      document.querySelector('h1')?.textContent.trim() ||
      'LinkedIn Lead';

    const pipelineOptions = pipelines.map(p =>
      `<option value="${escHtml(p.id)}">${escHtml(p.label)}</option>`
    ).join('');

    const firstStages = pipelines[0]?.stages || [];
    const stageOptions = firstStages.map(s =>
      `<option value="${escHtml(s.id)}">${escHtml(s.label)}</option>`
    ).join('');

    document.querySelector('.lia-hs-modal-body').innerHTML = `
      ${pushedNotice}
      <div class="lia-hs-row">
        <label class="lia-hs-label">Deal Name</label>
        <input class="lia-hs-input" id="lia-hs-dealname" value="${escHtml(profileName)}" />
      </div>
      <div class="lia-hs-row">
        <label class="lia-hs-label">Pipeline</label>
        <select class="lia-hs-select" id="lia-hs-pipeline">${pipelineOptions}</select>
      </div>
      <div class="lia-hs-row">
        <label class="lia-hs-label">Stage</label>
        <select class="lia-hs-select" id="lia-hs-stage">${stageOptions}</select>
      </div>
      ${owners.length ? `
      <div class="lia-hs-row">
        <label class="lia-hs-label">Deal Owner</label>
        <select class="lia-hs-select" id="lia-hs-owner">
          <option value="">— Unassigned —</option>
          ${owners.map(o => `<option value="${escHtml(o.id)}">${escHtml(o.label)}</option>`).join('')}
        </select>
      </div>` : ''}
      <div class="lia-hs-row">
        <label class="lia-hs-label">Remarks <span class="lia-hs-optional">(optional — goes to top of notes)</span></label>
        <textarea class="lia-hs-textarea" id="lia-hs-remarks" placeholder="Add any notes about this contact..."></textarea>
      </div>
      <div class="lia-hs-preview">
        <div class="lia-hs-preview-label">Notes preview</div>
        <div class="lia-hs-preview-text" id="lia-hs-preview"></div>
      </div>
      <button class="lia-btn-primary" id="lia-hs-push-btn">${alreadyPushed ? 'Push Again to HubSpot' : 'Push to HubSpot'}</button>
    `;

    const modal = document.getElementById('lia-hs-modal');
    const pipelineEl = modal.querySelector('#lia-hs-pipeline');
    const stageEl = modal.querySelector('#lia-hs-stage');
    const remarksEl = modal.querySelector('#lia-hs-remarks');
    const previewEl = modal.querySelector('#lia-hs-preview');

    function updatePreview() {
      const remarks = remarksEl.value.trim();
      const parts = [];
      if (remarks) parts.push(remarks);
      parts.push(`LinkedIn: ${currentProfileUrl}`);
      if (connectionText) parts.push(`Connection Request:\n${connectionText}`);
      previewEl.textContent = parts.join('\n\n');
    }

    updatePreview();
    remarksEl.addEventListener('input', updatePreview);

    pipelineEl.addEventListener('change', () => {
      const selected = pipelines.find(p => p.id === pipelineEl.value);
      const stages = selected?.stages || [];
      stageEl.innerHTML = stages.length
        ? stages.map(s => `<option value="${escHtml(s.id)}">${escHtml(s.label)}</option>`).join('')
        : '<option value="">— No stages —</option>';
    });

    modal.querySelector('#lia-hs-push-btn').addEventListener('click', async () => {
      const btn = modal.querySelector('#lia-hs-push-btn');
      btn.textContent = 'Pushing...';
      btn.disabled = true;

      const ownerEl = modal.querySelector('#lia-hs-owner');
      const pushResult = await sendMessage('PUSH_TO_HUBSPOT', {
        name: modal.querySelector('#lia-hs-dealname').value.trim() || profileName,
        linkedinUrl: currentProfileUrl,
        contactText: connectionText,
        remarks: remarksEl.value.trim(),
        pipelineId: pipelineEl.value,
        stageId: stageEl.value,
        ownerId: ownerEl?.value || '',
      });

      if (pushResult.error) {
        btn.textContent = 'Failed — Try Again';
        btn.disabled = false;
        modal.querySelector('.lia-hs-modal-body').insertAdjacentHTML('afterbegin',
          `<p class="lia-hs-error">${escHtml(pushResult.error)}</p>`
        );
        return;
      }

      document.querySelector('.lia-hs-modal-body').innerHTML = `
        <div class="lia-hs-success">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <polyline points="9 12 11 14 15 10"></polyline>
          </svg>
          <p>Deal pushed to HubSpot!</p>
          <button class="lia-btn-secondary" id="lia-hs-done">Done</button>
        </div>
      `;
      document.getElementById('lia-hs-done').addEventListener('click', () => {
        document.getElementById('lia-hs-modal')?.remove();
      });

      // Persist pushed state so we can remind the user next time
      const pushedAt = Date.now();
      const stored = await dbGet(currentProfileUrl).catch(() => null) || { url: currentProfileUrl };
      await dbPut(currentProfileUrl, { ...stored, hubspotPushed: true, hubspotPushedAt: pushedAt }).catch(() => {});
      reflectHubSpotState();
    });
  }

  // Reflect persisted "already pushed" state on the HubSpot button
  async function reflectHubSpotState() {
    const hsBtn = document.getElementById('lia-hs-btn');
    if (!hsBtn) return;
    const rec = await dbGet(currentProfileUrl).catch(() => null);
    if (rec?.hubspotPushed) {
      hsBtn.classList.add('hs-pushed');
      hsBtn.title = `Already pushed to HubSpot${rec.hubspotPushedAt ? ` (${timeAgo(rec.hubspotPushedAt)})` : ''}`;
    } else {
      hsBtn.classList.remove('hs-pushed');
      hsBtn.title = 'Push to HubSpot';
    }
  }

  function showHsModal(innerHtml, hasCloseBtn = true) {
    const existing = document.getElementById('lia-hs-modal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'lia-hs-modal';
    modal.innerHTML = `
      <div class="lia-hs-modal-header">
        <span class="lia-hs-modal-title">Push to HubSpot</span>
        <button class="lia-hs-modal-close" id="lia-hs-modal-close">&times;</button>
      </div>
      ${innerHtml}
    `;
    panel.appendChild(modal);
    modal.querySelector('#lia-hs-modal-close').addEventListener('click', () => modal.remove());
  }

  // ─── Profile Extraction ───────────────────────────────────────────────────────
  function extractProfile() {
    const profile = {};

    // Name - LinkedIn uses h2 in the top card for the profile name
    const profilePath = location.pathname.replace(/\/$/, '');
    const nameEl =
      document.querySelector(`a[href*="${profilePath}"] h2`) ||
      document.querySelector('main h2') ||
      document.querySelector('h1');
    if (nameEl) profile.name = nameEl.textContent.trim();

    // Headline — element right after h1 in the profile card
    const headline = document.querySelector('.text-body-medium.break-words') ||
                     document.querySelector('[data-generated-suggestion-target]');
    if (headline) profile.headline = headline.textContent.trim();

    // Fallback headline via aria patterns
    if (!profile.headline) {
      const allDivs = document.querySelectorAll('div.text-body-medium');
      if (allDivs[0]) profile.headline = allDivs[0].textContent.trim();
    }

    // Location
    const locationEl = document.querySelector('.text-body-small.inline.t-black--light.break-words') ||
                       document.querySelector('[data-field="location_of_origin"]');
    if (locationEl) profile.location = locationEl.textContent.trim();

    // Connections & followers
    const connEl = document.querySelector('span.t-bold');
    if (connEl) profile.connections = connEl.textContent.trim();

    const followerMatch = document.body.innerText.match(/([0-9,]+)\s+followers/i);
    if (followerMatch) profile.followers = followerMatch[1];

    // Experience section
    profile.experience = extractSection('Experience', node => {
      const roles = [];
      const items = node.querySelectorAll('li');
      items.forEach(item => {
        const titleEl = item.querySelector('span[aria-hidden="true"]') || item.querySelector('.t-bold span');
        const companyEl = item.querySelectorAll('span[aria-hidden="true"]')[1];
        const dateEl = item.querySelector('.t-black--light span[aria-hidden="true"]') ||
                       item.querySelector('span.t-14.t-normal.t-black--light');
        const descEl = item.querySelector('.pvs-list__outer-container');

        const role = {};
        if (titleEl) role.title = titleEl.textContent.trim();
        if (companyEl) role.company = companyEl.textContent.trim();
        if (dateEl) role.duration = dateEl.textContent.trim();
        if (descEl) role.description = descEl.textContent.trim().slice(0, 300);
        if (role.title || role.company) roles.push(role);
      });
      return roles;
    });

    // Education section
    profile.education = extractSection('Education', node => {
      const items = [];
      node.querySelectorAll('li').forEach(item => {
        const schoolEl = item.querySelector('span[aria-hidden="true"]');
        const degreeEl = item.querySelectorAll('span[aria-hidden="true"]')[1];
        if (schoolEl) items.push({
          school: schoolEl.textContent.trim(),
          degree: degreeEl?.textContent.trim(),
        });
      });
      return items;
    });

    // Skills section
    profile.skills = extractSection('Skills', node => {
      const skills = [];
      node.querySelectorAll('span[aria-hidden="true"]').forEach(el => {
        const text = el.textContent.trim();
        if (text && text.length < 60 && !text.includes('\n')) skills.push(text);
      });
      return [...new Set(skills)].slice(0, 15);
    });

    // Raw visible text of the main content area (most reliable fallback)
    const mainEl = document.querySelector('main') ||
                   document.querySelector('#main') ||
                   document.querySelector('.scaffold-layout__main');
    if (mainEl) {
      profile.rawText = mainEl.innerText.replace(/\s{3,}/g, '\n\n').trim().slice(0, 4000);
    }

    // Activity / Posts
    profile.posts = extractSection('Activity', node => {
      const posts = [];
      node.querySelectorAll('.feed-shared-update-v2, .occludable-update, article').forEach(postEl => {
        const text = postEl.textContent.trim().replace(/\s+/g, ' ');
        if (text.length > 50) posts.push(text.slice(0, 500));
      });
      // Fallback: grab span text blocks from activity section
      if (!posts.length) {
        node.querySelectorAll('span[aria-hidden="true"]').forEach(el => {
          const text = el.textContent.trim();
          if (text.length > 100) posts.push(text.slice(0, 500));
        });
      }
      return posts.slice(0, 5);
    });

    return profile;
  }

  function extractSection(sectionName, parser) {
    const sections = document.querySelectorAll('section');
    for (const section of sections) {
      const h2 = section.querySelector('h2');
      if (h2 && h2.textContent.trim().toLowerCase().includes(sectionName.toLowerCase())) {
        try { return parser(section); } catch { return []; }
      }
    }
    return [];
  }

  function extractContactInfo() {
    const info = [];
    const seen = new Set();

    // Email links
    document.querySelectorAll('a[href^="mailto:"]').forEach(el => {
      const val = el.href.replace('mailto:', '').trim();
      if (val && !seen.has(val)) { seen.add(val); info.push({ type: 'Email', value: val }); }
    });

    // Website links
    document.querySelectorAll('a[data-field="website_url"], .pv-contact-info__contact-type a').forEach(el => {
      const val = el.textContent.trim() || el.href;
      if (val && !seen.has(val)) { seen.add(val); info.push({ type: 'Website', value: val }); }
    });

    // Phone
    const phoneMatch = document.body.innerText.match(/(?:phone|tel|mobile)[:\s]+([+\d\s\-().]{7,20})/i);
    if (phoneMatch && !seen.has(phoneMatch[1])) {
      info.push({ type: 'Phone', value: phoneMatch[1].trim() });
    }

    // Twitter
    document.querySelectorAll('a[href*="twitter.com"], a[href*="x.com"]').forEach(el => {
      const val = el.href;
      if (!seen.has(val)) { seen.add(val); info.push({ type: 'Twitter/X', value: val }); }
    });

    return info;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────
  function sendMessage(type, data, extra = {}) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage({ type, profileData: data, ...extra }, response => {
          if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
          else resolve(response);
        });
      } catch (e) {
        reject(new Error('Extension context invalidated — please refresh the page.'));
      }
    });
  }

  async function checkApiKey() {
    return new Promise(resolve => {
      try {
        chrome.runtime.sendMessage({ type: 'GET_API_KEY_STATUS' }, response => {
          if (chrome.runtime.lastError) { resolve(false); return; }
          resolve(response?.hasKey ?? false);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  function escHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function resetUI() {
    if (panel) { panel.remove(); panel = null; }
    if (triggerBtn) { triggerBtn.remove(); triggerBtn = null; }
    activeTab = 'analysis';
  }

  function removeAll() {
    resetUI();
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
