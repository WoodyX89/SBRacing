// SB Racing — notify-event Edge Function
// audience: "all" (default) | "admins" | "leaders" (admins + leaders)
//
// Badge behaviour:
//   - Each successful push increments that device's badge_count and sends aps.badge
//   - Client calls action: "clear-badge" when user taps Clear all (resets to 0)
//   - Optional body.badge = absolute number overrides the increment for that send
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
    const action = (body.action || "").toString().toLowerCase();

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ── Clear home-screen badge for this user's devices ─────────────────────
    if (action === "clear-badge") {
      let userId = body.user_id || null;
      const token = body.token || null;

      try {
        const authHeader = req.headers.get("Authorization") || "";
        if (authHeader.startsWith("Bearer ")) {
          const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
          if (userData?.user?.id) userId = userData.user.id;
        }
      } catch (_) {}

      if (token) {
        await supabase
          .from("push_tokens")
          .update({ badge_count: 0, updated_at: new Date().toISOString() })
          .eq("token", token);
      } else if (userId) {
        await supabase
          .from("push_tokens")
          .update({ badge_count: 0, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      } else {
        return new Response(
          JSON.stringify({ error: "clear-badge requires user_id or token" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ ok: true, action: "clear-badge" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Set absolute badge (optional, used by client sync) ───────────────────
    if (action === "set-badge") {
      const token = body.token || null;
      let userId = body.user_id || null;
      const count = Math.max(0, Math.min(99, Number(body.badge) || 0));

      try {
        const authHeader = req.headers.get("Authorization") || "";
        if (authHeader.startsWith("Bearer ")) {
          const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
          if (userData?.user?.id) userId = userData.user.id;
        }
      } catch (_) {}

      if (token) {
        await supabase
          .from("push_tokens")
          .update({ badge_count: count, updated_at: new Date().toISOString() })
          .eq("token", token);
      } else if (userId) {
        await supabase
          .from("push_tokens")
          .update({ badge_count: count, updated_at: new Date().toISOString() })
          .eq("user_id", userId);
      } else {
        return new Response(
          JSON.stringify({ error: "set-badge requires user_id or token" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }

      return new Response(
        JSON.stringify({ ok: true, action: "set-badge", badge: count }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // ── Send push ────────────────────────────────────────────────────────────
    const title = (body.title || "SB Racing").toString().slice(0, 80);
    const message = (body.body || body.message || "").toString().slice(0, 200);
    const data = body.data || {};
    const audience = (body.audience || body.data?.audience || "all").toString().toLowerCase();
    const excludeUserId = (body.exclude_user_id || body.excludeUserId || "").toString() || null;
    const badgeOverride =
      body.badge != null && body.badge !== "" ? Math.max(0, Math.min(99, Number(body.badge))) : null;

    let tokenQuery = supabase
      .from("push_tokens")
      .select("token, platform, user_id, badge_count")
      .eq("platform", "ios");

    if (audience === "admins" || audience === "leaders") {
      let profileQuery = supabase.from("profiles").select("id");
      if (audience === "admins") {
        profileQuery = profileQuery.eq("is_admin", true);
      } else {
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

    let { data: tokens, error: tokErr } = await tokenQuery;
    if (!tokErr && tokens && excludeUserId) {
      tokens = tokens.filter((row: { user_id?: string | null }) => row.user_id !== excludeUserId);
    }

    // Honour per-user notification prefs on profiles (missing columns = allow)
    if (!tokErr && tokens && tokens.length) {
      const type = (data.type || body.type || "").toString().toLowerCase();
      const userIds = Array.from(
        new Set(
          tokens
            .map((row: { user_id?: string | null }) => row.user_id)
            .filter((id: string | null | undefined): id is string => !!id),
        ),
      );
      if (userIds.length) {
        const { data: prefs, error: prefErr } = await supabase
          .from("profiles")
          .select("id, notify_push, notify_events, notify_forum, notify_comments, notify_rsvp, notify_admin")
          .in("id", userIds);
        if (!prefErr && prefs) {
          const allow = new Set<string>();
          for (const p of prefs as {
            id: string;
            notify_push?: boolean | null;
            notify_events?: boolean | null;
            notify_forum?: boolean | null;
            notify_comments?: boolean | null;
            notify_rsvp?: boolean | null;
            notify_admin?: boolean | null;
          }[]) {
            if (p.notify_push === false) continue;
            let ok = true;
            if (type === "admin") ok = p.notify_admin !== false;
            else if (type === "rsvp") ok = p.notify_rsvp !== false;
            else if (type === "forum_comment" || type === "event_comment") ok = p.notify_comments !== false;
            else if (type === "forum_post" || type === "forum_poll") ok = p.notify_forum !== false;
            else if (
              type === "event" ||
              type === "event_edit" ||
              type === "event_delete" ||
              type === "event_reminder"
            ) ok = p.notify_events !== false;
            if (ok) allow.add(p.id);
          }
          tokens = tokens.filter((row: { user_id?: string | null }) => {
            if (!row.user_id) return true;
            return allow.has(row.user_id);
          });
        }
      }
    }

    if (tokErr) {
      console.error("token fetch error", tokErr);
      return new Response(JSON.stringify({ error: tokErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!tokens || !tokens.length) {
      return new Response(
        JSON.stringify({ sent: 0, message: "No iOS tokens registered" }),
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
          error: "Missing APNs secrets: APNS_KEY_ID, APNS_TEAM_ID, APNS_P8",
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

    const results: { token: string; status: number; badge?: number; reason?: string }[] = [];
    let sent = 0;

    for (const row of tokens) {
      const deviceToken = row.token;
      try {
        const current = Number(row.badge_count) || 0;
        const badge =
          badgeOverride != null ? badgeOverride : Math.min(99, current + 1);

        const apnsPayload = {
          aps: {
            alert: { title, body: message },
            sound: "default",
            badge: badge,
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
          results.push({
            token: deviceToken.slice(0, 12) + "…",
            status: 200,
            badge,
          });
          await supabase
            .from("push_tokens")
            .update({
              badge_count: badge,
              updated_at: new Date().toISOString(),
            })
            .eq("token", deviceToken);
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
          if (
            res.status === 410 ||
            reason === "Unregistered" ||
            reason === "BadDeviceToken"
          ) {
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
