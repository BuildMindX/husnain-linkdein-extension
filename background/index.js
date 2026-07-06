import { handleGoogleSignIn, handleGoogleSignOut } from './auth.js';
import { checkAndTrackUsage, handleStartCheckout } from './billing.js';
import {
  handleAnalyzeProfile,
  handleGenerateConnectionRequest,
  handleGenerateColdMessage,
  handleGenerateFirstMessage,
  handleGenerateFollowUp,
  handleRefineMessage,
  handleSuggestPostTopics,
  handleGeneratePost,
  handleGeneratePostImage,
} from './ai.js';
import { fetchHubSpotPipelines, fetchHubSpotOwners, pushHubSpotDeal } from './hubspot.js';

async function withUsageGate(eventType, fn) {
  const usage = await checkAndTrackUsage(eventType);
  if (!usage.allowed) return { error: 'LIMIT_REACHED', limit: usage.limit, used: usage.used };
  return fn();
}

async function withProGate(fn) {
  const { userPlan } = await chrome.storage.local.get('userPlan');
  if (userPlan !== 'pro') return { error: 'PRO_REQUIRED' };
  return fn();
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_PROFILE') {
    withUsageGate('analysis', () => handleAnalyzeProfile(msg.profileData, msg.intent)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_CONNECTION_REQUEST') {
    withUsageGate('message', () => handleGenerateConnectionRequest(msg.profileData, msg.intent, msg.userNotes)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_COLD_MESSAGE') {
    withUsageGate('message', () => handleGenerateColdMessage(msg.profileData, msg.intent, msg.userNotes)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_FIRST_MESSAGE') {
    withUsageGate('message', () => handleGenerateFirstMessage(msg.profileData, msg.analysis, msg.intent, msg.tone, msg.userInstructions)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_FOLLOW_UP') {
    withUsageGate('message', () => handleGenerateFollowUp(msg.profileData, msg.conversationText, msg.intent)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
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
    chrome.storage.local.get('openaiApiKey').then(result => sendResponse({ hasKey: !!result.openaiApiKey }));
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
  if (msg.type === 'GENERATE_POST_IMAGE') {
    withProGate(() => handleGeneratePostImage(msg.prompt)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'REFINE_MESSAGE') {
    withUsageGate('message', () => handleRefineMessage(msg.originalMessage, msg.profileData, msg.analysis, msg.intent, msg.tone, msg.instructions)).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GOOGLE_SIGN_IN') {
    handleGoogleSignIn().then(sendResponse).catch(err => sendResponse({ success: false, error: err.message }));
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
  if (msg.type === 'SYNC_PLAN') {
    (async () => {
      try {
        const authResult = await chrome.identity.getAuthToken({ interactive: false });
        const token = typeof authResult === 'string' ? authResult : authResult?.token;
        if (!token) { sendResponse({ plan: 'free' }); return; }
        const { SUPABASE_URL, SUPABASE_ANON_KEY } = await import('./config.js');
        const resp = await fetch(`${SUPABASE_URL}/functions/v1/sync-user`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
          body: JSON.stringify({ googleToken: token }),
        });
        if (!resp.ok) { sendResponse({ plan: 'free' }); return; }
        const data = await resp.json();
        const plan = data.user?.plan || 'free';
        await chrome.storage.local.set({ userPlan: plan });
        sendResponse({ plan });
      } catch (_) { sendResponse({ plan: 'free' }); }
    })();
    return true;
  }
});
