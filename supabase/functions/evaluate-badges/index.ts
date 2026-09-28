// Deploy: supabase functions deploy evaluate-badges --no-verify-jwt
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));
    let userId = String(body.userId || body.user_id || "");

    const authHeader = req.headers.get("Authorization") || "";
    if (authHeader.startsWith("Bearer ")) {
      const { data } = await supabase.auth.getUser(authHeader.slice(7));
      if (data?.user?.id) userId = data.user.id;
    }
    if (!userId) {
      return json({ error: "Not signed in" }, 401);
    }

    const { data, error } = await supabase.rpc("evaluate_member_badges", {
      p_user_id: userId,
    });
    if (error) return json({ error: error.message }, 500);
    return json(data || { ok: true, awarded: [] });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "failed" }, 500);
  }
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
