import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    if (req.method !== "GET") {
      return jsonRes({ error: "method_not_allowed" }, 405);
    }

    const url = new URL(req.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const error = url.searchParams.get("error");
    const errorDescription = url.searchParams.get("error_description");

    // Handle OAuth error from Pluggy
    if (error) {
      console.error(`pluggy oauth error: ${error} - ${errorDescription}`);
      // Redirect to frontend error page
      return new Response(
        `<html><body><script>window.location.href = '/connect/error?error=${encodeURIComponent(error)}'</script></body></html>`,
        {
          status: 302,
          headers: { "Content-Type": "text/html" },
        }
      );
    }

    if (!code || !state) {
      return jsonRes({ error: "missing_code_or_state" }, 400);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const pluggyClientId = Deno.env.get("PLUGGY_CLIENT_ID")!;
    const pluggyClientSecret = Deno.env.get("PLUGGY_CLIENT_SECRET")!;

    const svc = createClient(supabaseUrl, serviceKey);

    // Validate state (check if it exists in our auth_sessions or similar)
    // For MVP, we skip this and assume state is valid
    // In production: lookup state in a temporary table

    // Exchange code for access_token via Pluggy OAuth
    const tokenResponse = await fetch("https://api.pluggy.ai/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: pluggyClientId,
        client_secret: pluggyClientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });

    if (!tokenResponse.ok) {
      console.error(`pluggy token exchange failed: ${tokenResponse.status}`);
      return jsonRes({ error: "token_exchange_failed" }, 500);
    }

    const tokenData = (await tokenResponse.json()) as Record<string, unknown>;
    const accessToken = tokenData.access_token as string;
    const refreshToken = tokenData.refresh_token as string;

    if (!accessToken) {
      return jsonRes({ error: "no_access_token" }, 500);
    }

    // Fetch user info (clientId) from Pluggy
    const userResponse = await fetch("https://api.pluggy.ai/me", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      console.error(`pluggy /me failed: ${userResponse.status}`);
      return jsonRes({ error: "pluggy_me_failed" }, 500);
    }

    const userData = (await userResponse.json()) as Record<string, unknown>;
    const pluggyClientId_user = userData.id as string; // Pluggy's internal clientId

    // Parse state to get store_id (state = base64(JSON{store_id, code_verifier}))
    let stateData: Record<string, unknown>;
    try {
      const decodedState = atob(state);
      stateData = JSON.parse(decodedState) as Record<string, unknown>;
    } catch (_e) {
      return jsonRes({ error: "invalid_state_format" }, 400);
    }

    const storeId = stateData.store_id as string;
    if (!storeId) {
      return jsonRes({ error: "store_id_missing_in_state" }, 400);
    }

    // Create or update bank_connection with OAuth credentials
    // Store access_token and refresh_token in Vault
    const vaultRef = `pluggy-${pluggyClientId_user}`;

    // In production: store credentials in Vault via Supabase
    // For MVP: store in a secure config or environment

    const { data: existingConn } = await svc
      .from("bank_connections")
      .select("id")
      .eq("store_id", storeId)
      .eq("provider", "pluggy")
      .eq("external_connection_id", pluggyClientId_user)
      .single();

    let connectionId: string;

    if (existingConn) {
      // Update existing connection
      const { data: updated, error: updateErr } = await svc
        .from("bank_connections")
        .update({
          status: "active",
          credential_ref: vaultRef,
          last_event_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq("id", existingConn.id)
        .select("id")
        .single();

      if (updateErr) {
        console.error("connection update error:", updateErr);
        return jsonRes({ error: "update_failed" }, 500);
      }

      connectionId = updated.id;
    } else {
      // Create new connection
      const { data: created, error: createErr } = await svc
        .from("bank_connections")
        .insert({
          store_id: storeId,
          provider: "pluggy",
          label: "Pluggy",
          external_connection_id: pluggyClientId_user,
          status: "active",
          credential_ref: vaultRef,
          created_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      if (createErr) {
        console.error("connection create error:", createErr);
        return jsonRes({ error: "create_failed" }, 500);
      }

      connectionId = created.id;
    }

    // Audit log
    await svc.from("audit_logs").insert({
      store_id: storeId,
      event_type: "connect_oauth_callback",
      entity_type: "bank_connection",
      entity_id: connectionId,
      new_data: {
        provider: "pluggy",
        external_connection_id: pluggyClientId_user,
        status: "active",
      },
      created_at: new Date().toISOString(),
    });

    // Redirect to success page with store_id and connection_id
    return new Response(
      `<html><body><script>window.location.href = '/connect/contas?success=true&connection_id=${connectionId}'</script></body></html>`,
      {
        status: 302,
        headers: { "Content-Type": "text/html" },
      }
    );
  } catch (e) {
    console.error("connect-pluggy-auth-callback error:", e);
    return jsonRes({ error: "internal_error", details: String(e) }, 500);
  }
});
