import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const FREE_LIMITS: Record<string, number> = {
  analysis: 20,
  message:  30,
  post:     15,
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { googleToken, eventType, metadata } = await req.json()
    if (!googleToken || !eventType) return json({ error: 'Missing googleToken or eventType' }, 400)

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

    const { data: user } = await supabase
      .from('users')
      .select('id, plan, plan_expires_at')
      .eq('google_id', g.id)
      .single()

    if (!user) return json({ error: 'User not found — sign in first' }, 404)

    const isPro = user.plan === 'pro' &&
      (!user.plan_expires_at || new Date(user.plan_expires_at) > new Date())

    let usedThisMonth = 0
    if (!isPro) {
      const monthStart = new Date()
      monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

      const { count } = await supabase
        .from('usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('event_type', eventType)
        .gte('created_at', monthStart.toISOString())

      usedThisMonth = count ?? 0
      const limit = FREE_LIMITS[eventType] ?? 20

      if (usedThisMonth >= limit) {
        return json({ allowed: false, reason: 'free_limit_reached', limit, used: usedThisMonth, plan: 'free' })
      }
    }

    await supabase.from('usage_events').insert({
      user_id:    user.id,
      event_type: eventType,
      metadata:   metadata ?? null,
    })

    return json({ allowed: true, plan: user.plan, used: usedThisMonth + 1 })
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
