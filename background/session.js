// Who is signed in, for calls to LinkPilot's own server. Two ways in, one account:
//   - Google (chrome.identity) → { googleToken }
//   - Email + password (Supabase Auth) → { accessToken }, refreshed automatically
// The server resolves both to the same account (supabase/functions/_shared/identity.ts).
// Passwords are only ever typed into extension pages (popup, Settings) — never into the LinkedIn
// panel, where LinkedIn's own scripts could read the field.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const AUTH_URL = `${SUPABASE_URL}/auth/v1`;
const AUTH_HEADERS = { 'Content-Type': 'application/json', apikey: SUPABASE_ANON_KEY };

async function authRequest(path, body, extraHeaders = {}) {
  const resp = await fetch(`${AUTH_URL}${path}`, { method: 'POST', headers: { ...AUTH_HEADERS, ...extraHeaders }, body: JSON.stringify(body) });
  let data = {};
  try { data = await resp.json(); } catch (_) { /* empty body */ }
  return { ok: resp.ok, status: resp.status, data };
}

// Supabase Auth error → a sentence a user can act on.
function friendlyAuthError(data) {
  const raw = String(data?.error_description || data?.msg || data?.message || data?.error || '').toLowerCase();
  if (raw.includes('invalid login')) return 'That email and password don’t match. Check them, or reset your password.';
  if (raw.includes('email not confirmed')) return 'Confirm your email first — open the link we sent you, then sign in.';
  if (raw.includes('already registered') || raw.includes('already been registered')) return 'This email already has a password. Sign in instead, or reset the password.';
  if (raw.includes('password') && (raw.includes('least') || raw.includes('weak') || raw.includes('short'))) return 'Choose a longer password (at least 8 characters).';
  if (raw.includes('rate limit')) return 'Too many attempts. Wait a minute and try again.';
  return 'Sign-in failed. Check your connection and try again.';
}

async function storeSession(data) {
  const authSession = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    email: data.user?.email || '',
  };
  await chrome.storage.local.set({ authSession });
  return authSession;
}

async function refreshSession(refreshToken) {
  const r = await authRequest('/token?grant_type=refresh_token', { refresh_token: refreshToken });
  if (!r.ok || !r.data?.access_token) {
    // Only a definite rejection signs the user out; a network blip keeps the session for next time.
    if (r.status === 400 || r.status === 401) await chrome.storage.local.remove('authSession');
    return null;
  }
  return storeSession(r.data);
}

// The credential to send with every server call, or null when nobody is signed in.
export async function getCredential() {
  const { authSession } = await chrome.storage.local.get('authSession');
  if (authSession?.refresh_token) {
    if (Date.now() / 1000 < (authSession.expires_at || 0) - 60) return { accessToken: authSession.access_token };
    try {
      const fresh = await refreshSession(authSession.refresh_token);
      return fresh ? { accessToken: fresh.access_token } : null;
    } catch (_) { return null; }
  }
  try {
    const result = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof result === 'string' ? result : result?.token;
    return token ? { googleToken: token } : null;
  } catch (_) {
    return null;
  }
}

export async function passwordSignIn(email, password) {
  const r = await authRequest('/token?grant_type=password', { email: String(email || '').trim(), password: String(password || '') });
  if (!r.ok || !r.data?.access_token) return { ok: false, error: friendlyAuthError(r.data) };
  await storeSession(r.data);
  return { ok: true, user: r.data.user };
}

// Creates the password login. Supabase emails a confirmation link; the account (and, for an email
// already used with Google, the link to that same account) only works after it's confirmed.
export async function passwordSignUp(email, password, name = '') {
  if (String(password || '').length < 8) return { ok: false, error: 'Choose a longer password (at least 8 characters).' };
  const r = await authRequest('/signup', { email: String(email || '').trim(), password: String(password), data: name ? { name } : {} });
  if (!r.ok) return { ok: false, error: friendlyAuthError(r.data) };
  // With email confirmation on (Supabase's default) there's no session until the link is opened.
  if (r.data?.access_token) { await storeSession(r.data); return { ok: true, signedIn: true }; }
  // Supabase returns a user with no identities when the email is already registered with a password.
  if (Array.isArray(r.data?.identities) && r.data.identities.length === 0) {
    return { ok: false, error: 'This email already has a password. Sign in instead, or reset the password.' };
  }
  return { ok: true, needsConfirmation: true };
}

export async function sendPasswordReset(email) {
  const r = await authRequest('/recover', { email: String(email || '').trim() });
  // Same answer whether or not the email exists, so this can't be used to probe for accounts.
  return r.ok || r.status === 400 ? { ok: true } : { ok: false, error: friendlyAuthError(r.data) };
}

export async function passwordSignOut() {
  const { authSession } = await chrome.storage.local.get('authSession');
  if (authSession?.access_token) {
    try { await authRequest('/logout', {}, { Authorization: `Bearer ${authSession.access_token}` }); } catch (_) { /* best effort */ }
  }
  await chrome.storage.local.remove('authSession');
}
