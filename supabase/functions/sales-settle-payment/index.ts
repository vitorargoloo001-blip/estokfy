import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, idempotency-key, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const idemKey = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
    if (!idemKey) return json({ error: "payload_invalido", message: "Idempotency-Key obrigatório" }, 400);

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    const body = await req.json();
    const { sale_id, payments, paid_at, note } = body;

    if (!sale_id || !Array.isArray(payments) || payments.length === 0) {
      return json({ error: "payload_invalido", message: "sale_id e payments são obrigatórios" }, 400);
    }

    const noteClean = typeof note === "string" ? note.trim().slice(0, 500) : null;

    const svc = createClient(SB_URL, SB_SERVICE);

    // Look up store_id from sale to scope idempotency + store-access check
    const { data: saleRow } = await svc.from("sales").select("store_id").eq("id", sale_id).maybeSingle();
    if (!saleRow) return json({ error: "venda_nao_encontrada", message: "Venda não encontrada." }, 404);

    const { data: storeData } = await svc.from("stores").select("access_enabled, subscription_status").eq("id", saleRow.store_id).single();
    if (!storeData || !storeData.access_enabled || ["suspended","blocked","inactive"].includes(storeData.subscription_status)) {
      return json({ error: "acesso_loja_desativado", message: "Acesso da loja desativado." }, 403);
    }

    const requestHash = await sha256(JSON.stringify(body));

    const { data: existing } = await svc
      .from("idempotency_keys")
      .select("response_json")
      .eq("store_id", saleRow.store_id)
      .eq("idem_key", idemKey)
      .maybeSingle();

    if (existing) {
      if (existing.response_json) return json(existing.response_json as Record<string, unknown>, 200);
      return json({ error: "idempotency_conflict", message: "Requisição em andamento" }, 409);
    }

    const { error: idemErr } = await svc.from("idempotency_keys").insert({
      store_id: saleRow.store_id,
      idem_key: idemKey,
      action: "sales-settle-payment",
      request_hash: requestHash,
    });
    if (idemErr) {
      if (idemErr.code === "23505") return json({ error: "idempotency_conflict" }, 409);
      throw idemErr;
    }

    const { data: result, error: rpcErr } = await userClient.rpc("settle_sale_payment", {
      p_sale_id: sale_id,
      p_payments: payments,
      p_paid_at: paid_at || new Date().toISOString(),
      p_note: noteClean,
    });

    if (rpcErr) {
      await svc.from("idempotency_keys").delete().eq("store_id", saleRow.store_id).eq("idem_key", idemKey);
      const msg = rpcErr.message || "";
      if (msg.includes("venda_nao_encontrada")) return json({ error: "venda_nao_encontrada", message: "Venda não encontrada." }, 404);
      if (msg.includes("observacao_muito_longa")) return json({ error: "observacao_muito_longa", message: "A observação pode ter no máximo 500 caracteres." }, 400);
      if (msg.includes("venda_ja_quitada")) return json({ error: "venda_ja_quitada", message: "Venda já está quitada." }, 400);
      if (msg.includes("metodo_invalido_para_quitacao")) return json({ error: "metodo_invalido", message: "Método inválido para quitação." }, 400);
      if (msg.includes("pagamento_invalido")) return json({ error: "pagamento_invalido", message: "Valor de pagamento inválido." }, 400);
      if (msg.includes("sem_permissao_para_quitar")) return json({ error: "sem_permissao", message: "Sem permissão para quitar venda." }, 403);
      if (msg.includes("store_invalida")) return json({ error: "store_invalida", message: "Loja inválida." }, 400);
      if (msg.includes("perfil_nao_encontrado")) return json({ error: "perfil_nao_encontrado", message: "Perfil não encontrado." }, 403);
      if (msg.includes("usuario_inativo")) return json({ error: "usuario_inativo", message: "Usuário inativo." }, 403);
      console.error("settle rpc error:", rpcErr);
      return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
    }

    await svc
      .from("idempotency_keys")
      .update({ response_json: result as Record<string, unknown> })
      .eq("store_id", saleRow.store_id)
      .eq("idem_key", idemKey);

    return json(result as Record<string, unknown>, 200);
  } catch (e) {
    console.error("sales-settle-payment error:", e);
    return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
  }
});

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}
