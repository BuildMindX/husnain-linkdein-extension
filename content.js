(() => {
  'use strict';

  // ─── State ───────────────────────────────────────────────────────────────────
  let triggerBtn = null;
  let panel = null;
  let currentProfileUrl = null;
  let activeTab = 'analysis';

  // Post creator state
  let postBtn = null;
  let postPanel = null;
  let pcTopics = [];
  let pcSelected = null;     // { title, angle, hook }
  let pcStyle = 'educational';
  let pcResult = null;       // { post, hashtags, imagePrompt }
  let pcImageB64 = null;
  let pcMode = 'personal';   // 'personal' | 'company'

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

  async function isOwnProfile() {
    try {
      const r = await chrome.storage.local.get('creatorProfile');
      const myUrl = r.creatorProfile?.linkedinUrl;
      if (!myUrl) return false;
      const myPath = new URL(myUrl).pathname.replace(/\/$/, '').toLowerCase();
      const curPath = location.pathname.replace(/\/$/, '').toLowerCase();
      return curPath === myPath;
    } catch { return false; }
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  async function init() {
    if (!isProfilePage()) return;
    currentProfileUrl = location.href.split('?')[0];
    injectTriggerButton();
    const own = await isOwnProfile();
    if (own) injectPostCreatorButton();
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

  // ─── Post Creator Button ──────────────────────────────────────────────────────
  function injectPostCreatorButton() {
    if (postBtn) return;
    postBtn = document.createElement('button');
    postBtn.id = 'lia-post-trigger';
    postBtn.setAttribute('aria-label', 'Create LinkedIn Post');
    postBtn.innerHTML = `<span>✍️</span><span>Post</span>`;
    postBtn.addEventListener('click', openPostCreator);
    document.body.appendChild(postBtn);
  }

  function extractOwnPosts() {
    const texts = new Set();
    const selectors = [
      '.feed-shared-update-v2 .break-words span[dir]',
      '.update-components-text .break-words span[dir]',
      '.feed-shared-text span[dir]',
      '[data-test-id="main-feed-activity-card__commentary"] span[dir]',
      '.update-components-text span.break-words',
    ];
    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach(el => {
        const t = el.textContent.trim();
        if (t.length > 60) texts.add(t.slice(0, 250));
      });
    }
    return [...texts].slice(0, 8);
  }

  function openPostCreator() {
    if (postPanel) {
      postPanel.classList.toggle('lia-pc-open');
      return;
    }
    postPanel = document.createElement('div');
    postPanel.id = 'lia-post-panel';
    postPanel.innerHTML = `
      <div class="lia-pc-header">
        <div class="lia-pc-title">
          <span>✍️</span>
          <span>Post Creator</span>
        </div>
        <div class="lia-pc-mode-toggle" id="lia-pc-mode-toggle">
          <button class="lia-pc-mode-btn active" data-mode="personal" title="Post as yourself">👤 Me</button>
          <button class="lia-pc-mode-btn" data-mode="company" title="Post for your company">🏢 Company</button>
        </div>
        <button class="lia-pc-close" aria-label="Close">&times;</button>
      </div>
      <div class="lia-pc-body" id="lia-pc-body"></div>
    `;
    postPanel.querySelector('.lia-pc-close').addEventListener('click', () => {
      postPanel.classList.remove('lia-pc-open');
    });
    postPanel.querySelectorAll('.lia-pc-mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        if (btn.dataset.mode === pcMode) return;
        pcMode = btn.dataset.mode;
        postPanel.querySelectorAll('.lia-pc-mode-btn').forEach(b => b.classList.toggle('active', b.dataset.mode === pcMode));
        pcTopics = []; pcSelected = null; pcResult = null; pcImageB64 = null;
        renderPcLanding();
      });
    });
    document.body.appendChild(postPanel);
    setTimeout(() => postPanel.classList.add('lia-pc-open'), 10);
    renderPcLanding();
  }

  async function renderPcLanding() {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    const stored = await chrome.storage.local.get(['creatorProfile', 'companyProfile']).catch(() => ({}));
    const cp = stored.creatorProfile || {};
    const co = stored.companyProfile || {};

    const isCompany = pcMode === 'company';
    const hasSetup = isCompany ? !!co.name : (Array.isArray(cp.domains) && cp.domains.length);

    let infoHtml = '';
    if (isCompany) {
      if (co.name) {
        infoHtml = `<div class="lia-pc-company-badge">🏢 ${escHtml(co.name)}${co.industry ? ` &middot; ${escHtml(co.industry)}` : ''}</div>`;
      } else {
        infoHtml = `<p class="lia-pc-notice">No company profile found. Go to <strong>Settings → Step 4</strong> and fill in your Company Profile first.</p>`;
      }
    } else {
      const hasDomains = Array.isArray(cp.domains) && cp.domains.length;
      infoHtml = hasDomains
        ? `<div class="lia-pc-domains">${cp.domains.map(d => `<span class="lia-pc-domain-chip">${escHtml(d)}</span>`).join('')}</div>`
        : `<p class="lia-pc-notice">Tip: add your domains in Settings → Step 4 for more relevant topics.</p>`;
    }

    const recentPosts = extractOwnPosts();
    const postCountNote = recentPosts.length
      ? `<p class="lia-pc-posts-found">📋 ${recentPosts.length} recent post${recentPosts.length > 1 ? 's' : ''} found on this page — AI will avoid repeating similar topics.</p>`
      : '';

    body.innerHTML = `
      <div class="lia-pc-section">
        <p class="lia-pc-intro">${isCompany ? 'Generate a professional B2B post for your company.' : `Generate a post tailored to your niche${cp.name ? `, <strong>${escHtml(cp.name)}</strong>` : ''}.`}</p>
        ${infoHtml}
        ${postCountNote}
      </div>
      <div class="lia-pc-section">
        <button class="lia-btn-primary lia-pc-full-btn" id="lia-pc-suggest-btn"${!hasSetup && isCompany ? ' disabled' : ''}>
          💡 Suggest Trending Topics
        </button>
        <div class="lia-pc-or">— or write about something specific —</div>
        <div class="lia-pc-custom-row">
          <input type="text" class="lia-pc-custom-input" id="lia-pc-custom-topic" placeholder="Type your topic idea..." />
          <button class="lia-btn-secondary" id="lia-pc-custom-go">Go</button>
        </div>
        <div class="lia-pc-or" style="margin-top:14px">— already have a post? —</div>
        <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-img-only-btn" style="display:flex;align-items:center;justify-content:center;gap:7px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          Generate Image for My Post
        </button>
      </div>
    `;
    body.querySelector('#lia-pc-suggest-btn').addEventListener('click', () => {
      if (!hasSetup && isCompany) return;
      loadTopics(cp, co, recentPosts);
    });
    body.querySelector('#lia-pc-custom-go').addEventListener('click', () => {
      const val = document.getElementById('lia-pc-custom-topic')?.value.trim();
      if (val) {
        pcSelected = { title: val, angle: '', hook: '' };
        renderPcStylePicker(cp, co);
      }
    });
    body.querySelector('#lia-pc-custom-topic').addEventListener('keydown', e => {
      if (e.key === 'Enter') body.querySelector('#lia-pc-custom-go').click();
    });
    body.querySelector('#lia-pc-img-only-btn').addEventListener('click', renderPcImageOnly);
  }

  function renderPcImageOnly() {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    body.innerHTML = `
      <div class="lia-pc-back-row">
        <button class="lia-pc-back-btn" id="lia-pc-imgonly-back">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <polyline points="15 18 9 12 15 6"></polyline>
          </svg>
          Back
        </button>
      </div>
      <div class="lia-pc-section">
        <div class="lia-pc-label">Your Post or Description</div>
        <textarea
          class="lia-pc-imgonly-input"
          id="lia-pc-imgonly-text"
          rows="5"
          placeholder="Paste your post text, or describe what the image should convey — e.g. 'A post about AI transforming healthcare with ethical challenges' ..."></textarea>
      </div>
      <div class="lia-pc-section">
        <button class="lia-btn-primary lia-pc-full-btn" id="lia-pc-imgonly-gen">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
          </svg>
          Generate Image
        </button>
      </div>
      <div id="lia-pc-image-area" class="lia-pc-image-area" style="display:none"></div>
    `;

    body.querySelector('#lia-pc-imgonly-back').addEventListener('click', renderPcLanding);

    body.querySelector('#lia-pc-imgonly-gen').addEventListener('click', () => {
      const text = body.querySelector('#lia-pc-imgonly-text')?.value.trim();
      if (!text) {
        body.querySelector('#lia-pc-imgonly-text').focus();
        return;
      }
      const area = body.querySelector('#lia-pc-image-area');
      if (area) area.style.display = '';
      // Truncate to ~500 chars for the image prompt — enough context without overloading
      generateImage(text.slice(0, 500));
    });
  }

  async function loadTopics(cp, co, recentPosts = []) {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    const isCompany = pcMode === 'company';
    body.innerHTML = `
      <div class="lia-pc-loading">
        <div class="lia-spinner"></div>
        <p>${isCompany ? 'Generating B2B topic ideas for your company...' : 'Generating topic ideas for your niche...'}</p>
        ${recentPosts.length ? '<p style="font-size:11px;color:#94a3b8;margin-top:4px">Checking your recent posts to avoid repetition...</p>' : ''}
      </div>
    `;
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'SUGGEST_POST_TOPICS',
        creatorProfile: cp,
        companyProfile: co,
        recentPosts,
        mode: pcMode,
      }, resolve);
    });
    if (result?.error) {
      const msg = result.error === 'NO_API_KEY'
        ? 'No API key found. Add your OpenAI key in Settings → Step 3.'
        : result.error;
      body.innerHTML = `<p class="lia-pc-error">${escHtml(msg)}</p><button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-back-from-err">← Back</button>`;
      body.querySelector('#lia-pc-back-from-err').addEventListener('click', () => renderPcLanding());
      return;
    }
    pcTopics = result?.topics || [];
    renderPcTopics(cp, co);
  }

  function renderPcTopics(cp, co) {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    body.innerHTML = `
      <div class="lia-pc-section">
        <div class="lia-pc-sub-label">Pick a topic to write about:</div>
        <div class="lia-pc-topic-list" id="lia-pc-topic-list"></div>
      </div>
      <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-back-topics" style="margin-top:8px">← Back</button>
    `;
    const list = body.querySelector('#lia-pc-topic-list');
    pcTopics.forEach(t => {
      const card = document.createElement('div');
      card.className = 'lia-pc-topic-card';
      card.innerHTML = `
        <div class="lia-pc-topic-title">${escHtml(t.title)}</div>
        <div class="lia-pc-topic-angle">${escHtml(t.angle)}</div>
        <div class="lia-pc-topic-why">${escHtml(t.whyNow)}</div>
      `;
      card.addEventListener('click', () => {
        pcSelected = t;
        renderPcStylePicker(cp, co);
      });
      list.appendChild(card);
    });
    body.querySelector('#lia-pc-back-topics').addEventListener('click', () => renderPcLanding());
  }

  function renderPcStylePicker(cp, co) {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    const isCompany = pcMode === 'company';

    const styles = isCompany
      ? [
          { val: 'thought_leadership', label: '🧠 Thought Leadership', desc: 'Authoritative industry perspective' },
          { val: 'industry_insight',   label: '📊 Industry Insight',   desc: 'Data-driven trend analysis' },
          { val: 'case_study',         label: '🏆 Case Study',         desc: 'Client success story' },
          { val: 'culture',            label: '🤝 Culture / Team',     desc: 'Employer brand storytelling' },
          { val: 'product_spotlight',  label: '🚀 Product Spotlight',  desc: 'Soft-sell your solution' },
        ]
      : [
          { val: 'educational', label: '📚 Educational', desc: 'Teach something valuable' },
          { val: 'story',       label: '💬 Story',       desc: 'Personal experience or journey' },
          { val: 'hottake',     label: '🔥 Hot Take',    desc: 'Bold contrarian opinion' },
          { val: 'tips',        label: '✅ Quick Tips',  desc: 'Practical, actionable list' },
        ];

    if (isCompany) {
      const coDefault = co?.postStyle || 'thought_leadership';
      if (styles.find(s => s.val === coDefault)) pcStyle = coDefault;
    } else {
      if (!['educational','story','hottake','tips'].includes(pcStyle)) pcStyle = 'educational';
    }

    body.innerHTML = `
      <div class="lia-pc-section">
        <div class="lia-pc-selected-topic">
          <span class="lia-pc-st-label">Topic</span>
          <span class="lia-pc-st-title">${escHtml(pcSelected.title)}</span>
        </div>
        <div class="lia-pc-sub-label" style="margin-top:14px">Choose a post style:</div>
        <div class="lia-pc-style-grid${isCompany ? ' lia-pc-style-grid-col' : ''}" id="lia-pc-style-grid">
          ${styles.map(s => `
            <button class="lia-pc-style-card${pcStyle === s.val ? ' active' : ''}" data-val="${s.val}">
              <span class="lia-pc-style-label">${s.label}</span>
              <span class="lia-pc-style-desc">${s.desc}</span>
            </button>`).join('')}
        </div>
      </div>
      <button class="lia-btn-primary lia-pc-full-btn" id="lia-pc-write-btn">✍️ Write Post</button>
      <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-back-style" style="margin-top:6px">← Back</button>
    `;
    body.querySelectorAll('.lia-pc-style-card').forEach(btn => {
      btn.addEventListener('click', () => {
        pcStyle = btn.dataset.val;
        body.querySelectorAll('.lia-pc-style-card').forEach(b => b.classList.toggle('active', b.dataset.val === pcStyle));
      });
    });
    body.querySelector('#lia-pc-write-btn').addEventListener('click', () => generatePost(cp, co));
    body.querySelector('#lia-pc-back-style').addEventListener('click', () => {
      pcTopics.length ? renderPcTopics(cp, co) : renderPcLanding();
    });
  }

  async function generatePost(cp, co) {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    body.innerHTML = `
      <div class="lia-pc-loading">
        <div class="lia-spinner"></div>
        <p>Writing your post...</p>
      </div>
    `;
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({
        type: 'GENERATE_POST',
        topic: pcSelected.title,
        angle: pcSelected.angle,
        hook: pcSelected.hook,
        style: pcStyle,
        mode: pcMode,
        creatorProfile: cp,
        companyProfile: co,
      }, resolve);
    });
    if (result?.error) {
      const msg = result.error === 'NO_API_KEY'
        ? 'No API key found. Add your OpenAI key in Settings → Step 3.'
        : result.error;
      body.innerHTML = `<p class="lia-pc-error">${escHtml(msg)}</p><button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-back-we">← Back</button>`;
      body.querySelector('#lia-pc-back-we').addEventListener('click', () => renderPcStylePicker(cp, co));
      return;
    }
    pcResult = result;
    pcImageB64 = null;
    renderPcPost(cp, co);
  }

  function renderPcPost(cp, co) {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    const { post = '', hashtags = [], imagePrompt = '' } = pcResult || {};
    const hashtagStr = hashtags.map(h => `#${h.replace(/^#/, '')}`).join(' ');
    const fullText = post + (hashtagStr ? `\n\n${hashtagStr}` : '');

    body.innerHTML = `
      <div class="lia-pc-section">
        <div class="lia-pc-sub-label">Your Post</div>
        <div class="lia-pc-post-box">${escHtml(post).replace(/\n/g, '<br>')}</div>
        ${hashtagStr ? `<div class="lia-pc-hashtags">${escHtml(hashtagStr)}</div>` : ''}
        <div class="lia-pc-post-actions">
          <button class="lia-btn-primary" id="lia-pc-copy-btn">Copy Post + Hashtags</button>
          <button class="lia-btn-secondary" id="lia-pc-regen-btn">↺ Rewrite</button>
        </div>
      </div>

      ${imagePrompt ? `
      <div class="lia-pc-section">
        <div class="lia-pc-sub-label">Image</div>
        <div id="lia-pc-image-area">
          <div class="lia-pc-image-prompt">${escHtml(imagePrompt)}</div>
          <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-gen-image-btn">🎨 Generate Image (AI)</button>
          <p class="lia-pc-image-note">Uses your OpenAI key · ~$0.04 per image</p>
        </div>
      </div>` : ''}

      <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-new-post" style="margin-top:8px">＋ Create Another Post</button>
    `;

    body.querySelector('#lia-pc-copy-btn').addEventListener('click', async () => {
      await navigator.clipboard.writeText(fullText).catch(() => {});
      const btn = body.querySelector('#lia-pc-copy-btn');
      const orig = btn.textContent;
      btn.textContent = '✓ Copied!';
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });

    body.querySelector('#lia-pc-regen-btn').addEventListener('click', () => generatePost(cp, co));
    body.querySelector('#lia-pc-new-post').addEventListener('click', () => {
      pcSelected = null; pcTopics = []; pcResult = null; pcImageB64 = null;
      renderPcLanding();
    });

    body.querySelector('#lia-pc-gen-image-btn')?.addEventListener('click', () => generateImage(imagePrompt));
  }

  async function generateImage(prompt) {
    const area = document.getElementById('lia-pc-image-area');
    if (!area) return;
    area.innerHTML = `
      <div class="lia-pc-loading">
        <div class="lia-spinner"></div>
        <p>Generating image...</p>
      </div>
    `;
    const result = await new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'GENERATE_POST_IMAGE', prompt }, resolve);
    });
    if (result?.error) {
      const msg = result.error === 'NO_API_KEY'
        ? 'No API key found. Add your OpenAI key in Settings → Step 3.'
        : result.error;
      area.innerHTML = `<p class="lia-pc-error">${escHtml(msg)}</p><button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-retry-img">↺ Retry</button>`;
      area.querySelector('#lia-pc-retry-img').addEventListener('click', () => generateImage(prompt));
      return;
    }

    pcImageB64 = result?.b64 || null;
    const imgSrc = result?.b64
      ? `data:image/png;base64,${result.b64}`
      : (result?.url || null);

    if (imgSrc) {
      area.innerHTML = `
        <img class="lia-pc-image-preview" id="lia-pc-img-el" alt="Generated post image" />
        <button class="lia-btn-primary lia-pc-full-btn" id="lia-pc-download-btn">⬇ Download Image</button>
        <button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-regen-img">↺ Regenerate Image</button>
      `;
      area.querySelector('#lia-pc-img-el').src = imgSrc;

      area.querySelector('#lia-pc-download-btn').addEventListener('click', () => {
        const a = document.createElement('a');
        a.href = imgSrc;
        a.download = 'linkedin-post-image.png';
        if (result?.b64) {
          document.body.appendChild(a); a.click(); document.body.removeChild(a);
        } else {
          window.open(imgSrc, '_blank');
        }
      });

      area.querySelector('#lia-pc-regen-img').addEventListener('click', () => generateImage(prompt));
    } else {
      area.innerHTML = `<p class="lia-pc-error">No image returned. Try again.</p><button class="lia-btn-secondary lia-pc-full-btn" id="lia-pc-retry-img">↺ Retry</button>`;
      area.querySelector('#lia-pc-retry-img').addEventListener('click', () => generateImage(prompt));
    }
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
        <button class="lia-purpose-tile" id="lia-purpose-followup">
          <span class="lia-purpose-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">
              <polyline points="17 1 21 5 17 9"></polyline>
              <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
              <polyline points="7 23 3 19 7 15"></polyline>
              <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
            </svg>
          </span>
          <span class="lia-purpose-content">
            <span class="lia-purpose-title">Follow-up Message</span>
            <span class="lia-purpose-desc">${currentIntent === 'job_search' ? 'Continue an ongoing conversation — write the perfect follow-up' : 'Already messaging — get a contextual follow-up based on your conversation'}</span>
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
    body.querySelector('#lia-purpose-followup').addEventListener('click', () => runForPurpose('followup'));
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
    const hasKey = await checkApiKey();
    if (!hasKey) { renderNoApiKey(); return; }

    const { analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get('analysisIntent');

    if (purpose === 'followup') {
      renderFollowupForm(intent);
      return;
    }

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
    }

    // Generate fresh connection request
    const body = document.getElementById('lia-body');
    if (body) body.innerHTML = `
      <div class="lia-loading">
        <div class="lia-spinner"></div>
        <p>Writing connection request...</p>
      </div>
    `;

    try {
      const profileData = extractProfile();
      const result = await sendMessage('GENERATE_CONNECTION_REQUEST', profileData, { intent, userNotes: userNotes || undefined });
      if (result.error) throw new Error(result.error);

      if (!userNotes) {
        const current = await dbGet(currentProfileUrl).catch(() => null) || { url: currentProfileUrl };
        await dbPut(currentProfileUrl, { ...current, connectionRequest: result.text, intent }).catch(() => {});
      }

      renderSingleText('connection', result.text, intent);
    } catch (err) {
      renderError(err.message);
    }
  }

  function extractLinkedInConversation() {
    const lines = [];

    // Search in any open messaging overlay first, then fallback to full document
    const searchRoots = [
      document.querySelector('.msg-overlay-conversation-bubble'),
      document.querySelector('.msg-thread'),
      document.querySelector('[class*="messaging-thread"]'),
      document,
    ].filter(Boolean);

    for (const root of searchRoots) {
      // Strategy A: message groups (LinkedIn groups consecutive msgs from same sender)
      const groups = root.querySelectorAll('.msg-s-message-group');
      if (groups.length) {
        groups.forEach(group => {
          const nameEl = group.querySelector(
            '.msg-s-message-group__meta .presence-entity__display-name, ' +
            '.msg-s-message-group__meta strong, ' +
            '.msg-s-message-group__meta [aria-label]'
          );
          const name = nameEl?.textContent.trim() || '';
          group.querySelectorAll(
            '.msg-s-event-listitem__message-bubble, ' +
            '.msg-s-event-listitem__body p, ' +
            '.msg-s-event__body p'
          ).forEach(el => {
            const text = el.textContent.trim();
            if (text) lines.push(name ? `${name}: ${text}` : text);
          });
        });
        if (lines.length) break;
      }

      // Strategy B: individual event items without group wrapper
      const items = root.querySelectorAll('.msg-s-event-listitem, .msg-s-event__content');
      if (items.length) {
        items.forEach(item => {
          const body = item.querySelector(
            '.msg-s-event-listitem__body, .msg-s-event-listitem__message-bubble, p'
          );
          if (body) {
            const text = body.textContent.trim();
            if (text && text.length > 1) lines.push(text);
          }
        });
        if (lines.length) break;
      }
    }

    // Deduplicate consecutive duplicates (LinkedIn sometimes repeats nodes) and cap at 30
    const deduped = lines.filter((l, i) => l !== lines[i - 1]);
    return deduped.length ? deduped.slice(-30).join('\n\n') : null;
  }

  function renderFollowupForm(intent) {
    const body = document.getElementById('lia-body');
    if (!body) return;
    const tabs = panel.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = 'none';

    // Try to auto-extract the open conversation immediately
    const extracted = extractLinkedInConversation();
    const statusHtml = extracted
      ? `<div class="lia-convo-status lia-convo-found">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
           Conversation auto-loaded (${extracted.split('\n\n').length} messages)
           <button class="lia-convo-refresh" id="lia-convo-refresh">↺ Refresh</button>
         </div>`
      : `<div class="lia-convo-status lia-convo-missing">
           <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
           No open conversation found — open the message window on this page, then click
           <button class="lia-convo-refresh" id="lia-convo-refresh">↺ Refresh</button>
         </div>`;

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
        <div class="lia-label">Conversation
          <span class="lia-optional" style="font-weight:400"> — auto-extracted from this page</span>
        </div>
        ${statusHtml}
        <textarea class="lia-notes-input" id="lia-followup-convo" rows="6" placeholder="Conversation will appear here — or paste it manually..." style="min-height:110px"></textarea>
      </div>
      <div class="lia-section">
        <button class="lia-btn-primary" id="lia-followup-gen-btn" style="width:100%">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
            <polyline points="17 1 21 5 17 9"></polyline>
            <path d="M3 11V9a4 4 0 0 1 4-4h14"></path>
            <polyline points="7 23 3 19 7 15"></polyline>
            <path d="M21 13v2a4 4 0 0 1-4 4H3"></path>
          </svg>
          Generate Follow-up
        </button>
        <div id="lia-followup-result" style="display:none;margin-top:12px"></div>
      </div>
    `;

    // Pre-fill textarea if conversation was found
    if (extracted) body.querySelector('#lia-followup-convo').value = extracted;

    // Refresh button re-scrapes the page
    body.querySelector('#lia-convo-refresh')?.addEventListener('click', () => {
      const fresh = extractLinkedInConversation();
      const textarea = body.querySelector('#lia-followup-convo');
      const statusEl = body.querySelector('.lia-convo-status');
      if (fresh) {
        if (textarea) textarea.value = fresh;
        if (statusEl) {
          statusEl.className = 'lia-convo-status lia-convo-found';
          statusEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg> Conversation loaded (${fresh.split('\n\n').length} messages) <button class="lia-convo-refresh" id="lia-convo-refresh">↺ Refresh</button>`;
          statusEl.querySelector('#lia-convo-refresh')?.addEventListener('click', () => body.querySelector('#lia-convo-refresh')?.click());
        }
      } else {
        if (statusEl) {
          statusEl.className = 'lia-convo-status lia-convo-missing';
          statusEl.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg> Still no conversation found — make sure the message window is open <button class="lia-convo-refresh" id="lia-convo-refresh">↺ Refresh</button>`;
          statusEl.querySelector('#lia-convo-refresh')?.addEventListener('click', () => body.querySelector('#lia-convo-refresh')?.click());
        }
      }
    });

    body.querySelector('#lia-back-btn').addEventListener('click', () => {
      if (tabs) tabs.style.display = 'none';
      renderPurposePicker();
    });

    body.querySelector('#lia-followup-gen-btn').addEventListener('click', async () => {
      const btn = body.querySelector('#lia-followup-gen-btn');
      const resultDiv = body.querySelector('#lia-followup-result');
      const convoText = body.querySelector('#lia-followup-convo')?.value.trim() || '';

      btn.disabled = true;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Writing follow-up...`;
      resultDiv.style.display = 'none';

      try {
        const profileData = extractProfile();
        const result = await sendMessage('GENERATE_FOLLOW_UP', profileData, { intent, conversationText: convoText });
        if (result.error) throw new Error(result.error);

        const text = result.text || '';
        resultDiv.innerHTML = `
          <div class="lia-label">Follow-up Message</div>
          <div class="lia-connection-box">
            <p id="lia-followup-text">${escHtml(text)}</p>
          </div>
          <button class="lia-btn-primary lia-copy-btn" id="lia-followup-copy">Copy to Clipboard</button>
        `;
        resultDiv.style.display = '';

        resultDiv.querySelector('#lia-followup-copy')?.addEventListener('click', async () => {
          const copyBtn = resultDiv.querySelector('#lia-followup-copy');
          await navigator.clipboard.writeText(text);
          copyBtn.textContent = 'Copied!';
          copyBtn.classList.add('copied');
          setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; copyBtn.classList.remove('copied'); }, 2000);
        });

        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg> Regenerate`;
        btn.disabled = false;
      } catch (err) {
        const msg = err.message === 'NO_API_KEY' ? 'No API key found. Add your OpenAI key in Settings → Step 3.' : err.message;
        resultDiv.innerHTML = `<p class="lia-error-msg">${escHtml(msg)}</p>`;
        resultDiv.style.display = '';
        btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="17 1 21 5 17 9"></polyline><path d="M3 11V9a4 4 0 0 1 4-4h14"></path><polyline points="7 23 3 19 7 15"></polyline><path d="M21 13v2a4 4 0 0 1-4 4H3"></path></svg> Generate Follow-up`;
        btn.disabled = false;
      }
    });
  }

  function renderSingleText(purpose, text, intent) {
    const body = document.getElementById('lia-body');
    if (!body) return;

    const label = 'Connection Request';
    const charLimit = 200;
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

        <div class="lia-section lia-first-msg-section">
          <button class="lia-btn-primary" id="lia-gen-first-msg" style="width:100%">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            ${intent === 'job_search' ? 'Generate Outreach Message' : 'Generate First Message'}
          </button>
          <div id="lia-first-msg-result" style="display:none;margin-top:10px"></div>
        </div>
      `;

      body.querySelector('#lia-gen-first-msg')?.addEventListener('click', async () => {
        const btn = body.querySelector('#lia-gen-first-msg');
        const resultDiv = body.querySelector('#lia-first-msg-result');
        if (!btn || !resultDiv) return;

        btn.disabled = true;
        btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Writing message...`;
        resultDiv.style.display = 'none';

        try {
          const profileData = extractProfile();
          const result = await sendMessage('GENERATE_FIRST_MESSAGE', profileData, { intent, analysis });
          if (result.error) throw new Error(result.error);

          const text = result.text || '';
          resultDiv.innerHTML = `
            <div class="lia-label" style="margin-bottom:6px">${intent === 'job_search' ? 'Outreach Message' : 'First Message'}</div>
            <div class="lia-connection-box">
              <p id="lia-first-msg-text">${escHtml(text)}</p>
            </div>
            <button class="lia-btn-primary lia-copy-btn" id="lia-first-msg-copy">Copy to Clipboard</button>
          `;
          resultDiv.style.display = '';

          resultDiv.querySelector('#lia-first-msg-copy')?.addEventListener('click', async () => {
            const copyBtn = resultDiv.querySelector('#lia-first-msg-copy');
            await navigator.clipboard.writeText(text);
            copyBtn.textContent = 'Copied!';
            copyBtn.classList.add('copied');
            setTimeout(() => { copyBtn.textContent = 'Copy to Clipboard'; copyBtn.classList.remove('copied'); }, 2000);
          });

          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> Regenerate Message`;
          btn.disabled = false;
        } catch (err) {
          const msg = err.message === 'NO_API_KEY' ? 'No API key found. Add your OpenAI key in Settings → Step 3.' : err.message;
          resultDiv.innerHTML = `<p class="lia-error-msg">${escHtml(msg)}</p>`;
          resultDiv.style.display = '';
          btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg> ${intent === 'job_search' ? 'Generate Outreach Message' : 'Generate First Message'}`;
          btn.disabled = false;
        }
      });

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
    if (postPanel) { postPanel.remove(); postPanel = null; }
    if (postBtn) { postBtn.remove(); postBtn = null; }
    activeTab = 'analysis';
    pcTopics = []; pcSelected = null; pcResult = null; pcImageB64 = null; pcMode = 'personal';
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
