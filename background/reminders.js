// Follow-up-due reminders — nudges the user about saved contacts sitting in an
// actionable outreach stage with no activity for a while. Reuses the pipeline
// stage tracking already on savedContacts entries (see content/index.js).

// Stages worth nudging about — excludes 'new' (nothing sent yet, nothing to follow up on),
// 'followup_3plus' (end of the tracked sequence — further auto-nagging isn't useful, the
// user should decide to close it out), and the terminal states (replied/booked/closed).
const REMINDER_STAGES = ['connection_sent', 'messaged', 'followup_1', 'followup_2'];
const RENOTIFY_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000; // don't re-nag about the same contact more than every 3 days
const DEFAULT_REMINDER_SETTINGS = { enabled: true, thresholdDays: 3 };

async function getReminderSettings() {
  const { reminderSettings } = await chrome.storage.local.get('reminderSettings');
  return { ...DEFAULT_REMINDER_SETTINGS, ...(reminderSettings || {}) };
}

// Base "due" set — anyone sitting in an actionable stage with no movement in thresholdDays+ days,
// and not currently snoozed. Shared by the OS notification (which additionally cools down
// per-contact below) and the toolbar badge (which always reflects the full current count, not
// just newly-notified contacts), so the two can never disagree about who's due.
export function getDueContacts(savedContacts, now = Date.now(), settings = DEFAULT_REMINDER_SETTINGS) {
  if (!Array.isArray(savedContacts)) return [];
  const dueAfterMs = (settings.thresholdDays || DEFAULT_REMINDER_SETTINGS.thresholdDays) * 24 * 60 * 60 * 1000;
  return savedContacts.filter(c => {
    if (!REMINDER_STAGES.includes(c.stage)) return false;
    if (c.snoozedUntil && c.snoozedUntil > now) return false;
    return now - (c.stageUpdatedAt || c.savedAt || now) >= dueAfterMs;
  });
}

export async function updateReminderBadge() {
  const settings = await getReminderSettings();
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  const due = settings.enabled ? getDueContacts(savedContacts, Date.now(), settings) : [];
  const replies = Array.isArray(savedContacts) ? savedContacts.filter(c => c.newReply) : [];
  const total = due.length + replies.length;
  if (total > 0) {
    chrome.action.setBadgeText({ text: String(total) });
    // A reply is good news, not a nag — give it its own color rather than the same red used for
    // "you're falling behind" reminders, when replies make up any part of the count.
    chrome.action.setBadgeBackgroundColor({ color: replies.length ? '#16a34a' : '#dc2626' });
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

export async function checkFollowUpReminders() {
  const settings = await getReminderSettings();
  if (!settings.enabled) return;
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  if (!Array.isArray(savedContacts) || !savedContacts.length) return;

  const now = Date.now();
  const due = getDueContacts(savedContacts, now, settings).filter(c => now - (c.lastReminderAt || 0) >= RENOTIFY_COOLDOWN_MS);
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

// newReply is set by content/index.js's passive reply detection (checked only against a thread
// the user already has open, never via background polling) when an inbound message advances a
// contact's stage to Replied on its own. This is the one-time OS ping for that — replyOsNotified
// is a separate, never-reset flag so the same reply isn't re-announced on every daily alarm tick
// while it sits un-dismissed in the notification bell.
export async function checkNewReplyNotifications() {
  const { savedContacts } = await chrome.storage.local.get('savedContacts');
  if (!Array.isArray(savedContacts) || !savedContacts.length) return;

  const unnotified = savedContacts.filter(c => c.newReply && !c.replyOsNotified);
  if (!unnotified.length) return;

  const title = unnotified.length === 1
    ? `${unnotified[0].name || 'A lead'} replied`
    : `${unnotified.length} leads replied`;
  const body = unnotified.length === 1
    ? 'Open LinkPilot AI to see their message and follow up.'
    : `${unnotified.slice(0, 3).map(c => c.name || 'Unnamed').join(', ')}${unnotified.length > 3 ? ` and ${unnotified.length - 3} more` : ''} — worth a look.`;

  try {
    chrome.notifications.create('lia-new-reply', {
      type: 'basic',
      iconUrl: chrome.runtime.getURL('assets/extension_icon.png'),
      title: `LinkPilot AI — ${title}`,
      message: body,
      priority: 1,
    });
  } catch (_) { /* notifications may be blocked at the OS level — non-fatal */ }

  const notifiedUrls = new Set(unnotified.map(c => c.url));
  const updated = savedContacts.map(c => notifiedUrls.has(c.url) ? { ...c, replyOsNotified: true } : c);
  await chrome.storage.local.set({ savedContacts: updated });
}
