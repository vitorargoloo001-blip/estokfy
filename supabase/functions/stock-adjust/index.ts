import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ALLOWED_MOVEMENT_TYPES = ["initial_stock", "purchase_in", "sale_out", "adjustment", "return_in", "return_out", "manual_in", "manual_out", "loss"];

class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

const isUuid = (value: unknown) =>
  typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") return json({ success: false, error: "method_not_allowed", message: "Método não permitido." }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ success: false, error: "missing_token", message: "Sessão expirada." }, 401);

    const userClient = createClient(SB_URL, SB_ANON, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ success: false, error: "missing_token", message: "Sessão expirada." }, 401);

    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return json({ success: false, error: "payload_invalido", message: "Envie um JSON válido." }, 400);
    }

    const storeId = body.store_id;
    const productId = body.product_id;
    const parsedQty = Number(body.delta_qty ?? body.quantity);
    if (!isUuid(storeId)) return json({ success: false, error: "store_invalida", message: "store_id é obrigatório e deve ser válido." }, 400);
    if (!isUuid(productId)) return json({ success: false, error: "product_id_invalido", message: "product_id é obrigatório e deve ser válido." }, 400);
    if (!Number.isInteger(parsedQty) || parsedQty === 0) return json({ success: false, error: "quantidade_invalida", message: "quantity/delta_qty deve ser um número inteiro diferente de zero." }, 400);
    if (body.created_by !== undefined && body.created_by !== user.id) return json({ success: false, error: "user_id_invalido", message: "created_by não corresponde ao usuário logado." }, 400);

    let movementType = typeof body.movement_type === "string" && body.movement_type
      ? body.movement_type
      : parsedQty > 0
        ? (body.reason === "adjustment_in" ? "adjustment" : "purchase_in")
        : (body.reason === "loss" ? "loss" : "adjustment");
    if (!ALLOWED_MOVEMENT_TYPES.includes(movementType)) return json({ success: false, error: "movement_type_invalido", message: "Tipo de movimento inválido." }, 400);

    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc.from("profiles").select("id, store_id, role, is_active").eq("auth_user_id", user.id).single();
    if (!profile || !profile.is_active) return json({ success: false, error: "sem_permissao", message: "Perfil inativo ou não encontrado." }, 403);
    if (profile.store_id !== storeId) return json({ success: false, error: "sem_permissao", message: "Store inválida." }, 403);
    if (!["owner", "admin", "manager", "stock"].includes(profile.role)) return json({ success: false, error: "sem_permissao", message: "Permissão insuficiente." }, 403);

    const { data: product, error: prodErr } = await svc.from("products").select("id, name, on_hand, cost_price").eq("id", productId).eq("store_id", storeId).single();
    if (prodErr || !product) return json({ success: false, error: "produto_nao_encontrado", message: "Produto não encontrado nesta loja." }, 400);
    if (body.previous_stock !== undefined && Number(body.previous_stock) !== Number(product.on_hand)) return json({ success: false, error: "estoque_anterior_invalido", message: "O estoque anterior informado não confere com o estoque atual." }, 409);

    let unitCost = Number(product.cost_price) || 0;
    if (movementType === "purchase_in") {
      const parsedCost = Number(body.unit_cost);
      if (!parsedCost || parsedCost <= 0) return json({ success: false, error: "custo_unitario_obrigatorio", message: "Custo unitário é obrigatório para entrada de compra." }, 400);
      unitCost = parsedCost;
    }

    const newOnHand = Number(product.on_hand) + parsedQty;
    if (body.new_stock !== undefined && Number(body.new_stock) !== newOnHand) return json({ success: false, error: "estoque_novo_invalido", message: "O estoque final informado não confere com a quantidade movimentada." }, 400);
    if (newOnHand < 0) return json({ success: false, error: "estoque_insuficiente", message: "Estoque insuficiente." }, 400);

    let newCostPrice = Number(product.cost_price) || 0;
    if (movementType === "purchase_in") {
      const currentQty = Math.max(0, Number(product.on_hand) || 0);
      const totalQty = currentQty + parsedQty;
      newCostPrice = totalQty > 0 ? Math.round((((currentQty * newCostPrice) + (parsedQty * unitCost)) / totalQty) * 100) / 100 : unitCost;
    }

    const totalAmt = movementType === "purchase_in" ? Math.round(unitCost * parsedQty * 100) / 100 : null;
    const { error: movErr } = await svc.from("stock_movements").insert({
      store_id: storeId,
      product_id: productId,
      movement_type: movementType,
      qty: parsedQty,
      unit_cost: unitCost,
      reason: typeof body.reason === "string" ? body.reason : null,
      reference_type: "manual",
      created_by: profile.id,
      supplier_id: movementType === "purchase_in" ? (body.supplier_id || null) : null,
      payment_method: movementType === "purchase_in" ? (body.payment_method || null) : null,
      receipt_path: movementType === "purchase_in" ? (body.receipt_path || null) : null,
      total_amount: totalAmt,
    });
    if (movErr) throw new HttpError(400, "stock_movement_falhou", movErr.message);

    const { error: updErr } = await svc.from("products").update({ on_hand: newOnHand, cost_price: newCostPrice, updated_at: new Date().toISOString() }).eq("id", productId).eq("store_id", storeId);
    if (updErr) throw new HttpError(400, "produto_update_falhou", updErr.message);

    let expense_id: string | null = null;
    if (movementType === "purchase_in") {
      const { data: ledger } = await svc.from("cash_ledger").select("id").eq("store_id", storeId).eq("is_default", true).limit(1).maybeSingle();
      if (ledger?.id && totalAmt && totalAmt > 0) {
        let supplierName: string | null = null;
        if (body.supplier_id) {
          const { data: sup } = await svc.from("suppliers").select("name").eq("id", body.supplier_id).eq("store_id", storeId).maybeSingle();
          supplierName = sup?.name ?? null;
        }
        const descParts = [`Compra: ${product.name} (x${parsedQty} @ R$${unitCost.toFixed(2)})`, supplierName ? `Fornecedor: ${supplierName}` : null, body.payment_method ? `Pagto: ${body.payment_method}` : null, typeof body.description === "string" ? body.description : null].filter(Boolean);
        const { data: entry, error: entryErr } = await svc.from("cash_entries").insert({ store_id: storeId, ledger_id: ledger.id, entry_type: "expense", category: "Compra de Estoque", amount: totalAmt, reference_type: "stock_purchase", reference_id: productId, description: descParts.join(" — "), created_by: profile.id }).select("id").single();
        if (entryErr) throw new HttpError(400, "cash_entry_falhou", entryErr.message);
        expense_id = entry?.id ?? null;
      }
    }

    await svc.from("audit_logs").insert({
      store_id: storeId,
      actor_profile_id: profile.id,
      action: "stock_adjust",
      entity: "product",
      entity_id: productId,
      after_json: { delta_qty: parsedQty, previous_stock: product.on_hand, new_on_hand: newOnHand, reason: body.reason || null, movement_type: movementType, unit_cost: unitCost, new_cost_price: newCostPrice, expense_id, supplier_id: body.supplier_id || null, payment_method: body.payment_method || null },
    });

    return json({ success: true, product_id: productId, previous_stock: product.on_hand, quantity: parsedQty, new_on_hand: newOnHand, new_cost_price: newCostPrice, expense_id }, 200);
  } catch (e) {
    console.error("stock-adjust error:", e);
    if (e instanceof HttpError) return json({ success: false, error: e.code, message: e.message }, e.status);
    return json({ success: false, error: "internal_error", message: e instanceof Error ? e.message : "Erro interno. Tente novamente." }, 500);
  }
});

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}
