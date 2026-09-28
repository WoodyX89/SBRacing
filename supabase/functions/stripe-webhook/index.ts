// SB Racing — Stripe webhook → mark orders paid + decrement inventory
// Secrets: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET
// Deploy: supabase functions deploy stripe-webhook --no-verify-jwt
// Stripe Dashboard → Webhooks → endpoint:
//   https://<PROJECT>.supabase.co/functions/v1/stripe-webhook
// Events: checkout.session.completed
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, stripe-signature",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
  if (!stripeKey || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }

  const stripe = new Stripe(stripeKey, {
    apiVersion: "2023-10-16",
    httpClient: Stripe.createFetchHttpClient(),
  });

  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return new Response("Missing signature", { status: 400 });
  }

  const body = await req.text();
  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err) {
    console.error("webhook signature", err);
    return new Response(
      `Webhook Error: ${err instanceof Error ? err.message : "invalid"}`,
      { status: 400 },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const paid = session.payment_status === "paid" || session.status === "complete";
      if (!paid && session.payment_status && session.payment_status !== "no_payment_required") {
        console.log("session not paid yet", session.id, session.payment_status);
      }

      const paymentIntent =
        typeof session.payment_intent === "string"
          ? session.payment_intent
          : session.payment_intent?.id || null;

      let orderId = session.metadata?.order_id || null;
      if (!orderId && session.id) {
        const { data } = await supabase
          .from("orders")
          .select("id")
          .eq("stripe_session_id", session.id)
          .maybeSingle();
        orderId = data?.id || null;
      }

      if (orderId) {
        await supabase
          .from("orders")
          .update({
            status: "paid",
            stripe_session_id: session.id,
            stripe_payment_intent: paymentIntent,
            paid_at: new Date().toISOString(),
          })
          .eq("id", orderId);

        const { data: inv, error: invErr } = await supabase.rpc(
          "apply_paid_order_inventory",
          { p_order_id: orderId },
        );
        if (invErr) {
          console.error("inventory rpc", invErr);
          return new Response("Inventory update failed", { status: 500 });
        }
        console.log("inventory", orderId, inv);
      } else if (session.id) {
        await supabase
          .from("orders")
          .update({
            status: "paid",
            stripe_payment_intent: paymentIntent,
            paid_at: new Date().toISOString(),
          })
          .eq("stripe_session_id", session.id);
      }
    }

    if (event.type === "checkout.session.expired") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orderId = session.metadata?.order_id;
      if (orderId) {
        await supabase
          .from("orders")
          .update({ status: "expired" })
          .eq("id", orderId)
          .eq("status", "awaiting_payment");
      }
    }
  } catch (e) {
    console.error("webhook handler", e);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
