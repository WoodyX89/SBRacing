// SB Racing — notify-event Edge Function
// audience: "all" (default) | "admins" | "leaders" (admins + leaders)
//
// iOS  → APNs (.p8 secrets)
// Android → FCM HTTP v1 (FCM_SERVICE_ACCOUNT JSON secret)
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type TokenRow = {
  token: string;
  platform?: string | null;
  user_id?: string | null;
  badge_count?: number | null;
};

function platformOf(row: TokenRow): "ios" | "android" | "other" {
  const p = String(row.platform || "").toLowerCase();
  if (p === "android") return "android";
  if (p === "ios") return "ios";
  // FCM tokens look like "<id>:APA91b..."
  if (String(row.token || "").includes(":APA91")) return "android";
  return "ios";
}

async function getFcmAccessToken(saRaw: string): Promise<{ token: string; projectId: string }> {
  const sa = JSON.parse(saRaw);
  const projectId = String(sa.project_id || Deno.env.get("FCM_PROJECT_ID") || "sb-racing-914fd");
  const email = sa.client_email;
  const key = String(sa.private_key || "").replace(/\\n/g, "\n");
  if (!email || !key) throw new Error("FCM_SERVICE_ACCOUNT missing client_email or private_key");

  const privateKey = await importPKCS8(key, "RS256");
  const jwt = await new SignJWT({
    scope: "https://www.googleapis.com/auth/firebase.messaging",
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(email)
    .setSubject(email)
    .setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);

  const tokRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  const tokJson = await tokRes.json();
  if (!tokRes.ok || !tokJson.access_token) {
    throw new Error("FCM oauth failed: " + JSON.stringify(tokJson));
  }
  return { token: tokJson.access_token as string, projectId };
}

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

    async function callerUserId(): Promise<string | null> {
      try {
        const authHeader = req.headers.get("Authorization") || "";
        if (!authHeader.startsWith("Bearer ")) return null;
        const { data: userData } = await supabase.auth.getUser(authHeader.slice(7));
        return userData?.user?.id || null;
      } catch (_) {
        return null;
      }
    }

    async function callerIsAdmin(): Promise<{ userId: string | null; admin: boolean }> {
      const userId = await callerUserId();
      if (!userId) return { userId: null, admin: false };
      const { data: profile } = await supabase
        .from("profiles")
        .select("is_admin")
        .eq("id", userId)
        .maybeSingle();
      return { userId, admin: !!(profile && profile.is_admin) };
    }

    async function readPushEnabled(): Promise<boolean> {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", "push_enabled")
        .maybeSingle();
      if (error || !data) return true;
      const v = data.value;
      if (v === false || v === "false" || v === 0 || v === "0") return false;
      if (typeof v === "object" && v !== null && "enabled" in (v as Record<string, unknown>)) {
        return (v as { enabled?: unknown }).enabled !== false;
      }
      return v !== false;
    }

    if (action === "get-push-enabled") {
      const enabled = await readPushEnabled();
      return new Response(JSON.stringify({ ok: true, enabled }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "set-push-enabled") {
      const { userId, admin } = await callerIsAdmin();
      if (!admin) {
        return new Response(JSON.stringify({ error: "Admins only" }), {
          status: 403,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const enabled = !(body.enabled === false || body.enabled === "false" || body.enabled === 0);
      const { error } = await supabase.from("app_settings").upsert({
        key: "push_enabled",
        value: enabled,
        updated_at: new Date().toISOString(),
        updated_by: userId,
      }, { onConflict: "key" });
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ ok: true, enabled }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        await supabase.from("push_tokens").update({ badge_count: 0, updated_at: new Date().toISOString() }).eq("token", token);
      } else if (userId) {
        await supabase.from("push_tokens").update({ badge_count: 0, updated_at: new Date().toISOString() }).eq("user_id", userId);
      } else {
        return new Response(JSON.stringify({ error: "clear-badge requires user_id or token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, action: "clear-badge" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

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
        await supabase.from("push_tokens").update({ badge_count: count, updated_at: new Date().toISOString() }).eq("token", token);
      } else if (userId) {
        await supabase.from("push_tokens").update({ badge_count: count, updated_at: new Date().toISOString() }).eq("user_id", userId);
      } else {
        return new Response(JSON.stringify({ error: "set-badge requires user_id or token" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ ok: true, action: "set-badge", badge: count }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action) {
      return new Response(JSON.stringify({ error: "Unknown action: " + action }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const title = (body.title || "SB Racing").toString().slice(0, 80);
    const message = (body.body || body.message || "").toString().slice(0, 200);
    const data = body.data || {};
    const audience = (body.audience || body.data?.audience || "all").toString().toLowerCase();

    const pushEnabled = await readPushEnabled();
    if (!pushEnabled) {
      return new Response(
        JSON.stringify({
          sent: 0,
          paused: true,
          message: "Club push notifications are paused by an admin",
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const excludeUserId = (body.exclude_user_id || body.excludeUserId || "").toString() || null;
    const badgeOverride =
      body.badge != null && body.badge !== "" ? Math.max(0, Math.min(99, Number(body.badge))) : null;

    let tokenQuery = supabase
      .from("push_tokens")
      .select("token, platform, user_id, badge_count");

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
      tokens = tokens.filter((row: TokenRow) => row.user_id !== excludeUserId);
    }

    if (!tokErr && tokens && tokens.length) {
      const type = (data.type || body.type || "").toString().toLowerCase();
      const userIds = Array.from(
        new Set(
          tokens
            .map((row: TokenRow) => row.user_id)
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
          tokens = tokens.filter((row: TokenRow) => {
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
        JSON.stringify({ sent: 0, message: "No device tokens registered" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const iosRows = tokens.filter((r: TokenRow) => platformOf(r) === "ios");
    const androidRows = tokens.filter((r: TokenRow) => platformOf(r) === "android");

    const results: { token: string; platform: string; status: number; badge?: number; reason?: string }[] = [];
    let sent = 0;

    // ── iOS / APNs ──────────────────────────────────────────────────────────
    if (iosRows.length) {
      const keyId = Deno.env.get("APNS_KEY_ID");
      const teamId = Deno.env.get("APNS_TEAM_ID");
      const bundleId = Deno.env.get("APNS_BUNDLE_ID") || "ca.sbracing.app";
      const p8 = Deno.env.get("APNS_P8");
      const production = (Deno.env.get("APNS_PRODUCTION") || "false").toLowerCase() === "true";

      if (!keyId || !teamId || !p8) {
        for (const row of iosRows) {
          results.push({ token: String(row.token).slice(0, 12) + "…", platform: "ios", status: 0, reason: "missing APNs secrets" });
        }
      } else {
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

        for (const row of iosRows) {
          const deviceToken = row.token;
          try {
            const current = Number(row.badge_count) || 0;
            const badge = badgeOverride != null ? badgeOverride : Math.min(99, current + 1);
            const apnsPayload = {
              aps: { alert: { title, body: message }, sound: "default", badge },
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
              results.push({ token: deviceToken.slice(0, 12) + "…", platform: "ios", status: 200, badge });
              await supabase.from("push_tokens").update({ badge_count: badge, updated_at: new Date().toISOString() }).eq("token", deviceToken);
            } else {
              const errBody = await res.text();
              let reason = errBody;
              try { reason = JSON.parse(errBody).reason || errBody; } catch (_) {}
              results.push({ token: deviceToken.slice(0, 12) + "…", platform: "ios", status: res.status, reason });
              if (res.status === 410 || reason === "Unregistered" || reason === "BadDeviceToken") {
                await supabase.from("push_tokens").delete().eq("token", deviceToken);
              }
            }
          } catch (e) {
            results.push({ token: String(deviceToken).slice(0, 12) + "…", platform: "ios", status: 0, reason: String(e) });
          }
        }
      }
    }

    // ── Android / FCM ───────────────────────────────────────────────────────
    if (androidRows.length) {
      const saRaw = Deno.env.get("FCM_SERVICE_ACCOUNT") || "";
      if (!saRaw) {
        for (const row of androidRows) {
          results.push({ token: String(row.token).slice(0, 12) + "…", platform: "android", status: 0, reason: "missing FCM_SERVICE_ACCOUNT" });
        }
      } else {
        try {
          const { token: accessToken, projectId } = await getFcmAccessToken(saRaw);
          const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;
          const dataStr: Record<string, string> = {};
          for (const [k, v] of Object.entries(data || {})) {
            if (v == null) continue;
            dataStr[String(k)] = typeof v === "string" ? v : JSON.stringify(v);
          }
          if (!dataStr.url) dataStr.url = "events.html";

          for (const row of androidRows) {
            const deviceToken = row.token;
            try {
              const current = Number(row.badge_count) || 0;
              const badge = badgeOverride != null ? badgeOverride : Math.min(99, current + 1);
              const res = await fetch(fcmUrl, {
                method: "POST",
                headers: {
                  Authorization: "Bearer " + accessToken,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  message: {
                    token: deviceToken,
                    notification: { title, body: message },
                    data: dataStr,
                    android: {
                      priority: "HIGH",
                      notification: { sound: "default", notification_count: badge },
                    },
                  },
                }),
              });
              if (res.ok) {
                sent++;
                results.push({ token: deviceToken.slice(0, 12) + "…", platform: "android", status: 200, badge });
                await supabase.from("push_tokens").update({ badge_count: badge, updated_at: new Date().toISOString() }).eq("token", deviceToken);
              } else {
                const errBody = await res.text();
                results.push({ token: deviceToken.slice(0, 12) + "…", platform: "android", status: res.status, reason: errBody.slice(0, 300) });
                if (res.status === 404 || /UNREGISTERED|NOT_FOUND/i.test(errBody)) {
                  await supabase.from("push_tokens").delete().eq("token", deviceToken);
                }
              }
            } catch (e) {
              results.push({ token: String(deviceToken).slice(0, 12) + "…", platform: "android", status: 0, reason: String(e) });
            }
          }
        } catch (e) {
          for (const row of androidRows) {
            results.push({ token: String(row.token).slice(0, 12) + "…", platform: "android", status: 0, reason: String(e) });
          }
        }
      }
    }

    return new Response(
      JSON.stringify({
        sent,
        total: tokens.length,
        ios: iosRows.length,
        android: androidRows.length,
        audience,
        results,
      }),
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
