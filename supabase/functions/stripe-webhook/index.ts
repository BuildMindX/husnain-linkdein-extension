import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import Stripe from 'https://esm.sh/stripe@14?target=deno'

Deno.serve(async (req: Request) => {
  const signature = req.headers.get('stripe-signature')
  const body = await req.text()

  const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { apiVersion: '2024-06-20' })

  let event: Stripe.Event
  try {
    event = await stripe.webhooks.constructEventAsync(
      body,
      signature!,
      Deno.env.get('STRIPE_WEBHOOK_SECRET')!
    )
  } catch (err) {
    return new Response(`Webhook signature failed: ${(err as Error).message}`, { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  )

  if (event.type === 'checkout.session.completed') {
    const session = event.data.object as Stripe.Checkout.Session
    const userId = session.metadata?.supabase_user_id
    if (!userId) return new Response('Missing metadata', { status: 400 })

    const subscription = await stripe.subscriptions.retrieve(session.subscription as string)

    await supabase.from('users').update({
      plan:                    'pro',
      stripe_subscription_id:  subscription.id,
      plan_expires_at:         new Date(subscription.current_period_end * 1000).toISOString(),
    }).eq('id', userId)
  }

  if (event.type === 'customer.subscription.deleted' ||
      event.type === 'customer.subscription.updated') {
    const subscription = event.data.object as Stripe.Subscription

    const { data: user } = await supabase
      .from('users')
      .select('id')
      .eq('stripe_subscription_id', subscription.id)
      .single()

    if (user) {
      const isActive = subscription.status === 'active' || subscription.status === 'trialing'
      await supabase.from('users').update({
        plan:            isActive ? 'pro' : 'free',
        plan_expires_at: isActive
          ? new Date(subscription.current_period_end * 1000).toISOString()
          : null,
      }).eq('id', user.id)
    }
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { 'Content-Type': 'application/json' },
  })
})
