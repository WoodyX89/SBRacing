// SB Racing — notify-event Edge Function
// Sends remote push to all registered iOS (APNs) devices.
// Secrets required (set via `supabase secrets set`):
//   APNS_KEY_ID, APNS_TEAM_ID, APNS_BUNDLE_ID, APNS_P8, APNS_PRODUCTION

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://deno.land/x/jose@v5.9.6/index.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json().catch(() => ({}));
    const title = (body.title || "SB Racing").toString().slice(0, 80);
    const message = (body.body || body.message || "").toString().slice(0, 200);
    const data = body.data || {};

    // Service-role client so we can read every token
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: tokens, error: tokErr } = await supabase
      .from("push_tokens")
      .select("token, platform")
      .eq("platform", "ios");

    if (tokErr) {
      console.error("token fetch error", tokErr);
      return new Response(JSON.stringify({ error: tokErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No iOS tokens registered yet" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const keyId = Deno.env.get("APNS_KEY_ID");
    const teamId = Deno.env.get("APNS_TEAM_ID");
    const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "ca.sbracing.app";
    const p8 = Deno.env.get("APNS_P8");
    const production = (Deno.env.get("APNS_PRODUCTION") || "false").toLowerCase() === "true";

    if (!keyId || !teamId || !p8) {
      return new Response(
        JSON.stringify({
          error: "Missing APNs secrets. Set APNS_KEY_ID, APNS_TEAM_ID, APNS_P8",
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Build APNs JWT (valid ~1 hour)
    const privateKey = await importPKCS8(p8.replace(/\\n/g, "\n"), "ES256");
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: "ES256", kid: keyId })
      .setIssuer(teamId)
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(privateKey);

    const host = production
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";

    const results: { token: string; status: number; reason?: string }[] = [];
    let sent = 0;

    // Send sequentially to keep it simple (small club size is fine)
    for (const row of tokens) {
      const deviceToken = row.token;
      try {
        const apnsPayload = {
          aps: {
            alert: { title, body: message },
            sound: "default",
            badge: 1,
          },
          // custom data the app can read
          ...data,
        };

        const res = await fetch(`${host}/3/device/${deviceToken}`, {
          method: "POST",
          headers: {
            authorization: `bearer ${jwt}`,
            "apns-topic": bundleId,
            "apns-push-type": "alert",
            "apns-priority": "10",
            "content-type": "application/json",
          },
          body: JSON.stringify(apnsPayload),
        });

        if (res.status === 200) {
          sent++;
          results.push({ token: deviceToken.slice(0, 12) + "…", status: 200 });
        } else {
          const errBody = await res.text();
          let reason = errBody;
          try {
            reason = JSON.parse(errBody).reason || errBody;
          } catch (_) {}
          results.push({
            token: deviceToken.slice(0, 12) + "…",
            status: res.status,
            reason,
          });

          // Clean up dead tokens
          if (res.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
            await supabase.from("push_tokens").delete().eq("token", deviceToken);
          }
        }
      } catch (e) {
        results.push({
          token: deviceToken.slice(0, 12) + "…",
          status: 0,
          reason: String(e),
        });
      }
    }

    return new Response(
      JSON.stringify({ sent, total: tokens.length, results }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error(err);
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
