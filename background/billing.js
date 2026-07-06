import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Check limit AND record usage atomically. Returns { allowed, limit, used } or { allowed: true } on error (fail open).
export async function checkAndTrackUsage(eventType, metadata = {}) {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof authResult === 'string' ? authResult : authResult?.token;
    if (!token) return { allowed: true };
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/track-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ googleToken: token, eventType, metadata }),
    });
    if (!resp.ok) return { allowed: true };
    return await resp.json();
  } catch (_) {
    return { allowed: true };
  }
}

export async function handleStartCheckout() {
  const authResult = await chrome.identity.getAuthToken({ interactive: true });
  const token = typeof authResult === 'string' ? authResult : authResult?.token;
  if (!token) throw new Error('Sign in first to upgrade.');

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-checkout`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ googleToken: token }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Checkout failed.');
  return { url: data.url };
}
