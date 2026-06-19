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
  days?: number;
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
    const { store_id, bank_connection_id, user_id, days = 90 } = payload;

    // Validate inputs
    if (!store_id || !bank_connection_id) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get bank accounts for this connection
    const { data: bankAccounts, error: accountsError } = await supabase
      .from("bank_accounts")
      .select("id, provider_account_id")
      .eq("bank_connection_id", bank_connection_id)
      .eq("store_id", store_id);

    if (accountsError) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch bank accounts" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    if (!bankAccounts || bankAccounts.length === 0) {
      return new Response(
        JSON.stringify({ error: "No bank accounts found for this connection" }),
        { status: 404, headers: { "Content-Type": "application/json" } }
      );
    }

    // Get bank connection token
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

    const { access_token, provider_connection_id } = bankConnData[0];

    if (!access_token) {
      return new Response(JSON.stringify({ error: "Invalid or expired token" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    let totalTransactionsSynced = 0;

    // Sync transactions for each account
    for (const account of bankAccounts) {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);

      const transactionsResponse = await fetch(
        `${PLUGGY_API_BASE}/auth/${provider_connection_id}/accounts/${account.provider_account_id}/transactions?startDate=${startDate.toISOString().split("T")[0]}`,
        {
          method: "GET",
          headers: {
            Authorization: `Bearer ${access_token}`,
            "Content-Type": "application/json",
          },
        }
      );

      if (!transactionsResponse.ok) {
        console.error(
          `Failed to fetch transactions for account ${account.provider_account_id}`
        );
        continue;
      }

      const transactionsData = await transactionsResponse.json();
      const { transactions } = transactionsData;

      if (!transactions || !Array.isArray(transactions)) {
        continue;
      }

      // Sync transactions to database
      const { data: syncResult, error: syncError } = await supabase.rpc(
        "sync_bank_transactions_from_provider",
        {
          p_store_id: store_id,
          p_bank_connection_id: bank_connection_id,
          p_bank_account_id: account.id,
          p_transactions: transactions,
        }
      );

      if (!syncError && syncResult && syncResult.length > 0) {
        totalTransactionsSynced += syncResult[0].transactions_synced || 0;
      }
    }

    // Update last sync time
    await supabase.rpc("update_bank_connection_sync", {
      p_bank_connection_id: bank_connection_id,
      p_sync_status: "synced",
    });

    // Log auditoria
    await supabase.rpc("log_connect_audit", {
      p_store_id: store_id,
      p_user_id: user_id,
      p_action: `Sincronizou ${totalTransactionsSynced} transação(ões)`,
      p_action_type: "sync",
      p_entity_type: "bank_transaction",
      p_entity_id: bank_connection_id,
      p_details: {
        transactions_count: totalTransactionsSynced,
        days: days,
        accounts_synced: bankAccounts.length,
      },
    });

    // Trigger reconciliation
    await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/run-bank-reconciliation`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        store_id,
        bank_connection_id,
      }),
    }).catch((e) => console.log("Reconciliation trigger skipped:", e.message));

    return new Response(
      JSON.stringify({
        success: true,
        transactions_synced: totalTransactionsSynced,
        accounts_synced: bankAccounts.length,
        message: `Successfully synced ${totalTransactionsSynced} transaction(s) from ${bankAccounts.length} account(s)`,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in sync-bank-transactions:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
