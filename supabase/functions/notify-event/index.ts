// SB Racing — notify-event Edge Function
// audience: "all" (default) | "admins" | "leaders" (admins + leaders)
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
    const audience = (body.audience || body.data?.audience || "all").toString().toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    let tokenQuery = supabase.from("push_tokens").select("token, platform, user_id").eq("platform", "ios");

    // Filter by role when audience is restricted
    if (audience === "admins" || audience === "leaders") {
      let profileQuery = supabase.from("profiles").select("id");
      if (audience === "admins") {
        profileQuery = profileQuery.eq("is_admin", true);
      } else {
        // leaders includes full admins
        profileQuery = profileQuery.or("is_leader.eq.true,is_admin.eq.true");
      }
      const { data: profiles, error: pErr } = await profileQuery;
      if (pErr) {
        return new Response(JSON.stringify({ error: pErr.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const ids = (profiles || []).map((p: { id: string }) => p.id);
      if (!ids.length) {
        return new Response(
          JSON.stringify({ sent: 0, message: "No users match audience " + audience }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      tokenQuery = tokenQuery.in("user_id", ids);
    }

    const { data: tokens, error: tokErr } = await tokenQuery;

    if (tokErr) {
      console.error("token fetch error", tokErr);
      return new Response(JSON.stringify({ error: tokErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tokens || tokens.length === 0) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No iOS tokens for audience " + audience }),
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

    for (const row of tokens) {
      const deviceToken = row.token;
      try {
        const apnsPayload = {
          aps: {
            alert: { title, body: message },
            sound: "default",
            badge: 1,
          },
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
      JSON.stringify({ sent, total: tokens.length, audience, results }),
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
