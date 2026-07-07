import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { googleToken } = await req.json()
    if (!googleToken) return json({ error: 'Missing googleToken' }, 400)

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
      .select('id, email, stripe_customer_id, plan')
      .eq('google_id', g.id)
      .single()

    if (!user) return json({ error: 'User not found' }, 404)
    if (user.plan === 'pro') return json({ error: 'Already on Pro plan' }, 400)

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

    // Create or reuse Stripe customer
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? g.email,
        name: g.name,
        metadata: { supabase_user_id: user.id, google_id: g.id },
      })
      customerId = customer.id
      await supabase.from('users').update({ stripe_customer_id: customerId }).eq('id', user.id)
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
      allow_promotion_codes: true,
      success_url: 'https://hokgbtrptddjgwgvvhrb.supabase.co/functions/v1/success-page?session_id={CHECKOUT_SESSION_ID}',
      cancel_url:  'https://hokgbtrptddjgwgvvhrb.supabase.co/functions/v1/cancel-page',
      metadata: { supabase_user_id: user.id },
    })

    return json({ url: session.url })
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
