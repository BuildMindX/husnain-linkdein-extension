import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// Fire-and-forget — never blocks the main action
export async function trackUsage(eventType, metadata = {}) {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof authResult === 'string' ? authResult : authResult?.token;
    if (!token) return;
    fetch(`${SUPABASE_URL}/functions/v1/track-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ googleToken: token, eventType, metadata }),
    }).catch(() => {});
  } catch (_) {}
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
