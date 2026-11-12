import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

// ─── Plan + usage gate (server-decided) ─────────────────────────────────────────
// The server (track-usage / sync-user edge functions) verifies the Google token and reads the plan
// from the database — that is the only source of truth. The local userPlan value is for display
// only and is never trusted to unlock anything: it used to skip the server check entirely, so
// anyone could set it to "pro" in DevTools.
//
// When the server can't be reached (network error, 5xx, paused project) the old code allowed every
// request. Now: a Pro plan the server confirmed in the last 3 days keeps working, Free users get a
// small daily offline allowance, and after that the request is refused with a clear reason.
// "Not signed in" / "unknown user" (401/404) is never treated as an outage.
// Honest limit: with bring-your-own-key, AI calls go straight from the browser to Anthropic, so a
// user who edits the extension's own code can bypass any client gate. Real enforcement would need
// the AI calls routed through the server.
const PRO_GRACE_MS = 3 * 24 * 60 * 60 * 1000;
const PRO_CACHE_MS = 60 * 60 * 1000;
const OFFLINE_FREE_PER_DAY = 3;
const SERVER_TIMEOUT_MS = 10000;

async function getGoogleToken() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    return typeof authResult === 'string' ? authResult : authResult?.token || null;
  } catch (_) { return null; }
}

async function postFunction(name, body) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), SERVER_TIMEOUT_MS);
  try {
    return await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } finally { clearTimeout(t); }
}

// Record what the server said, for the offline grace window and for display.
async function recordVerifiedPlan(plan) {
  await chrome.storage.local.set({ verifiedPlan: plan, planVerifiedAt: Date.now(), userPlan: plan });
}

async function outageDecision() {
  const { verifiedPlan, planVerifiedAt, offlineUsage } = await chrome.storage.local.get(['verifiedPlan', 'planVerifiedAt', 'offlineUsage']);
  if (verifiedPlan === 'pro' && Date.now() - (planVerifiedAt || 0) < PRO_GRACE_MS) return { allowed: true, plan: 'pro', offline: true };
  const today = new Date().toISOString().slice(0, 10);
  const used = offlineUsage?.date === today ? offlineUsage.count : 0;
  if (used < OFFLINE_FREE_PER_DAY) {
    await chrome.storage.local.set({ offlineUsage: { date: today, count: used + 1 } });
    return { allowed: true, plan: 'free', offline: true };
  }
  return { allowed: false, error: 'SERVICE_UNAVAILABLE' };
}

// Check limit AND record usage atomically on the server. Returns { allowed, plan, limit, used } or
// { allowed: false, error }.
export async function checkAndTrackUsage(eventType, metadata = {}) {
  const token = await getGoogleToken();
  if (!token) return { allowed: false, error: 'SIGN_IN_REQUIRED' };
  let resp;
  try {
    resp = await postFunction('track-usage', { googleToken: token, eventType, metadata });
  } catch (_) {
    return outageDecision();
  }
  if (resp.status === 401 || resp.status === 404) return { allowed: false, error: 'SIGN_IN_REQUIRED' };
  if (!resp.ok) return outageDecision();
  let data;
  try { data = await resp.json(); } catch (_) { return outageDecision(); }
  if (data.plan === 'pro' || data.plan === 'free') await recordVerifiedPlan(data.plan);
  // Cache usage count for popup display and fire upgrade notification if threshold crossed
  if (data.used !== undefined && data.plan !== 'pro') {
    chrome.storage.local.get(['usageStats', 'usageNotified'], r => {
      const stats = r.usageStats || {};
      stats[eventType] = data.used;
      chrome.storage.local.set({ usageStats: stats });
      maybeFireUsageNotification(eventType, data.used, r.usageNotified || {});
    });
  }
  return data;
}

// Pro-only features (HubSpot). Uses a server confirmation from the last hour if there is one,
// otherwise asks the server (sync-user, which also applies plan expiry). During an outage, a Pro
// plan confirmed in the last 3 days still counts.
export async function verifyProPlan() {
  const { verifiedPlan, planVerifiedAt } = await chrome.storage.local.get(['verifiedPlan', 'planVerifiedAt']);
  if (verifiedPlan === 'pro' && Date.now() - (planVerifiedAt || 0) < PRO_CACHE_MS) return true;
  const token = await getGoogleToken();
  if (!token) return false;
  try {
    const resp = await postFunction('sync-user', { googleToken: token });
    if (resp.status === 401 || resp.status === 404) return false;
    if (!resp.ok) throw new Error('server');
    const { user } = await resp.json();
    const isPro = user?.plan === 'pro' && (!user.plan_expires_at || new Date(user.plan_expires_at) > new Date());
    await recordVerifiedPlan(isPro ? 'pro' : 'free');
    return isPro;
  } catch (_) {
    return verifiedPlan === 'pro' && Date.now() - (planVerifiedAt || 0) < PRO_GRACE_MS;
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
