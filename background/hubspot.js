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

export async function pushHubSpotDeal({ name, linkedinUrl, contactText, remarks, pipelineId, stageId, ownerId }) {
  const dealName = name || 'LinkedIn Lead';

  const deal = await hubspotFetch('/crm/v3/objects/deals', {
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

  const noteParts = [];
  if (remarks && remarks.trim()) noteParts.push(remarks.trim());
  noteParts.push(`LinkedIn: ${linkedinUrl}`);
  if (contactText) noteParts.push(`Connection Request:\n${contactText}`);

  const note = await hubspotFetch('/crm/v3/objects/notes', {
    method: 'POST',
    body: JSON.stringify({
      properties: {
        hs_note_body: noteParts.join('\n\n'),
        hs_timestamp: Date.now().toString(),
      },
    }),
  });

  await hubspotFetch(`/crm/v4/objects/note/${note.id}/associations/default/deal/${deal.id}`, {
    method: 'PUT',
  });

  return { success: true };
}
