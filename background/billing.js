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
    const data = await resp.json();
    // Cache usage count for popup display and fire upgrade notification if threshold crossed
    if (data.used !== undefined) {
      chrome.storage.local.get(['usageStats', 'usageNotified', 'userPlan'], r => {
        if (r.userPlan === 'pro') return;
        const stats = r.usageStats || {};
        stats[eventType] = data.used;
        chrome.storage.local.set({ usageStats: stats });
        maybeFireUsageNotification(eventType, data.used, r.usageNotified || {});
      });
    }
    return data;
  } catch (_) {
    return { allowed: true };
  }
}

const FREE_LIMIT = 50;
const NOTIFY_THRESHOLDS = [
  { key: 'warn80', count: 40, title: 'Running low on free analyses', body: 'You\'ve used 80% of your monthly free quota. Upgrade to Pro for unlimited access.' },
  { key: 'warn100', count: FREE_LIMIT, title: 'Monthly free quota reached', body: 'You\'ve hit the free tier limit. Upgrade to Pro to continue analyzing profiles.' },
];
const NOTIFY_COOLDOWN_MS = 25 * 24 * 60 * 60 * 1000; // 25 days — once per month

function maybeFireUsageNotification(eventType, used, notified) {
  for (const { key, count, title, body } of NOTIFY_THRESHOLDS) {
    if (used < count) continue;
    const notifKey = `${eventType}_${key}`;
    const lastFired = notified[notifKey] || 0;
    if (Date.now() - lastFired < NOTIFY_COOLDOWN_MS) continue;
    try {
      chrome.notifications.create(`lia-usage-${notifKey}`, {
        type: 'basic',
        iconUrl: chrome.runtime.getURL('assets/extension_icon.png'),
        title: `LinkPilot AI — ${title}`,
        message: body,
        priority: 1,
      });
    } catch (_) {}
    const updated = { ...notified, [notifKey]: Date.now() };
    chrome.storage.local.set({ usageNotified: updated });
    break;
  }
}

export async function handleOpenBillingPortal() {
  const authResult = await chrome.identity.getAuthToken({ interactive: false });
  const token = typeof authResult === 'string' ? authResult : authResult?.token;
  if (!token) throw new Error('Sign in first to manage your subscription.');

  const resp = await fetch(`${SUPABASE_URL}/functions/v1/create-portal-session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ googleToken: token }),
  });
  const data = await resp.json();
  if (!resp.ok || data.error) throw new Error(data.error || 'Could not open billing portal.');
  return { url: data.url };
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
