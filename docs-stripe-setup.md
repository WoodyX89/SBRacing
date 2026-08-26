# SB Racing — Stripe merch checkout setup

## What was added

- Checkout button sends cart + shipping to Supabase Edge Function `create-checkout-session`
- Customer pays on **Stripe Checkout** (hosted)
- Webhook `stripe-webhook` marks the order `paid` in Supabase
- Return URLs: `merch.html?checkout=success` / `cancel`

## 1. SQL

In Supabase → SQL Editor, run:

`supabase/stripe_orders.sql`

## 2. Stripe keys

Dashboard → Developers → API keys (start in **Test mode**):

- Secret key `sk_test_…`
- (Publishable key not required for Checkout Session flow)

## 3. Supabase secrets

```bash
supabase secrets set STRIPE_SECRET_KEY=sk_test_...
supabase secrets set SITE_URL=https://YOUR_PUBLIC_SITE
# after creating webhook:
supabase secrets set STRIPE_WEBHOOK_SECRET=whsec_...
```

`SITE_URL` must be your real HTTPS site (success/cancel return).  
Native app users should still return to that HTTPS merch page (or set `window.SB_SITE_URL` in config).

## 4. Deploy functions

```bash
supabase functions deploy create-checkout-session --no-verify-jwt
supabase functions deploy stripe-webhook --no-verify-jwt
```

## 5. Webhook in Stripe

Developers → Webhooks → Add endpoint:

- URL: `https://vuqwfpwtwacwvaofqjdp.supabase.co/functions/v1/stripe-webhook`
- Event: `checkout.session.completed`
- Copy signing secret → `STRIPE_WEBHOOK_SECRET`

## 6. Test

1. Add merch to cart → Checkout → **Pay with card**
2. Card: `4242 4242 4242 4242`, any future expiry, any CVC
3. After pay, land on merch success toast; order status becomes `paid` (via webhook)

## 7. Go live

- Switch Stripe to live keys
- Set `STRIPE_SECRET_KEY=sk_live_...`
- New live webhook + `whsec_...`
- Redeploy or update secrets only

## Optional

In `js/supabase-config.js` you can set:

```js
window.SB_SITE_URL = 'https://sbracing.ca';
```

so Capacitor builds always return to the public site after Stripe.
