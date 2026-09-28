// SB Racing — poll whether a Stripe checkout session is paid
// Deploy: supabase functions deploy checkout-status --no-verify-jwt
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

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
    const url = new URL(req.url);
    let sessionId = url.searchParams.get("session_id") || url.searchParams.get("sessionId") || "";
    let orderId = url.searchParams.get("order_id") || url.searchParams.get("orderId") || "";

    if (req.method === "POST") {
      const body = await req.json().catch(() => ({}));
      sessionId = String(body.sessionId || body.session_id || sessionId || "");
      orderId = String(body.orderId || body.order_id || orderId || "");
    }

    sessionId = sessionId.trim();
    orderId = orderId.trim();
    if (!sessionId && !orderId) {
      return json({ error: "session_id or order_id required" }, 400);
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let query = supabase
      .from("orders")
      .select("id,status,paid_at,inventory_applied,stripe_session_id")
      .limit(1);

    if (sessionId) query = query.eq("stripe_session_id", sessionId);
    else query = query.eq("id", orderId);

    const { data, error } = await query.maybeSingle();
    if (error) {
      console.error("checkout-status", error);
      return json({ error: "Lookup failed" }, 500);
    }
    if (!data) {
      return json({ paid: false, status: "unknown" });
    }

    const paid = data.status === "paid" || data.status === "shipped";
    return json({
      paid,
      status: data.status,
      orderId: data.id,
      sessionId: data.stripe_session_id,
      inventoryApplied: !!data.inventory_applied,
      paidAt: data.paid_at,
    });
  } catch (err) {
    console.error(err);
    return json({ error: "Status check failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
