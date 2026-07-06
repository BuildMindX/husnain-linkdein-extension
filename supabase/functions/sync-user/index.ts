import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { googleToken } = await req.json()
    if (!googleToken) return json({ error: 'Missing googleToken' }, 400)

    // Verify token + fetch Google user profile
    const gRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!gRes.ok) return json({ error: 'Invalid or expired Google token' }, 401)

    const g = await gRes.json()
    if (!g.id) return json({ error: 'Could not retrieve Google user' }, 401)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )

    // Check if user already exists to detect first-time sign-up
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('google_id', g.id)
      .maybeSingle()

    const isNew = !existing

    // Upsert: create on first sign-in, update last_seen on subsequent ones
    const { data: user, error } = await supabase
      .from('users')
      .upsert(
        {
          google_id:   g.id,
          email:       g.email,
          name:        g.name,
          avatar_url:  g.picture,
          last_seen_at: new Date().toISOString(),
        },
        { onConflict: 'google_id', ignoreDuplicates: false }
      )
      .select('id, google_id, email, name, avatar_url, plan, plan_expires_at, created_at')
      .single()

    if (error) return json({ error: error.message }, 500)

    return json({ user, isNew })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}
