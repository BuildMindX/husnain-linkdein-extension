import { handleGoogleSignIn, handleGoogleSignOut, SETTINGS_KEYS } from './auth.js';
import { checkAndTrackUsage, verifyProPlan, handleStartCheckout, handleOpenBillingPortal } from './billing.js';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
import {
  handleAnalyzeProfile,
  handleBulkScoreProfiles,
  handleGenerateConnectionRequest,
  handleGenerateFirstMessage,
  handleGenerateChatFollowup,
  handleRefineMessage,
  handleSuggestPostTopics,
  handleGeneratePost,
  ensureMigrated,
  resetMigration,
} from './ai.js';
import { fetchHubSpotPipelines, fetchHubSpotOwners, pushHubSpotDeal } from './hubspot.js';
import { checkFollowUpReminders, checkNewReplyNotifications, updateReminderBadge } from './reminders.js';

// Old three-mode settings (B2B / Freelance / Job Search, free-text industries) are converted to the
// two-mode structured schema the first time a worker starts — idempotent, so running it on every
// worker start is safe and also catches settings restored from an older cloud snapshot.
ensureMigrated();

async function pushSettingsToCloud(settings) {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    const token = typeof authResult === 'string' ? authResult : authResult?.token;
    if (!token) return { ok: false, error: 'NO_AUTH_TOKEN' };
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/save-settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ googleToken: token, settings }),
    });
    // Surface the actual failure reason instead of a bare boolean — a silent {ok:false} here
    // previously made a real sync failure indistinguishable from "everything's fine", which is
    // exactly what let settings silently stop reaching the cloud without anyone noticing.
    if (!resp.ok) {
      const body = await resp.json().catch(() => ({}));
      return { ok: false, error: body.error || `HTTP_${resp.status}` };
    }
    return { ok: true };
  } catch (err) { return { ok: false, error: err.message }; }
}

// Every AI request is decided by the server (see background/billing.js) — the local plan value is
// display-only and never unlocks anything.
async function withUsageGate(eventType, fn) {
  const { anthropicApiKey } = await chrome.storage.local.get('anthropicApiKey');
  if (!anthropicApiKey) return { error: 'NO_API_KEY' };
  const usage = await checkAndTrackUsage(eventType);
  if (!usage.allowed) {
    if (usage.error === 'SIGN_IN_REQUIRED') return { error: 'SIGN_IN_REQUIRED' };
    if (usage.error === 'SERVICE_UNAVAILABLE') return { error: 'SERVICE_UNAVAILABLE' };
    return { error: 'LIMIT_REACHED', limit: usage.limit, used: usage.used };
  }
  return fn();
}

async function withProGate(fn) {
  if (!(await verifyProPlan())) return { error: 'PRO_REQUIRED' };
  return fn();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_PROFILE') {
    withUsageGate('analysis', () => handleAnalyzeProfile(msg.profileData, msg.intent)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'BULK_SCORE_PROFILES') {
    withUsageGate('analysis', () => handleBulkScoreProfiles(msg.profiles, msg.intent)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_CONNECTION_REQUEST') {
    withUsageGate('message', () => handleGenerateConnectionRequest(msg.profileData, msg.intent, msg.userNotes, msg.contextMaterial, msg.previousAttempt, msg.strategy)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_FIRST_MESSAGE') {
    withUsageGate('message', () => handleGenerateFirstMessage(msg.profileData, msg.analysis, msg.intent, msg.tone, msg.userInstructions, msg.stage, msg.daysSinceLastTouch, msg.contextMaterial, msg.previousAttempt, msg.strategy)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_CHAT_FOLLOWUP') {
    withUsageGate('message', () => handleGenerateChatFollowup(msg)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_PIPELINES') {
    withProGate(() => fetchHubSpotPipelines()).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_OWNERS') {
    withProGate(() => fetchHubSpotOwners()).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'PUSH_TO_HUBSPOT') {
    withProGate(() => pushHubSpotDeal(msg)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'OPEN_OPTIONS_PAGE') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg.type === 'GET_API_KEY_STATUS') {
    chrome.storage.local.get('anthropicApiKey').then(result => sendResponse({ hasKey: !!result.anthropicApiKey }));
    return true;
  }
  if (msg.type === 'GET_HS_KEY_STATUS') {
    chrome.storage.local.get('hubspotApiKey').then(result => sendResponse({ hasKey: !!result.hubspotApiKey }));
    return true;
  }
  if (msg.type === 'SUGGEST_POST_TOPICS') {
    withUsageGate('post', () => handleSuggestPostTopics(msg.creatorProfile, msg.recentPosts, msg.mode, msg.companyProfile)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_POST') {
    withUsageGate('post', () => handleGeneratePost(msg)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'REFINE_MESSAGE') {
    withUsageGate('message', () => handleRefineMessage(msg.originalMessage, msg.profileData, msg.analysis, msg.intent, msg.tone, msg.instructions)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GOOGLE_SIGN_IN') {
    handleGoogleSignIn()
      .then(async res => { resetMigration(); await ensureMigrated(); return res; })
      .then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'GOOGLE_SIGN_OUT') {
    handleGoogleSignOut().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'START_CHECKOUT') {
    handleStartCheckout().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'OPEN_TAB') {
    chrome.tabs.create({ url: msg.url, active: true });
    return false;
  }
  if (msg.type === 'OPEN_BILLING_PORTAL') {
    handleOpenBillingPortal().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
    return true;
  }
  if (msg.type === 'SAVE_SETTINGS') {
    (async () => {
      const result = await pushSettingsToCloud(msg.settings);
      sendResponse(result);
    })();
    return true;
  }
  if (msg.type === 'SYNC_PLAN') {
    (async () => {
      try {
        const authResult = await chrome.identity.getAuthToken({ interactive: false });
        const token = typeof authResult === 'string' ? authResult : authResult?.token;
        if (!token) { sendResponse({ plan: 'free' }); return; }
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ googleToken: token }),
        });
        if (!resp.ok) { sendResponse({ plan: 'free' }); return; }
        const data = await resp.json();
        const plan = data.user?.plan || 'free';
        await chrome.storage.local.set({ userPlan: plan });
        if (plan === 'pro') await chrome.storage.local.remove('pendingOnboarding');
        sendResponse({ plan });
      } catch (_) { sendResponse({ plan: 'free' }); }
    })();
    return true;
  }
  sendResponse({ error: 'UNKNOWN_TYPE' });
  return false;
});

chrome.alarms.get('daily-plan-sync', existing => {
  if (!existing) chrome.alarms.create('daily-plan-sync', { delayInMinutes: 60, periodInMinutes: 1440 });
});
chrome.alarms.get('followup-reminder-check', existing => {
  if (!existing) chrome.alarms.create('followup-reminder-check', { delayInMinutes: 5, periodInMinutes: 1440 });
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'followup-reminder-check') { checkFollowUpReminders(); checkNewReplyNotifications(); updateReminderBadge(); return; }
  if (alarm.name !== 'daily-plan-sync') return;
  chrome.identity.getAuthToken({ interactive: false }, token => {
    if (chrome.runtime.lastError || !token) return;
    fetch(`${SUPABASE_URL}/functions/v1/sync-user`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
      body: JSON.stringify({ googleToken: token }),
    }).then(r => r.ok ? r.json() : null).then(data => {
      if (!data?.user?.plan) return;
      chrome.storage.local.set({ userPlan: data.user.plan });
    }).catch(() => {});
  });
});

chrome.notifications.onClicked.addListener(notifId => {
  if (notifId === 'lia-followup-reminder') {
    chrome.tabs.create({ url: 'https://www.linkedin.com/messaging/' });
  }
});

// Keep the toolbar badge accurate in near-real-time — not just once a day on the alarm tick —
// so it drops immediately when the user acts (copies a follow-up, corrects a stage) rather than
// waiting for tomorrow's check.
updateReminderBadge();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && ('savedContacts' in changes || 'reminderSettings' in changes)) updateReminderBadge();
});

// options/index.js already reactively pushes SETTINGS_KEYS to the cloud on change, but that
// listener only runs while the Options page happens to be open — fine for settings, which are
// only ever edited there, but savedContacts (the pipeline) is written from the content script
// while browsing LinkedIn instead, where the Options page is almost never open. Without this,
// pipeline changes would never actually reach the cloud in normal use, and the cross-device sync
// added for it would be sync in name only.
// Settings sync, owned here (not by the options page) so changes from any surface reach the cloud.
// Every settings change stamps a per-field timestamp for the sign-in merge, except a batch that
// already carries settingsFieldTimestamps — that's a cloud restore writing merged data, and
// re-stamping it "now" would make restored fields look freshly edited on this device.
let _settingsSyncDebounceTimer = null;
chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'local' || 'settingsFieldTimestamps' in changes) return;
  const changed = SETTINGS_KEYS.filter(k => k in changes);
  if (!changed.length) return;
  // Signed out: don't stamp. Sign-out clears settings and the migration then writes empty
  // defaults; stamping those "now" made them beat the real cloud copy on the next sign-in (and the
  // next sync then overwrote the cloud). Unstamped local values lose to the cloud in the merge.
  const { settingsFieldTimestamps = {}, googleUser } = await chrome.storage.local.get(['settingsFieldTimestamps', 'googleUser']);
  if (!googleUser) return;
  const now = Date.now();
  changed.forEach(k => { settingsFieldTimestamps[k] = now; });
  await chrome.storage.local.set({ settingsFieldTimestamps });
  clearTimeout(_settingsSyncDebounceTimer);
  _settingsSyncDebounceTimer = setTimeout(async () => {
    const { googleUser } = await chrome.storage.local.get('googleUser');
    if (!googleUser) return;
    const settings = await chrome.storage.local.get([...SETTINGS_KEYS, 'savedContacts', 'settingsFieldTimestamps']);
    pushSettingsToCloud(settings);
  }, 1500);
});

let _pipelineSyncDebounceTimer = null;
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !('savedContacts' in changes)) return;
  clearTimeout(_pipelineSyncDebounceTimer);
  _pipelineSyncDebounceTimer = setTimeout(async () => {
    // save-settings replaces the whole cloud settings blob, so this has to send the full
    // snapshot (everything else already synced, plus the pipeline) — never just savedContacts
    // alone, or it would silently wipe out every other setting on the next sign-in elsewhere.
    const { googleUser } = await chrome.storage.local.get('googleUser');
    if (!googleUser) return;
    const settings = await chrome.storage.local.get([...SETTINGS_KEYS, 'savedContacts', 'settingsFieldTimestamps']);
    pushSettingsToCloud(settings);
  }, 1500);
});
