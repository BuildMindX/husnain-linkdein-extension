-- LinkPilot: migrations 003 + 004 + 005 in one paste for the Supabase SQL Editor.
-- Runs as a single transaction: if any statement fails, nothing is changed.
-- Safe to run more than once.
--
--   003  Lock the database to the edge functions only (closes the public-key read/write hole).
--   004  Remove API keys that were previously synced into users.settings.
--   005  Email + password accounts linked to the same user row as Google.

begin;

-- ── 003: lock down public access ──────────────────────────────────────────────
drop policy if exists service_role_all on public.users;
drop policy if exists service_role_all on public.usage_events;

revoke all on table public.users, public.usage_events from anon, authenticated;

revoke execute on function public.track_usage_atomic(uuid, text, jsonb, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.track_usage_atomic(uuid, text, jsonb, timestamptz, integer)
  to service_role;

alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

-- ── 004: scrub synced API keys ────────────────────────────────────────────────
update public.users
set settings = settings - 'anthropicApiKey' - 'hubspotApiKey'
where settings ? 'anthropicApiKey' or settings ? 'hubspotApiKey';

-- ── 005: email + password accounts ────────────────────────────────────────────
alter table public.users alter column google_id drop not null;
alter table public.users add column if not exists auth_user_id uuid unique;

update public.users set email = lower(email) where email is not null and email <> lower(email);

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_users_email_lower on public.users(lower(email));

revoke all on table public.users from anon, authenticated;

commit;

-- ── Check (read-only): every row below should say ok = true ───────────────────
select 'no policies left on users/usage_events' as item, count(*) = 0 as ok
  from pg_policies where schemaname = 'public' and tablename in ('users', 'usage_events')
union all
select 'publishable key cannot read users', not has_table_privilege('anon', 'public.users', 'select')
union all
select 'signed-in role cannot read users', not has_table_privilege('authenticated', 'public.users', 'select')
union all
select 'publishable key cannot call track_usage_atomic',
  not has_function_privilege('anon', 'public.track_usage_atomic(uuid, text, jsonb, timestamptz, integer)', 'execute')
union all
select 'no API keys left in synced settings', count(*) = 0
  from public.users where settings ? 'anthropicApiKey' or settings ? 'hubspotApiKey'
union all
select 'auth_user_id column exists', count(*) = 1
  from information_schema.columns where table_schema = 'public' and table_name = 'users' and column_name = 'auth_user_id';
