-- 004: remove API keys from synced settings.
--
-- Until 2026-11-12 the extension synced anthropicApiKey and hubspotApiKey inside the settings blob,
-- although the product promised keys never leave the browser. The extension no longer syncs them
-- (background/auth.js SETTINGS_KEYS); this removes the copies already stored. Users whose keys were
-- stored should rotate them, because they were readable with the public key until migration 003.

update public.users
set settings = settings - 'anthropicApiKey' - 'hubspotApiKey'
where settings ? 'anthropicApiKey' or settings ? 'hubspotApiKey';
