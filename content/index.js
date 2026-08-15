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

  // Search results state
  let _searchObserver = null;
  let _searchScored = false;

  // Messaging follow-up state
  let _msgFollowupBar = null;
  let _msgObserver = null;
  let pcTopics = [];
  let pcSelected = null;     // { title, angle, hook }
  let pcStyle = 'educational';
  let pcResult = null;       // { post, hashtags, imagePrompt }
  let pcImageB64 = null;
  let pcMode = 'personal';   // 'personal' | 'company'

  // Time / world clock state
  let timeBtn = null;
  let timePanel = null;
  let _timeInterval = null;
  let timeZones = null; // array of IANA zone ids, loaded from storage lazily

  // Dock "Save" button state — a second, quicker path to save a contact besides the
  // bookmark icon inside the analysis panel header (that one requires running Analyze first).
  let dockSaveBtn = null;

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
    return /linkedin\.com\/in\/[^\/]+/.test(location.href) ||
           /linkedin\.com\/sales\/(people|lead)\/[^\/]+/.test(location.href);
  }

  function isNativeLinkedInProfile() {
    return /linkedin\.com\/in\/[^\/]+/.test(location.href);
  }

  function isSearchResultsPage() {
    return /linkedin\.com\/search\/results\/people/.test(location.href);
  }

  function isMessagingPage() {
    return /linkedin\.com\/messaging/.test(location.href);
  }

  // ─── Init ─────────────────────────────────────────────────────────────────────
  async function ensureDockButtons() {
    injectTriggerButton();
    injectTimeButton();
    injectSaveButton();
    const authed = await checkGoogleAuth();
    if (authed) injectPostCreatorButton();
  }

  // Lets a contact be saved straight from the dock, without running a full Analyze first —
  // useful when you just want to add someone to the pipeline quickly. Guarded to no-op off a
  // profile page, since currentProfileUrl otherwise keeps pointing at the last profile visited
  // (it's never cleared on navigation) and would silently save/unsave the wrong person.
  function injectSaveButton() {
    if (dockSaveBtn) return;
    dockSaveBtn = document.createElement('button');
    dockSaveBtn.id = 'lia-save-trigger';
    dockSaveBtn.setAttribute('aria-label', 'Save contact');
    dockSaveBtn.title = 'Save contact';
    dockSaveBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg><span>Save</span>`;
    dockSaveBtn.addEventListener('click', async () => {
      if (!isProfilePage()) return;
      await toggleSaveContact();
    });
    ensureDock().appendChild(dockSaveBtn);
  }

  async function init() {
    await ensureDockButtons();
    if (isProfilePage()) {
      currentProfileUrl = location.href.split('?')[0];
      syncSaveButtons();
    } else if (isSearchResultsPage()) {
      initSearchResults();
    } else if (isMessagingPage()) {
      initMessagingPage();
    }
  }

  // ─── SPA Navigation (history API patch — fires once per URL change, not on DOM mutations) ─
  // LinkedIn's React Router calls pushState/replaceState for every navigation — we intercept
  // those calls and dispatch a lightweight custom event. Zero MutationObserver, zero polling.
  (function patchHistory() {
    if (window.__liaNavPatched) return;
    window.__liaNavPatched = true;
    const fire = () => window.dispatchEvent(new Event('lia-nav'));
    const _push = history.pushState;
    const _replace = history.replaceState;
    history.pushState    = function() { _push.apply(this, arguments);    fire(); };
    history.replaceState = function() { _replace.apply(this, arguments); fire(); };
    window.addEventListener('popstate', fire);
  }());

  // Compare path only — LinkedIn frequently calls replaceState/pushState just to update
  // tracking query params (trk=...), and since our history patch leaks into the page's
  // main world (shared `history` object), those no-op-for-us calls would otherwise fire
  // 'lia-nav' and re-run init() (and its chrome.storage calls) on every tracking tick.
  let _navLastPath = location.pathname;

  window.addEventListener('lia-nav', () => {
    const path = location.pathname;
    if (path === _navLastPath) return;
    _navLastPath = path;
    ensureDockButtons();
    if (isProfilePage()) {
      currentProfileUrl = location.href.split('?')[0];
      syncSaveButtons();
      removeSearchUI();
      removeMessagingUI();
      resetUI();
      init();
    } else if (isSearchResultsPage()) {
      removeMessagingUI();
      resetUI();
      initSearchResults();
    } else if (isMessagingPage()) {
      removeSearchUI();
      resetUI();
      removeMessagingUI();
      initMessagingPage();
    } else {
      removeSearchUI();
      removeAll();
    }
  });

  // ─── Reactive auth state — show/hide Post button on sign-in / sign-out ────────
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || !('googleUser' in changes)) return;
    if (!changes.googleUser.newValue) {
      if (postBtn) { postBtn.remove(); postBtn = null; }
    } else if (!postBtn) {
      injectPostCreatorButton();
    }
  });

  // ─── Sidebar Dock ─────────────────────────────────────────────────────────────
  let sidebarDock = null;
  function ensureDock() {
    if (sidebarDock && document.contains(sidebarDock)) return sidebarDock;
    sidebarDock = document.createElement('div');
    sidebarDock.id = 'lia-sidebar-dock';
    document.body.appendChild(sidebarDock);
    return sidebarDock;
  }

  // ─── Search Results Scoring ───────────────────────────────────────────────────
  function removeSearchUI() {
    document.getElementById('lia-search-banner')?.remove();
    document.querySelectorAll('.lia-search-badge').forEach(el => el.remove());
    document.querySelectorAll('[data-lia-scored]').forEach(el => delete el.dataset.liaScored);
    if (_searchObserver) { _searchObserver.disconnect(); _searchObserver = null; }
    _searchScored = false;
  }

  function initSearchResults() {
    if (!document.getElementById('lia-search-banner')) injectSearchBanner();
    if (_searchObserver) _searchObserver.disconnect();
    // Scoring now costs a real AI call, so scroll-triggered lazy-load mutations must never
    // auto-fire it — just surface that new cards showed up and let the user opt back in.
    _searchObserver = new MutationObserver(() => {
      if (_searchScored) updateScoreButtonForNewCards();
    });
    const root = document.querySelector('.search-results-container, main');
    if (root) _searchObserver.observe(root, { childList: true, subtree: true });
  }

  function getSearchCards() {
    return document.querySelectorAll([
      '.entity-result',
      '.search-result',
      '[data-view-name="search-entity-result-universal-template"]',
    ].join(', '));
  }

  function updateScoreButtonForNewCards() {
    const btn = document.getElementById('lia-score-btn');
    if (!btn || btn.disabled) return;
    let unscored = 0;
    getSearchCards().forEach(card => { if (!card.dataset.liaScored) unscored++; });
    if (unscored > 0) btn.textContent = `Score ${unscored} New`;
  }

  function injectSearchBanner() {
    const banner = document.createElement('div');
    banner.id = 'lia-search-banner';
    banner.innerHTML = `
      <div class="lia-search-banner-inner">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(167,139,250,0.9)" style="flex-shrink:0">
          <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/>
        </svg>
        <span class="lia-search-banner-label" id="lia-search-banner-label">LinkPilot AI — ICP-aware AI scoring</span>
        <button id="lia-search-upgrade-btn" class="lia-search-upgrade-btn" style="display:none">Upgrade to Pro</button>
        <button id="lia-score-btn" class="lia-search-score-btn">Score Results</button>
      </div>`;

    banner.querySelector('#lia-search-upgrade-btn')?.addEventListener('click', () => {
      const upgradeBtn = document.getElementById('lia-search-upgrade-btn');
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Opening checkout…';
      chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, res => {
        if (chrome.runtime.lastError || !res?.url) {
          upgradeBtn.disabled = false;
          upgradeBtn.textContent = 'Upgrade to Pro';
          return;
        }
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: res.url });
      });
    });

    const insertTarget = document.querySelector('.search-results-container > div:first-child, .reusable-search__result-container');
    if (insertTarget?.parentElement) {
      insertTarget.parentElement.insertBefore(banner, insertTarget);
    } else {
      const main = document.querySelector('main');
      if (main) main.insertAdjacentElement('afterbegin', banner);
    }

    document.getElementById('lia-score-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('lia-score-btn');
      if (!btn || btn.disabled) return;

      if (_searchScored) {
        document.querySelectorAll('.lia-search-badge').forEach(el => el.remove());
        document.querySelectorAll('[data-lia-scored]').forEach(el => delete el.dataset.liaScored);
        btn.textContent = 'Score Results';
        _searchScored = false;
        return;
      }

      await scoreVisibleCards();
    });
  }

  const SEARCH_SCORE_COLORS = {
    High:     { fg: '#16a34a', bg: 'rgba(22,163,74,0.10)',   border: 'rgba(22,163,74,0.28)' },
    Medium:   { fg: '#d97706', bg: 'rgba(217,119,6,0.10)',   border: 'rgba(217,119,6,0.28)'  },
    Low:      { fg: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' },
    Strong:   { fg: '#16a34a', bg: 'rgba(22,163,74,0.10)',   border: 'rgba(22,163,74,0.28)' },
    Possible: { fg: '#d97706', bg: 'rgba(217,119,6,0.10)',   border: 'rgba(217,119,6,0.28)'  },
    Unlikely: { fg: '#94a3b8', bg: 'rgba(148,163,184,0.08)', border: 'rgba(148,163,184,0.2)' },
  };

  async function scoreVisibleCards() {
    const btn = document.getElementById('lia-score-btn');
    const labelEl = document.getElementById('lia-search-banner-label');
    const defaultLabel = 'LinkPilot AI — ICP-aware AI scoring';

    const unscoredCards = [];
    const profiles = [];
    getSearchCards().forEach(card => {
      if (card.dataset.liaScored) return;
      const profileLink = card.querySelector('a[href*="/in/"]');
      if (!profileLink) return;
      const id = profileLink.href.split('?')[0];

      const nameEl = card.querySelector('.entity-result__title-text, .artdeco-entity-lockup__title');
      const titleEl = card.querySelector('.entity-result__primary-subtitle, .artdeco-entity-lockup__subtitle, .t-14.t-black.t-normal');
      const companyEl = card.querySelector('.entity-result__secondary-subtitle, .t-14.t-black--light');

      unscoredCards.push({ card, id, nameEl });
      profiles.push({
        id,
        name: nameEl?.textContent.trim() || '',
        title: titleEl?.textContent.trim() || '',
        company: companyEl?.textContent.trim() || '',
      });
    });

    if (!profiles.length) return;

    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" class="lia-spin" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Scoring...`;
    }
    if (labelEl) { labelEl.textContent = defaultLabel; labelEl.classList.remove('lia-search-banner-err'); }
    const upgradeBtnReset = document.getElementById('lia-search-upgrade-btn');
    if (upgradeBtnReset) upgradeBtnReset.style.display = 'none';

    try {
      const { analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get('analysisIntent');
      const result = await sendMessage('BULK_SCORE_PROFILES', null, { profiles, intent });
      if (result.error) throw new Error(result.error);

      const scoreById = {};
      (result.scores || []).forEach(s => { if (s?.id) scoreById[s.id] = s; });

      // Cards missing a valid entry are deliberately left unscored (not defaulted to Low) so
      // the next "Score Again" click retries just them instead of silently mis-scoring.
      unscoredCards.forEach(({ card, id, nameEl }) => {
        const entry = scoreById[id];
        if (!entry || !SEARCH_SCORE_COLORS[entry.score]) return;
        card.dataset.liaScored = '1';
        const { fg, bg, border } = SEARCH_SCORE_COLORS[entry.score];
        const badge = document.createElement('span');
        badge.className = 'lia-search-badge';
        badge.title = entry.reasoning || entry.score;
        badge.style.cssText = `display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:20px;font-size:10.5px;font-weight:700;color:${fg};background:${bg};border:1px solid ${border};margin-left:7px;vertical-align:middle;white-space:nowrap;font-family:-apple-system,BlinkMacSystemFont,sans-serif;line-height:1.7;cursor:default;flex-shrink:0;`;
        badge.innerHTML = `<span style="width:5px;height:5px;border-radius:50%;background:${fg};flex-shrink:0"></span>${entry.score}`;
        if (nameEl) nameEl.appendChild(badge);
      });

      if (btn) { btn.disabled = false; btn.textContent = 'Clear Scores'; }
      _searchScored = true;
    } catch (err) {
      const errMap = {
        NO_API_KEY: 'No API key — open Settings',
        LIMIT_REACHED: 'Monthly limit reached — upgrade to Pro',
        RATE_LIMITED: 'Rate limited — try again shortly',
        INVALID_KEY: 'Invalid API key — check Settings',
      };
      if (labelEl) { labelEl.textContent = errMap[err.message] || 'Scoring failed — try again'; labelEl.classList.add('lia-search-banner-err'); }
      const upgradeBtn = document.getElementById('lia-search-upgrade-btn');
      if (upgradeBtn) upgradeBtn.style.display = err.message === 'LIMIT_REACHED' ? '' : 'none';
      if (btn) { btn.disabled = false; btn.textContent = 'Score Results'; }
    }
  }

  // ─── Messaging Follow-up ─────────────────────────────────────────────────────

  function removeMessagingUI() {
    _msgFollowupBar?.remove();
    _msgFollowupBar = null;
    if (_msgObserver) { _msgObserver.disconnect(); _msgObserver = null; }
  }

  function _resolveSender(rawName, contactName, myName) {
    if (!rawName) return 'You';
    const low = rawName.toLowerCase();
    const contactFirst = (contactName || '').split(' ')[0].toLowerCase();
    const myFirst = (myName || '').split(' ')[0].toLowerCase();
    if (contactFirst && low.includes(contactFirst)) return contactName || rawName;
    if (myFirst && low.includes(myFirst)) return 'You';
    // If contact name is known, anything not matching the contact is the user
    if (contactFirst) return 'You';
    return rawName;
  }

  function _isReactionOnly(text) {
    // Filter out LinkedIn emoji reactions (👍❤️👏 etc.) that are not message content
    return text.length < 5 && /^[\p{Emoji_Presentation}\p{Extended_Pictographic}\s]+$/u.test(text);
  }

  // Strips LinkedIn UI chrome that innerText picks up alongside real message text — visually
  // hidden "View X's profile" accessibility labels, connection-degree badges, group headers,
  // "(Edited)" tags, reaction summaries — so it never gets fed to the AI as if it were something
  // the recipient actually said (which is exactly what caused fabricated follow-ups).
  function _stripUiChrome(text) {
    return text
      .split('\n')
      .filter(line => {
        const t = line.trim();
        if (!t) return false;
        if (/^view .+ profile$/i.test(t)) return false;
        if (/^\d+(st|nd|rd|th)\s+degree connection$/i.test(t)) return false;
        if (/^·?\s*(1st|2nd|3rd)\+?$/i.test(t)) return false;
        if (/sent the following messages? at/i.test(t)) return false;
        if (/^\(edited\)$/i.test(t)) return false;
        if (_isReactionOnly(t)) return false;
        return true;
      })
      .join('\n')
      .trim();
  }

  // Splits an optional trailing "TIMING_NOTE: ..." line off a generated follow-up — that line is
  // coaching for the user (e.g. "you followed up 1 day ago, consider waiting"), never part of the
  // actual message, so it must never end up in the copyable text or get sent to the recipient.
  function parseTimingNote(raw) {
    const m = (raw || '').match(/\n?TIMING_NOTE:\s*(.+)\s*$/i);
    if (!m) return { text: (raw || '').trim(), note: null };
    return { text: raw.slice(0, m.index).trim(), note: m[1].trim() };
  }

  // Guesses a starting pipeline stage for a contact who has a real conversation already but was
  // never explicitly saved — e.g. outreach that started before this feature existed, or a thread
  // the user never got around to tracking. Better than dropping them in at "New" (which would
  // make the very next follow-up read as a cold opener when it's actually a 2nd or 3rd touch).
  function inferStageFromConversation(msgs, isRaw) {
    if (isRaw || !msgs.length) return 'messaged'; // can't reliably attribute raw text by sender
    if (msgs.some(m => m.sender && m.sender !== 'You')) return 'replied';
    const sentByMe = msgs.filter(m => m.sender === 'You').length;
    if (sentByMe <= 1) return 'messaged';
    if (sentByMe === 2) return 'followup_1';
    if (sentByMe === 3) return 'followup_2';
    return 'followup_3plus';
  }

  function scrapeThreadMessages(contactName, myName) {
    const contactFirst = (contactName || '').split(' ')[0].toLowerCase();
    const myFirst = (myName || '').split(' ')[0].toLowerCase();
    const msgs = [];

    // ── Strategy 1: structured message groups ──────────────────────────────────
    const groups = document.querySelectorAll('.msg-s-message-group');
    if (groups.length) {
      groups.forEach(group => {
        const isOutbound = group.classList.contains('msg-s-message-group--outbound');
        // aria-label: "Husnain Ali sent the following messages at …"
        const ariaLabel = group.getAttribute('aria-label') || '';
        const ariaMatch = ariaLabel.match(/^(.+?)\s+sent\s+/i);
        const nameEl = group.querySelector('.msg-s-message-group__name, [class*="message-group__name"]');
        const rawName = ariaMatch?.[1]?.trim() || nameEl?.textContent.trim() || '';
        const senderLow = rawName.toLowerCase();

        const isContact = contactFirst && senderLow.includes(contactFirst);
        const isMe = isOutbound || (myFirst && senderLow.includes(myFirst)) || (!isContact && contactFirst && rawName);
        const sender = isContact ? (contactName || rawName) : 'You';

        group.querySelectorAll('.msg-s-event-listitem__body, [class*="event-listitem__body"]').forEach(bodyEl => {
          const text = _stripUiChrome((bodyEl.innerText || bodyEl.textContent || '').trim());
          if (text && !_isReactionOnly(text)) msgs.push({ sender, text });
        });
      });
      if (msgs.length) return msgs;
    }

    // ── Strategy 2: flat body elements with parent traversal ───────────────────
    const bodyEls = document.querySelectorAll(
      '.msg-s-event-listitem__body, [class*="event-listitem__body"], [class*="message-content__text"]'
    );
    if (bodyEls.length) {
      bodyEls.forEach(bodyEl => {
        const text = _stripUiChrome((bodyEl.innerText || bodyEl.textContent || '').trim());
        if (!text || _isReactionOnly(text)) return;
        // Walk up max 8 levels to find sender name
        let rawName = '';
        let node = bodyEl.parentElement;
        for (let i = 0; i < 8 && node; i++) {
          // aria-label "X sent the following messages"
          const label = node.getAttribute('aria-label') || '';
          const m = label.match(/^(.+?)\s+sent\s+/i);
          if (m) { rawName = m[1].trim(); break; }
          // named element
          const nameEl = node.querySelector('[class*="message-group__name"], [class*="sender-name"]');
          if (nameEl) { rawName = nameEl.textContent.trim(); break; }
          // outbound class
          if (node.classList.contains('msg-s-message-group--outbound')) { rawName = myName || 'Me'; break; }
          node = node.parentElement;
        }
        msgs.push({ sender: _resolveSender(rawName, contactName, myName), text });
      });
      if (msgs.length) return msgs;
    }

    // ── Strategy 3: raw innerText from the conversation pane ──────────────────
    const paneSelectors = [
      '.msg-s-message-list',
      '.scaffold-layout__detail',
      '[class*="msg-thread"]',
      'main',
    ];
    for (const sel of paneSelectors) {
      const pane = document.querySelector(sel);
      if (!pane) continue;
      const raw = _stripUiChrome((pane.innerText || '')).replace(/\n{3,}/g, '\n\n').trim();
      if (raw.length > 40) return [{ sender: '__raw__', text: raw.slice(0, 4000) }];
    }

    return [];
  }

  function getContactName() {
    const sels = [
      '.msg-thread__link-to-profile',
      '.msg-entity-lockup__entity-title',
      '.artdeco-entity-lockup__title',
      '.presence-entity__name',
      '.msg-conversation-listitem__participant-names',
    ];
    for (const s of sels) {
      const name = document.querySelector(s)?.textContent.trim();
      if (name) return name;
    }
    return '';
  }

  // Resolves the open conversation's contact back to a profile URL, so the messaging-page
  // follow-up bar can look up the same tracked pipeline stage / elapsed time / cached analysis
  // the profile-panel Follow-up tool already uses — instead of always falling back to the
  // message-counting heuristic. Reuses the exact same elements getContactName() already relies
  // on (proven to reliably identify the conversation participant), just also checking whether
  // that element is or is inside an <a> pointing at their profile. Returns '' if none resolve —
  // callers must treat that as "no tracked data available," not an error.
  function getContactProfileUrl() {
    const sels = [
      '.msg-thread__link-to-profile',
      '.msg-entity-lockup__entity-title',
      '.artdeco-entity-lockup__title',
      '.presence-entity__name',
    ];
    for (const s of sels) {
      const el = document.querySelector(s);
      if (!el) continue;
      const link = el.matches('a') ? el : (el.closest('a') || el.querySelector('a'));
      if (link?.href && /linkedin\.com\/in\//.test(link.href)) {
        return link.href.split('?')[0];
      }
    }

    // Lower-confidence fallback: the first "/in/" link inside the conversation thread container
    // (same '.msg-thread' selector extractLinkedInConversation() already relies on elsewhere in
    // this file). LinkedIn renders the conversation header — with the contact's own profile link
    // — before the message list in DOM order, so document order means the first match is very
    // likely the header's link rather than one from inside a message. Not guaranteed, but a
    // reasonable second attempt before giving up.
    const threadRoot = document.querySelector('.msg-thread, [class*="messaging-thread"]');
    const firstLink = threadRoot?.querySelector('a[href*="/in/"]');
    if (firstLink?.href) return firstLink.href.split('?')[0];

    return '';
  }

  function insertIntoChat(text) {
    const input = document.querySelector(
      '.msg-form__contenteditable[contenteditable="true"], ' +
      '[data-artdeco-is-focused][contenteditable="true"]'
    );
    if (!input) return false;
    input.focus();
    const sel = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(input);
    sel.removeAllRanges();
    sel.addRange(range);
    document.execCommand('insertText', false, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function resetFollowupBtn(btn) {
    if (!btn) return;
    btn.disabled = false;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><polyline points="17 8 21 12 17 16"/><path d="M3 12h18"/></svg> AI Follow-up`;
  }

  function injectFollowupBar() {
    if (_msgFollowupBar && document.contains(_msgFollowupBar)) return;

    // Anchor on the compose contenteditable — never the search form
    const compose = document.querySelector('.msg-form__contenteditable[contenteditable="true"]');
    if (!compose) return; // No open conversation yet — retry later

    // Walk up to the closest form-like wrapper
    const formWrapper = compose.closest('.msg-form') ||
                        compose.closest('[class*="msg-thread__composer"]') ||
                        compose.closest('[class*="compose"]') ||
                        compose.parentElement?.parentElement;
    if (!formWrapper) return;

    const bar = document.createElement('div');
    bar.id = 'lia-followup-bar';
    bar.innerHTML = `
      <div class="lia-followup-bar-inner">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="rgba(167,139,250,0.9)" style="flex-shrink:0"><path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452z"/></svg>
        <span class="lia-followup-bar-label">LinkPilot AI</span>
        <span id="lia-followup-tag" class="lia-followup-tag"></span>
        <span id="lia-followup-status" class="lia-followup-status"></span>
        <button id="lia-followup-instr-toggle" class="lia-followup-instr-toggle" type="button" title="Add instructions (e.g. be more direct)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
        </button>
        <button id="lia-followup-btn" class="lia-followup-btn">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="flex-shrink:0"><polyline points="17 8 21 12 17 16"/><path d="M3 12h18"/></svg>
          AI Follow-up
        </button>
      </div>
      <div id="lia-followup-instr-row" class="lia-followup-instr-row" style="display:none">
        <input type="text" id="lia-followup-instr-input" class="lia-followup-instr-input" placeholder="Optional: be more direct, ask for a call this week..." />
      </div>`;

    formWrapper.insertAdjacentElement('beforebegin', bar);
    _msgFollowupBar = bar;
    document.getElementById('lia-followup-btn')?.addEventListener('click', handleFollowupClick);
    document.getElementById('lia-followup-instr-toggle')?.addEventListener('click', () => {
      const row = document.getElementById('lia-followup-instr-row');
      if (!row) return;
      const opening = row.style.display === 'none';
      row.style.display = opening ? 'block' : 'none';
      if (opening) document.getElementById('lia-followup-instr-input')?.focus();
    });
    updateFollowupTag();
  }

  // Shows the detected pipeline stage as a visible chip in the bar itself (not just a hover
  // tooltip, which is too easy to miss) — read-only, never creates a pipeline entry on its own.
  // Re-run after every generation too, since that can create/advance the entry.
  async function updateFollowupTag() {
    const tagEl = document.getElementById('lia-followup-tag');
    if (!tagEl) return;
    const contactProfileUrl = getContactProfileUrl();
    if (!contactProfileUrl) { tagEl.textContent = ''; tagEl.className = 'lia-followup-tag'; return; }
    const contacts = await getSavedContacts();
    const entry = contacts.find(c => c.url === contactProfileUrl);
    if (!entry) {
      tagEl.textContent = 'Not tracked';
      tagEl.className = 'lia-followup-tag lia-followup-tag-untracked';
      return;
    }
    tagEl.textContent = STAGE_META[entry.stage]?.label || 'New';
    tagEl.className = 'lia-followup-tag';
  }

  async function handleFollowupClick() {
    const btn = document.getElementById('lia-followup-btn');
    const status = document.getElementById('lia-followup-status');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.innerHTML = `<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="flex-shrink:0;animation:lia-spin 0.9s linear infinite"><circle cx="12" cy="12" r="10" stroke-dasharray="40 20" stroke-linecap="round"/></svg> Generating…`;
    if (status) { status.textContent = ''; status.className = 'lia-followup-status'; }
    try {
      const keyCheck = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'GET_API_KEY_STATUS' }, r => {
          if (chrome.runtime.lastError) resolve({ hasKey: false });
          else resolve(r || { hasKey: false });
        });
      });
      if (!keyCheck.hasKey) {
        if (status) { status.textContent = 'No API key — open Settings'; status.className = 'lia-followup-status lia-followup-status-err'; }
        resetFollowupBtn(btn);
        return;
      }
      const contactName = getContactName();
      const { googleUser, analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get(['googleUser', 'analysisIntent']);
      const myName = googleUser?.name || googleUser?.given_name || '';
      const msgs = scrapeThreadMessages(contactName, myName);
      const isRaw = msgs.length === 1 && msgs[0].sender === '__raw__';
      const conversationText = !msgs.length
        ? '(no messages found in thread)'
        : isRaw
        ? msgs[0].text
        : msgs.map(m => `${m.sender}: ${m.text}`).join('\n\n');
      const userInstructions = document.getElementById('lia-followup-instr-input')?.value.trim() || '';

      // Resolve the conversation back to a profile URL so this gets the same tracked stage /
      // elapsed time / cached analysis the profile-panel Follow-up tool already uses, instead of
      // always falling back to the message-counting heuristic. Gracefully degrades to that
      // heuristic (stage/daysSinceLastTouch/analysis all left undefined) if resolution fails or
      // the contact was never saved — same behavior as before for those cases.
      const contactProfileUrl = getContactProfileUrl();
      let stage, daysSinceLastTouch, analysis;
      if (contactProfileUrl) {
        const contacts = await getSavedContacts();
        let entry = contacts.find(c => c.url === contactProfileUrl);

        if (!entry) {
          // Not tracked yet, but a real conversation already exists — auto-add them to the
          // pipeline instead of silently leaving them untracked, guessing a starting stage from
          // the actual thread rather than defaulting to "New" (which would be wrong if there's
          // already been back-and-forth, e.g. outreach that started before this was built).
          entry = {
            url: contactProfileUrl,
            name: contactName || '',
            headline: '',
            company: '',
            score: null,
            intent,
            savedAt: Date.now(),
            stage: inferStageFromConversation(msgs, isRaw),
            stageUpdatedAt: Date.now(),
          };
          await chrome.storage.local.set({ savedContacts: [entry, ...contacts] });
        }

        if (entry.stage && entry.stage !== 'new') {
          stage = entry.stage;
          daysSinceLastTouch = Math.floor((Date.now() - (entry.stageUpdatedAt || entry.savedAt || Date.now())) / 86400000);
        }
        const storedRecord = await dbGet(contactProfileUrl).catch(() => null);
        analysis = storedRecord?.analysis || undefined;
        if (stage) {
          btn.title = `Detected: ${STAGE_META[stage]?.label || stage} · last touch ${daysSinceLastTouch === 0 ? 'today' : `${daysSinceLastTouch}d ago`}`;
        }
      }

      const res = await new Promise(resolve => {
        chrome.runtime.sendMessage({
          type: 'GENERATE_CHAT_FOLLOWUP',
          conversationText,
          isRaw,
          contactName,
          senderName: myName,
          intent,
          userInstructions,
          stage, daysSinceLastTouch, analysis,
        }, r => {
          if (chrome.runtime.lastError) resolve({ error: chrome.runtime.lastError.message });
          else resolve(r || { error: 'No response' });
        });
      });
      if (res.error) {
        const errMap = {
          NO_API_KEY: 'No API key — open Settings',
          LIMIT_REACHED: 'Monthly limit reached — upgrade to Pro',
          RATE_LIMITED: 'Rate limited — try again shortly',
          INVALID_KEY: 'Invalid API key — check Settings',
        };
        if (status) { status.textContent = errMap[res.error] || 'Error — try again'; status.className = 'lia-followup-status lia-followup-status-err'; }
      } else if (res.text) {
        const { text: messageText, note } = parseTimingNote(res.text);
        if (note && status) { status.textContent = `⚠ ${note}`; status.title = note; status.className = 'lia-followup-status lia-followup-status-err'; }
        const inserted = insertIntoChat(messageText);
        if (!inserted) {
          await navigator.clipboard.writeText(messageText).catch(() => {});
          if (status && !note) { status.textContent = '✓ Copied to clipboard'; status.className = 'lia-followup-status lia-followup-status-ok'; }
        } else {
          if (status && !note) { status.textContent = '✓ Inserted into chat'; status.className = 'lia-followup-status lia-followup-status-ok'; }
          if (!note) setTimeout(() => { if (status) { status.textContent = ''; status.className = 'lia-followup-status'; } }, 3500);
        }
        if (contactProfileUrl) {
          await advanceStageBySteps(contactProfileUrl, 1);
          await updateFollowupTag();
        }
      }
    } catch (_) {
      if (status) { status.textContent = 'Error — try again'; status.className = 'lia-followup-status lia-followup-status-err'; }
    }
    resetFollowupBtn(btn);
  }

  function initMessagingPage() {
    // Retry until the compose box renders (LinkedIn's SPA may not have painted it yet)
    let attempts = 0;
    (function tryInject() {
      injectFollowupBar();
      if (!_msgFollowupBar && attempts++ < 14) setTimeout(tryInject, 600);
    }());

    // Switching between conversations inside /messaging/ doesn't reliably fire the lia-nav
    // history-based listener (LinkedIn swaps the open thread without always changing the URL
    // path), and LinkedIn's own re-render can detach our injected bar even when it does.
    // Observe document.body directly rather than guessing a specific LinkedIn container class
    // (those are unstable and a wrong/unrelated match would silently watch the wrong subtree) —
    // self-heal by re-injecting whenever the bar goes missing while still on a messaging page.
    if (!_msgObserver) {
      _msgObserver = new MutationObserver(() => {
        if (!isMessagingPage()) return;
        if (_msgFollowupBar && document.contains(_msgFollowupBar)) return;
        injectFollowupBar();
      });
      _msgObserver.observe(document.body, { childList: true, subtree: true });
    }
  }

  // ─── Trigger Button ───────────────────────────────────────────────────────────
  function injectTriggerButton() {
    if (triggerBtn) return;
    triggerBtn = document.createElement('button');
    triggerBtn.id = 'lia-trigger';
    triggerBtn.setAttribute('aria-label', 'Open LinkPilot AI');
    triggerBtn.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
        <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
      </svg>
      <span>Analyze</span>
    `;
    triggerBtn.addEventListener('click', handleTriggerClick);
    ensureDock().appendChild(triggerBtn);
  }

  // ─── Post Creator Button ──────────────────────────────────────────────────────
  function injectPostCreatorButton() {
    if (postBtn) return;
    postBtn = document.createElement('button');
    postBtn.id = 'lia-post-trigger';
    postBtn.setAttribute('aria-label', 'Create LinkedIn Post');
    postBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg><span>Post</span>`;
    postBtn.addEventListener('click', openPostCreator);
    ensureDock().appendChild(postBtn);
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
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          <span>Post Creator</span>
        </div>
        <div class="lia-pc-mode-toggle" id="lia-pc-mode-toggle">
          <button class="lia-pc-mode-btn active" data-mode="personal" title="Post as yourself">Personal</button>
          <button class="lia-pc-mode-btn" data-mode="company" title="Post for your company">Company</button>
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
    const hasKey = await checkApiKey();
    if (!hasKey) { renderPcNoApiKey(); return; }
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
      if (result.error === 'LIMIT_REACHED') { renderPcLimitReached(); return; }
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
      <button class="lia-btn-primary lia-pc-full-btn" id="lia-pc-write-btn">Write Post</button>
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
      if (result.error === 'LIMIT_REACHED') { renderPcLimitReached(); return; }
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
      if (result.error === 'PRO_REQUIRED') { renderPcLimitReached(); return; }
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

  // ─── Time / World Clock ───────────────────────────────────────────────────────
  const DEFAULT_TIME_ZONES = ['Asia/Karachi', 'America/New_York', 'Europe/London', 'Australia/Sydney'];
  const ALL_TIME_ZONES = [
    { id: 'Asia/Karachi', label: 'Pakistan' },
    { id: 'America/New_York', label: 'US Eastern' },
    { id: 'America/Chicago', label: 'US Central' },
    { id: 'America/Denver', label: 'US Mountain' },
    { id: 'America/Los_Angeles', label: 'US Pacific' },
    { id: 'Europe/London', label: 'UK' },
    { id: 'Europe/Berlin', label: 'Europe (CET)' },
    { id: 'Asia/Dubai', label: 'UAE' },
    { id: 'Asia/Kolkata', label: 'India' },
    { id: 'Australia/Sydney', label: 'Australia (Sydney)' },
    { id: 'Asia/Singapore', label: 'Singapore' },
    { id: 'Asia/Tokyo', label: 'Japan' },
  ];
  // Common colloquial abbreviations/words → IANA zone, for the free-text converter input.
  const TZ_ABBR = {
    est: 'America/New_York', edt: 'America/New_York', et: 'America/New_York', eastern: 'America/New_York',
    cst: 'America/Chicago', cdt: 'America/Chicago', ct: 'America/Chicago', central: 'America/Chicago',
    mst: 'America/Denver', mdt: 'America/Denver', mt: 'America/Denver', mountain: 'America/Denver',
    pst: 'America/Los_Angeles', pdt: 'America/Los_Angeles', pt: 'America/Los_Angeles', pacific: 'America/Los_Angeles',
    gmt: 'Europe/London', bst: 'Europe/London', uk: 'Europe/London',
    aest: 'Australia/Sydney', aedt: 'Australia/Sydney', au: 'Australia/Sydney', australia: 'Australia/Sydney', sydney: 'Australia/Sydney',
    pkt: 'Asia/Karachi', pakistan: 'Asia/Karachi', pk: 'Asia/Karachi',
    ist: 'Asia/Kolkata', india: 'Asia/Kolkata',
    utc: 'UTC',
  };

  async function loadTimeZones() {
    if (timeZones) return timeZones;
    const { timeZonesConfig } = await chrome.storage.local.get('timeZonesConfig').catch(() => ({}));
    timeZones = Array.isArray(timeZonesConfig) && timeZonesConfig.length ? timeZonesConfig : [...DEFAULT_TIME_ZONES];
    return timeZones;
  }

  function saveTimeZones() {
    chrome.storage.local.set({ timeZonesConfig: timeZones }).catch(() => {});
  }

  function zoneLabel(id) {
    return ALL_TIME_ZONES.find(z => z.id === id)?.label || id.split('/').pop().replace(/_/g, ' ');
  }

  function getZoneOffsetMinutes(zoneId, date = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: zoneId, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(date).reduce((acc, p) => { acc[p.type] = p.value; return acc; }, {});
    const asUTC = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
    return (asUTC - date.getTime()) / 60000;
  }

  function parseTimeInput(str) {
    const m = str.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*([a-zA-Z]{2,10})?$/i);
    if (!m) return null;
    let hour = parseInt(m[1], 10);
    const minute = m[2] ? parseInt(m[2], 10) : 0;
    const meridiem = m[3]?.toLowerCase();
    const tzWord = (m[4] || '').toLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (!meridiem && hour > 23) return null;
    if (minute > 59) return null;
    const zoneId = tzWord ? TZ_ABBR[tzWord] : 'Asia/Karachi';
    if (!zoneId) return null;
    return { hour, minute, zoneId, zoneLabel: tzWord ? zoneLabel(zoneId) : 'Pakistan' };
  }

  function convertTime(hour, minute, sourceZoneId, targetZoneId) {
    const now = new Date();
    const offsetMin = getZoneOffsetMinutes(sourceZoneId, now);
    const naiveUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour, minute);
    const instant = new Date(naiveUTC - offsetMin * 60000);
    return new Intl.DateTimeFormat('en-US', { timeZone: targetZoneId, hour: 'numeric', minute: '2-digit', hour12: true }).format(instant);
  }

  function renderClocks() {
    const list = document.getElementById('lia-time-clocks');
    if (!list || !timeZones) return;
    list.innerHTML = timeZones.map(id => {
      const time = new Intl.DateTimeFormat('en-US', { timeZone: id, hour: 'numeric', minute: '2-digit', second: '2-digit', hour12: true }).format(new Date());
      const date = new Intl.DateTimeFormat('en-US', { timeZone: id, weekday: 'short', month: 'short', day: 'numeric' }).format(new Date());
      return `
        <div class="lia-time-row">
          <div class="lia-time-row-label">${zoneLabel(id)}<span class="lia-time-row-date">${date}</span></div>
          <div class="lia-time-row-clock">${time}</div>
        </div>`;
    }).join('');
  }

  function renderZonePicker() {
    const list = document.getElementById('lia-time-zone-picker');
    if (!list) return;
    list.innerHTML = ALL_TIME_ZONES.map(z => `
      <label class="lia-time-zone-opt">
        <input type="checkbox" value="${z.id}" ${timeZones.includes(z.id) ? 'checked' : ''} />
        ${z.label}
      </label>`).join('');
    list.querySelectorAll('input[type="checkbox"]').forEach(cb => {
      cb.addEventListener('change', () => {
        const checked = [...list.querySelectorAll('input:checked')].map(c => c.value);
        timeZones = checked.length ? checked : [...DEFAULT_TIME_ZONES];
        saveTimeZones();
        renderClocks();
      });
    });
  }

  async function openTimePanel() {
    if (timePanel) {
      const opening = !timePanel.classList.contains('lia-pc-open');
      timePanel.classList.toggle('lia-pc-open');
      if (opening) { renderClocks(); if (!_timeInterval) _timeInterval = setInterval(renderClocks, 1000); }
      else if (_timeInterval) { clearInterval(_timeInterval); _timeInterval = null; }
      return;
    }
    await loadTimeZones();
    timePanel = document.createElement('div');
    timePanel.id = 'lia-time-panel';
    timePanel.innerHTML = `
      <div class="lia-pc-header">
        <div class="lia-pc-title">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          <span>World Clock</span>
        </div>
        <button class="lia-pc-close" aria-label="Close">&times;</button>
      </div>
      <div class="lia-pc-body">
        <div id="lia-time-clocks" class="lia-time-clocks"></div>
        <div class="lia-section">
          <div class="lia-label">Convert a time to Pakistan time</div>
          <div class="lia-time-convert-row">
            <input type="text" id="lia-time-convert-input" class="lia-notes-input" placeholder="e.g. 10am EST, 3:30pm PKT" style="flex:1" />
            <button class="lia-btn-primary" id="lia-time-convert-btn">Convert</button>
          </div>
          <div id="lia-time-convert-result" class="lia-time-convert-result"></div>
        </div>
        <div class="lia-section">
          <button class="lia-time-zones-toggle" id="lia-time-zones-toggle">Edit zones shown ▾</button>
          <div id="lia-time-zone-picker" class="lia-time-zone-picker" style="display:none"></div>
        </div>
      </div>`;
    document.body.appendChild(timePanel);

    timePanel.querySelector('.lia-pc-close').addEventListener('click', () => openTimePanel());
    timePanel.querySelector('#lia-time-convert-btn').addEventListener('click', () => {
      const input = timePanel.querySelector('#lia-time-convert-input');
      const resultEl = timePanel.querySelector('#lia-time-convert-result');
      const parsed = parseTimeInput(input?.value || '');
      if (!parsed) {
        resultEl.innerHTML = `<span class="lia-time-convert-err">Couldn't parse that — try "10am EST" or "3:30pm PKT"</span>`;
        return;
      }
      const rows = timeZones.map(id => {
        const converted = convertTime(parsed.hour, parsed.minute, parsed.zoneId, id);
        return `<div class="lia-time-convert-out-row"><span>${zoneLabel(id)}</span><b>${converted}</b></div>`;
      }).join('');
      resultEl.innerHTML = rows;
    });
    timePanel.querySelector('#lia-time-convert-input').addEventListener('keydown', e => {
      if (e.key === 'Enter') timePanel.querySelector('#lia-time-convert-btn')?.click();
    });
    timePanel.querySelector('#lia-time-zones-toggle').addEventListener('click', () => {
      const list = timePanel.querySelector('#lia-time-zone-picker');
      const opening = list.style.display === 'none';
      list.style.display = opening ? 'block' : 'none';
      if (opening) renderZonePicker();
    });

    timePanel.classList.add('lia-pc-open');
    renderClocks();
    _timeInterval = setInterval(renderClocks, 1000);
  }

  function injectTimeButton() {
    if (timeBtn) return;
    timeBtn = document.createElement('button');
    timeBtn.id = 'lia-time-trigger';
    timeBtn.setAttribute('aria-label', 'World Clock & Time Converter');
    timeBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg><span>Time</span>`;
    timeBtn.addEventListener('click', openTimePanel);
    ensureDock().appendChild(timeBtn);
  }

  // ─── Main Click Handler ───────────────────────────────────────────────────────
  async function handleTriggerClick() {
    if (panel) {
      togglePanel(!panel.classList.contains('lia-open'));
      return;
    }
    createPanel();
    togglePanel(true);
    if (!isProfilePage()) {
      renderNoProfileGate();
      return;
    }
    if (!isNativeLinkedInProfile()) {
      const body = document.getElementById('lia-body');
      if (body) body.innerHTML = `
        <div style="padding:28px 20px;text-align:center;">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="rgba(167,139,250,0.6)" stroke-width="1.5" style="margin-bottom:12px"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>
          <div style="font-size:14px;font-weight:700;color:#f1f5f9;margin-bottom:6px;">Sales Navigator Support</div>
          <div style="font-size:12.5px;color:rgba(196,181,253,0.6);line-height:1.6;">Full analysis on Sales Navigator profiles is coming soon. Open the person's standard LinkedIn profile (<code style="font-size:11px;background:rgba(255,255,255,0.07);padding:1px 5px;border-radius:4px">linkedin.com/in/…</code>) to use LinkPilot AI.</div>
        </div>`;
      return;
    }
    const isAuthed = await checkGoogleAuth();
    if (!isAuthed) { renderSignInRequired(); return; }
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

    const modeLabel = currentIntent === 'job_search' ? 'Job Search'
      : currentIntent === 'b2c_sales' ? 'Freelance'
      : 'B2B Sales';

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

    const { targetIndustries } = await chrome.storage.local.get('targetIndustries').catch(() => ({}));
    const showIcpWarning = (currentIntent === 'b2b_sales') && (!Array.isArray(targetIndustries) || targetIndustries.length === 0);

    body.innerHTML = `
      <div class="lia-purpose-picker">
        <div class="lia-mode-indicator">${modeLabel}</div>
        ${showIcpWarning ? `
        <div class="lia-icp-warning">
          <div class="lia-icp-warning-icon">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
          </div>
          <div class="lia-icp-warning-body">
            <div class="lia-icp-warning-title">No ICP Industries Set</div>
            <div class="lia-icp-warning-text">Analysis will be generic without target industries. <button class="lia-icp-warning-link" id="lia-set-icp">Set ICP →</button></div>
          </div>
        </div>` : ''}
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

    body.querySelector('#lia-set-icp')?.addEventListener('click', () => chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' }));
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
            const text = _stripUiChrome(el.textContent.trim());
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
            const text = _stripUiChrome(body.textContent.trim());
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

  async function renderFollowupForm(intent) {
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

    // Pipeline stage + elapsed time (ground truth from tracked stageUpdatedAt, not scraped
    // text) + any cached full-profile analysis, so generation is grounded in real context.
    const contacts = await getSavedContacts();
    const entry = contacts.find(c => c.url === currentProfileUrl);
    // Not tracked yet, but a conversation was actually found — default to "Messaged" rather than
    // "New" so the dropdown doesn't misrepresent an already-started conversation as a cold one.
    const trackedStage = STAGE_META[entry?.stage] ? entry.stage : (extracted ? 'messaged' : 'new');
    const daysSinceLastTouch = (entry && entry.stage && entry.stage !== 'new')
      ? Math.floor((Date.now() - (entry.stageUpdatedAt || entry.savedAt || Date.now())) / 86400000)
      : null;
    const storedRecord = await dbGet(currentProfileUrl).catch(() => null);
    const cachedAnalysis = storedRecord?.analysis || null;

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
        <div class="lia-label">Outreach Stage <span class="lia-optional">(auto-detected — correct if needed)</span></div>
        <select class="lia-notes-input" id="lia-followup-stage-select" style="margin-bottom:4px">
          ${STAGE_ORDER.map(s => `<option value="${s}" ${s === trackedStage ? 'selected' : ''}>${STAGE_META[s].label}</option>`).join('')}
        </select>
        ${daysSinceLastTouch !== null ? `<div class="lia-followup-elapsed">Last touch: ${daysSinceLastTouch === 0 ? 'today' : `${daysSinceLastTouch} day${daysSinceLastTouch === 1 ? '' : 's'} ago`}</div>` : ''}
      </div>
      <div class="lia-section">
        <div class="lia-label">Conversation
          <span class="lia-optional" style="font-weight:400"> — auto-extracted from this page</span>
        </div>
        ${statusHtml}
        <textarea class="lia-notes-input" id="lia-followup-convo" rows="6" placeholder="Conversation will appear here — or paste it manually..." style="min-height:110px"></textarea>
      </div>
      <div class="lia-section">
        <div class="lia-refine-label" style="margin-bottom:6px">Instructions <span class="lia-optional">(optional)</span></div>
        <textarea class="lia-notes-input" id="lia-followup-instructions" rows="2" placeholder="e.g. Be more direct, focus on AI automation, ask for a call this week..."></textarea>
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
      const userInstructions = body.querySelector('#lia-followup-instructions')?.value.trim() || '';
      const selectedStage = body.querySelector('#lia-followup-stage-select')?.value || trackedStage;

      btn.disabled = true;
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Writing follow-up...`;
      resultDiv.style.display = 'none';

      try {
        const profileData = extractProfile();
        if (!entry) {
          // Auto-track this contact — generating a follow-up means we're actively following up
          // with them, so the pipeline should reflect that instead of only tracking contacts the
          // user remembered to explicitly Save first.
          const freshContacts = await getSavedContacts();
          const score = cachedAnalysis
            ? (intent === 'job_search' ? (cachedAnalysis.hiringSignal?.score || 'Unlikely')
              : intent === 'b2c_sales' ? (cachedAnalysis.clientPotential?.score || 'Low')
              : (cachedAnalysis.potentialClient?.score || 'Low'))
            : null;
          const newEntry = {
            url: currentProfileUrl,
            name: profileData.name || '',
            headline: profileData.headline || '',
            company: cachedAnalysis?.company?.name || cachedAnalysis?.companyName || '',
            score,
            intent,
            savedAt: Date.now(),
            stage: selectedStage,
            stageUpdatedAt: Date.now(),
          };
          await chrome.storage.local.set({ savedContacts: [newEntry, ...freshContacts.filter(c => c.url !== currentProfileUrl)] });
        } else if (selectedStage !== entry.stage) {
          await setContactStage(currentProfileUrl, selectedStage);
        }
        const result = await sendMessage('GENERATE_FOLLOW_UP', profileData, {
          intent, conversationText: convoText, userInstructions,
          stage: selectedStage, daysSinceLastTouch, analysis: cachedAnalysis,
        });
        if (result.error) throw new Error(result.error);

        const { text, note } = parseTimingNote(result.text || '');
        resultDiv.innerHTML = `
          ${note ? `<div class="lia-timing-note">⚠️ ${escHtml(note)}</div>` : ''}
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
          advanceStageBySteps(currentProfileUrl, 1);
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
      advanceStage(currentProfileUrl, 'connection_sent');
    });

    body.querySelector('#lia-single-regen').addEventListener('click', async () => {
      const btn = body.querySelector('#lia-single-regen');
      const notes = body.querySelector('#lia-notes-input').value.trim();
      btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" class="lia-spin"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg> Regenerating...`;
      btn.disabled = true;
      await runForPurpose(purpose, notes, true);
    });

    // Restore saved notes, then auto-save on input
    dbGet(currentProfileUrl).then(stored => {
      if (!stored?.notes) return;
      const textarea = body.querySelector('#lia-notes-input');
      if (textarea) textarea.value = stored.notes;
    }).catch(() => {});

    let _notesSaveTimer = null;
    body.querySelector('#lia-notes-input')?.addEventListener('input', () => {
      clearTimeout(_notesSaveTimer);
      _notesSaveTimer = setTimeout(async () => {
        const notes = body.querySelector('#lia-notes-input')?.value || '';
        const current = await dbGet(currentProfileUrl).catch(() => null) || {};
        await dbPut(currentProfileUrl, { ...current, url: currentProfileUrl, notes }).catch(() => {});
      }, 800);
    });
  }

  let _analyzing = false;

  async function runAnalysis() {
    if (_analyzing) return;
    const hasKey = await checkApiKey();
    if (!hasKey) { renderNoApiKey(); return; }

    // Make sure tabs are visible for full analysis
    const tabs = panel?.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = '';

    _analyzing = true;
    setLoadingState();
    const profileData = extractProfile();

    const { analysisIntent: intent = 'b2b_sales' } = await chrome.storage.local.get('analysisIntent');

    try {
      // Settled (not Promise.all) on purpose: a failed connection-request generation shouldn't
      // discard a successful analysis — that used to throw away real work and cost a second
      // usage credit on "Try Again" for something that had already succeeded once. Only a failed
      // *analysis* is fatal here; a failed connection request just renders empty, and the
      // Connection tab offers its own retry for that piece alone.
      const [analysisSettled, connectionSettled] = await Promise.allSettled([
        sendMessage('ANALYZE_PROFILE', profileData, { intent }),
        sendMessage('GENERATE_CONNECTION_REQUEST', profileData, { intent }),
      ]);

      const analysis = analysisSettled.status === 'fulfilled' ? analysisSettled.value : null;
      if (!analysis || analysis.error) {
        throw new Error(analysis?.error || analysisSettled.reason?.message || 'Analysis failed');
      }

      const connectionValue = connectionSettled.status === 'fulfilled' ? connectionSettled.value : null;
      const connectionText = (connectionValue && !connectionValue.error) ? (connectionValue.text || '') : '';

      const prevRec = await dbGet(currentProfileUrl).catch(() => null);
      const record = { ...(prevRec || {}), analysis, connectionRequest: connectionText, intent };
      await dbPut(currentProfileUrl, record).catch(() => {});
      renderResults(record.analysis, record.connectionRequest, Date.now(), intent);
    } catch (err) {
      renderError(err.message);
    } finally {
      _analyzing = false;
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
          <span>LinkPilot AI</span>
          <span class="lia-mode-badge" id="lia-header-mode-badge"></span>
        </div>
        <div class="lia-header-actions">
          <button class="lia-reanalyze-btn" id="lia-reanalyze-btn" aria-label="Re-analyze profile" title="Re-analyze">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="23 4 23 10 17 10"></polyline>
              <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
            </svg>
          </button>
          <button class="lia-save-btn" id="lia-save-btn" aria-label="Save contact" title="Save contact" style="display:none">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2">
              <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
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
        <button class="lia-tab" data-tab="message">Message</button>
        <button class="lia-tab" data-tab="contact">Contact</button>
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
    panel.querySelector('#lia-save-btn').addEventListener('click', () => toggleSaveContact());

    document.body.appendChild(panel);
    reflectHubSpotState();
  }

  // ─── Saved Contacts / Pipeline Stage ───────────────────────────────────────────
  // Ordered outreach pipeline. Duplicated in popup/index.js (no shared-module bundler here,
  // same pattern already used for SETTINGS_KEYS/SYNC_KEYS between auth.js and options/index.js).
  const STAGE_ORDER = ['new', 'connection_sent', 'messaged', 'followup_1', 'followup_2', 'followup_3plus', 'replied', 'booked', 'closed'];
  const STAGE_META = {
    new:             { label: 'New' },
    connection_sent: { label: 'Connection Sent' },
    messaged:        { label: 'Messaged' },
    followup_1:      { label: 'Follow-up 1' },
    followup_2:      { label: 'Follow-up 2' },
    followup_3plus:  { label: 'Follow-up 3+' },
    replied:         { label: 'Replied' },
    booked:          { label: 'Booked' },
    closed:          { label: 'Closed' },
  };

  async function getSavedContacts() {
    const r = await chrome.storage.local.get('savedContacts').catch(() => ({}));
    return Array.isArray(r.savedContacts) ? r.savedContacts : [];
  }

  async function isContactSaved(url) {
    const contacts = await getSavedContacts();
    return contacts.some(c => c.url === url);
  }

  async function getContactStage(url) {
    const contacts = await getSavedContacts();
    return contacts.find(c => c.url === url)?.stage || null;
  }

  // Bumps a saved contact's stage forward — never moves it backward, and is a no-op if the
  // contact isn't saved (nothing to track). Called from the "Copy to Clipboard" handlers, which
  // is the closest reliable signal we have to "the user actually sent this" without a LinkedIn API.
  async function advanceStage(url, targetStage) {
    if (!url) return;
    const targetIdx = STAGE_ORDER.indexOf(targetStage);
    if (targetIdx === -1) return;
    const contacts = await getSavedContacts();
    const entry = contacts.find(c => c.url === url);
    if (!entry) return;
    const currentIdx = STAGE_ORDER.indexOf(entry.stage || 'new');
    if (currentIdx >= targetIdx) return;
    entry.stage = targetStage;
    entry.stageUpdatedAt = Date.now();
    await chrome.storage.local.set({ savedContacts: contacts });
  }

  // Moves a saved contact one step forward from wherever it currently sits — used for follow-ups,
  // where "the next stage" depends on the current one rather than a fixed target.
  async function advanceStageBySteps(url, steps = 1) {
    if (!url) return;
    const contacts = await getSavedContacts();
    const entry = contacts.find(c => c.url === url);
    if (!entry) return;
    const currentIdx = STAGE_ORDER.indexOf(entry.stage || 'new');
    const nextIdx = Math.min(currentIdx + steps, STAGE_ORDER.indexOf('followup_3plus'));
    if (nextIdx <= currentIdx) return;
    entry.stage = STAGE_ORDER[nextIdx];
    entry.stageUpdatedAt = Date.now();
    await chrome.storage.local.set({ savedContacts: contacts });
  }

  // Unconditional stage set — used when the user manually corrects the stage tag in the
  // Follow-up tool (unlike advanceStage/advanceStageBySteps, this can move it either direction).
  async function setContactStage(url, stage) {
    if (!url || !STAGE_META[stage]) return;
    const contacts = await getSavedContacts();
    const entry = contacts.find(c => c.url === url);
    if (!entry) return;
    entry.stage = stage;
    entry.stageUpdatedAt = Date.now();
    await chrome.storage.local.set({ savedContacts: contacts });
  }

  // Saves (or refreshes) the current profile. Uses the freshly-rendered analysis when one is
  // available (document.getElementById('lia-body')._rendered, populated after Analyze completes)
  // for a real score/company; otherwise falls back to whatever extractProfile() can read off the
  // page directly, with score left null — the "quick save from the dock, no Analyze required"
  // path. Existing stage/savedAt/score are preserved on re-save unless fresher data overrides them,
  // so this also doubles as an "upgrade" when Analyze completes on an already quick-saved contact.
  async function saveCurrentContact() {
    if (!currentProfileUrl) return;
    const rendered = document.getElementById('lia-body')?._rendered;
    const analysis = rendered?.analysis;
    const intent = rendered?.intent
      || (await chrome.storage.local.get('analysisIntent')).analysisIntent
      || 'b2b_sales';
    const profileData = extractProfile();
    const contacts = await getSavedContacts();
    const existing = contacts.find(c => c.url === currentProfileUrl);

    const score = analysis
      ? (intent === 'job_search' ? (analysis.hiringSignal?.score || 'Unlikely')
        : intent === 'b2c_sales' ? (analysis.clientPotential?.score || 'Low')
        : (analysis.potentialClient?.score || 'Low'))
      : (existing?.score ?? null);
    const company = analysis?.company?.name || analysis?.companyName
      || profileData.experience?.[0]?.company || existing?.company || '';

    const entry = {
      url: currentProfileUrl,
      name: profileData.name || existing?.name || '',
      headline: profileData.headline || existing?.headline || '',
      company,
      score,
      intent,
      savedAt: existing?.savedAt || Date.now(),
      stage: existing?.stage || 'new',
      stageUpdatedAt: existing?.stageUpdatedAt || Date.now(),
    };
    const updated = [entry, ...contacts.filter(c => c.url !== currentProfileUrl)].slice(0, 200);
    await chrome.storage.local.set({ savedContacts: updated });
  }

  async function unsaveCurrentContact() {
    if (!currentProfileUrl) return;
    const contacts = await getSavedContacts();
    const updated = contacts.filter(c => c.url !== currentProfileUrl);
    await chrome.storage.local.set({ savedContacts: updated });
  }

  async function toggleSaveContact() {
    if (!currentProfileUrl) return;
    const saved = await isContactSaved(currentProfileUrl);
    if (saved) await unsaveCurrentContact();
    else await saveCurrentContact();
    await syncSaveButtons();
  }

  // Keeps the panel's save icon and the dock's Save button showing the same state — either one
  // can be used to save/unsave, so both need to reflect whichever was used last.
  async function syncSaveButtons() {
    const saved = currentProfileUrl ? await isContactSaved(currentProfileUrl) : false;
    const panelBtn = panel?.querySelector('#lia-save-btn');
    if (panelBtn) {
      panelBtn.style.display = '';
      panelBtn.classList.toggle('lia-save-btn-active', saved);
      panelBtn.title = saved ? 'Unsave contact' : 'Save contact';
    }
    if (dockSaveBtn) {
      dockSaveBtn.classList.toggle('lia-save-trigger-active', saved);
      dockSaveBtn.title = saved ? 'Unsave contact' : 'Save contact';
    }
  }

  async function refreshSaveBtn() {
    // If Analyze just completed on a contact that was already quick-saved from the dock (no
    // score yet), upgrade the saved entry with the real score now that one exists.
    if (currentProfileUrl && await isContactSaved(currentProfileUrl)) await saveCurrentContact();
    await syncSaveButtons();
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

  function _renderGate(bodyEl, { iconColor, iconGlow, iconSvg, heading, desc, btnId, btnLabel }) {
    bodyEl.innerHTML = `
      <div class="lia-gate">
        <div class="lia-gate-icon" style="--glow:${iconGlow};">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="${iconColor}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${iconSvg}</svg>
        </div>
        <div class="lia-gate-heading">${heading}</div>
        <div class="lia-gate-desc">${desc}</div>
        <button class="lia-btn-primary lia-gate-btn" id="${btnId}">${btnLabel}</button>
      </div>
    `;
  }

  function renderNoProfileGate() {
    const body = document.getElementById('lia-body');
    if (!body) return;
    _renderGate(body, {
      iconColor: 'rgba(167,139,250,0.9)',
      iconGlow: 'rgba(124,58,237,0.35)',
      iconSvg: '<circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>',
      heading: 'Open a Profile to Analyze',
      desc: 'Visit someone\'s LinkedIn profile, then click Analyze to score them and generate outreach.',
      btnId: 'lia-gate-close',
      btnLabel: 'Got it',
    });
    body.querySelector('#lia-gate-close')?.addEventListener('click', () => togglePanel(false));
  }

  function renderNoApiKey() {
    const body = document.getElementById('lia-body');
    if (!body) return;
    _renderGate(body, {
      iconColor: '#06b6d4',
      iconGlow: 'rgba(6,182,212,0.35)',
      iconSvg: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      heading: 'API Key Required',
      desc: 'Enter your OpenAI API key in Settings to enable AI-powered analysis.',
      btnId: 'lia-open-settings',
      btnLabel: 'Open Settings',
    });
    body.querySelector('#lia-open-settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    });
  }

  function renderPcNoApiKey() {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    _renderGate(body, {
      iconColor: '#06b6d4',
      iconGlow: 'rgba(6,182,212,0.35)',
      iconSvg: '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
      heading: 'API Key Required',
      desc: 'Enter your OpenAI API key in Settings to generate AI-powered posts.',
      btnId: 'lia-pc-open-settings',
      btnLabel: 'Open Settings',
    });
    body.querySelector('#lia-pc-open-settings').addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS_PAGE' });
    });
  }

  function renderPcLimitReached() {
    const body = document.getElementById('lia-pc-body');
    if (!body) return;
    _renderUpgradeGate(body, 'Monthly Limit Reached', 'You\'ve used all your free post generations this month. Upgrade to Pro for unlimited access.', 'lia-pc-upgrade-btn');
  }

  function _renderUpgradeGate(bodyEl, heading, desc, btnId) {
    _renderGate(bodyEl, {
      iconColor: '#a78bfa',
      iconGlow: 'rgba(167,139,250,0.35)',
      iconSvg: '<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>',
      heading,
      desc,
      btnId,
      btnLabel: 'Upgrade to Pro',
    });
    const upgradeBtn = bodyEl.querySelector(`#${btnId}`);
    upgradeBtn.addEventListener('click', () => {
      upgradeBtn.disabled = true;
      upgradeBtn.textContent = 'Opening checkout…';
      chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, res => {
        if (chrome.runtime.lastError || !res?.url) {
          upgradeBtn.disabled = false;
          upgradeBtn.textContent = 'Upgrade to Pro';
          return;
        }
        chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: res.url });
      });
    });
  }

  function renderError(message) {
    const body = document.getElementById('lia-body');
    if (!body) return;
    if (message === 'NO_API_KEY') { renderNoApiKey(); return; }
    if (message === 'INVALID_KEY') { message = 'Your OpenAI API key is invalid. Please update it in Settings.'; }
    if (message === 'RATE_LIMITED') { message = 'OpenAI rate limit reached. Please wait a moment and try again.'; }
    if (message === 'API_DOWN') { message = 'OpenAI is temporarily unavailable. Please try again shortly.'; }
    if (message === 'TRUNCATED_RESPONSE') { message = 'The AI response was cut short. Please try again.'; }
    if (message === 'LIMIT_REACHED') {
      _renderUpgradeGate(body, 'Monthly Limit Reached', 'You\'ve used all your free analyses this month. Upgrade to Pro for unlimited access.', 'lia-upgrade-btn');
      return;
    }
    if (message === 'PRO_REQUIRED') {
      _renderUpgradeGate(body, 'Pro Feature', 'This feature requires a Pro plan. Upgrade to unlock unlimited analyses and HubSpot CRM.', 'lia-upgrade-btn');
      return;
    }

    const isStale = /context invalidated|Extension context/i.test(message);
    _renderGate(body, {
      iconColor: isStale ? '#f59e0b' : '#ef4444',
      iconGlow: isStale ? 'rgba(245,158,11,0.35)' : 'rgba(239,68,68,0.35)',
      iconSvg: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
      heading: isStale ? 'Extension Updated' : 'Something Went Wrong',
      desc: isStale ? 'The extension was reloaded. Refresh this page to reconnect.' : escHtml(message),
      btnId: 'lia-retry',
      btnLabel: isStale ? 'Refresh Page' : 'Try Again',
    });
    body.querySelector('#lia-retry').addEventListener('click', async () => {
      if (isStale) { location.reload(); return; }
      await dbDelete(currentProfileUrl).catch(() => {});
      panel.remove(); panel = null;
      handleTriggerClick();
    });
  }

  function renderResults(analysis, connectionRequest, timestamp, intent = 'b2b_sales') {
    const body = document.getElementById('lia-body');
    if (!body) return;
    body._rendered = { analysis, connectionRequest, timestamp, intent };

    const badge = panel.querySelector('#lia-header-mode-badge');
    if (badge) {
      const modeMap = { b2b_sales: 'B2B Sales', b2c_sales: 'Freelance', job_search: 'Job Search' };
      badge.textContent = modeMap[intent] || 'B2B Sales';
    }

    refreshSaveBtn();
    renderTabContent(analysis, connectionRequest, activeTab, intent);
  }

  function renderTabContent(analysis, connectionRequest, tab, intent = 'b2b_sales') {
    const body = document.getElementById('lia-body');
    if (!body) return;

    if (tab === 'analysis') {
      // ── Should I message? recommendation ─────────────────────────────────
      let reachOut = 'Maybe';
      let reachReason = '';
      if (intent === 'job_search') {
        const hs = analysis.hiringSignal?.score || 'Unlikely';
        reachOut = hs === 'Strong' ? 'Yes' : hs === 'Possible' ? 'Maybe' : 'Low priority';
        reachReason = analysis.hiringSignal?.reasoning || '';
      } else if (intent === 'b2c_sales') {
        const cp = analysis.clientPotential?.score || 'Low';
        reachOut = cp === 'High' ? 'Yes' : cp === 'Medium' ? 'Maybe' : 'Low priority';
        reachReason = analysis.clientPotential?.reasoning || '';
      } else {
        const ps = analysis.potentialClient?.score || 'Low';
        reachOut = ps === 'High' ? 'Yes' : ps === 'Medium' ? 'Maybe' : 'Low priority';
        reachReason = analysis.potentialClient?.reasoning || '';
      }
      const roClass = reachOut === 'Yes' ? 'ro-yes' : reachOut === 'Maybe' ? 'ro-maybe' : 'ro-no';
      const roIcon = reachOut === 'Yes'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>`
        : reachOut === 'Maybe'
        ? `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"/></svg>`
        : `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`;

      const reachLabel = intent === 'job_search' ? 'Reach out?' : 'Should you message?';
      const recommendationBlock = `
        <div class="lia-reach-card ${roClass}">
          <div class="reach-header">
            <span class="reach-label">${reachLabel}</span>
            <span class="reach-verdict ${roClass}">${roIcon} ${reachOut}</span>
          </div>
          ${reachReason ? `<p class="reach-reason">${escHtml(reachReason)}</p>` : ''}
        </div>`;

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
        ${recommendationBlock}
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

    } else if (tab === 'message') {
      // ── Message Tab ─────────────────────────────────────────────────────────
      const TONES = [
        { val: 'warm',         label: 'Warm',         desc: 'Friendly & genuine' },
        { val: 'professional', label: 'Professional',  desc: 'Polished & credible' },
        { val: 'casual',       label: 'Casual',        desc: 'Relaxed & conversational' },
        { val: 'direct',       label: 'Direct',        desc: 'Straight to the point' },
        { val: 'bold',         label: 'Bold',          desc: 'Confident & memorable' },
      ];
      let msgCurrentText = '';
      let msgSelectedTone = 'warm';

      // Build analysis insights block
      let insightRows = '';
      if (intent === 'b2b_sales') {
        const ps = analysis.prospectScore?.score || analysis.potentialClient?.score || '';
        const psR = analysis.prospectScore?.reasoning || analysis.potentialClient?.reasoning || '';
        const dm = analysis.decisionMakerLevel || analysis.decisionMaker || '';
        const fit = analysis.icpFit?.match || analysis.industryFit?.level || '';
        const fitR = analysis.icpFit?.reasoning || analysis.industryFit?.reasoning || '';
        const psClass = { High: 'score-high', Medium: 'score-medium', Low: 'score-low' }[ps] || 'score-low';
        if (ps) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Prospect Score</span><span class="ind-score-badge ${psClass}" style="font-size:11px;padding:2px 8px">${ps}</span>${psR ? `<span class="lia-insight-note">${escHtml(psR)}</span>` : ''}</div>`;
        if (dm) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Decision Maker</span><span class="lia-insight-val">${escHtml(dm)}</span></div>`;
        if (fit) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">ICP Fit</span><span class="lia-insight-val">${escHtml(fit)}</span>${fitR ? `<span class="lia-insight-note">${escHtml(fitR)}</span>` : ''}</div>`;
      } else if (intent === 'b2c_sales') {
        const cp = analysis.clientPotential?.score || '';
        const cpR = analysis.clientPotential?.reasoning || '';
        const aa = analysis.approachAngle || '';
        const cpClass = { High: 'score-high', Medium: 'score-medium', Low: 'score-low' }[cp] || 'score-low';
        if (cp) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Client Potential</span><span class="ind-score-badge ${cpClass}" style="font-size:11px;padding:2px 8px">${cp}</span>${cpR ? `<span class="lia-insight-note">${escHtml(cpR)}</span>` : ''}</div>`;
        if (aa) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Approach Angle</span><span class="lia-insight-note">${escHtml(aa)}</span></div>`;
        (analysis.painPoints || []).slice(0, 2).forEach(pp => {
          insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Pain Point</span><span class="lia-insight-note">${escHtml(pp)}</span></div>`;
        });
      } else {
        const hs = analysis.hiringSignal?.score || '';
        const hsR = analysis.hiringSignal?.reasoning || '';
        const hsClass = { Strong: 'score-high', Possible: 'score-medium', Unlikely: 'score-low' }[hs] || 'score-low';
        if (hs) insightRows += `<div class="lia-insight-row"><span class="lia-insight-key">Hiring Signal</span><span class="ind-score-badge ${hsClass}" style="font-size:11px;padding:2px 8px">${hs}</span>${hsR ? `<span class="lia-insight-note">${escHtml(hsR)}</span>` : ''}</div>`;
      }
      const ki = (analysis.keyInsights || []).slice(0, 3);
      const insightsSection = (insightRows || ki.length) ? `
        <div class="lia-msg-intelligence">
          <div class="lia-label" style="margin-bottom:8px">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="vertical-align:-2px"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
            Outreach Intelligence
          </div>
          ${insightRows}
          ${ki.length ? ki.map(i => `<div class="lia-insight-row lia-insight-ki"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#0A66C2" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg><span class="lia-insight-note" style="color:#374151">${escHtml(i)}</span></div>`).join('') : ''}
        </div>` : '';

      body.innerHTML = `
        ${insightsSection}
        <div class="lia-section" style="margin-top:0">
          <div class="lia-refine-label" style="margin-bottom:7px">Tone</div>
          <div class="lia-tone-grid" id="lia-msgtab-tone">
            ${TONES.map(t => `
              <button class="lia-tone-btn${t.val === msgSelectedTone ? ' active' : ''}" data-tone="${t.val}">
                <span class="lia-tone-name">${t.label}</span>
                <span class="lia-tone-desc">${t.desc}</span>
              </button>`).join('')}
          </div>
        </div>
        <div class="lia-section">
          <div class="lia-refine-label" style="margin-bottom:6px">Instructions <span class="lia-optional">(optional)</span></div>
          <textarea class="lia-notes-input" id="lia-msgtab-instructions" rows="3" placeholder="e.g. Keep it under 2 sentences, mention their recent AI post, ask about their roadmap..."></textarea>
        </div>
        <button class="lia-btn-primary" id="lia-msgtab-generate" style="width:100%;margin-bottom:4px">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
          ${intent === 'job_search' ? 'Generate Outreach Message' : 'Generate First Message'}
        </button>
        <div id="lia-msgtab-result" style="display:none;margin-top:10px"></div>`;

      body.querySelectorAll('.lia-tone-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          msgSelectedTone = btn.dataset.tone;
          body.querySelectorAll('#lia-msgtab-tone .lia-tone-btn').forEach(b => b.classList.toggle('active', b.dataset.tone === msgSelectedTone));
        });
      });

      function renderMsgTabResult(text) {
        const resultDiv = body.querySelector('#lia-msgtab-result');
        if (!resultDiv) return;
        msgCurrentText = text;
        resultDiv.innerHTML = `
          <div class="lia-connection-box" style="margin-bottom:8px">
            <p id="lia-msgtab-text">${escHtml(text)}</p>
          </div>
          <button class="lia-btn-primary lia-copy-btn" id="lia-msgtab-copy" style="margin-bottom:10px">Copy to Clipboard</button>
          <div class="lia-refine-section">
            <button class="lia-refine-toggle" id="lia-msgtab-refine-toggle">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Refine this message
              <svg class="lia-refine-arrow" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <div class="lia-refine-body" id="lia-msgtab-refine-body" style="display:none">
              <div class="lia-refine-group" style="margin-bottom:8px">
                <div class="lia-refine-label" style="margin-bottom:6px">Instructions</div>
                <textarea class="lia-notes-input" id="lia-msgtab-refine-instructions" rows="2" placeholder="e.g. Shorter, add a question, reference their fundraising..."></textarea>
              </div>
              <button class="lia-btn-primary" id="lia-msgtab-refine-btn" style="width:100%">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
                Refine with AI
              </button>
              <div id="lia-msgtab-refine-error" class="lia-error-msg" style="display:none;margin-top:6px"></div>
            </div>
          </div>`;
        resultDiv.style.display = '';

        resultDiv.querySelector('#lia-msgtab-copy')?.addEventListener('click', async () => {
          const btn = resultDiv.querySelector('#lia-msgtab-copy');
          await navigator.clipboard.writeText(msgCurrentText);
          btn.textContent = 'Copied!'; btn.classList.add('copied');
          setTimeout(() => { btn.textContent = 'Copy to Clipboard'; btn.classList.remove('copied'); }, 2000);
          advanceStage(currentProfileUrl, 'messaged');
        });

        const refToggle = resultDiv.querySelector('#lia-msgtab-refine-toggle');
        const refBody = resultDiv.querySelector('#lia-msgtab-refine-body');
        refToggle?.addEventListener('click', () => {
          const open = refBody.style.display !== 'none';
          refBody.style.display = open ? 'none' : 'block';
          refToggle.querySelector('.lia-refine-arrow').style.transform = open ? '' : 'rotate(180deg)';
        });

        resultDiv.querySelector('#lia-msgtab-refine-btn')?.addEventListener('click', async () => {
          const rb = resultDiv.querySelector('#lia-msgtab-refine-btn');
          const ed = resultDiv.querySelector('#lia-msgtab-refine-error');
          const instr = resultDiv.querySelector('#lia-msgtab-refine-instructions')?.value.trim() || '';
          rb.disabled = true;
          rb.innerHTML = `<svg width="13" height="13" class="lia-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refining...`;
          if (ed) ed.style.display = 'none';
          try {
            const res = await sendMessage('REFINE_MESSAGE', extractProfile(), { originalMessage: msgCurrentText, analysis, intent, tone: msgSelectedTone, instructions: instr });
            if (res.error) throw new Error(res.error);
            renderMsgTabResult(res.text || '');
          } catch (e) {
            if (ed) { ed.textContent = e.message; ed.style.display = ''; }
            rb.disabled = false;
            rb.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Refine with AI`;
          }
        });
      }

      body.querySelector('#lia-msgtab-generate')?.addEventListener('click', async () => {
        const genBtn = body.querySelector('#lia-msgtab-generate');
        const resultDiv = body.querySelector('#lia-msgtab-result');
        if (!genBtn || !resultDiv) return;
        const userInstructions = body.querySelector('#lia-msgtab-instructions')?.value.trim() || '';
        genBtn.disabled = true;
        genBtn.innerHTML = `<svg width="13" height="13" class="lia-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Writing...`;
        resultDiv.style.display = 'none';
        try {
          const result = await sendMessage('GENERATE_FIRST_MESSAGE', extractProfile(), { intent, analysis, tone: msgSelectedTone, userInstructions });
          if (result.error) throw new Error(result.error);
          renderMsgTabResult(result.text || '');
          genBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> Regenerate`;
          genBtn.disabled = false;
        } catch (err) {
          const msg = err.message === 'NO_API_KEY' ? 'No API key — open Settings.' : err.message;
          resultDiv.innerHTML = `<p class="lia-error-msg">${escHtml(msg)}</p>`; resultDiv.style.display = '';
          genBtn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg> ${intent === 'job_search' ? 'Generate Outreach Message' : 'Generate First Message'}`;
          genBtn.disabled = false;
        }
      });

    } else if (tab === 'connection') {
      if (!connectionRequest) {
        body.innerHTML = `
          <div class="lia-section">
            <p class="lia-error-msg">Couldn't generate a connection request for this profile — the analysis above is still good, this piece alone failed.</p>
            <button class="lia-btn-primary" id="lia-conn-retry-btn">Retry</button>
          </div>
        `;
        body.querySelector('#lia-conn-retry-btn').addEventListener('click', async () => {
          const btn = body.querySelector('#lia-conn-retry-btn');
          btn.textContent = 'Retrying...';
          btn.disabled = true;
          try {
            const profileData = extractProfile();
            const result = await sendMessage('GENERATE_CONNECTION_REQUEST', profileData, { intent });
            if (result.error) throw new Error(result.error);
            body._rendered.connectionRequest = result.text;
            const stored = await dbGet(currentProfileUrl).catch(() => null);
            if (stored) await dbPut(currentProfileUrl, { ...stored, connectionRequest: result.text }).catch(() => {});
            renderTabContent(analysis, result.text, 'connection', intent);
          } catch (e) {
            btn.textContent = e.message || 'Error — try again';
            btn.disabled = false;
          }
        });
        return;
      }
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
      if (pipelinesResult.error === 'PRO_REQUIRED') {
        document.querySelector('.lia-hs-modal-body').innerHTML = `
          <div style="text-align:center;padding:28px 16px;">
            <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="1.5" style="margin-bottom:12px;filter:drop-shadow(0 0 10px rgba(167,139,250,0.4))"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:8px;">Pro Feature</div>
            <div style="font-size:13px;color:rgba(196,181,253,0.7);margin-bottom:20px;">HubSpot CRM integration is available on the Pro plan.</div>
            <button class="lia-btn-primary" id="lia-hs-upgrade-btn" style="width:100%">Upgrade to Pro</button>
          </div>
        `;
        document.getElementById('lia-hs-upgrade-btn').addEventListener('click', () => {
          const btn = document.getElementById('lia-hs-upgrade-btn');
          btn.disabled = true;
          btn.textContent = 'Opening checkout…';
          chrome.runtime.sendMessage({ type: 'START_CHECKOUT' }, res => {
            if (chrome.runtime.lastError || !res?.url) {
              btn.disabled = false;
              btn.textContent = 'Upgrade to Pro';
              return;
            }
            chrome.runtime.sendMessage({ type: 'OPEN_TAB', url: res.url });
          });
        });
        return;
      }
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
        analysis: rendered?.analysis,
        intent: rendered?.intent,
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

    const mutualMatch = document.body.innerText.match(/([0-9,]+)\s+mutual connection/i);
    if (mutualMatch) profile.mutualConnections = mutualMatch[1];

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

  async function checkGoogleAuth() {
    try {
      const r = await chrome.storage.local.get('googleUser');
      return !!r.googleUser;
    } catch {
      return false;
    }
  }

  function renderSignInRequired() {
    const body = document.getElementById('lia-body');
    if (!body) return;
    const tabs = panel?.querySelector('.lia-tabs');
    if (tabs) tabs.style.display = 'none';
    body.innerHTML = `
      <div class="lia-sign-gate">
        <div class="lia-sign-gate-icon">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
        </div>
        <div class="lia-sign-gate-title">Sign in Required</div>
        <div class="lia-sign-gate-desc">Connect your Google account to unlock AI-powered LinkedIn intelligence.</div>
        <button class="lia-sign-gate-btn" id="lia-gate-signin">
          <svg width="16" height="16" viewBox="0 0 24 24" style="flex-shrink:0">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"/>
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Sign in with Google
        </button>
        <div class="lia-sign-gate-footer">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
          Secured by Satyron Private Limited
        </div>
      </div>
    `;
    body.querySelector('#lia-gate-signin').addEventListener('click', async function() {
      this.textContent = 'Signing in…';
      this.disabled = true;
      const res = await chrome.runtime.sendMessage({ type: 'GOOGLE_SIGN_IN' });
      if (res?.success) {
        this.textContent = '✓ Signed in! Click ANALYZE to continue.';
        this.style.background = '#f0fdf4';
        this.style.color = '#16a34a';
        this.style.borderColor = '#bbf7d0';
      } else {
        this.textContent = 'Try again';
        this.disabled = false;
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

  // Resets page-bound panel state on navigation. Deliberately leaves triggerBtn/postBtn/
  // timeBtn alone — the dock buttons are meant to persist across SPA navigation (they live
  // directly on document.body, which LinkedIn's re-renders never touch), only their panels
  // (tied to whatever profile/context was open) get torn down and rebuilt fresh next click.
  function resetUI() {
    if (panel) { panel.remove(); panel = null; }
    if (postPanel) { postPanel.remove(); postPanel = null; }
    activeTab = 'analysis';
    pcTopics = []; pcSelected = null; pcResult = null; pcImageB64 = null; pcMode = 'personal';
  }

  function removeAll() {
    removeSearchUI();
    removeMessagingUI();
    resetUI();
  }

  // ─── Boot ─────────────────────────────────────────────────────────────────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
