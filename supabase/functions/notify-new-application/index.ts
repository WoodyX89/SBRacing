/**
 * Called by a Supabase Database Webhook on club_applications INSERT.
 * Forwards a push through notify-event with audience: "admins".
 *
 * Dashboard:
 *   Database → Webhooks → Create
 *   Table: club_applications
 *   Events: INSERT
 *   URL: https://vuqwfpwtwacwvaofqjdp.supabase.co/functions/v1/notify-new-application
 *   HTTP headers:
 *     Authorization: Bearer <SERVICE_ROLE_KEY>
 *     Content-Type: application/json
 *
 * Deploy:
 *   supabase functions deploy notify-new-application --no-verify-jwt
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers":
          "authorization, x-client-info, apikey, content-type",
      },
    });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const auth = req.headers.get("Authorization") || "";
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secret = Deno.env.get("APPLICATION_WEBHOOK_SECRET") || "";
  const token = auth.replace(/^Bearer\s+/i, "");
  const headerSecret = req.headers.get("x-webhook-secret") || "";

  const ok =
    (service && token && token === service) ||
    (secret && (token === secret || headerSecret === secret));
  if (!ok) {
    return json({ error: "Unauthorized" }, 401);
  }

  let payload: {
    type?: string;
    record?: { full_name?: string; email?: string; status?: string };
    full_name?: string;
    email?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const rec = payload.record || payload;
  if (payload.type && payload.type !== "INSERT") {
    return json({ ok: true, skipped: "not insert" });
  }

  const name = (rec.full_name || "Someone").trim();
  const email = (rec.email || "").trim();
  const title = "New club application";
  const body = email ? name + " applied (" + email + ")" : name + " applied to join";

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const res = await fetch(supabaseUrl + "/functions/v1/notify-event", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + service,
      apikey: service,
    },
    body: JSON.stringify({
      title,
      body,
      audience: "admins",
      data: {
        url: "https://sbracing.ca/members",
        type: "club_application",
        audience: "admins",
      },
    }),
  });

  const text = await res.text();
  let data: unknown = text;
  try {
    data = JSON.parse(text);
  } catch {
    /* keep text */
  }
  if (!res.ok) {
    console.error("[notify-new-application] notify-event", res.status, data);
    return json({ error: data || "notify-event failed" }, 502);
  }
  return json({ ok: true, push: data });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
