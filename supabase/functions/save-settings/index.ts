import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { googleToken, settings } = await req.json()
    if (!googleToken || !settings) return json({ error: 'Missing googleToken or settings' }, 400)

    const gRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${googleToken}` },
    })
    if (!gRes.ok) return json({ error: 'Invalid token' }, 401)
    const g = await gRes.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )

    const { error } = await supabase
      .from('users')
      .update({ settings, last_seen_at: new Date().toISOString() })
      .eq('google_id', g.id)

    if (error) return json({ error: error.message }, 500)

    return json({ ok: true })
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
