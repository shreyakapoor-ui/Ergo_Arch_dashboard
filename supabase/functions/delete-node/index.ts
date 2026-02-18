// =============================================================================
// Supabase Edge Function: delete-node
//
// Admin-only endpoint that removes a node from architecture_data.
// The caller must supply their Supabase JWT (Authorization: Bearer <token>).
// We verify they have an active admin row in public.user_roles before touching
// any data.
//
// Required Supabase secrets:
//   SUPABASE_URL             — auto-injected by Supabase
//   SUPABASE_SERVICE_ROLE_KEY — set with `supabase secrets set`
//
// Request body (JSON):
//   { nodeId: string }
//
// Response:
//   200  { success: true, nodeId: string }
//   400  { error: "Missing nodeId" }
//   401  { error: "Missing or invalid Authorization header" }
//   403  { error: "Admin access required" }
//   404  { error: "architecture_data row not found" }
//   500  { error: string }
// =============================================================================

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
// Helper: JSON response
// ---------------------------------------------------------------------------

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

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
    return json({ error: "Method not allowed" }, 405);
  }

  // ── 1. Extract the caller's JWT ──────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const jwtMatch  = authHeader.match(/^Bearer (.+)$/);
  if (!jwtMatch) {
    return json({ error: "Missing or invalid Authorization header" }, 401);
  }
  const callerJwt = jwtMatch[1];

  // ── 2. Parse body ────────────────────────────────────────────────────────
  let nodeId: string;
  try {
    const body = await req.json();
    nodeId = body?.nodeId;
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  if (!nodeId || typeof nodeId !== "string") {
    return json({ error: "Missing nodeId" }, 400);
  }

  // ── 3. Build two clients ─────────────────────────────────────────────────
  //   • callerClient  — authenticated as the calling user (for role check)
  //   • adminClient   — service-role (bypasses RLS for the data write)

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
  const SERVICE_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!SUPABASE_URL || !SERVICE_KEY) {
    console.error("[delete-node] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "Server configuration error" }, 500);
  }

  const callerClient = createClient(SUPABASE_URL, SERVICE_KEY, {
    global: { headers: { Authorization: `Bearer ${callerJwt}` } },
  });

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── 4. Resolve the caller's user id via their JWT ────────────────────────
  const { data: { user }, error: userErr } = await callerClient.auth.getUser();
  if (userErr || !user) {
    console.warn("[delete-node] Could not resolve caller:", userErr?.message);
    return json({ error: "Missing or invalid Authorization header" }, 401);
  }

  // ── 5. Check admin role ──────────────────────────────────────────────────
  const { data: roleRow, error: roleErr } = await adminClient
    .from("user_roles")
    .select("role, active")
    .or(`user_id.eq.${user.id},email.eq.${user.email}`)
    .maybeSingle();

  if (roleErr) {
    console.error("[delete-node] Role lookup error:", roleErr.message);
    return json({ error: "Role lookup failed" }, 500);
  }

  if (!roleRow || roleRow.role !== "admin" || !roleRow.active) {
    console.warn(`[delete-node] 403 for user ${user.email}: role=${roleRow?.role}, active=${roleRow?.active}`);
    return json({ error: "Admin access required" }, 403);
  }

  // ── 6. Fetch current architecture_data ──────────────────────────────────
  const { data: row, error: fetchErr } = await adminClient
    .from("architecture_data")
    .select("data, connections, updated_at")
    .eq("id", "main")
    .single();

  if (fetchErr || !row) {
    console.error("[delete-node] Fetch error:", fetchErr?.message);
    return json({ error: "architecture_data row not found" }, 404);
  }

  // ── 7. Patch: remove the node and any connections referencing it ─────────
  const currentData = row.data as {
    components: Array<{ id: string; [key: string]: unknown }>;
    [key: string]: unknown;
  };

  const updatedData = {
    ...currentData,
    components: (currentData.components ?? []).filter(
      (c: { id: string }) => c.id !== nodeId
    ),
  };

  // Also remove connections that reference the deleted node
  let updatedConnections = row.connections;
  if (Array.isArray(row.connections)) {
    updatedConnections = row.connections.filter(
      (conn: { source?: string; target?: string }) =>
        conn.source !== nodeId && conn.target !== nodeId
    );
  }

  // ── 8. Write back ────────────────────────────────────────────────────────
  const { error: writeErr } = await adminClient
    .from("architecture_data")
    .upsert({
      id:          "main",
      data:        updatedData,
      connections: updatedConnections,
      updated_at:  new Date().toISOString(),
    });

  if (writeErr) {
    console.error("[delete-node] Write error:", writeErr.message);
    return json({ error: `Write failed: ${writeErr.message}` }, 500);
  }

  console.log(`[delete-node] ✓ Deleted node ${nodeId} by ${user.email}`);
  return json({ success: true, nodeId });
});
