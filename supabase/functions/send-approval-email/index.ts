import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const cors = {
  "Access-Control-Allow-Origin": "https://sbracing.ca",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: cors });

  const authHeader = req.headers.get("Authorization") || "";
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authHeader } } }
  );

  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) {
    return json({ error: "Not signed in" }, 401);
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) {
    return json({ error: "Admin only" }, 403);
  }

  const { to, name, acceptUrl } = await req.json();
  if (!to || !acceptUrl) return json({ error: "Missing to or acceptUrl" }, 400);

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
    return json({ error: body?.data?.failures?.[0] || body || "Send failed" }, 502);
  }
  return json({ ok: true, email_id: body?.data?.email_id });
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}