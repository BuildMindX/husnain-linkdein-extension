import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { verifyIdentity, findUser, corsHeaders, json } from '../_shared/identity.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'


Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json()
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false } }
    )
    const v = await verifyIdentity(body, supabase)
    if ('error' in v) return json({ error: v.error }, v.status)
    const ident = v.identity
    const { user } = await findUser(supabase, ident)
    if (!user) return json({ error: 'User not found' }, 404)
    if (user.plan === 'pro') return json({ error: 'Already on Pro plan' }, 400)

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

    // Create or reuse Stripe customer
    let customerId = user.stripe_customer_id
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? ident.email,
        name: user.name ?? ident.name ?? undefined,
        metadata: { supabase_user_id: user.id },
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

