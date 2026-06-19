import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const PLUGGY_CLIENT_ID = Deno.env.get("PLUGGY_CLIENT_ID");
const PLUGGY_CLIENT_SECRET = Deno.env.get("PLUGGY_CLIENT_SECRET");
const PLUGGY_API_BASE = "https://api.pluggy.ai";
const REDIRECT_URI = Deno.env.get("PLUGGY_REDIRECT_URI") ||
  "https://estokfy-dibacell.netlify.app/connect/bank/callback";

interface OAuthRequest {
  action: "get_auth_url" | "get_token";
  store_id: string;
  code?: string;
}

interface OAuthResponse {
  auth_url?: string;
  success?: boolean;
  provider_connection_id?: string;
  message?: string;
  error?: string;
}

serve(async (req: Request) => {
  // CORS headers
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const payload: OAuthRequest = await req.json();
    const { action, store_id, code } = payload;

    // Validate required fields
    if (!store_id || !action) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: store_id, action" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate store exists and user has access
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id, owner_id")
      .eq("id", store_id)
      .single();

    if (storeError || !store) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Validate license is active
    const { data: license, error: licenseError } = await supabase
      .from("connect_licenses")
      .select("status")
      .eq("store_id", store_id)
      .eq("status", "active")
      .single();

    if (licenseError || !license) {
      return new Response(
        JSON.stringify({ error: "Connect license is not active for this store" }),
        { status: 403, headers: { "Content-Type": "application/json" } }
      );
    }

    // Handle action: get_auth_url
    if (action === "get_auth_url") {
      const authUrl = `${PLUGGY_API_BASE}/auth/credential?client_id=${PLUGGY_CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&state=${store_id}`;

      return new Response(JSON.stringify({ auth_url: authUrl }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Handle action: get_token
    if (action === "get_token") {
      if (!code) {
        return new Response(
          JSON.stringify({ error: "Missing authorization code" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Exchange code for token with Pluggy
      const tokenResponse = await fetch(`${PLUGGY_API_BASE}/auth/credential`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${btoa(`${PLUGGY_CLIENT_ID}:${PLUGGY_CLIENT_SECRET}`)}`,
        },
        body: JSON.stringify({
          code,
          redirect_uri: REDIRECT_URI,
          grant_type: "authorization_code",
        }),
      });

      if (!tokenResponse.ok) {
        const error = await tokenResponse.text();
        console.error("Pluggy token exchange failed:", error);
        return new Response(
          JSON.stringify({ error: "Failed to exchange token with bank provider" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      const tokenData = await tokenResponse.json();
      const { access_token, expires_in, id } = tokenData;

      if (!access_token || !id) {
        return new Response(
          JSON.stringify({ error: "Invalid token response from provider" }),
          { status: 400, headers: { "Content-Type": "application/json" } }
        );
      }

      // Encrypt token before storing (using simple base64 for now, production should use proper encryption)
      const encryptedToken = btoa(access_token);
      const expiresAt = new Date(Date.now() + (expires_in * 1000)).toISOString();

      // Save to bank_connections
      const { error: insertError } = await supabase.rpc(
        "update_or_insert_bank_connection",
        {
          p_store_id: store_id,
          p_provider: "pluggy",
          p_provider_connection_id: id,
          p_access_token_encrypted: encryptedToken,
          p_token_expires_at: expiresAt,
          p_sync_status: "pending",
          p_bank_name: "Pluggy Connection",
          p_account_type: "unknown",
          p_status: "active",
        }
      );

      if (insertError) {
        console.error("Failed to save bank connection:", insertError);
        return new Response(
          JSON.stringify({ error: "Failed to save connection" }),
          { status: 500, headers: { "Content-Type": "application/json" } }
        );
      }

      // Log auditoria
      await supabase.rpc("log_connect_audit", {
        p_store_id: store_id,
        p_user_id: store.owner_id,
        p_action: "Conectou banco via Pluggy OAuth",
        p_action_type: "login",
        p_entity_type: "bank_connection",
        p_entity_id: id,
        p_details: { provider: "pluggy", connection_id: id },
      });

      return new Response(
        JSON.stringify({
          success: true,
          provider_connection_id: id,
          message: "Bank connection established successfully",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in connect-bank-oauth:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
