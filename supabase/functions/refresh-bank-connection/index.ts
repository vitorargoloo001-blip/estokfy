import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const PLUGGY_CLIENT_ID = Deno.env.get("PLUGGY_CLIENT_ID");
const PLUGGY_CLIENT_SECRET = Deno.env.get("PLUGGY_CLIENT_SECRET");
const PLUGGY_API_BASE = "https://api.pluggy.ai";

interface RefreshRequest {
  store_id: string;
  bank_connection_id: string;
}

serve(async (req: Request) => {
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
    const payload: RefreshRequest = await req.json();
    const { store_id, bank_connection_id } = payload;

    if (!store_id || !bank_connection_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get bank connection
    const { data: bankConnData, error: bcError } = await supabase.rpc(
      "get_bank_connection_token",
      {
        p_bank_connection_id: bank_connection_id,
        p_store_id: store_id,
      }
    );

    if (bcError || !bankConnData || bankConnData.length === 0) {
      return new Response(JSON.stringify({ error: "Bank connection not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { provider, provider_connection_id, needs_refresh } = bankConnData[0];

    // Check if refresh is needed
    if (!needs_refresh) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Token is still valid, no refresh needed",
          needs_refresh: false,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    if (provider !== "pluggy") {
      return new Response(
        JSON.stringify({ error: "Unsupported provider for refresh" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Refresh token with Pluggy (requires re-authentication)
    // In production, this would trigger a new OAuth flow
    console.log(`Token refresh needed for connection ${provider_connection_id}`);

    // For now, mark as needing re-authentication
    const { error: updateError } = await supabase
      .from("bank_connections")
      .update({
        sync_status: "pending",
        last_sync_error: "Token expired, re-authentication required",
      })
      .eq("id", bank_connection_id);

    if (updateError) {
      return new Response(
        JSON.stringify({ error: "Failed to update connection status" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Re-authentication required",
        needs_reauth: true,
        auth_url: `${PLUGGY_API_BASE}/auth/credential?client_id=${PLUGGY_CLIENT_ID}&response_type=code`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in refresh-bank-connection:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
