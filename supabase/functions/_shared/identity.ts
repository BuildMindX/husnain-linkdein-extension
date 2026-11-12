// Who is calling? Shared by every edge function.
//
// Two ways to sign in, one account:
//   - Google: the extension sends `googleToken` (a chrome.identity access token). It must have been
//     issued to LinkPilot's own OAuth client — a Google token from any other app is rejected
//     (previously any token userinfo accepted was trusted).
//   - Email + password: the extension sends `accessToken` from Supabase Auth. The email must be
//     confirmed before it can link to an existing account, so nobody can take over an account by
//     signing up with someone else's address.
// Both resolve to one row in public.users: by google_id / auth_user_id once linked, otherwise by
// the (verified) email, which then gets linked.
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID')
  ?? '592927077998-058seb6htaan8ma47vhhiqjg724avke3.apps.googleusercontent.com'

export type Identity =
  | { kind: 'google'; googleId: string; email: string; emailVerified: boolean; name: string | null; picture: string | null }
  | { kind: 'password'; authUserId: string; email: string; name: string | null; picture: null }

export type IdentityResult = { identity: Identity } | { error: string; status: number }

export const USER_COLUMNS =
  'id, google_id, auth_user_id, email, name, avatar_url, plan, plan_expires_at, created_at, settings, stripe_customer_id, stripe_subscription_id'

export async function verifyIdentity(body: Record<string, unknown>, supabase: SupabaseClient): Promise<IdentityResult> {
  const googleToken = typeof body.googleToken === 'string' ? body.googleToken : ''
  const accessToken = typeof body.accessToken === 'string' ? body.accessToken : ''

  if (googleToken) {
    const ti = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`)
    if (!ti.ok) return { error: 'Invalid or expired Google token', status: 401 }
    const info = await ti.json()
    if (info.aud !== GOOGLE_CLIENT_ID && info.azp !== GOOGLE_CLIENT_ID) {
      return { error: 'This Google token was not issued to LinkPilot', status: 401 }
    }
    const gRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!gRes.ok) return { error: 'Invalid or expired Google token', status: 401 }
    const g = await gRes.json()
    if (!g.id) return { error: 'Could not retrieve Google user', status: 401 }
    return {
      identity: {
        kind: 'google', googleId: String(g.id), email: String(g.email || '').toLowerCase(),
        emailVerified: g.verified_email !== false, name: g.name ?? null, picture: g.picture ?? null,
      },
    }
  }

  if (accessToken) {
    const { data, error } = await supabase.auth.getUser(accessToken)
    if (error || !data?.user) return { error: 'Your session expired — sign in again', status: 401 }
    const u = data.user
    if (!u.email_confirmed_at) return { error: 'Confirm your email address first — check your inbox', status: 403 }
    return {
      identity: {
        kind: 'password', authUserId: u.id, email: String(u.email || '').toLowerCase(),
        name: (u.user_metadata?.name as string) ?? null, picture: null,
      },
    }
  }

  return { error: 'Not signed in', status: 401 }
}

// The caller's row in public.users. With create:true (sign-in), a missing row is created; with
// create:false (every other function) a missing row is a 404 for the caller to report.
export async function findUser(
  supabase: SupabaseClient,
  ident: Identity,
  { create = false } = {},
): Promise<{ user: Record<string, any> | null; isNew: boolean; error?: string }> {
  const byKey = ident.kind === 'google'
    ? await supabase.from('users').select(USER_COLUMNS).eq('google_id', ident.googleId).limit(1)
    : await supabase.from('users').select(USER_COLUMNS).eq('auth_user_id', ident.authUserId).limit(1)
  if (byKey.error) return { user: null, isNew: false, error: byKey.error.message }
  if (byKey.data?.length) return { user: byKey.data[0], isNew: false }

  // Not linked yet: link to an existing account with the same verified email, if it has no
  // identity of this kind already.
  const canLinkByEmail = ident.email && (ident.kind === 'password' || ident.emailVerified)
  if (canLinkByEmail) {
    const linkCol = ident.kind === 'google' ? 'google_id' : 'auth_user_id'
    const { data: sameEmail } = await supabase
      .from('users').select(USER_COLUMNS).eq('email', ident.email).is(linkCol, null).limit(1)
    if (sameEmail?.length) {
      const patch = ident.kind === 'google' ? { google_id: ident.googleId } : { auth_user_id: ident.authUserId }
      const { data: linked, error } = await supabase
        .from('users').update(patch).eq('id', sameEmail[0].id).select(USER_COLUMNS).single()
      if (error) return { user: null, isNew: false, error: error.message }
      return { user: linked, isNew: false }
    }
  }

  if (!create) return { user: null, isNew: false }
  const row = ident.kind === 'google'
    ? { google_id: ident.googleId, email: ident.email, name: ident.name, avatar_url: ident.picture }
    : { auth_user_id: ident.authUserId, email: ident.email, name: ident.name }
  const { data: created, error } = await supabase.from('users').insert(row).select(USER_COLUMNS).single()
  if (error) return { user: null, isNew: false, error: error.message }
  return { user: created, isNew: true }
}

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

export function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
