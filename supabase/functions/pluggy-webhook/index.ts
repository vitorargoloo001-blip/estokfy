// Estokfy Connect — Edge Function: pluggy-webhook
// Recebe webhooks da Pluggy (ITEM_UPDATED, ITEM_ERROR, TRANSACTIONS_UPDATED).
// Verifica assinatura HMAC-SHA256 (X-Pluggy-Signature).
// Registra em pluggy_webhooks e dispara sync se necessário.
//
// URL para configurar no Pluggy Dashboard:
//   https://<PROJECT_REF>.supabase.co/functions/v1/pluggy-webhook
//
// Env vars: PLUGGY_WEBHOOK_SECRET (opcional — desabilita verificação se ausente),
//           PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET,
//           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-pluggy-signature",
};

// ── HMAC verification ─────────────────────────────────────────────────

async function verifyPluggySignature(
  payload: string,
  signature: string,
  secret: string
): Promise<boolean> {
  try {
    const enc     = new TextEncoder();
    const key     = await crypto.subtle.importKey(
      "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]
    );
    const sigBytes = hexToUint8(signature.replace(/^sha256=/, ""));
    return crypto.subtle.verify("HMAC", key, sigBytes, enc.encode(payload));
  } catch {
    return false;
  }
}

function hexToUint8(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substring(i, 2 + i), 16);
  }
  return bytes;
}

// ── Main ──────────────────────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const supabase   = createClient(Deno.env.get("SUPABASE_URL") ?? "", serviceKey);

  const rawBody = await req.text();
  let payload: Record<string, unknown>;

  try {
    payload = JSON.parse(rawBody);
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  // ── Verificar assinatura Pluggy ───────────────────────────────────
  const webhookSecret = Deno.env.get("PLUGGY_WEBHOOK_SECRET");
  if (webhookSecret) {
    const signature = req.headers.get("x-pluggy-signature") ?? "";
    if (!signature) {
      console.warn("[pluggy-webhook] Assinatura ausente — rejeitando");
      return new Response("Missing signature", { status: 401 });
    }
    const valid = await verifyPluggySignature(rawBody, signature, webhookSecret);
    if (!valid) {
      console.warn("[pluggy-webhook] Assinatura inválida");
      return new Response("Invalid signature", { status: 401 });
    }
  } else {
    console.warn("[pluggy-webhook] PLUGGY_WEBHOOK_SECRET não configurado — verificação desabilitada");
  }

  const event      = (payload.event as string) ?? "";
  const pluggyItemId = (payload.itemId ?? (payload.data as Record<string, unknown>)?.itemId) as string;

  console.log(`[pluggy-webhook] event=${event} itemId=${pluggyItemId}`);

  // ── Registrar webhook no banco ────────────────────────────────────
  const { error: logErr } = await supabase
    .from("pluggy_webhooks")
    .insert({
      pluggy_item_id: pluggyItemId,
      event_type:     event,
      payload:        payload,
      processed:      false,
      received_at:    new Date().toISOString(),
    });

  if (logErr) {
    console.error("[pluggy-webhook] Erro ao salvar webhook:", logErr.message);
  }

  // ── Processar evento ─────────────────────────────────────────────
  const evtUpper = event.toUpperCase().replace("/", "_").replace(".", "_");

  // Buscar store_id pelo pluggy_item_id externo
  const { data: itemRow } = await supabase
    .from("pluggy_items")
    .select("id, store_id, status")
    .eq("pluggy_item_id", pluggyItemId)
    .single();

  if (!itemRow?.store_id) {
    console.warn(`[pluggy-webhook] Item ${pluggyItemId} não encontrado no banco`);
    return new Response(JSON.stringify({ received: true, action: "ignored_unknown_item" }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  const storeId = itemRow.store_id as string;

  if (evtUpper.includes("ITEM_ERROR") || evtUpper.includes("LOGIN_ERROR")) {
    // Atualizar status como erro
    await supabase.rpc("update_pluggy_item_status", {
      p_pluggy_item_id: pluggyItemId,
      p_status:         "login_error",
      p_error_code:     (payload.data as Record<string, unknown>)?.code as string ?? null,
      p_error_message:  (payload.data as Record<string, unknown>)?.message as string ?? "Erro de autenticação",
    });

    // Marcar bank_connections como erro
    await supabase
      .from("bank_connections")
      .update({ status: "error", updated_at: new Date().toISOString() })
      .eq("pluggy_item_id", itemRow.id);

    console.log(`[pluggy-webhook] item=${pluggyItemId} marcado como login_error`);

  } else if (
    evtUpper.includes("ITEM_UPDATED") ||
    evtUpper.includes("TRANSACTIONS_UPDATED") ||
    evtUpper.includes("ITEM_UPDATED_PARTIALLY")
  ) {
    // Atualizar status Pluggy
    await supabase.rpc("update_pluggy_item_status", {
      p_pluggy_item_id: pluggyItemId,
      p_status:         "updated",
    });

    // Disparar sincronização interna via chamada à Edge Function sync
    // Usa X-Internal-Secret para bypass de auth JWT
    const syncUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/pluggy-sync-transactions`;

    const syncRes = await fetch(syncUrl, {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-internal-secret": serviceKey,
      },
      body: JSON.stringify({
        storeId:      storeId,
        pluggyItemId: pluggyItemId,
      }),
    });

    const syncData = await syncRes.json().catch(() => ({}));
    console.log(`[pluggy-webhook] sync result for store=${storeId}:`, JSON.stringify(syncData).slice(0, 200));

  } else {
    console.log(`[pluggy-webhook] evento ${event} — sem ação definida`);
  }

  // Marcar webhook como processado
  await supabase
    .from("pluggy_webhooks")
    .update({ processed: true, processed_at: new Date().toISOString() })
    .eq("pluggy_item_id", pluggyItemId)
    .eq("processed", false);

  return new Response(JSON.stringify({ received: true }), {
    headers: { "Content-Type": "application/json" },
  });
});
