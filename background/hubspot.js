function normalizeLinkedInUrl(url) {
  if (!url) return url;
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname.replace(/\/$/, '')}`.toLowerCase();
  } catch { return url; }
}

async function getHubSpotKey() {
  const result = await chrome.storage.local.get('hubspotApiKey');
  if (!result.hubspotApiKey) throw new Error('No HubSpot token found — add one in Settings.');
  return result.hubspotApiKey;
}

// HubSpot's own API error text ("PROPERTY_DOESNT_EXIST", raw validation JSON, etc.) is written for
// developers, not the person using this extension — map the common cases to something actionable
// and fall back to a generic message rather than surfacing HubSpot's raw response.
const HUBSPOT_FRIENDLY_ERRORS = {
  401: 'Your HubSpot token is invalid or expired — check it in Settings.',
  403: 'Your HubSpot token doesn\'t have permission for this — check its scopes in HubSpot.',
  404: 'HubSpot couldn\'t find the pipeline, stage, or record — refresh and try again.',
  429: 'HubSpot rate limit reached — wait a moment and try again.',
};

async function hubspotFetch(path, options = {}) {
  const token = await getHubSpotKey();
  const res = await fetch(`https://api.hubapi.com${path}`, {
    ...options,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });
  if (!res.ok) {
    throw new Error(HUBSPOT_FRIENDLY_ERRORS[res.status] || 'HubSpot couldn\'t complete this request — try again, or check your HubSpot connection in Settings.');
  }
  return res.json();
}

export async function fetchHubSpotPipelines() {
  const data = await hubspotFetch('/crm/v3/pipelines/deal');
  return (data.results || []).map(p => ({
    id: p.id,
    label: p.label,
    stages: (p.stages || [])
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map(s => ({ id: s.id, label: s.label })),
  }));
}

export async function fetchHubSpotOwners() {
  const data = await hubspotFetch('/crm/v3/owners?limit=100');
  return (data.results || []).map(o => ({
    id: o.id,
    label: [o.firstName, o.lastName].filter(Boolean).join(' ') || o.email,
  }));
}

// Find an existing contact by LinkedIn URL, falling back to name search.
async function findOrCreateContact(name, linkedinUrl) {
  const nameParts = (name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || 'LinkedIn';
  const lastName = nameParts.slice(1).join(' ') || 'Lead';

  const normalizedUrl = normalizeLinkedInUrl(linkedinUrl);

  // Search by LinkedIn URL first (most precise)
  if (normalizedUrl) {
    try {
      const searchRes = await hubspotFetch('/crm/v3/objects/contacts/search', {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: 'hs_linkedinid', operator: 'EQ', value: normalizedUrl }],
          }],
          properties: ['hs_object_id'],
          limit: 1,
        }),
      });
      if (searchRes.total > 0) return searchRes.results[0].id;
    } catch (_) { /* fall through to create */ }
  }

  // Create new contact
  const contact = await hubspotFetch('/crm/v3/objects/contacts', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        firstname: firstName,
        lastname: lastName,
        hs_linkedinid: normalizedUrl || '',
      },
    }),
  });
  return contact.id;
}

// Mirrors the same fields/branches background/ai.js's buildAnalysisContext() reads (kept as a
// separate small formatter rather than importing that one directly, since its wording is written
// for an AI prompt — "use these insights to craft a message" — not a CRM note a human will read).
function formatAnalysisForNote(analysis, intent) {
  if (!analysis) return '';
  const lines = [];
  if (intent === 'b2b_sales') {
    if (analysis.potentialClient?.score) lines.push(`Prospect Score: ${analysis.potentialClient.score}${analysis.potentialClient.reasoning ? ` — ${analysis.potentialClient.reasoning}` : ''}`);
    if (analysis.decisionMaker) lines.push(`Decision Maker: ${analysis.decisionMaker}`);
    if (analysis.industryFit?.level) lines.push(`Industry Fit: ${analysis.industryFit.level}${analysis.industryFit.reasoning ? ` — ${analysis.industryFit.reasoning}` : ''}`);
    if (analysis.companySize) lines.push(`Company Size: ${analysis.companySize}`);
  } else if (intent === 'b2c_sales') {
    if (analysis.clientPotential?.score) lines.push(`Client Potential: ${analysis.clientPotential.score}${analysis.clientPotential.reasoning ? ` — ${analysis.clientPotential.reasoning}` : ''}`);
    if (analysis.decisionMaker) lines.push(`Decision Maker: ${analysis.decisionMaker}`);
    if ((analysis.painPoints || []).length) lines.push(`Pain Points: ${analysis.painPoints.join('; ')}`);
    if (analysis.approachAngle) lines.push(`Recommended Approach: ${analysis.approachAngle}`);
  } else if (intent === 'job_search') {
    if (analysis.hiringSignal?.score) lines.push(`Hiring Signal: ${analysis.hiringSignal.score}${analysis.hiringSignal.reasoning ? ` — ${analysis.hiringSignal.reasoning}` : ''}`);
    if (analysis.isRecruiter) lines.push(`Is Recruiter: ${analysis.isRecruiter}`);
  }
  if (analysis.industry) lines.push(`Industry: ${analysis.industry}`);
  if ((analysis.keyInsights || []).length) lines.push(`Key Insights: ${analysis.keyInsights.join('; ')}`);
  if (!lines.length) return '';
  return `AI Analysis Summary:\n${lines.map(l => `- ${l}`).join('\n')}`;
}

export async function pushHubSpotDeal({ name, linkedinUrl, contactText, remarks, pipelineId, stageId, ownerId, analysis, intent }) {
  const dealName = name || 'LinkedIn Lead';

  // Step 1: Find or create contact
  const contactId = await findOrCreateContact(name, linkedinUrl);

  // Step 2: Create deal
  let deal;
  try {
    deal = await hubspotFetch('/crm/v3/objects/deals', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          dealname: dealName,
          pipeline: pipelineId,
          dealstage: stageId,
          ...(ownerId ? { hubspot_owner_id: ownerId } : {}),
        },
      }),
    });
  } catch (err) {
    throw err;
  }

  // Step 3: Associate deal with contact (rollback deal if this fails)
  try {
    await hubspotFetch(`/crm/v4/objects/deal/${deal.id}/associations/default/contact/${contactId}`, {
      method: 'PUT',
    });
  } catch (_) {
    // Best effort rollback
    hubspotFetch(`/crm/v3/objects/deals/${deal.id}`, { method: 'DELETE' }).catch(() => {});
    throw new Error('Created deal but failed to link contact — deal rolled back.');
  }

  // Step 4: Create note
  const noteParts = [];
  if (remarks && remarks.trim()) noteParts.push(remarks.trim());
  noteParts.push(`LinkedIn: ${linkedinUrl}`);
  const analysisNote = formatAnalysisForNote(analysis, intent);
  if (analysisNote) noteParts.push(analysisNote);
  if (contactText) noteParts.push(`Connection Request:\n${contactText}`);

  let note;
  try {
    note = await hubspotFetch('/crm/v3/objects/notes', {
      method: 'POST',
      body: JSON.stringify({
        properties: {
          hs_note_body: noteParts.join('\n\n'),
          hs_timestamp: Date.now().toString(),
        },
      }),
    });
  } catch (_) {
    // Note creation failed — deal + contact association still saved, not fatal, but the caller
    // should know rather than being told this went through cleanly when the note never made it.
    return { success: true, warning: 'Deal created, but the note failed to save — add it manually in HubSpot.' };
  }

  // Step 5: Associate note with deal and contact (best effort, but not silently — an unlinked
  // note is easy to lose track of in HubSpot, so a failure here needs to reach the user too).
  const [dealAssoc, contactAssoc] = await Promise.allSettled([
    hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/deal/${deal.id}`, { method: 'PUT' }),
    hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/contact/${contactId}`, { method: 'PUT' }),
  ]);
  if (dealAssoc.status === 'rejected' || contactAssoc.status === 'rejected') {
    return { success: true, warning: 'Deal and note created, but the note may not show up linked to them in HubSpot — check it manually.' };
  }

  return { success: true };
}
