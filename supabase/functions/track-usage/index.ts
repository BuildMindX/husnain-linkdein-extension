import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyIdentity, findUser, corsHeaders, json } from '../_shared/identity.ts'


const FREE_LIMITS: Record<string, number> = {
  analysis: 50,
  message:  50,
  post:     50,
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const { eventType, metadata } = body
    if (!eventType) return json({ error: 'Missing eventType' }, 400)

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )
    const v = await verifyIdentity(body, supabase)
    if ('error' in v) return json({ error: v.error }, v.status)
    const { user } = await findUser(supabase, v.identity)
    if (!user) return json({ error: 'User not found — sign in first' }, 404)

    const isPro = user.plan === 'pro' &&
      (!user.plan_expires_at || new Date(user.plan_expires_at) > new Date())

    if (isPro) {
      await supabase.from('usage_events').insert({
        user_id:    user.id,
        event_type: eventType,
        metadata:   metadata ?? null,
      })
      return json({ allowed: true, plan: 'pro' })
    }

    // Atomic check-and-insert via Postgres RPC to avoid TOCTOU race
    const limit = FREE_LIMITS[eventType] ?? 20
    const monthStart = new Date()
    monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)

    const { data: rpcResult, error: rpcError } = await supabase.rpc('track_usage_atomic', {
      p_user_id:    user.id,
      p_event_type: eventType,
      p_metadata:   metadata ?? null,
      p_month_start: monthStart.toISOString(),
      p_limit:      limit,
    })

    if (rpcError) {
      // Fallback to non-atomic path if RPC not deployed yet
      const { count } = await supabase
        .from('usage_events')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('event_type', eventType)
        .gte('created_at', monthStart.toISOString())

      const usedThisMonth = count ?? 0
      if (usedThisMonth >= limit) {
        return json({ allowed: false, reason: 'free_limit_reached', limit, used: usedThisMonth, plan: 'free' })
      }
      await supabase.from('usage_events').insert({
        user_id:    user.id,
        event_type: eventType,
        metadata:   metadata ?? null,
      })
      return json({ allowed: true, plan: 'free', used: usedThisMonth + 1 })
    }

    if (!rpcResult?.allowed) {
      return json({ allowed: false, reason: 'free_limit_reached', limit, used: rpcResult?.used ?? limit, plan: 'free' })
    }

    return json({ allowed: true, plan: 'free', used: rpcResult.used })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

