// Outreach setup: the B2C / B2B toggle and the structured targeting forms.
//
// Forms are declared as data (FORMS below) and rendered by a small field engine, so the two modes
// share every control: chip groups, tag inputs, the searchable industry and location pickers,
// proof points, and one save bar per mode with an unsaved-changes state. Stored shapes, option
// lists and ids come from shared/schema.js + shared/taxonomy.js — never duplicated here.
(function () {
  const S = globalThis.LP_SCHEMA;
  const T = globalThis.LP_TAXONOMY;
  const root = document.getElementById('setup-root');
  if (!root || !S || !T) return;

  const KEYS = {
    b2c_sales: { list: 'b2cProfiles', active: 'activeB2cProfileId', presets: 'b2cMessagePresets', make: S.emptyB2cProfile },
    b2b_sales: { list: 'icpProfiles', active: 'activeIcpProfileId', presets: 'messagePresets', make: S.emptyB2bProfile },
  };

  const state = { intent: S.DEFAULT_INTENT, lists: {}, activeIds: {}, presets: {}, draft: null, draftPresets: null, dirty: false };

  // ── Form definitions ─────────────────────────────────────────────────────────
  const O = S.OPTIONS;
  const proofHint = 'A real result with a number beats an adjective. Used lightly, never as a brag.';
  const SKIP_SECTION = {
    id: 'skip', title: 'Skip these', desc: 'People who match any of these score as a poor fit, so you don’t spend invites on them.',
    fields: [
      { type: 'industry', path: 'profile.icp.excludeIndustries', custom: 'profile.icp.customExcludes', label: 'Industries to skip' },
      { type: 'chips', path: 'profile.icp.excludeCompanyTypes', options: O.excludeCompanyTypes, label: 'Company types to skip' },
      { type: 'tags', path: 'profile.icp.excludeRoles', label: 'Roles to skip', placeholder: 'e.g. Student, Intern, Sales rep — press Enter', max: 20 },
      { type: 'tags', path: 'profile.icp.excludeCompanies', label: 'Specific companies to skip', hint: 'competitors, current employer, existing clients', placeholder: 'Company name — press Enter', max: 50 },
    ],
  };
  const styleSection = intent => ({
    id: 'style', title: 'Message style', desc: 'Messages are always kept short: LinkedIn’s own data shows notes under 400 characters get 22% more replies.',
    fields: [
      { type: 'chips', single: true, path: 'presets.tone', options: O.tones, label: 'Tone' },
      { type: 'select', path: 'presets.ending', options: O.endings[intent], label: 'How messages should end', hint: 'an interest question beats asking for a call on a first touch', noBlank: true },
    ],
  });

  const FORMS = {
    b2c_sales: [
      {
        id: 'seeking', title: 'What you’re looking for', desc: 'Decides how LinkPilot frames your outreach: a job, a project, or a seat on a team.',
        fields: [
          { type: 'chips', path: 'profile.seeking.workTypes', options: O.workTypes, label: 'Type of work', required: true },
          { type: 'tags', path: 'profile.seeking.roles', label: 'Target roles', placeholder: 'e.g. ML Engineer — press Enter', max: 5, required: true },
          { type: 'select', path: 'profile.seeking.level', options: O.experience, label: 'Experience level' },
        ],
      },
      {
        id: 'pitch', title: 'Your pitch', desc: 'Only what’s here is ever used to describe you. Nothing is invented.',
        fields: [
          { type: 'row', fields: [
            { type: 'text', path: 'profile.pitch.senderName', label: 'Your first name' },
            { type: 'text', path: 'profile.pitch.currentTitle', label: 'Current or target title', placeholder: 'e.g. Senior AI Engineer' },
          ] },
          { type: 'text', path: 'profile.pitch.represents', label: 'Representing a team instead of yourself?', placeholder: 'e.g. Satyron’s senior engineers, for staff augmentation and contract roles', optional: true, hint: 'leave empty if you’re finding work for yourself. Filled in, messages speak as you presenting the team’s engineers' },
          { type: 'text', path: 'profile.pitch.oneLiner', label: 'You in one line', placeholder: 'I’m a [role] who [does what] for [whom]', maxLength: 180, required: true },
          { type: 'tags', path: 'profile.pitch.skills', label: 'Top skills', placeholder: 'e.g. LLM agents, RAG, React — press Enter', max: 15, required: true },
          { type: 'textarea', path: 'profile.pitch.services', label: 'What you can do for a team or client', placeholder: 'e.g. Ship an MVP in 6 weeks, build agent pipelines, take over a backlog', optional: true },
          { type: 'proofs', path: 'profile.pitch.proofPoints', label: 'Proof points', hint: proofHint },
          { type: 'textarea', path: 'profile.pitch.background', label: 'Background', placeholder: '1–3 sentences on your experience', optional: true },
          { type: 'text', path: 'profile.pitch.portfolio', label: 'Portfolio or work link', placeholder: 'https://…', optional: true, hint: 'only shared in follow-ups, never in a first message' },
          { type: 'text', path: 'profile.pitch.location', label: 'Where you’re based and overlap hours', placeholder: 'e.g. Lahore, Pakistan. 4 hours overlap with US Eastern', optional: true, hint: 'said once, to people hiring for remote work' },
          { type: 'text', path: 'profile.pitch.rate', label: 'Your rate', placeholder: 'e.g. $40–60/hr, or fixed price once scope is clear', optional: true, hint: 'only used when someone asks, never in a first message' },
        ],
      },
      {
        id: 'who', title: 'Who can hire you', desc: 'Used to score every profile you open. The more specific, the fewer wasted invites.',
        fields: [
          { type: 'chips', path: 'profile.icp.hirerTypes', options: O.hirerTypes, label: 'People to reach', required: true },
          { type: 'industry', path: 'profile.icp.industries', custom: 'profile.icp.customIndustries', label: 'Industries' },
          { type: 'location', label: 'Locations' },
          { type: 'chips', path: 'profile.icp.headcount', options: T.headcount, label: 'Company size (employees)' },
          { type: 'chips', path: 'profile.icp.signals', options: O.b2cSignals, label: 'Prioritise people who…' },
          { type: 'textarea', path: 'profile.icp.idealCustomer', label: 'Anyone else, in your own words', placeholder: 'e.g. Seed-stage founders in Europe building AI products without a full-time ML engineer', optional: true },
        ],
      },
      SKIP_SECTION,
      styleSection('b2c_sales'),
      {
        id: 'notes', title: 'Anything else the AI should know', desc: 'Context that doesn’t fit above, such as a niche, a language you work in, or something to avoid.',
        fields: [{ type: 'textarea', path: 'profile.pitch.notes', label: 'Notes', rows: 3, optional: true }],
      },
    ],

    b2b_sales: [
      {
        id: 'offer', title: 'What you offer', desc: 'The only source LinkPilot uses when a message mentions your business.',
        fields: [
          { type: 'row', fields: [
            { type: 'text', path: 'profile.businessProfile.senderName', label: 'Your first name' },
            { type: 'text', path: 'profile.businessProfile.senderRole', label: 'Your role', placeholder: 'e.g. Business Development', optional: true },
          ] },
          { type: 'text', path: 'profile.businessProfile.companyName', label: 'Company name', required: true },
          { type: 'text', path: 'profile.businessProfile.offer', label: 'Your offer in one line', placeholder: 'We help [who] [get outcome] by [how]', maxLength: 220, required: true },
          { type: 'chips', path: 'profile.businessProfile.problems', options: O.problems, label: 'Problems you solve', hint: 'pick up to 3', max: 3, required: true },
          { type: 'textarea', path: 'profile.businessProfile.problem', label: 'The problem, in your words', placeholder: 'e.g. Teams that tried AI agents and hit reliability problems in production', optional: true },
          { type: 'proofs', path: 'profile.businessProfile.proofPoints', label: 'Proof points', hint: proofHint },
          { type: 'textarea', path: 'profile.businessProfile.expertise', label: 'What your team works with', placeholder: 'e.g. LLM agents, RAG, Next.js, React Native, n8n', optional: true },
          { type: 'textarea', path: 'profile.businessProfile.serviceMap', label: 'Which service fits which situation', rows: 4, placeholder: 'One per line, e.g.\nHiring developers = dedicated engineers\nManual, repetitive work = AI automation\nLaunching an MVP = full stack web and mobile', optional: true, hint: 'each message picks the ONE service that fits what it found on the profile' },
          { type: 'textarea', path: 'profile.businessProfile.trust', label: 'Why clients trust you', placeholder: 'e.g. You own the code and repo from day one. 4 hours overlap with US Eastern. Senior engineers only.', optional: true, hint: 'used from the second message on, never invented' },
          { type: 'text', path: 'profile.businessProfile.pricing', label: 'Typical price range', placeholder: 'e.g. Most projects $8k–30k, smallest engagement $3k', optional: true, hint: 'only used when someone asks what you charge' },
        ],
      },
      {
        id: 'target', title: 'Who you target', desc: 'Used to score every profile you open. Firmographics set the boundary; titles and the description sharpen it.',
        fields: [
          { type: 'industry', path: 'profile.icp.industries', custom: 'profile.icp.customIndustries', label: 'Target industries', required: true },
          { type: 'location', label: 'Locations' },
          { type: 'chips', path: 'profile.icp.headcount', options: T.headcount, label: 'Company size (employees)' },
          { type: 'chips', path: 'profile.icp.seniority', options: T.seniority, label: 'Seniority' },
          { type: 'chips', path: 'profile.icp.functions', options: T.functions, label: 'Department', collapsible: true },
          { type: 'tags', path: 'profile.icp.titles', label: 'Example job titles', placeholder: 'e.g. Head of Operations — press Enter', max: 15 },
          { type: 'textarea', path: 'profile.icp.idealCustomer', label: 'Your ideal customer, in your own words', placeholder: 'e.g. Series A–C SaaS companies moving core workflows onto AI agents', optional: true },
        ],
      },
      {
        id: 'signals', title: 'Why now', desc: 'Timing signals LinkPilot looks for in a profile. Only ones visible on LinkedIn are offered.',
        fields: [{ type: 'chips', path: 'profile.icp.signals', options: O.b2bSignals, label: 'Prioritise people who…' }],
      },
      SKIP_SECTION,
      styleSection('b2b_sales'),
      {
        id: 'notes', title: 'Anything else the AI should know', desc: 'Context that doesn’t fit above, such as a niche, regulations, or words to avoid.',
        fields: [{ type: 'textarea', path: 'profile.businessProfile.notes', label: 'Notes', rows: 3, optional: true }],
      },
    ],
  };

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const clone = o => JSON.parse(JSON.stringify(o));
  let uid = 0; const nextId = p => `${p}-${++uid}`;
  function bag() { return { profile: state.draft, presets: state.draftPresets }; }
  function getPath(path) { return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), bag()); }
  function setPath(path, value) {
    const keys = path.split('.'); let o = bag();
    keys.slice(0, -1).forEach(k => { if (o[k] == null || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
    o[keys[keys.length - 1]] = value;
    markDirty();
  }
  function markDirty() {
    state.dirty = true;
    const bar = root.querySelector('.save-bar');
    if (bar) { bar.classList.add('is-dirty'); bar.querySelector('.save-state').textContent = 'Unsaved changes'; }
  }

  // ── Load / save ──────────────────────────────────────────────────────────────
  async function load() {
    await S.migrate();
    const keys = ['analysisIntent', ...Object.values(KEYS).flatMap(k => [k.list, k.active, k.presets])];
    const r = await chrome.storage.local.get(keys);
    state.intent = S.normalizeIntent(r.analysisIntent);
    for (const [intent, k] of Object.entries(KEYS)) {
      state.lists[intent] = Array.isArray(r[k.list]) && r[k.list].length ? r[k.list] : [k.make('Default')];
      state.activeIds[intent] = state.lists[intent].some(p => p.id === r[k.active]) ? r[k.active] : state.lists[intent][0].id;
      state.presets[intent] = S.sanitizePresets(r[k.presets], intent);
    }
    startDraft();
    render();
    syncOnboardingCards();
  }

  function activeProfile(intent = state.intent) {
    return state.lists[intent].find(p => p.id === state.activeIds[intent]) || state.lists[intent][0];
  }
  function startDraft() {
    const base = state.intent === 'b2b_sales' ? S.emptyB2bProfile() : S.emptyB2cProfile();
    const p = clone(activeProfile());
    // Fill any missing keys from the empty shape so every field has somewhere to write.
    state.draft = { ...base, ...p, icp: { ...base.icp, ...(p.icp || {}) } };
    if (state.intent === 'b2b_sales') state.draft.businessProfile = { ...base.businessProfile, ...(p.businessProfile || {}) };
    else { state.draft.seeking = { ...base.seeking, ...(p.seeking || {}) }; state.draft.pitch = { ...base.pitch, ...(p.pitch || {}) }; }
    state.draftPresets = clone(state.presets[state.intent]);
    state.dirty = false;
  }

  async function save() {
    const k = KEYS[state.intent];
    const sanitize = state.intent === 'b2b_sales' ? S.sanitizeB2bProfile : S.sanitizeB2cProfile;
    const senderName = state.intent === 'b2b_sales' ? state.draft.businessProfile.senderName : state.draft.pitch.senderName;
    const clean = state.intent === 'b2b_sales'
      ? sanitize(state.draft, (senderName || '').slice(0, 60), state.draft.businessProfile.senderRole || '')
      : sanitize(state.draft, (senderName || '').slice(0, 60));
    clean.id = state.draft.id; clean.name = state.draft.name;
    state.lists[state.intent] = state.lists[state.intent].map(p => (p.id === clean.id ? clean : p));
    state.presets[state.intent] = S.sanitizePresets(state.draftPresets, state.intent);
    await chrome.storage.local.set({
      [k.list]: state.lists[state.intent], [k.active]: state.activeIds[state.intent], [k.presets]: state.presets[state.intent],
    });
    state.dirty = false;
    const bar = root.querySelector('.save-bar');
    if (bar) { bar.classList.remove('is-dirty'); bar.querySelector('.save-state').textContent = 'Saved'; }
  }

  function confirmDiscard() {
    return !state.dirty || confirm('You have unsaved changes. Discard them?');
  }

  // ── Render ───────────────────────────────────────────────────────────────────
  function render() {
    const intent = state.intent;
    const list = state.lists[intent];
    const mode = S.MODES[intent];
    root.innerHTML = `
      <div class="card">
        <h3>Who is reaching out?</h3>
        <p class="card-desc">Pick the mode that matches this LinkedIn account. You can switch any time; each mode keeps its own setup.</p>
        <div class="mode-selector mode-selector--two" role="radiogroup" aria-label="Outreach mode">
          ${Object.entries(S.MODES).map(([id, m]) => `
            <button type="button" class="mode-card${id === intent ? ' active' : ''}" role="radio" aria-checked="${id === intent}" data-intent="${id}">
              <span class="mode-card-icon">${id === 'b2c_sales'
                ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>'
                : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/></svg>'}</span>
              <span class="mode-card-body">
                <span class="mode-card-name">${esc(m.long)}</span>
                <span class="mode-card-tagline">${esc(m.sub)}</span>
              </span>
              <span class="mode-card-check" aria-hidden="true"><svg width="11" height="11" viewBox="0 0 12 12" fill="none"><path d="M2 6.5l2.8 2.8 5-5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
            </button>`).join('')}
        </div>
      </div>

      <div class="card profile-bar">
        <div class="profile-bar-main">
          <label for="setup-profile-select">${intent === 'b2b_sales' ? 'Targeting profile' : 'Search profile'}</label>
          <select id="setup-profile-select" class="form-select">
            ${list.map(p => `<option value="${esc(p.id)}"${p.id === state.activeIds[intent] ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
          </select>
        </div>
        <div class="actions">
          <button type="button" class="btn-secondary" data-act="new">New</button>
          <button type="button" class="btn-secondary" data-act="rename">Rename</button>
          <button type="button" class="btn-secondary" data-act="delete"${list.length < 2 ? ' disabled title="You need at least one profile"' : ''}>Delete</button>
        </div>
        <p class="hint profile-bar-hint">${intent === 'b2b_sales'
          ? 'Selling to more than one kind of buyer? Keep a profile for each and switch here.'
          : 'Looking for more than one kind of work? Keep a profile for each and switch here.'}</p>
      </div>

      ${FORMS[intent].map(renderSection).join('')}

      <div class="save-bar" role="region" aria-label="Save">
        <span class="save-state" aria-live="polite">All changes saved</span>
        <button type="button" class="btn-primary" data-act="save">Save ${esc(mode.label)} setup</button>
      </div>`;
    wire();
  }

  function renderSection(sec) {
    const fields = sec.fields.map(renderField).join('');
    return `<section class="card setup-section" data-section="${sec.id}">
      <h3>${esc(sec.title)}</h3>
      ${sec.desc ? `<p class="card-desc">${esc(sec.desc)}</p>` : ''}
      ${fields}
    </section>`;
  }

  function labelHtml(f, forId) {
    const extra = f.optional ? ' <span class="optional">(optional)</span>' : f.hint ? ` <span class="label-hint">— ${esc(f.hint)}</span>` : '';
    const req = f.required ? ' <span class="req" title="Recommended">•</span>' : '';
    return forId ? `<label for="${forId}">${esc(f.label)}${req}${extra}</label>` : `<span class="field-label" id="${f._lid}">${esc(f.label)}${req}${extra}</span>`;
  }

  function renderField(f) {
    if (f.type === 'row') return `<div class="form-row">${f.fields.map(renderField).join('')}</div>`;
    const id = nextId('f'); f._lid = `${id}-l`;
    const v = f.path ? getPath(f.path) : undefined;
    switch (f.type) {
      case 'text':
        return `<div class="form-group">${labelHtml(f, id)}<input type="text" id="${id}" data-path="${f.path}" value="${esc(v || '')}" placeholder="${esc(f.placeholder || '')}"${f.maxLength ? ` maxlength="${f.maxLength}"` : ''}></div>`;
      case 'textarea':
        return `<div class="form-group">${labelHtml(f, id)}<textarea id="${id}" data-path="${f.path}" rows="${f.rows || 2}" placeholder="${esc(f.placeholder || '')}">${esc(v || '')}</textarea></div>`;
      case 'select':
        return `<div class="form-group">${labelHtml(f, id)}<select id="${id}" class="form-select" data-path="${f.path}">
          ${f.noBlank ? '' : `<option value="">Select…</option>`}
          ${f.options.map(o => `<option value="${esc(o.id)}"${o.id === v ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}
        </select></div>`;
      case 'chips': {
        const sel = f.single ? [v] : (v || []);
        const full = f.max && sel.length >= f.max;
        const chips = f.options.map(o => {
          const on = sel.includes(o.id);
          return `<button type="button" class="choice" aria-pressed="${on}" data-id="${esc(o.id)}"${!on && full ? ' disabled' : ''}>${esc(o.label)}</button>`;
        }).join('');
        const body = `<div class="choice-group" role="group" aria-labelledby="${f._lid}" data-path="${f.path}" data-single="${!!f.single}" data-max="${f.max || 0}">${chips}</div>`;
        if (f.collapsible) {
          return `<div class="form-group"><details class="choice-details"${sel.length ? ' open' : ''}><summary>${labelHtml(f)}<span class="choice-count">${sel.length ? `${sel.length} selected` : 'Any'}</span></summary>${body}</details></div>`;
        }
        return `<div class="form-group">${labelHtml(f)}${body}</div>`;
      }
      case 'tags':
        return `<div class="form-group">${labelHtml(f, id)}
          <div class="tag-input" data-tags-for="${id}">${(v || []).map((t, i) => tagChip(t, i)).join('')}</div>
          <input type="text" id="${id}" class="tag-text" data-tags="${f.path}" data-max="${f.max || 50}" placeholder="${esc(f.placeholder || 'Type and press Enter')}" autocomplete="off">
        </div>`;
      case 'proofs': {
        const arr = Array.isArray(v) ? v : ['', '', ''];
        return `<div class="form-group">${labelHtml(f)}<div class="proofs" role="group" aria-labelledby="${f._lid}">
          ${[0, 1, 2].map(i => `<input type="text" data-proof="${f.path}" data-idx="${i}" value="${esc(arr[i] || '')}" aria-label="Proof point ${i + 1}" placeholder="${i === 0 ? 'e.g. Cut no-shows 40% for a 12-clinic dental group' : i === 1 ? 'Another result (optional)' : 'And one more (optional)'}" maxlength="200">`).join('')}
        </div></div>`;
      }
      case 'industry':
        return pickerHtml({ f, kind: 'industry', id });
      case 'location':
        return pickerHtml({ f, kind: 'location', id });
      default: return '';
    }
  }
  const tagChip = (t, i) => `<span class="tag">${esc(t)}<button type="button" class="tag-remove" data-idx="${i}" aria-label="Remove ${esc(t)}">&times;</button></span>`;

  // ── Picker (industries: group › sub-segment, locations: region › country) ─────
  function pickerGroups(kind) {
    if (kind === 'industry') {
      return T.industries.map(g => ({
        key: g.id, label: g.label, search: [g.label, ...g.li].join(' ').toLowerCase(),
        items: g.sub.map(s => ({ key: `${g.id}/${s.id}`, label: s.label, search: [s.label, ...s.li].join(' ').toLowerCase() })),
      }));
    }
    return T.regions.map(r => ({
      key: `region:${r.id}`, label: r.label, search: r.label.toLowerCase(),
      items: r.countries.map(c => ({ key: c, label: c, search: [c, ...((T.countryAliases || {})[c] || [])].join(' ').toLowerCase() })),
    }));
  }
  function pickerSelection(kind, f) {
    if (kind === 'industry') return new Set(getPath(f.path) || []);
    return new Set([...(getPath('profile.icp.regions') || []).map(r => `region:${r}`), ...(getPath('profile.icp.countries') || [])]);
  }
  function pickerCustom(kind, f) { return kind === 'industry' && f.custom ? (getPath(f.custom) || []) : []; }
  function pickerWrite(kind, f, set, custom) {
    if (kind === 'industry') { setPath(f.path, [...set]); if (f.custom) setPath(f.custom, custom); return; }
    const all = [...set];
    setPath('profile.icp.regions', all.filter(k => k.startsWith('region:')).map(k => k.slice(7)));
    setPath('profile.icp.countries', all.filter(k => !k.startsWith('region:')));
  }
  function labelForKey(kind, key) {
    if (kind === 'industry') return S.industryLabel(key) || key;
    if (key.startsWith('region:')) return (T.regions.find(r => r.id === key.slice(7)) || {}).label || key;
    return key;
  }

  function pickerHtml({ f, kind, id }) {
    const total = kind === 'industry' ? `${T.industries.length} industries and ${T.industries.reduce((n, g) => n + g.sub.length, 0)} segments` : `${T.regions.length} regions and ${T.regions.reduce((n, r) => n + r.countries.length, 0)} countries`;
    return `<div class="form-group picker" data-kind="${kind}" data-fid="${id}">
      ${labelHtml(f)}
      <div class="picker-selected" aria-live="polite"></div>
      <button type="button" class="btn-secondary picker-toggle" aria-expanded="false" aria-controls="${id}-panel">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        ${kind === 'industry' ? 'Add industries' : 'Add locations'}
      </button>
      <div class="picker-panel" id="${id}-panel" hidden>
        <input type="search" class="picker-search" placeholder="Search ${total}" aria-label="Search ${kind === 'industry' ? 'industries' : 'locations'}">
        <div class="picker-list"></div>
        ${kind === 'industry' && f.custom ? '<button type="button" class="picker-custom" hidden></button>' : ''}
        <div class="picker-foot"><button type="button" class="btn-secondary picker-done">Done</button></div>
      </div>
    </div>`;
  }

  function mountPicker(el, f) {
    const kind = el.dataset.kind;
    const groups = pickerGroups(kind);
    const selectedEl = el.querySelector('.picker-selected');
    const listEl = el.querySelector('.picker-list');
    const search = el.querySelector('.picker-search');
    const panel = el.querySelector('.picker-panel');
    const toggle = el.querySelector('.picker-toggle');
    const customBtn = el.querySelector('.picker-custom');
    const expanded = new Set();

    const sel = () => pickerSelection(kind, f);
    function renderSelected() {
      const s = sel(); const custom = pickerCustom(kind, f);
      const chips = [...s].map(k => `<span class="tag${f.path?.includes('exclude') ? ' tag-exclude' : ''}">${esc(labelForKey(kind, k))}<button type="button" class="tag-remove" data-key="${esc(k)}" aria-label="Remove ${esc(labelForKey(kind, k))}">&times;</button></span>`)
        .concat(custom.map((c, i) => `<span class="tag tag-custom${f.path?.includes('exclude') ? ' tag-exclude' : ''}">${esc(c)}<button type="button" class="tag-remove" data-custom="${i}" aria-label="Remove ${esc(c)}">&times;</button></span>`));
      selectedEl.innerHTML = chips.length ? chips.join('') : `<span class="picker-empty">${kind === 'industry' ? 'Any industry' : 'Anywhere'}</span>`;
    }
    function renderList() {
      const q = search.value.trim().toLowerCase();
      // Match at word starts only, so "edtech" finds EdTech but not "MedTech".
      const re = q ? new RegExp(`(^|[^a-z0-9])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) : null;
      const hit = text => !re || re.test(text);
      const s = sel();
      const html = groups.map(g => {
        const gMatch = hit(g.search);
        const items = g.items.filter(it => !q || gMatch || hit(it.search));
        if (!gMatch && !items.length) return '';
        const open = expanded.has(g.key) || (q && !gMatch && items.length);
        const gOn = s.has(g.key);
        const nSel = g.items.filter(it => s.has(it.key)).length;
        return `<div class="picker-group">
          <div class="picker-group-head">
            <label class="picker-check"><input type="checkbox" data-key="${esc(g.key)}"${gOn ? ' checked' : ''}><span>${esc(g.label)}</span>${!gOn && nSel ? `<span class="picker-count">${nSel} selected</span>` : ''}</label>
            <button type="button" class="picker-expand" data-group="${esc(g.key)}" aria-expanded="${!!open}" aria-label="${open ? 'Hide' : 'Show'} ${esc(g.label)} options">
              ${g.items.length}<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>
            </button>
          </div>
          ${open ? `<div class="picker-items">${items.map(it => `<label class="picker-check picker-item"><input type="checkbox" data-key="${esc(it.key)}" data-parent="${esc(g.key)}"${gOn || s.has(it.key) ? ' checked' : ''}${gOn ? ' disabled' : ''}><span>${esc(it.label)}</span></label>`).join('')}</div>` : ''}
        </div>`;
      }).join('');
      listEl.innerHTML = html || '<p class="picker-none">No matches.</p>';
      if (customBtn) {
        const exists = pickerCustom(kind, f).some(c => c.toLowerCase() === q);
        customBtn.hidden = !q || exists;
        customBtn.textContent = q ? `Add “${search.value.trim()}” as your own` : '';
      }
    }
    function update(mutator) {
      const s = sel(); const custom = [...pickerCustom(kind, f)];
      mutator(s, custom);
      pickerWrite(kind, f, s, custom);
      renderSelected(); renderList();
    }

    listEl.addEventListener('change', e => {
      const cb = e.target.closest('input[type=checkbox]'); if (!cb) return;
      const key = cb.dataset.key; const parent = cb.dataset.parent;
      update(s => {
        if (cb.checked) {
          s.add(key);
          if (!parent) { const g = groups.find(x => x.key === key); g.items.forEach(it => s.delete(it.key)); } // a whole group supersedes its items
        } else s.delete(key);
      });
    });
    listEl.addEventListener('click', e => {
      const b = e.target.closest('.picker-expand'); if (!b) return;
      const k = b.dataset.group; expanded.has(k) ? expanded.delete(k) : expanded.add(k); renderList();
    });
    selectedEl.addEventListener('click', e => {
      const b = e.target.closest('.tag-remove'); if (!b) return;
      update((s, custom) => { if (b.dataset.key) s.delete(b.dataset.key); else custom.splice(+b.dataset.custom, 1); });
    });
    search.addEventListener('input', renderList);
    search.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); if (customBtn && !customBtn.hidden) customBtn.click(); } });
    customBtn?.addEventListener('click', () => {
      const v = search.value.trim().slice(0, 120); if (!v) return;
      update((s, custom) => { if (!custom.some(c => c.toLowerCase() === v.toLowerCase())) custom.push(v); });
      search.value = ''; renderList();
    });
    const setOpen = open => { panel.hidden = !open; toggle.setAttribute('aria-expanded', String(open)); if (open) { renderList(); search.focus(); } };
    toggle.addEventListener('click', () => setOpen(panel.hidden));
    el.querySelector('.picker-done').addEventListener('click', () => { setOpen(false); toggle.focus(); });
    panel.addEventListener('keydown', e => { if (e.key === 'Escape') { setOpen(false); toggle.focus(); } });
    renderSelected();
  }

  // ── Wiring ───────────────────────────────────────────────────────────────────
  function fieldDefs() {
    const out = [];
    const walk = fs => fs.forEach(f => (f.type === 'row' ? walk(f.fields) : out.push(f)));
    FORMS[state.intent].forEach(sec => walk(sec.fields));
    return out;
  }

  function wire() {
    root.querySelectorAll('.mode-selector--two .mode-card').forEach(btn => btn.addEventListener('click', () => switchMode(btn.dataset.intent)));

    root.querySelectorAll('[data-path]').forEach(el => {
      if (el.matches('input, textarea, select')) {
        el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => setPath(el.dataset.path, el.value));
      }
    });
    root.querySelectorAll('.choice-group').forEach(group => {
      group.addEventListener('click', e => {
        const b = e.target.closest('.choice'); if (!b || b.disabled) return;
        const path = group.dataset.path; const single = group.dataset.single === 'true'; const max = +group.dataset.max;
        if (single) { setPath(path, b.dataset.id); group.querySelectorAll('.choice').forEach(c => c.setAttribute('aria-pressed', String(c === b))); return; }
        const cur = new Set(getPath(path) || []);
        cur.has(b.dataset.id) ? cur.delete(b.dataset.id) : cur.add(b.dataset.id);
        setPath(path, [...cur]);
        b.setAttribute('aria-pressed', String(cur.has(b.dataset.id)));
        if (max) group.querySelectorAll('.choice').forEach(c => { c.disabled = cur.size >= max && c.getAttribute('aria-pressed') !== 'true'; });
        const count = group.closest('details')?.querySelector('.choice-count');
        if (count) count.textContent = cur.size ? `${cur.size} selected` : 'Any';
      });
    });
    root.querySelectorAll('input[data-tags]').forEach(input => {
      const path = input.dataset.tags; const max = +input.dataset.max;
      const box = root.querySelector(`[data-tags-for="${input.id}"]`);
      const redraw = () => { box.innerHTML = (getPath(path) || []).map((t, i) => tagChip(t, i)).join(''); };
      const add = () => {
        const parts = input.value.split(',').map(s => s.trim()).filter(Boolean); if (!parts.length) return;
        const cur = [...(getPath(path) || [])];
        parts.forEach(p => { if (cur.length < max && !cur.some(c => c.toLowerCase() === p.toLowerCase())) cur.push(p.slice(0, 120)); });
        setPath(path, cur); input.value = ''; redraw();
      };
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); add(); }
        else if (e.key === 'Backspace' && !input.value) { const cur = [...(getPath(path) || [])]; if (cur.length) { cur.pop(); setPath(path, cur); redraw(); } }
      });
      input.addEventListener('blur', add);
      box.addEventListener('click', e => {
        const b = e.target.closest('.tag-remove'); if (!b) return;
        const cur = [...(getPath(path) || [])]; cur.splice(+b.dataset.idx, 1); setPath(path, cur); redraw();
      });
    });
    root.querySelectorAll('input[data-proof]').forEach(input => input.addEventListener('input', () => {
      const arr = [...(getPath(input.dataset.proof) || ['', '', ''])]; while (arr.length < 3) arr.push('');
      arr[+input.dataset.idx] = input.value; setPath(input.dataset.proof, arr);
    }));
    const defs = fieldDefs().filter(f => f.type === 'industry' || f.type === 'location');
    root.querySelectorAll('.picker').forEach((el, i) => mountPicker(el, defs[i]));

    root.querySelector('#setup-profile-select').addEventListener('change', e => {
      if (!confirmDiscard()) { e.target.value = state.activeIds[state.intent]; return; }
      state.activeIds[state.intent] = e.target.value;
      chrome.storage.local.set({ [KEYS[state.intent].active]: e.target.value });
      startDraft(); render();
    });
    root.querySelector('[data-act="new"]').addEventListener('click', async () => {
      if (!confirmDiscard()) return;
      const name = (prompt('Name this profile (e.g. "Healthcare clients")') || '').trim().slice(0, 60);
      if (!name) return;
      const p = KEYS[state.intent].make(name);
      state.lists[state.intent] = [...state.lists[state.intent], p];
      state.activeIds[state.intent] = p.id;
      await chrome.storage.local.set({ [KEYS[state.intent].list]: state.lists[state.intent], [KEYS[state.intent].active]: p.id });
      startDraft(); render();
    });
    root.querySelector('[data-act="rename"]').addEventListener('click', async () => {
      const name = (prompt('Rename this profile', state.draft.name) || '').trim().slice(0, 60);
      if (!name) return;
      state.draft.name = name;
      state.lists[state.intent] = state.lists[state.intent].map(p => (p.id === state.draft.id ? { ...p, name } : p));
      await chrome.storage.local.set({ [KEYS[state.intent].list]: state.lists[state.intent] });
      const opt = root.querySelector(`#setup-profile-select option[value="${CSS.escape(state.draft.id)}"]`); if (opt) opt.textContent = name;
    });
    root.querySelector('[data-act="delete"]').addEventListener('click', async () => {
      if (state.lists[state.intent].length < 2) return;
      if (!confirm(`Delete the profile "${state.draft.name}"? This can't be undone.`)) return;
      state.lists[state.intent] = state.lists[state.intent].filter(p => p.id !== state.draft.id);
      state.activeIds[state.intent] = state.lists[state.intent][0].id;
      await chrome.storage.local.set({ [KEYS[state.intent].list]: state.lists[state.intent], [KEYS[state.intent].active]: state.activeIds[state.intent] });
      startDraft(); render();
    });
    root.querySelector('[data-act="save"]').addEventListener('click', save);
  }

  async function switchMode(intent) {
    intent = S.normalizeIntent(intent);
    if (intent === state.intent) return;
    if (!confirmDiscard()) return;
    state.intent = intent;
    await chrome.storage.local.set({ analysisIntent: intent });
    startDraft(); render(); syncOnboardingCards();
  }

  // Onboarding's mode step uses the same .mode-card markup; B2C is preselected.
  function syncOnboardingCards() {
    document.querySelectorAll('#ob-mode-selector .mode-card').forEach(c => {
      const on = c.dataset.intent === state.intent;
      c.classList.toggle('active', on); c.setAttribute('aria-checked', String(on));
    });
  }
  document.querySelectorAll('#ob-mode-selector .mode-card').forEach(c => c.addEventListener('click', async () => {
    state.intent = S.normalizeIntent(c.dataset.intent);
    await chrome.storage.local.set({ analysisIntent: state.intent });
    syncOnboardingCards(); startDraft(); render();
  }));

  window.addEventListener('beforeunload', e => { if (state.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // Another surface (panel / popup toggle, team import, cloud restore) changed the mode or profiles.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local' || state.dirty) return;
    const relevant = ['analysisIntent', ...Object.values(KEYS).flatMap(k => [k.list, k.active, k.presets])];
    if (relevant.some(k => k in changes)) load();
  });

  globalThis.LPSetup = { reload: load, save, get state() { return state; } };
  load();
})();
