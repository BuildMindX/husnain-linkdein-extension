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
    if (!user.stripe_customer_id) return json({ error: 'No billing account found. Please upgrade first.' }, 400)

    const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripe_customer_id,
      return_url: 'https://www.linkedin.com',
    })

    return json({ url: session.url })
  } catch (err) {
    return json({ error: (err as Error).message }, 500)
  }
})

