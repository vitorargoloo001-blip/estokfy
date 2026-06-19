import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    const body = await req.json();
    const { store_id, sale_id, reason, items, notes } = body;

    if (!store_id || !reason || !items?.length) {
      return json({ error: "payload_invalido", message: "store_id, reason e items são obrigatórios" }, 400);
    }

    const validReasons = ["defect", "damaged", "wrong_item", "customer_regret", "other"];
    if (!validReasons.includes(reason)) {
      return json({ error: "payload_invalido", message: "Motivo inválido." }, 400);
    }

    for (const item of items) {
      if (!item.product_id || !item.qty || item.qty <= 0) {
        return json({ error: "payload_invalido", message: "Cada item precisa de product_id e qty > 0." }, 400);
      }
    }

    // Call RPC via user client
    const { data: returnId, error: rpcErr } = await userClient.rpc("create_return_atomic", {
      p_store_id: store_id,
      p_sale_id: sale_id || null,
      p_reason: reason,
      p_items: items,
      p_notes: notes || null,
    });

    if (rpcErr) {
      const msg = rpcErr.message || "";
      if (msg.includes("sem_permissao")) return json({ error: "sem_permissao", message: "Permissão insuficiente." }, 403);
      if (msg.includes("produto_invalido")) return json({ error: "payload_invalido", message: "Produto inválido." }, 400);
      if (msg.includes("venda_nao_encontrada")) return json({ error: "payload_invalido", message: "Venda não encontrada." }, 400);
      if (msg.includes("perfil_nao_encontrado") || msg.includes("usuario_inativo")) return json({ error: "sem_permissao" }, 403);
      return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
    }

    return json({ return_id: returnId }, 201);
  } catch (e) {
    console.error("returns-create error:", e);
    return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
  }
});

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
