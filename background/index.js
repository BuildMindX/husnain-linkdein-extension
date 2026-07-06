import { handleGoogleSignIn, handleGoogleSignOut } from './auth.js';
import { handleStartCheckout } from './billing.js';
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

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'ANALYZE_PROFILE') {
    handleAnalyzeProfile(msg.profileData, msg.intent).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_CONNECTION_REQUEST') {
    handleGenerateConnectionRequest(msg.profileData, msg.intent, msg.userNotes).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_COLD_MESSAGE') {
    handleGenerateColdMessage(msg.profileData, msg.intent, msg.userNotes).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_FIRST_MESSAGE') {
    handleGenerateFirstMessage(msg.profileData, msg.analysis, msg.intent, msg.tone, msg.userInstructions).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_FOLLOW_UP') {
    handleGenerateFollowUp(msg.profileData, msg.conversationText, msg.intent).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_PIPELINES') {
    fetchHubSpotPipelines().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'FETCH_HUBSPOT_OWNERS') {
    fetchHubSpotOwners().then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'PUSH_TO_HUBSPOT') {
    pushHubSpotDeal(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
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
    handleSuggestPostTopics(msg.creatorProfile, msg.recentPosts, msg.mode, msg.companyProfile).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_POST') {
    handleGeneratePost(msg).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'GENERATE_POST_IMAGE') {
    handleGeneratePostImage(msg.prompt).then(sendResponse).catch(err => sendResponse({ error: err.message }));
    return true;
  }
  if (msg.type === 'REFINE_MESSAGE') {
    handleRefineMessage(msg.originalMessage, msg.profileData, msg.analysis, msg.intent, msg.tone, msg.instructions).then(sendResponse).catch(err => sendResponse({ error: err.message }));
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
});
