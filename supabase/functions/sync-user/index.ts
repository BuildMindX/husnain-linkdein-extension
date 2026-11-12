import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyIdentity, findUser, corsHeaders, json } from '../_shared/identity.ts'

// Sign-in and plan refresh. Works for Google and email/password sign-in; both reach the same
// account (see _shared/identity.ts). Creates the account on first sign-in.
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json()
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const v = await verifyIdentity(body, supabase)
    if ('error' in v) return json({ error: v.error }, v.status)
    const ident = v.identity

    const found = await findUser(supabase, ident, { create: true })
    if (found.error || !found.user) return json({ error: found.error || 'Could not load account' }, 500)

    const patch: Record<string, unknown> = { last_seen_at: new Date().toISOString() }
    if (ident.kind === 'google') {
      if (ident.name) patch.name = ident.name
      if (ident.picture) patch.avatar_url = ident.picture
    }
    if (!found.user.email && ident.email) patch.email = ident.email
    const { data: user, error } = await supabase
      .from('users').update(patch).eq('id', found.user.id)
      .select('id, email, name, avatar_url, plan, plan_expires_at, created_at, settings').single()
    if (error) return json({ error: error.message }, 500)

    return json({ user, isNew: found.isNew, settings: user.settings || {} })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
