import { Webhook } from "https://esm.sh/standardwebhooks@1.0.0";

const hookSecret = (Deno.env.get("SEND_EMAIL_HOOK_SECRET") || "").replace(
  "v1,whsec_",
  ""
);

const SUBJECTS: Record<string, string> = {
  signup: "Confirm your SB Racing email",
  invite: "You are invited to SB Racing",
  magiclink: "Your SB Racing sign-in link",
  recovery: "Reset your SB Racing password",
  email_change: "Confirm your new SB Racing email",
  email_change_new: "Confirm your new SB Racing email",
  email_change_current: "Confirm this email change",
  reauthentication: "Confirm it is you — SB Racing",
};

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response("not allowed", { status: 400 });
  }

  const payload = await req.text();
  const headers = Object.fromEntries(req.headers);
  const wh = new Webhook(hookSecret);

  let user: { email?: string; user_metadata?: { full_name?: string } };
  let email_data: {
    token?: string;
    token_hash?: string;
    redirect_to?: string;
    email_action_type?: string;
    site_url?: string;
  };

  try {
    const parsed = wh.verify(payload, headers) as {
      user: typeof user;
      email_data: typeof email_data;
    };
    user = parsed.user;
    email_data = parsed.email_data;
  } catch (err) {
    console.error("[send-auth-email] verify", err);
    return json({ error: { message: "Invalid hook signature" } }, 401);
  }

  const to = user?.email;
  if (!to) return json({ error: { message: "No user email" } }, 400);

  const type = email_data.email_action_type || "signup";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") || email_data.site_url || "";
  const redirect = email_data.redirect_to || "https://sbracing.ca/members";
  const confirmUrl =
    supabaseUrl.replace(/\/$/, "") +
    "/auth/v1/verify?token=" +
    encodeURIComponent(email_data.token_hash || "") +
    "&type=" +
    encodeURIComponent(type === "signup" ? "signup" : type) +
    "&redirect_to=" +
    encodeURIComponent(redirect);

  const name = user.user_metadata?.full_name || "rider";
  const subject = SUBJECTS[type] || "SB Racing account email";
  const code = email_data.token || "";

  const text =
    type === "recovery"
      ? `Reset your password:\n${confirmUrl}\n\nOr use this code: ${code}`
      : `Confirm your email for SB Racing:\n${confirmUrl}\n\nOr enter this code: ${code}`;

  const html = `
    <div style="font-family:Inter,Arial,sans-serif;background:#09090b;color:#e4e4e7;padding:32px">
      <div style="max-width:480px;margin:0 auto;background:#18181b;border:1px solid #27272a;border-radius:20px;padding:28px">
        <p style="color:#ea580c;font-size:11px;letter-spacing:2px;text-transform:uppercase;margin:0 0 8px">SB Racing</p>
        <h1 style="margin:0 0 12px;font-size:22px;color:#fafafa">${escapeHtml(subject)}</h1>
        <p style="color:#a1a1aa;font-size:14px;line-height:1.5">Hey ${escapeHtml(name)},</p>
        <p style="color:#d4d4d8;font-size:14px;line-height:1.5">
          ${
            type === "recovery"
              ? "Use the button below to set a new password."
              : "Tap the button to confirm this email and finish creating your club login."
          }
        </p>
        <p style="margin:24px 0">
          <a href="${escapeHtml(confirmUrl)}"
             style="display:inline-block;background:#ea580c;color:#fff;text-decoration:none;padding:12px 20px;border-radius:12px;font-weight:600;font-size:14px">
            ${type === "recovery" ? "Reset password" : "Confirm email"}
          </a>
        </p>
        ${
          code
            ? `<p style="color:#71717a;font-size:12px">Or enter this code: <strong style="color:#fafafa">${escapeHtml(code)}</strong></p>`
            : ""
        }
        <p style="color:#52525b;font-size:12px;word-break:break-all">${escapeHtml(confirmUrl)}</p>
        <p style="color:#52525b;font-size:12px;margin-top:24px">— Soggy Bottom Racing</p>
      </div>
    </div>
  `;

  const res = await fetch("https://api.smtp2go.com/v3/email/send", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Smtp2go-Api-Key": Deno.env.get("SMTP2GO_API_KEY") || "",
    },
    body: JSON.stringify({
      sender: Deno.env.get("MAIL_FROM") || "SB Racing <info@sbracing.ca>",
      to: [to],
      subject,
      text_body: text,
      html_body: html,
    }),
  });

  const body = await res.json();
  if (!res.ok || body?.data?.failed) {
    console.error("[send-auth-email] smtp2go", body);
    return json(
      { error: { message: body?.data?.failures?.[0] || "SMTP2GO send failed" } },
      500
    );
  }

  return json({});
});

function json(obj: unknown, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function escapeHtml(s: string) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!)
  );
}
