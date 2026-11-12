import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyIdentity, findUser, corsHeaders, json } from '../_shared/identity.ts'

// API keys are never stored server-side, even if an old extension version still sends them.
const NEVER_STORE = ['anthropicApiKey', 'hubspotApiKey']

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json()
    const settings = body?.settings
    if (!settings || typeof settings !== 'object') return json({ error: 'Missing settings' }, 400)
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
    const v = await verifyIdentity(body, supabase)
    if ('error' in v) return json({ error: v.error }, v.status)
    const { user } = await findUser(supabase, v.identity)
    if (!user) return json({ error: 'User not found — sign in first' }, 404)

    const clean = { ...settings }
    NEVER_STORE.forEach(k => delete clean[k])
    const { error } = await supabase.from('users')
      .update({ settings: clean, last_seen_at: new Date().toISOString() }).eq('id', user.id)
    if (error) return json({ error: error.message }, 500)
    return json({ ok: true })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})
