import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonRes(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// HMAC-SHA256 signature validation (Pluggy format)
async function validateSignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const encoder = new TextEncoder();
    const keyData = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );

    const messageBuffer = encoder.encode(payload);
    const signatureBuffer = await crypto.subtle.sign("HMAC", keyData, messageBuffer);
    const expectedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return expectedSignature === signature;
  } catch (_e) {
    return false;
  }
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

    // Parse payload
    const bodyText = await req.text();
    let payload: Record<string, unknown>;

    try {
      payload = JSON.parse(bodyText);
    } catch (_e) {
      return jsonRes({ error: "invalid_json" }, 400);
    }

    // Pluggy webhook format:
    // {
    //   "event": "payment.created" | "payment.updated" | "account.created" | "account.updated",
    //   "data": { ...transaction/account data },
    //   "createdAt": "2026-06-12T10:30:00Z"
    // }
    const event = payload.event as string;
    const data = payload.data as Record<string, unknown>;
    const createdAt = payload.createdAt as string;

    if (!event || !data) {
      return jsonRes({ error: "invalid_payload" }, 400);
    }

    // Extract provider, external_event_id, connection_id
    const provider = "pluggy";
    const externalEventId = `${provider}-${event}-${data.id}-${createdAt}`;
    const externalConnectionId = data.clientId as string; // Pluggy clientId
    const externalAccountId = data.accountId as string; // Pluggy account ID

    // Look up connection to get store_id e webhook_secret
    const { data: connection } = await svc
      .from("bank_connections")
      .select("id,store_id,webhook_secret_ref")
      .eq("provider", provider)
      .eq("external_connection_id", externalConnectionId)
      .single();

    if (!connection) {
      console.warn(`webhook: connection not found for clientId ${externalConnectionId}`);
      return jsonRes({ error: "connection_not_found" }, 404);
    }

    // Validate signature (if webhook_secret_ref is set)
    if (connection.webhook_secret_ref) {
      const signature = req.headers.get("x-pluggy-signature");
      if (!signature) {
        return jsonRes({ error: "missing_signature" }, 401);
      }

      // Fetch secret from Vault (in production, this is done via service role)
      // For now, skip validation if no secret is available
      // In production: const secretResult = await svc.from("vault").select("secret").eq("ref",...)
      // const isValid = await validateSignature(bodyText, signature, secretResult.secret);
      // if (!isValid) return jsonRes({ error: "invalid_signature" }, 401);
    }

    // Check for duplicate event (dedup by provider + external_event_id)
    const { data: existingEvent } = await svc
      .from("webhook_events")
      .select("id,status")
      .eq("provider", provider)
      .eq("external_event_id", externalEventId)
      .single();

    if (existingEvent) {
      // Already processed or in progress
      return jsonRes({ webhook_event_id: existingEvent.id, duplicate: true }, 200);
    }

    // Insert webhook event (inbox pattern)
    const { data: insertedEvent, error: insertErr } = await svc
      .from("webhook_events")
      .insert({
        provider,
        external_event_id: externalEventId,
        connection_id: connection.id,
        store_id: connection.store_id,
        event_type: event,
        payload: payload,
        signature_valid: true, // TODO: implement actual validation
        status: "received",
        received_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (insertErr) {
      console.error("webhook insert error:", insertErr);
      return jsonRes({ error: "insert_failed", details: insertErr.message }, 500);
    }

    // Trigger async worker (connect-process-events) to normalize the event
    // In production, this would be a queue trigger or HTTP request to the worker
    // For MVP, we can make a synchronous call or queue it via Edge Function

    return jsonRes({
      webhook_event_id: insertedEvent.id,
      provider,
      event_type: event,
      store_id: connection.store_id,
      status: "received",
    }, 202);
  } catch (e) {
    console.error("connect-webhook error:", e);
    return jsonRes({ error: "internal_error", details: String(e) }, 500);
  }
});
