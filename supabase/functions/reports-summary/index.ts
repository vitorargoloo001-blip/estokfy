import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "GET") return json({ error: "method_not_allowed" }, 405);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "missing_token" }, 401);

    const userClient = createClient(SB_URL, SB_ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authErr } = await userClient.auth.getUser();
    if (authErr || !user) return json({ error: "missing_token" }, 401);

    // Get profile
    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc
      .from("profiles")
      .select("id, store_id, role, is_active")
      .eq("auth_user_id", user.id)
      .single();

    if (!profile || !profile.is_active) return json({ error: "sem_permissao" }, 403);

    const storeId = profile.store_id;
    const url = new URL(req.url);
    const todayBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const daysAgoBR = (n: number) => {
      const [y, m, d] = todayBR.split("-").map(Number);
      const a = new Date(Date.UTC(y, m - 1, d, 15, 0, 0));
      a.setUTCDate(a.getUTCDate() - n);
      return `${a.getUTCFullYear()}-${String(a.getUTCMonth() + 1).padStart(2, "0")}-${String(a.getUTCDate()).padStart(2, "0")}`;
    };
    const from = url.searchParams.get("from") || daysAgoBR(30);
    const to = url.searchParams.get("to") || todayBR;
    const fromDate = `${from}T03:00:00.000Z`;
    const [ty, tm, td] = to.split("-").map(Number);
    const toDate = new Date(Date.UTC(ty, tm - 1, td + 1, 2, 59, 59, 999)).toISOString();

    // Sales realizadas no período (para lucro bruto)
    const { data: salesData } = await svc
      .from("sales")
      .select("profit_gross, cost_total, amount_paid, amount_pending, payment_status")
      .eq("store_id", storeId)
      .in("status", ["paid"])
      .is("deleted_at", null)
      .gte("created_at", fromDate)
      .lte("created_at", toDate);

    // Pagamentos efetivamente RECEBIDOS no período (pela data de quitação)
    const { data: paymentsData } = await svc
      .from("payments")
      .select("amount")
      .eq("store_id", storeId)
      .gte("paid_at", fromDate)
      .lte("paid_at", toDate);

    const netRevenue = (paymentsData || []).reduce((s, r) => s + Number(r.amount), 0);
    const amountPending = (salesData || []).reduce((s, r) => s + Number(r.amount_pending || 0), 0);
    const grossProfit = (salesData || []).reduce((s, r) => s + Number(r.profit_gross), 0);

    // Expenses
    const { data: expenseData } = await svc
      .from("cash_entries")
      .select("amount")
      .eq("store_id", storeId)
      .eq("entry_type", "expense")
      .gte("occurred_at", fromDate)
      .lte("occurred_at", toDate);

    const expenseTotal = (expenseData || []).reduce((s, r) => s + Number(r.amount), 0);

    // Low stock
    const { data: lowStock } = await svc
      .from("products")
      .select("sku, name, on_hand, minimum_stock")
      .eq("store_id", storeId)
      .eq("is_active", true)
      .filter("on_hand", "lte", "minimum_stock")
      .order("on_hand", { ascending: true })
      .limit(20);

    // Top returns
    const { data: returnItems } = await svc
      .from("return_items")
      .select("product_id, qty, returns!inner(store_id, created_at)")
      .eq("returns.store_id", storeId)
      .gte("returns.created_at", fromDate)
      .lte("returns.created_at", toDate);

    // Aggregate returns by product
    const returnMap = new Map<string, number>();
    for (const ri of returnItems || []) {
      const curr = returnMap.get(ri.product_id) || 0;
      returnMap.set(ri.product_id, curr + ri.qty);
    }

    // Get product SKUs for top returns
    const topReturnEntries = [...returnMap.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    let topReturns: { sku: string; returned_qty: number }[] = [];
    if (topReturnEntries.length > 0) {
      const productIds = topReturnEntries.map(([id]) => id);
      const { data: products } = await svc
        .from("products")
        .select("id, sku")
        .in("id", productIds);

      const skuMap = new Map((products || []).map(p => [p.id, p.sku]));
      topReturns = topReturnEntries.map(([id, qty]) => ({
        sku: skuMap.get(id) || "?",
        returned_qty: qty,
      }));
    }

    return json({
      net_revenue: Math.round(netRevenue * 100) / 100,
      amount_received: Math.round(netRevenue * 100) / 100,
      amount_pending: Math.round(amountPending * 100) / 100,
      gross_profit: Math.round(grossProfit * 100) / 100,
      expense_total: Math.round(expenseTotal * 100) / 100,
      low_stock: (lowStock || []).map(p => ({ sku: p.sku, on_hand: p.on_hand, minimum_stock: p.minimum_stock })),
      top_returns: topReturns,
    }, 200);
  } catch (e) {
    console.error("reports-summary error:", e);
    return json({ error: "internal_error", message: "Erro interno. Tente novamente." }, 500);
  }
});

function json(data: Record<string, unknown>, status: number) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
