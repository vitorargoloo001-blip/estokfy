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
    if (req.method !== "POST") {
      return json({ error: "method_not_allowed" }, 405);
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return json({ error: "missing_token" }, 401);
    }

    const idemKey = req.headers.get("Idempotency-Key") ?? req.headers.get("idempotency-key");
    if (!idemKey) {
      return json({ error: "payload_invalido", message: "Idempotency-Key obrigatório" }, 400);
    }

    // Auth user
    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    // Parse body
    const body = await req.json();
    const { store_id, customer_id, items, payments, delivery, discount, due_date, sale_date, notes } = body;

    if (!store_id || !items?.length || !payments?.length) {
      return json({ error: "payload_invalido", message: "store_id, items e payments são obrigatórios" }, 400);
    }

    let safeNotes: string | null = null;
    if (notes != null) {
      if (typeof notes !== "string") {
        return json({ error: "payload_invalido", message: "notes deve ser texto" }, 400);
      }
      safeNotes = notes.trim().slice(0, 1000) || null;
    }

    // Valida sale_date (retroativa). Não permitir data futura.
    if (sale_date) {
      const d = new Date(sale_date);
      if (isNaN(d.getTime())) {
        return json({ error: "payload_invalido", message: "sale_date inválida" }, 400);
      }
      if (d.getTime() > Date.now() + 60_000) {
        return json({ error: "data_futura_invalida", message: "Não é possível registrar uma venda em uma data futura." }, 400);
      }
    }

    // Service client for idempotency check + store access
    const svc = createClient(SB_URL, SB_SERVICE);

    // Check store access
    const { data: storeData } = await svc.from("stores").select("access_enabled, subscription_status").eq("id", store_id).single();
    if (!storeData || !storeData.access_enabled || ["suspended","blocked","inactive"].includes(storeData.subscription_status)) {
      return json({ error: "acesso_loja_desativado", message: "Acesso da loja desativado. Operação não permitida." }, 403);
    }

    const requestHash = await sha256(JSON.stringify(body));

    // Check idempotency
    const { data: existing } = await svc
      .from("idempotency_keys")
      .select("response_json")
      .eq("store_id", store_id)
      .eq("idem_key", idemKey)
      .maybeSingle();

    if (existing) {
      if (existing.response_json) {
        return json(existing.response_json as Record<string, unknown>, 200);
      }
      return json({ error: "idempotency_conflict", message: "Requisição em andamento" }, 409);
    }

    // Reserve idempotency key
    const { error: idemErr } = await svc.from("idempotency_keys").insert({
      store_id,
      idem_key: idemKey,
      action: "sales-create",
      request_hash: requestHash,
    });

    if (idemErr) {
      if (idemErr.code === "23505") {
        return json({ error: "idempotency_conflict" }, 409);
      }
      throw idemErr;
    }

    // Call RPC via user client (respects RLS/roles)
    const { data: saleId, error: rpcErr } = await userClient.rpc("create_sale_atomic", {
      p_store_id: store_id,
      p_customer_id: customer_id || null,
      p_items: items,
      p_payments: payments,
      p_delivery: delivery || { method: "pickup", shipping_fee: 0, delivery_cost: 0 },
      p_discount: discount || 0,
      p_due_date: due_date || null,
      p_sale_date: sale_date || null,
      p_notes: safeNotes,
    });

    if (rpcErr) {
      // Clean up idempotency key on failure
      await svc.from("idempotency_keys").delete().eq("store_id", store_id).eq("idem_key", idemKey);

      const msg = rpcErr.message || "";
      if (msg.includes("estoque_insuficiente")) return json({ error: "estoque_insuficiente", message: "Estoque insuficiente." }, 400);
      if (msg.includes("produto_invalido")) return json({ error: "produto_invalido", message: "Produto inválido." }, 400);
      if (msg.includes("qty_invalida")) return json({ error: "qty_invalida", message: "Quantidade inválida." }, 400);
      if (msg.includes("store_invalida")) return json({ error: "store_invalida", message: "Loja inválida." }, 400);
      if (msg.includes("sem_permissao_para_vender")) return json({ error: "sem_permissao_para_vender", message: "Você não tem permissão para registrar vendas." }, 403);
      if (msg.includes("sem_permissao")) return json({ error: "sem_permissao", message: "Permissão insuficiente." }, 403);
      if (msg.includes("perfil_nao_encontrado")) return json({ error: "perfil_nao_encontrado", message: "Perfil não encontrado." }, 403);
      if (msg.includes("usuario_inativo")) return json({ error: "usuario_inativo", message: "Usuário inativo." }, 403);
      if (msg.includes("data_futura_invalida")) return json({ error: "data_futura_invalida", message: "Não é possível registrar uma venda em uma data futura." }, 400);
      return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
    }

    const responseData = { sale_id: saleId };

    // Store response in idempotency key
    await svc
      .from("idempotency_keys")
      .update({ response_json: responseData })
      .eq("store_id", store_id)
      .eq("idem_key", idemKey);

    return json(responseData, 201);
  } catch (e) {
    console.error("sales-create error:", e);
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
