import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.208.0/node/crypto.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL") || "",
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || ""
);

const PLUGGY_WEBHOOK_SECRET = Deno.env.get("PLUGGY_WEBHOOK_SECRET") || "";

interface WebhookPayload {
  id: string;
  createdAt: string;
  type: string;
  data: {
    id: string;
    [key: string]: any;
  };
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Pluggy-Signature",
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
    // Get webhook signature from headers
    const signature = req.headers.get("x-pluggy-signature");
    if (!signature) {
      return new Response(JSON.stringify({ error: "Missing signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Get raw body for signature validation
    const body = await req.text();

    // Validate HMAC signature
    const hash = createHmac("sha256", PLUGGY_WEBHOOK_SECRET);
    hash.update(body);
    const computedSignature = hash.digest("hex");

    if (computedSignature !== signature) {
      console.warn("Invalid webhook signature");
      return new Response(JSON.stringify({ error: "Invalid signature" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload: WebhookPayload = JSON.parse(body);
    const { id, type, data } = payload;

    console.log(`Processing webhook: ${type} (${id})`);

    // Get bank connection from provider_connection_id (data.id)
    const { data: bankConnections, error: bcError } = await supabase
      .from("bank_connections")
      .select("id, store_id")
      .eq("provider_connection_id", data.id);

    if (bcError || !bankConnections || bankConnections.length === 0) {
      console.warn(`Bank connection not found for provider_id: ${data.id}`);
      return new Response(
        JSON.stringify({ success: true, message: "Bank connection not found, ignoring" }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    const bankConnection = bankConnections[0];
    const { id: bankConnectionId, store_id } = bankConnection;

    // Store webhook event
    const { data: webhookRecord, error: webhookError } = await supabase.rpc(
      "store_provider_webhook",
      {
        p_store_id: store_id,
        p_bank_connection_id: bankConnectionId,
        p_provider: "pluggy",
        p_event_type: type,
        p_webhook_id: id,
        p_payload: payload,
        p_signature: signature,
      }
    );

    if (webhookError) {
      console.error("Failed to store webhook event:", webhookError);
    }

    // Handle different event types
    let processed = false;
    let processError: string | null = null;

    try {
      switch (type) {
        case "transaction.created":
        case "transaction.updated":
          // Trigger transaction sync
          await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-bank-transactions`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              store_id,
              bank_connection_id: bankConnectionId,
            }),
          });
          processed = true;
          break;

        case "account.sync.failed":
          // Update sync status to failed
          await supabase.rpc("update_bank_connection_sync", {
            p_bank_connection_id: bankConnectionId,
            p_sync_status: "failed",
            p_error_message: `Sync failed: ${data.error || "Unknown error"}`,
          });
          processed = true;
          break;

        default:
          console.log(`Unhandled webhook type: ${type}`);
          processed = true;
      }
    } catch (error) {
      processError = String(error);
      console.error(`Error processing webhook ${type}:`, error);
    }

    // Mark webhook as processed
    if (webhookRecord && webhookRecord.length > 0) {
      await supabase.rpc("mark_webhook_processed", {
        p_webhook_id: webhookRecord[0].id,
        p_success: processed,
        p_error_message: processError,
      });
    }

    return new Response(
      JSON.stringify({
        success: true,
        event_id: id,
        event_type: type,
        processed,
        error: processError,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error in bank-webhook-handler:", error);
    return new Response(
      JSON.stringify({ error: String(error) }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
});
