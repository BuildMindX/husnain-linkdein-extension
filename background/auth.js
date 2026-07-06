import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export async function handleGoogleSignIn() {
  const authResult = await chrome.identity.getAuthToken({ interactive: true });
  const token = typeof authResult === 'string' ? authResult : authResult?.token;
  if (!token) throw new Error('Authentication cancelled.');

  const resp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) throw new Error('Failed to fetch Google profile.');
  const googleUser = await resp.json();

  let plan = 'free';
  let supabaseUserId = null;
  try {
    const syncResp = await fetch(`${SUPABASE_URL}/functions/v1/sync-user`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ googleToken: token }),
    });
    if (syncResp.ok) {
      const { user: sbUser } = await syncResp.json();
      plan = sbUser?.plan || 'free';
      supabaseUserId = sbUser?.id || null;
    }
  } catch (_) { /* Supabase unavailable — continue offline */ }

  await chrome.storage.local.set({ googleUser, userPlan: plan, supabaseUserId });
  return { success: true, user: googleUser, plan };
}

export async function handleGoogleSignOut() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    const tokenResult = typeof authResult === 'string' ? authResult : authResult?.token;
    if (tokenResult) await chrome.identity.removeCachedAuthToken({ token: tokenResult });
  } catch (_) { /* token may already be expired */ }
  await chrome.storage.local.remove(['googleUser', 'userPlan', 'supabaseUserId']);
  return { success: true };
}
