import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const PLUGGY_API_BASE = "https://api.pluggy.ai";

interface SyncRequest {
  store_id: string;
  bank_connection_id: string;
  user_id: string;
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
    const payload: SyncRequest = await req.json();
    const { store_id, bank_connection_id, user_id } = payload;

    // Validate inputs
    if (!store_id || !bank_connection_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Validate store
    const { data: store, error: storeError } = await supabase
      .from("stores")
      .select("id")
      .eq("id", store_id)
      .single();

    if (storeError || !store) {
      return new Response(JSON.stringify({ error: "Store not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get bank connection and token
    const { data: bankConnData, error: connError } = await supabase.rpc(
      "get_bank_connection_token",
      {
        p_bank_connection_id: bank_connection_id,
        p_store_id: store_id,
      }
    );

    if (connError || !bankConnData || bankConnData.length === 0) {
      return new Response(JSON.stringify({ error: "Bank connection not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { access_token, provider_connection_id, needs_refresh } = bankConnData[0];

    if (!access_token) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch accounts from Pluggy
    const accountsResponse = await fetch(
      `${PLUGGY_API_BASE}/auth/${provider_connection_id}/accounts`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${access_token}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!accountsResponse.ok) {
      const error = await accountsResponse.text();
      console.error("Pluggy accounts fetch failed:", error);

      // Update sync status to failed
      await supabase.rpc("update_bank_connection_sync", {
        p_bank_connection_id: bank_connection_id,
        p_sync_status: "failed",
        p_error_message: "Failed to fetch accounts from Pluggy",
      });

      return new Response(
        JSON.stringify({
          error: "Failed to fetch accounts from provider",
          details: error,
        }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const accountsData = await accountsResponse.json();
    const { accounts } = accountsData;

    if (!accounts || !Array.isArray(accounts)) {
      return new Response(
        JSON.stringify({ error: "Invalid accounts data from provider" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Sync accounts to database
    const { data: syncResult, error: syncError } = await supabase.rpc(
      "sync_bank_accounts_from_provider",
      {
        p_store_id: store_id,
        p_bank_connection_id: bank_connection_id,
        p_accounts: accounts,
      }
    );

    if (syncError) {
      console.error("Failed to sync accounts:", syncError);
      return new Response(
        JSON.stringify({ error: "Failed to sync accounts" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Log auditoria
    await supabase.rpc("log_connect_audit", {
      p_store_id: store_id,
      p_user_id: user_id,
      p_action: `Sincronizou ${accounts.length} conta(s) bancária(s)`,
      p_action_type: "sync",
      p_entity_type: "bank_account",
      p_entity_id: bank_connection_id,
      p_details: {
        accounts_count: accounts.length,
        provider: "pluggy",
      },
    });

    return new Response(
      JSON.stringify({
        success: true,
        accounts_synced: accounts.length,
        accounts: accounts,
        message: `Successfully synced ${accounts.length} account(s)`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in sync-bank-accounts:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
