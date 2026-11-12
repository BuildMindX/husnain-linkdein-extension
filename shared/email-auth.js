// Email + password sign-in UI, shared by the popup and the Settings page (extension pages only —
// a password field must never be injected into linkedin.com, where the page's scripts could read
// it). The actual auth calls run in the background worker (background/session.js).
(function () {
  const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  // UNKNOWN_TYPE = the background worker is still running a version from before email sign-in
  // existed (Chrome only swaps it on reload / update).
  const STALE = 'LinkPilot was just updated. Reload it in chrome://extensions (or restart Chrome), then try again.';
  const send = msg => new Promise(resolve => chrome.runtime.sendMessage(msg, r => {
    if (chrome.runtime.lastError) { resolve({ error: chrome.runtime.lastError.message }); return; }
    resolve(r?.error === 'UNKNOWN_TYPE' ? { ...r, error: STALE } : r);
  }));

  // mount(container, { onSignedIn(response), idPrefix }) — sign in / create account / reset password.
  function mount(container, { onSignedIn, idPrefix = 'lp-auth' } = {}) {
    let mode = 'signin';
    const id = s => `${idPrefix}-${s}`;
    function render(note) {
      const title = { signin: 'Sign in with email', signup: 'Create an account', reset: 'Reset your password' }[mode];
      container.innerHTML = `
        <form class="lp-auth" id="${id('form')}" novalidate>
          <div class="lp-auth-title">${title}</div>
          ${mode === 'signup' ? `<label class="lp-auth-field"><span>Name</span><input type="text" id="${id('name')}" autocomplete="name"></label>` : ''}
          <label class="lp-auth-field"><span>Email</span><input type="email" id="${id('email')}" autocomplete="email" required></label>
          ${mode !== 'reset' ? `<label class="lp-auth-field"><span>Password</span><input type="password" id="${id('password')}" autocomplete="${mode === 'signup' ? 'new-password' : 'current-password'}" minlength="8" required></label>` : ''}
          <button type="submit" class="lp-auth-submit" id="${id('submit')}">${{ signin: 'Sign in', signup: 'Create account', reset: 'Send reset link' }[mode]}</button>
          <p class="lp-auth-status" id="${id('status')}" role="status" aria-live="polite">${note ? esc(note) : ''}</p>
          <div class="lp-auth-links">
            ${mode !== 'signin' ? `<button type="button" data-mode="signin">Sign in instead</button>` : `<button type="button" data-mode="signup">Create an account</button>`}
            ${mode !== 'reset' ? `<button type="button" data-mode="reset">Forgot password?</button>` : ''}
          </div>
        </form>`;
      container.querySelectorAll('.lp-auth-links [data-mode]').forEach(b => b.addEventListener('click', () => { mode = b.dataset.mode; render(); }));
      container.querySelector('form').addEventListener('submit', onSubmit);
    }
    function setStatus(text, kind) {
      const el = container.querySelector('.lp-auth-status');
      if (el) { el.textContent = text; el.dataset.kind = kind || ''; }
    }
    async function onSubmit(e) {
      e.preventDefault();
      const email = container.querySelector(`#${id('email')}`).value.trim();
      const password = container.querySelector(`#${id('password')}`)?.value || '';
      const name = container.querySelector(`#${id('name')}`)?.value.trim() || '';
      if (!/^\S+@\S+\.\S+$/.test(email)) { setStatus('Enter a valid email address.', 'error'); return; }
      if (mode !== 'reset' && password.length < 8) { setStatus('Passwords need at least 8 characters.', 'error'); return; }
      const btn = container.querySelector(`#${id('submit')}`);
      btn.disabled = true;
      if (mode === 'signin') {
        setStatus('Signing in…');
        const r = await send({ type: 'EMAIL_SIGN_IN', email, password });
        btn.disabled = false;
        if (r?.success) { setStatus('Signed in.', 'success'); onSignedIn?.(r); return; }
        setStatus(r?.error || 'Sign-in failed.', 'error');
      } else if (mode === 'signup') {
        setStatus('Creating your account…');
        const r = await send({ type: 'EMAIL_SIGN_UP', email, password, name });
        btn.disabled = false;
        if (r?.ok && r.needsConfirmation) { mode = 'signin'; render(`Check ${email} for a confirmation link, then sign in here. If this email already has a LinkPilot account (for example through Google), it becomes the same account.`); return; }
        if (r?.ok) { const s = await send({ type: 'EMAIL_SIGN_IN', email, password }); if (s?.success) { onSignedIn?.(s); return; } }
        setStatus(r?.error || 'Could not create the account.', 'error');
      } else {
        setStatus('Sending…');
        await send({ type: 'PASSWORD_RESET', email });
        btn.disabled = false;
        mode = 'signin';
        render(`If ${email} has a LinkPilot password, a reset link is on its way.`);
      }
    }
    render();
  }

  // For someone signed in with Google: add a password to the same account.
  function mountAddPassword(container, { email, idPrefix = 'lp-addpw' } = {}) {
    const id = s => `${idPrefix}-${s}`;
    container.innerHTML = `
      <form class="lp-auth" id="${id('form')}" novalidate>
        <div class="lp-auth-title">Add a password</div>
        <p class="lp-auth-hint">Sign in with ${esc(email)} and a password as well as with Google. It's the same account: same plan, settings and pipeline.</p>
        <label class="lp-auth-field"><span>New password</span><input type="password" id="${id('password')}" autocomplete="new-password" minlength="8" required></label>
        <label class="lp-auth-field"><span>Confirm password</span><input type="password" id="${id('confirm')}" autocomplete="new-password" minlength="8" required></label>
        <button type="submit" class="lp-auth-submit" id="${id('submit')}">Add password</button>
        <p class="lp-auth-status" id="${id('status')}" role="status" aria-live="polite"></p>
      </form>`;
    const status = (t, k) => { const el = container.querySelector('.lp-auth-status'); el.textContent = t; el.dataset.kind = k || ''; };
    container.querySelector('form').addEventListener('submit', async e => {
      e.preventDefault();
      const pw = container.querySelector(`#${id('password')}`).value;
      const confirm = container.querySelector(`#${id('confirm')}`).value;
      if (pw.length < 8) { status('Passwords need at least 8 characters.', 'error'); return; }
      if (pw !== confirm) { status('The two passwords don’t match.', 'error'); return; }
      const btn = container.querySelector(`#${id('submit')}`);
      btn.disabled = true; status('Saving…');
      const r = await send({ type: 'ADD_PASSWORD', password: pw });
      btn.disabled = false;
      if (r?.ok) { container.querySelector('form').reset(); status(`Almost done: open the confirmation link sent to ${email}. After that you can sign in with your email and this password.`, 'success'); }
      else status(r?.error || 'Could not add a password.', 'error');
    });
  }

  globalThis.LPEmailAuth = { mount, mountAddPassword };
})();
