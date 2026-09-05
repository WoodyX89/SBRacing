import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED = new Set([
  "https://sbracing.ca",
  "https://www.sbracing.ca",
  "capacitor://localhost",
  "ionic://localhost",
  "https://localhost",
  "http://localhost",
  "http://localhost:5173",
  "http://localhost:8080",
]);

function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  return {
    "Access-Control-Allow-Origin": ALLOWED.has(origin) ? origin : "https://sbracing.ca",
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };
}

function json(req: Request, obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }
  if (req.method !== "POST") {
    return json(req, { error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization") || "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json(req, { error: "Not signed in" }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return json(req, { error: "Admin only" }, 403);
  }

  const { to, name, acceptUrl } = await req.json();
  if (!to || !acceptUrl) {
    return json(req, { error: "Missing to or acceptUrl" }, 400);
  }

  const html = `
    <p>Hey ${escapeHtml(name || "")},</p>
    <p>Your SB Racing application was approved.</p>
    <p><a href="${escapeHtml(acceptUrl)}">Create your login</a></p>
    <p>Use the same email you applied with, set a password, then sign in at
    <a href="https://sbracing.ca/members">sbracing.ca/members</a>.</p>
    <p>— Soggy Bottom Racing</p>
  `;

  const res = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": Deno.env.get("SMTP2GO_API_KEY")!,
    },
    body: JSON.stringify({
      sender: Deno.env.get("MAIL_FROM"),
      to: [to],
      subject: "You are in — SB Racing",
      text_body: `Your application was approved. Create your login: ${acceptUrl}`,
      html_body: html,
    }),
  });

  const body = await res.json();
  if (!res.ok || body?.data?.failed) {
    return json(req, { error: body?.data?.failures?.[0] || body || "Send failed" }, 502);
  }
  return json(req, { ok: true, email_id: body?.data?.email_id });
});
