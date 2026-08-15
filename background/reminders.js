// Follow-up-due reminders — nudges the user about saved contacts sitting in an
// actionable outreach stage with no activity for a while. Reuses the pipeline
// stage tracking already on savedContacts entries (see content/index.js).

// Stages worth nudging about — excludes 'new' (nothing sent yet, nothing to follow up on),
// 'followup_3plus' (end of the tracked sequence — further auto-nagging isn't useful, the
// user should decide to close it out), and the terminal states (replied/booked/closed).
const REMINDER_STAGES = ['connection_sent', 'messaged', 'followup_1', 'followup_2'];
const DUE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;       // no stage movement in 3+ days = due
const RENOTIFY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // don't re-nag about the same contact more than every 3 days

// Base "due" set — anyone sitting in an actionable stage with no movement in 3+ days. Shared by
// the OS notification (which additionally cools down per-contact below) and the toolbar badge
// (which always reflects the full current count, not just newly-notified contacts), so the two
// can never disagree about who's due.
export function getDueContacts(savedContacts, now = Date.now()) {
  if (!Array.isArray(savedContacts)) return [];
  return savedContacts.filter(c => {
    if (!REMINDER_STAGES.includes(c.stage)) return false;
    return now - (c.stageUpdatedAt || c.savedAt || now) >= DUE_AFTER_MS;
  });
}

export async function updateReminderBadge() {
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  const due = getDueContacts(savedContacts);
  if (due.length > 0) {
    chrome.action.setBadgeText({ text: String(due.length) });
    chrome.action.setBadgeBackgroundColor({ color: '#dc2626' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

export async function checkFollowUpReminders() {
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  if (!Array.isArray(savedContacts) || !savedContacts.length) return;

  const now = Date.now();
  const due = getDueContacts(savedContacts, now).filter(c => now - (c.lastReminderAt || 0) >= RENOTIFY_COOLDOWN_MS);
  if (!due.length) return;

  const title = due.length === 1
    ? `Follow-up due: ${due[0].name || 'a lead'}`
    : `${due.length} leads are due for a follow-up`;
  const body = due.length === 1
    ? `It's been ${Math.floor((now - (due[0].stageUpdatedAt || due[0].savedAt || now)) / 86400000)} days since your last touch — worth a follow-up.`
    : `${due.slice(0, 3).map(c => c.name || 'Unnamed').join(', ')}${due.length > 3 ? ` and ${due.length - 3} more` : ''} — worth a follow-up.`;

  try {
    chrome.notifications.create('lia-followup-reminder', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/extension_icon.png'),
      title: `LinkPilot AI — ${title}`,
      message: body,
      priority: 1,
    });
  } catch (_) { /* notifications may be blocked at the OS level — non-fatal */ }

  const dueUrls = new Set(due.map(c => c.url));
  const updated = savedContacts.map(c => dueUrls.has(c.url) ? { ...c, lastReminderAt: now } : c);
  await chrome.storage.local.set({ savedContacts: updated });
}
