import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const SETTINGS_KEYS = [
  'analysisIntent',
  'targetIndustries', 'excludeIndustries', 'businessProfile',
  'messagePresets', 'b2cProfile', 'jobProfile',
  'creatorProfile', 'companyProfile',
  'openaiApiKey', 'hubspotApiKey',
];

// savedContacts (the pipeline) changes far more often than the settings above — every generated
// message, every stage correction — so restoring it the same way (blind overwrite from whatever
// the cloud last saw) risks clobbering same-day local activity with an older snapshot. Merged by
// url, keeping whichever copy of each contact has the newer stageUpdatedAt/savedAt, instead of
// replacing the array outright. Kept separate from the generic SETTINGS_KEYS loop below.
function mergeSavedContacts(local, cloud) {
  const localList = Array.isArray(local) ? local : [];
  const cloudList = Array.isArray(cloud) ? cloud : [];
  const tsOf = c => c.stageUpdatedAt || c.savedAt || 0;
  const byUrl = new Map();
  for (const c of cloudList) byUrl.set(c.url, c);
  for (const c of localList) {
    const existing = byUrl.get(c.url);
    if (!existing || tsOf(c) >= tsOf(existing)) byUrl.set(c.url, c);
  }
  return [...byUrl.values()];
}

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
  let isNew = false;
  let cloudSettings = {};
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
      const data = await syncResp.json();
      plan = data.user?.plan || 'free';
      supabaseUserId = data.user?.id || null;
      isNew = !!data.isNew;
      cloudSettings = data.settings || {};
    }
  } catch (_) { /* Supabase unavailable — continue offline */ }

  const storagePayload = { googleUser, userPlan: plan, supabaseUserId };
  if (isNew) storagePayload.pendingOnboarding = true;
  // Restore all saved settings from cloud onto local storage
  for (const key of SETTINGS_KEYS) {
    if (cloudSettings[key] !== undefined) storagePayload[key] = cloudSettings[key];
  }
  if (cloudSettings.savedContacts !== undefined) {
    const { savedContacts: localContacts } = await chrome.storage.local.get('savedContacts');
    storagePayload.savedContacts = mergeSavedContacts(localContacts, cloudSettings.savedContacts);
  }
  await chrome.storage.local.set(storagePayload);
  return { success: true, user: googleUser, plan, isNew };
}

export async function handleGoogleSignOut() {
  try {
    const authResult = await chrome.identity.getAuthToken({ interactive: false });
    const tokenResult = typeof authResult === 'string' ? authResult : authResult?.token;
    if (tokenResult) await chrome.identity.removeCachedAuthToken({ token: tokenResult });
  } catch (_) { /* token may already be expired */ }
  await chrome.storage.local.remove(['googleUser', 'userPlan', 'supabaseUserId', 'savedContacts', ...SETTINGS_KEYS]);
  return { success: true };
}
