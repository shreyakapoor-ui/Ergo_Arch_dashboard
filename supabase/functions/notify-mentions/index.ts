// =============================================================================
// Supabase Edge Function: notify-mentions
//
// Called by the client after a save that contains net-new @mentions.
// Sends one email per newly-mentioned user via Resend.
//
// Required Supabase secrets (set with `supabase secrets set`):
//   RESEND_API_KEY   — your Resend API key (re_xxxxxxxx)
//   FROM_EMAIL       — verified sender address, e.g. "noreply@yourdomain.com"
//   APP_URL          — canonical app URL for deep links, e.g. "https://your-app.vercel.app"
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

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

function buildEmailHtml(
  recipientName: string,
  mentioner: { name: string; email: string },
  context: RequestBody["context"]
): string {
  const fieldLabel: Record<string, string> = {
    comment: "a comment",
    weekly_update: "a weekly update",
    description: "the description",
    blockers: "the blockers section",
    remaining_mvp_scope: "the remaining MVP scope",
  };
  const where = fieldLabel[context.field] ?? context.field;
  const snippet = context.label
    ? `<blockquote style="border-left:3px solid #e5e7eb;margin:12px 0;padding:8px 12px;color:#6b7280;font-style:italic;">${context.label}</blockquote>`
    : "";

  return `
<!DOCTYPE html>
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
    Architecture dashboard. Reply to this email or open the app to respond.
  </p>
</body>
</html>
  `.trim();
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

serve(async (req: Request) => {
  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
      },
    });
  }

  // Only accept POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Parse body
  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { mentions, mentioner, context } = body;

  if (!mentions?.length || !mentioner || !context) {
    return new Response(
      JSON.stringify({ error: "Missing required fields: mentions, mentioner, context" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  // Read secrets from Deno environment
  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const FROM_EMAIL     = Deno.env.get("FROM_EMAIL") ?? "noreply@example.com";

  if (!RESEND_API_KEY) {
    console.error("[notify-mentions] RESEND_API_KEY secret is not set");
    return new Response(
      JSON.stringify({ error: "Email provider not configured (missing RESEND_API_KEY)" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  // Send one email per mentioned user
  const sent: string[] = [];
  const errors: string[] = [];

  await Promise.all(
    mentions.map(async (mention) => {
      const html = buildEmailHtml(mention.name, mentioner, context);
      const subject = `${mentioner.name} mentioned you in "${context.node_name}"`;

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
            // Include plain-text fallback
            text: `Hi ${mention.name},\n\n${mentioner.name} (${mentioner.email}) mentioned you in "${context.node_name}".\n\nOpen: ${context.deep_link}`,
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          console.error(`[notify-mentions] Resend error for ${mention.email}:`, errText);
          errors.push(`${mention.email}: ${res.status} ${errText}`);
        } else {
          sent.push(mention.email);
          console.log(`[notify-mentions] Sent to ${mention.email}`);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[notify-mentions] Fetch threw for ${mention.email}:`, msg);
        errors.push(`${mention.email}: ${msg}`);
      }
    })
  );

  return new Response(
    JSON.stringify({ sent: sent.length, errors }),
    {
      status: errors.length > 0 && sent.length === 0 ? 500 : 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    }
  );
});
