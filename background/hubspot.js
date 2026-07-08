async function getHubSpotKey() {
  const result = await chrome.storage.local.get('hubspotApiKey');
  if (!result.hubspotApiKey) throw new Error('NO_HUBSPOT_KEY');
  return result.hubspotApiKey;
}

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
  const data = await res.json();
  if (!res.ok) {
    const msg = data?.message || data?.error || `HubSpot API error ${res.status}`;
    throw new Error(msg);
  }
  return data;
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

  // Search by LinkedIn URL first (most precise)
  if (linkedinUrl) {
    try {
      const searchRes = await hubspotFetch('/crm/v3/objects/contacts/search', {
        method: 'POST',
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: 'hs_linkedinid', operator: 'EQ', value: linkedinUrl }],
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
        hs_linkedinid: linkedinUrl || '',
      },
    }),
  });
  return contact.id;
}

export async function pushHubSpotDeal({ name, linkedinUrl, contactText, remarks, pipelineId, stageId, ownerId }) {
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
    // Note creation failed — deal + contact association still saved, not fatal
    return { success: true };
  }

  // Step 5: Associate note with deal and contact (best effort)
  await Promise.allSettled([
    hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/deal/${deal.id}`, { method: 'PUT' }),
    hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/contact/${contactId}`, { method: 'PUT' }),
  ]);

  return { success: true };
}
