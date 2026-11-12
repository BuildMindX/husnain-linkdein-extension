-- 003: lock the database to the edge functions only.
--
-- schema.sql created a policy named "service_role_all" with FOR ALL USING (true) but no
-- TO service_role, so it applied to every role — and Supabase grants anon/authenticated full
-- table privileges by default. Together that let anyone holding the publishable key (which ships
-- inside the extension) read, edit and delete every user row, including the synced settings blob
-- (API keys, pipeline). Confirmed live on 2026-11-12 and fixed with this migration.
--
-- Nothing in the extension talks to the database directly; every read/write goes through an edge
-- function using the service-role key, which bypasses RLS and keeps its own grants. So the public
-- roles need no access at all: RLS stays enabled with no policies, and their grants are revoked.

begin;

drop policy if exists service_role_all on public.users;
drop policy if exists service_role_all on public.usage_events;

revoke all on table public.users, public.usage_events from anon, authenticated;

revoke execute on function public.track_usage_atomic(uuid, text, jsonb, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.track_usage_atomic(uuid, text, jsonb, timestamptz, integer)
  to service_role;

-- New tables in public should not be readable by the publishable key by default either.
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

commit;
