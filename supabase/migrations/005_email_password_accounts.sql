-- 005: email + password sign-in alongside Google, as the same account.
--
-- Password accounts live in Supabase Auth (auth.users). Each one links to exactly one row in
-- public.users: by auth_user_id once linked, otherwise by (verified) email — so a person who first
-- signed in with Google and later adds a password keeps the same plan, settings and pipeline.
-- The edge functions only link by email after Supabase has confirmed the address
-- (supabase/functions/_shared/identity.ts), so nobody can claim an account by signing up with
-- someone else's email.

begin;

alter table public.users alter column google_id drop not null;
alter table public.users add column if not exists auth_user_id uuid unique;

-- Emails are matched exactly (lower-cased) when linking accounts.
update public.users set email = lower(email) where email is not null and email <> lower(email);

create index if not exists idx_users_auth_user_id on public.users(auth_user_id);
create index if not exists idx_users_email_lower on public.users(lower(email));

-- Still no access for the publishable key (see 003): only the edge functions read this table.
revoke all on table public.users from anon, authenticated;

commit;
