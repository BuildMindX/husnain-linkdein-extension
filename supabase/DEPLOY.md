# LinkPilot AI — Supabase + Stripe Deploy Guide

## 1. Run Schema
In Supabase Dashboard → SQL Editor → paste and run `../schema.sql`

## 2. Set Secrets
Run these in your terminal (requires Supabase CLI):

```bash
npx supabase secrets set \
  STRIPE_SECRET_KEY=sk_test_YOUR_STRIPE_SECRET_KEY \
  STRIPE_PRICE_ID=REPLACE_WITH_PRICE_ID_FROM_STRIPE_DASHBOARD \
  STRIPE_WEBHOOK_SECRET=REPLACE_AFTER_REGISTERING_WEBHOOK \
  --project-ref hokgbtrptddjgwgvvhrb
```

## 3. Deploy Edge Functions
```bash
npx supabase functions deploy sync-user --project-ref hokgbtrptddjgwgvvhrb
npx supabase functions deploy track-usage --project-ref hokgbtrptddjgwgvvhrb
npx supabase functions deploy create-checkout --project-ref hokgbtrptddjgwgvvhrb
npx supabase functions deploy stripe-webhook --project-ref hokgbtrptddjgwgvvhrb
```

## 4. Create Stripe Product (in Stripe Dashboard)
1. Products → Add Product → "LinkPilot AI Pro"
2. Add price → Recurring → Monthly → set your price
3. Copy the Price ID (price_xxx) → use in STRIPE_PRICE_ID above

## 5. Register Stripe Webhook
1. Stripe Dashboard → Developers → Webhooks → Add endpoint
2. Endpoint URL: `https://hokgbtrptddjgwgvvhrb.supabase.co/functions/v1/stripe-webhook`
3. Events to listen: `checkout.session.completed`, `customer.subscription.deleted`, `customer.subscription.updated`
4. Copy Signing Secret → use as STRIPE_WEBHOOK_SECRET above

## 6. Fix Google OAuth (IMPORTANT)
The current OAuth client fails because it is the wrong type.
In Google Cloud Console → Credentials:
1. DELETE the existing client (592927077998-osav10sc75ghl2rnokm9c60g89tafdhq)
2. Create Credentials → OAuth 2.0 Client ID
3. Application type: **Chrome Extension** (NOT Web Application)
4. Application ID: ofloohhjdcggabbbmimgbbekdpjnkmof
5. Copy new Client ID → update manifest.json oauth2.client_id
