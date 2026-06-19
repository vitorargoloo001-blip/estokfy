import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
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
    if (req.method !== "POST") {
      return jsonRes({ error: "method_not_allowed" }, 405);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { webhook_event_id, limit = 10 } = (await req.json()) as Record<string, unknown>;

    // If webhook_event_id is provided, process single event
    // Otherwise, process a batch of pending events (worker mode)

    let eventsToProcess: Record<string, unknown>[] = [];

    if (webhook_event_id) {
      // Single event
      const { data: event, error: fetchErr } = await svc
        .from("webhook_events")
        .select("*")
        .eq("id", webhook_event_id as string)
        .single();

      if (fetchErr || !event) {
        return jsonRes({ error: "event_not_found" }, 404);
      }

      eventsToProcess = [event];
    } else {
      // Batch: fetch pending/failed events (up to limit)
      const { data: events, error: fetchErr } = await svc
        .from("webhook_events")
        .select("*")
        .in("status", ["received", "failed"])
        .order("received_at", { ascending: true })
        .limit(limit as number);

      if (fetchErr) {
        console.error("fetch events error:", fetchErr);
        return jsonRes({ error: "fetch_failed" }, 500);
      }

      eventsToProcess = events || [];
    }

    let processedCount = 0;
    let failedCount = 0;

    for (const event of eventsToProcess) {
      try {
        const eventId = event.id as string;
        const eventType = event.event_type as string;
        const payload = event.payload as Record<string, unknown>;
        const storeId = event.store_id as string;
        const connectionId = event.connection_id as string;

        // Update status to processing
        await svc
          .from("webhook_events")
          .update({ status: "processing", attempts: ((event.attempts as number) || 0) + 1 })
          .eq("id", eventId);

        let transactionsToInsert: Record<string, unknown>[] = [];

        // Parse event based on provider and event_type
        if (event.provider === "pluggy") {
          // Pluggy webhook formats:
          // payment.created / payment.updated / account.created / account.updated
          if (eventType.startsWith("payment")) {
            const tx = parsePluggyPaymentEvent(payload, storeId, connectionId);
            if (tx) {
              transactionsToInsert.push(tx);
            }
          }
          // account events would update bank_accounts (skipped in MVP)
        }

        // Save transactions if any
        if (transactionsToInsert.length > 0) {
          // Look up account_id from external_account_id
          const externalAccountId = payload.accountId as string;
          const { data: account } = await svc
            .from("bank_accounts")
            .select("id")
            .eq("external_account_id", externalAccountId)
            .eq("store_id", storeId)
            .single();

          if (account) {
            // Call RPC to save transactions
            const { error: rpcErr } = await svc.rpc("connect_save_bank_transactions", {
              p_store_id: storeId,
              p_account_id: account.id,
              p_transactions: transactionsToInsert,
            });

            if (rpcErr) {
              throw new Error(`RPC error: ${rpcErr.message}`);
            }

            // Trigger matching for this account
            const { error: matchErr } = await svc.rpc("connect_run_matching", {
              p_store_id: storeId,
              p_account_id: account.id,
              p_trigger_source: "webhook",
            });

            if (matchErr) {
              console.error(`matching error: ${matchErr.message}`);
            }
          }
        }

        // Mark as processed
        await svc
          .from("webhook_events")
          .update({
            status: "processed",
            processed_at: new Date().toISOString(),
          })
          .eq("id", eventId);

        processedCount++;
      } catch (e) {
        failedCount++;
        const error = String(e);

        // Update event status to failed with error message
        await svc
          .from("webhook_events")
          .update({
            status: "failed",
            last_error: error.substring(0, 500),
            attempts: ((event.attempts as number) || 0) + 1,
          })
          .eq("id", event.id as string);

        console.error(`event processing error (${event.id}):`, error);
      }
    }

    return jsonRes({
      processed: processedCount,
      failed: failedCount,
      total: eventsToProcess.length,
    }, 200);
  } catch (e) {
    console.error("connect-process-events error:", e);
    return jsonRes({ error: "internal_error", details: String(e) }, 500);
  }
});

/**
 * Parse Pluggy payment event into bank_transaction format
 * Pluggy payload structure:
 * {
 *   id: string (paymentId),
 *   accountId: string,
 *   clientId: string,
 *   amount: number,
 *   fees: number,
 *   type: "debit" | "credit",
 *   status: "pending" | "completed" | "failed",
 *   date: ISO string,
 *   description: string,
 *   ...
 * }
 */
function parsePluggyPaymentEvent(
  payload: Record<string, unknown>,
  storeId: string,
  connectionId: string
): Record<string, unknown> | null {
  const id = payload.id as string;
  const amount = payload.amount as number;
  const fees = payload.fees as number || 0;
  const type = payload.type as string; // "debit" or "credit"
  const status = payload.status as string; // "pending", "completed", "failed"
  const date = payload.date as string;
  const description = payload.description as string;

  if (!id || amount == null || !type) {
    return null;
  }

  // Map Pluggy type to direction
  const direction = type === "credit" ? "credit" : "debit";

  // Map Pluggy status to our status
  const txStatus = status === "completed" ? "confirmed" : "pending";

  // Determine method from description (heuristic, can be improved)
  let method = "other";
  const desc = (description || "").toLowerCase();
  if (desc.includes("pix")) method = "pix";
  else if (desc.includes("cartão") || desc.includes("card")) method = "card";
  else if (desc.includes("boleto")) method = "boleto";
  else if (desc.includes("transf")) method = "transfer";

  return {
    provider: "pluggy",
    external_tx_id: id,
    direction,
    method,
    gross_amount: Math.abs(amount),
    fee_amount: Math.abs(fees),
    net_amount: Math.abs(amount) - Math.abs(fees),
    currency: "BRL",
    payer_name: null, // Pluggy doesn't always provide this
    payer_doc_mask: null,
    description,
    occurred_at: new Date(date).toISOString(),
    settled_at: status === "completed" ? new Date(date).toISOString() : null,
    status: txStatus,
    metadata: {
      pluggy_payload: payload,
    },
  };
}
