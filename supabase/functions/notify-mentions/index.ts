// =============================================================================
// Supabase Edge Function: notify-mentions
//
// Called by the client after a save that contains net-new @mentions.
// Sends one email per newly-mentioned user via Resend.
//
// Required Supabase secrets (set with `supabase secrets set`):
//   RESEND_API_KEY   — your Resend API key (re_xxxxxxxx)
//   FROM_EMAIL       — verified sender address, e.g. "noreply@yourdomain.com"
//
// Request body (JSON):
//   {
//     mentions: Array<{ user_id: string; email: string; name: string }>,
//     mentioner: { name: string; email: string },
//     context: {
//       node_id: string;
//       node_name: string;
//       field: string;      // "comment" | "weekly_update" | …
//       label: string;      // short snippet of the text (≤120 chars)
//       deep_link: string;  // URL that opens the app focused on this node
//     }
//   }
//
// Response:
//   { sent: number; errors: string[] }
// =============================================================================

// Supabase Edge Functions run on Deno Deploy — use Deno.serve (no import needed).

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MentionEntry {
  user_id: string;
  email: string;
  name: string;
}

interface RequestBody {
  mentions: MentionEntry[];
  mentioner: { name: string; email: string };
  context: {
    node_id: string;
    node_name: string;
    field: string;
    label: string;
    deep_link: string;
  };
}

// ---------------------------------------------------------------------------
// Email builder
// ---------------------------------------------------------------------------

const FIELD_LABELS: Record<string, string> = {
  comment:             "a comment",
  weekly_update:       "a weekly update",
  description:         "the purpose / description",
  blockers:            "the blockers section",
  remaining_mvp_scope: "the remaining MVP scope",
  future_scope:        "the future scope",
  inputs:              "the inputs",
  outputs:             "the outputs",
};

function buildEmailHtml(
  recipientName: string,
  mentioner: { name: string; email: string },
  context: RequestBody["context"]
): string {
  const where = FIELD_LABELS[context.field] ?? context.field;
  const snippet = context.label
    ? `<blockquote style="border-left:3px solid #e5e7eb;margin:12px 0;padding:8px 12px;color:#6b7280;font-style:italic;">${context.label.replace(/</g, "&lt;").replace(/>/g, "&gt;")}</blockquote>`
    : "";

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family:system-ui,-apple-system,sans-serif;max-width:600px;margin:0 auto;padding:24px;color:#111827;">
  <h2 style="margin-bottom:4px;">You were mentioned in <em>${context.node_name}</em></h2>
  <p style="color:#6b7280;margin-top:0;">Hi ${recipientName},</p>
  <p>
    <strong>${mentioner.name}</strong> (${mentioner.email}) mentioned you in
    ${where} on the <strong>${context.node_name}</strong> node.
  </p>
  ${snippet}
  <p>
    <a href="${context.deep_link}"
       style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-weight:600;">
      Open in Ergo Architecture →
    </a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="color:#9ca3af;font-size:12px;">
    You received this email because you were @mentioned in the Ergo Overwatch
    Architecture dashboard.
  </p>
</body>
</html>`.trim();
}

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS_HEADERS });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const { mentions, mentioner, context } = body;

  if (!Array.isArray(mentions) || !mentioner || !context) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: mentions, mentioner, context" }),
      { status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  if (mentions.length === 0) {
    return new Response(
      JSON.stringify({ sent: 0, errors: [] }),
      { status: 200, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // Read secrets
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "noreply@example.com";

  if (!RESEND_API_KEY) {
    console.error("[notify-mentions] RESEND_API_KEY secret is not set");
    return new Response(
      JSON.stringify({ error: "Email provider not configured — RESEND_API_KEY secret missing" }),
      { status: 500, headers: { "Content-Type": "application/json", ...CORS_HEADERS } }
    );
  }

  // Send one email per mentioned user
  const sent: string[] = [];
  const errors: string[] = [];

  await Promise.all(
    mentions.map(async (mention) => {
      if (!mention.email) {
        errors.push(`Skipped user ${mention.user_id}: no email`);
        return;
      }

      const html = buildEmailHtml(mention.name, mentioner, context);
      const subject = `${mentioner.name} mentioned you in "${context.node_name}"`;
      const plainText = `Hi ${mention.name},\n\n${mentioner.name} (${mentioner.email}) mentioned you in "${context.node_name}".\n\nContext: ${context.label}\n\nOpen: ${context.deep_link}`;

      try {
        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${RESEND_API_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: FROM_EMAIL,
            to: mention.email,
            subject,
            html,
            text: plainText,
          }),
        });

        const responseText = await res.text();

        if (!res.ok) {
          console.error(`[notify-mentions] Resend error for ${mention.email}: ${res.status} ${responseText}`);
          errors.push(`${mention.email}: HTTP ${res.status} — ${responseText}`);
        } else {
          sent.push(mention.email);
          console.log(`[notify-mentions] ✓ Sent to ${mention.email}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[notify-mentions] Fetch threw for ${mention.email}:`, msg);
        errors.push(`${mention.email}: ${msg}`);
      }
    })
  );

  const allFailed = errors.length > 0 && sent.length === 0;

  return new Response(
    JSON.stringify({ sent: sent.length, errors }),
    {
      status: allFailed ? 500 : 200,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    }
  );
});
