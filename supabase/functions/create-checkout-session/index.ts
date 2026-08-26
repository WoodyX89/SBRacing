// SB Racing — create Stripe Checkout Session for merch cart
// Secrets: STRIPE_SECRET_KEY, SITE_URL (optional fallback)
// Deploy: supabase functions deploy create-checkout-session --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import Stripe from "https://esm.sh/stripe@14.25.0?target=deno";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return json({ error: "STRIPE_SECRET_KEY not configured" }, 500);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const body = await req.json().catch(() => ({}));
    const items = Array.isArray(body.items) ? body.items : [];
    const customer = body.customer || {};
    const origin = String(body.origin || Deno.env.get("SITE_URL") || "")
      .replace(/\/$/, "");

    if (!items.length) {
      return json({ error: "Cart is empty" }, 400);
    }
    if (!customer.email || !customer.name) {
      return json({ error: "Name and email are required" }, 400);
    }
    if (!origin) {
      return json({ error: "Missing origin / SITE_URL" }, 400);
    }

    // Build Stripe line items (amounts in cents)
    const line_items = [];
    let total = 0;
    for (const it of items) {
      const name = String(it.name || "Item").slice(0, 120);
      const size = it.size ? ` (${it.size})` : "";
      const color = it.color ? ` — ${it.color}` : "";
      const unit = Math.round(Number(it.price) * 100);
      const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));
      if (!Number.isFinite(unit) || unit < 50) {
        return json({ error: `Invalid price for ${name}` }, 400);
      }
      total += (unit * qty) / 100;
      line_items.push({
        quantity: qty,
        price_data: {
          currency: "cad",
          unit_amount: unit,
          product_data: {
            name: name + size + color,
          },
        },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // Optional auth user
    let userId: string | null = null;
    try {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader.startsWith("Bearer ")) {
        const { data } = await supabase.auth.getUser(authHeader.slice(7));
        if (data?.user?.id) userId = data.user.id;
      }
    } catch (_) {}

    const orderPayload: Record<string, unknown> = {
      user_id: userId,
      customer_name: String(customer.name).trim(),
      customer_email: String(customer.email).trim().toLowerCase(),
      customer_phone: customer.phone || null,
      shipping_address: customer.address || null,
      shipping_city: customer.city || null,
      shipping_province: customer.province || null,
      shipping_postal: customer.postal || null,
      notes: customer.notes || null,
      items: items.map((it: Record<string, unknown>) => ({
        productId: it.productId ?? null,
        name: it.name,
        price: Number(it.price),
        qty: Number(it.qty) || 1,
        size: it.size || null,
        color: it.color || null,
      })),
      total: Math.round(total * 100) / 100,
      status: "awaiting_payment",
    };

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .insert(orderPayload)
      .select("id")
      .single();

    if (orderErr || !order) {
      console.error("order insert", orderErr);
      return json({ error: orderErr?.message || "Could not create order" }, 500);
    }

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items,
      customer_email: String(customer.email).trim(),
      success_url:
        origin + "/merch.html?checkout=success&session_id={CHECKOUT_SESSION_ID}",
      cancel_url: origin + "/merch.html?checkout=cancel",
      metadata: {
        order_id: String(order.id),
      },
      shipping_address_collection: undefined,
    });

    await supabase
      .from("orders")
      .update({ stripe_session_id: session.id })
      .eq("id", order.id);

    return json({ url: session.url, orderId: order.id, sessionId: session.id });
  } catch (err) {
    console.error(err);
    return json(
      { error: err instanceof Error ? err.message : "Checkout failed" },
      500,
    );
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
