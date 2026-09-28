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
    const rawItems = Array.isArray(body.items) ? body.items : [];
    const customer = body.customer || {};
    const origin = String(body.origin || Deno.env.get("SITE_URL") || "")
      .replace(/\/$/, "");

    if (!rawItems.length) {
      return json({ error: "Cart is empty" }, 400);
    }
    if (!customer.email || !customer.name) {
      return json({ error: "Name and email are required" }, 400);
    }
    if (!origin) {
      return json({ error: "Missing origin / SITE_URL" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const ids = rawItems
      .map((it: Record<string, unknown>) => it.productId ?? it.id)
      .filter((id: unknown) => id != null && String(id).length > 0)
      .map((id: unknown) => {
        const s = String(id);
        return /^\d+$/.test(s) ? Number(s) : s;
      });

    const productMap = new Map<string, Record<string, unknown>>();
    if (ids.length) {
      const { data: rows, error: prodErr } = await supabase
        .from("products")
        .select("id,name,price,stock_qty,is_active,size,color")
        .in("id", ids);
      if (prodErr) {
        console.error("products lookup", prodErr);
        return json({ error: "Could not load products" }, 500);
      }
      for (const row of rows || []) {
        productMap.set(String(row.id), row as Record<string, unknown>);
      }
    }

    const line_items: Stripe.Checkout.SessionCreateParams.LineItem[] = [];
    const snapshot: Record<string, unknown>[] = [];
    let total = 0;

    for (const it of rawItems) {
      const productId = it.productId != null ? String(it.productId) : (it.id != null ? String(it.id) : null);
      const db = productId ? productMap.get(productId) : null;
      if (productId && !db) {
        return json({ error: `Unknown product ${productId}` }, 400);
      }
      if (db && db.is_active === false) {
        return json({ error: `${db.name || "Item"} is no longer available` }, 400);
      }

      const name = String((db && db.name) || it.name || "Item").slice(0, 120);
      const size = String((db && db.size) || it.size || "").trim();
      const color = String((db && db.color) || it.color || "").trim();
      const unit = Math.round(Number((db && db.price) != null ? db.price : it.price) * 100);
      const qty = Math.max(1, Math.min(99, Number(it.qty) || 1));

      if (!Number.isFinite(unit) || unit < 50) {
        return json({ error: `Invalid price for ${name}` }, 400);
      }

      if (db) {
        const stock = Math.max(0, Number(db.stock_qty) || 0);
        if (stock < qty) {
          return json({
            error: stock <= 0
              ? `${name}${size ? " (" + size + ")" : ""} is sold out`
              : `Only ${stock} left of ${name}${size ? " (" + size + ")" : ""}`,
          }, 409);
        }
      }

      total += (unit * qty) / 100;
      line_items.push({
        quantity: qty,
        price_data: {
          currency: "cad",
          unit_amount: unit,
          product_data: {
            name: name + (size ? ` (${size})` : "") + (color ? ` — ${color}` : ""),
          },
        },
      });
      snapshot.push({
        productId: productId,
        name,
        price: unit / 100,
        qty,
        size: size || null,
        color: color || null,
      });
    }

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
      items: snapshot,
      total: Math.round(total * 100) / 100,
      status: "awaiting_payment",
      inventory_applied: false,
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
