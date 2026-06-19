// Aggregated detailed report: summary, sales, returns, stock, finance, timeline
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
const SB_SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

function json(data: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const num = (v: unknown) => Number(v ?? 0);
const round2 = (v: number) => Math.round(v * 100) / 100;

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

    const svc = createClient(SB_URL, SB_SERVICE);
    const { data: profile } = await svc
      .from("profiles")
      .select("id, store_id, role, is_active")
      .eq("auth_user_id", user.id)
      .single();
    if (!profile?.is_active) return json({ error: "sem_permissao" }, 403);

    const storeId = profile.store_id;
    const url = new URL(req.url);
    // Hoje em America/Sao_Paulo (UTC-3)
    const todayBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const from = url.searchParams.get("from") || todayBR;
    const to = url.searchParams.get("to") || todayBR;
    const compareFrom = url.searchParams.get("compare_from");
    const compareTo = url.searchParams.get("compare_to");
    const seller = url.searchParams.get("seller");
    // Janela em UTC equivalente ao dia BR completo (00:00 BR = 03:00 UTC; 23:59:59.999 BR = 02:59:59.999 UTC do dia seguinte)
    const startOfDayBR = (d: string) => `${d}T03:00:00.000Z`;
    const endOfDayBR = (d: string) => {
      const [y, m, dd] = d.split("-").map(Number);
      return new Date(Date.UTC(y, m - 1, dd + 1, 2, 59, 59, 999)).toISOString();
    };
    const fromIso = startOfDayBR(from);
    const toIso = endOfDayBR(to);

    // --- Parallel fetch ---
    const [
      salesRes,
      saleItemsRes,
      paymentsRes,
      returnsRes,
      returnItemsRes,
      stockMovesRes,
      cashRes,
      lowStockRes,
      productsRes,
      customersRes,
      suppliersRes,
    ] = await Promise.all([
      svc.from("sales")
        .select("id, created_at, sale_date, registered_at, status, customer_id, gross_total, discount_total, shipping_fee, net_total, cost_total, profit_gross, payment_status, amount_paid, amount_pending, due_date, deleted_at, notes, created_by")
        .eq("store_id", storeId)
        .gte("sale_date", from).lte("sale_date", to),
      svc.from("sale_items")
        .select("sale_id, product_id, qty, unit_price, line_total, product_name_snapshot, product_sku_snapshot, product_category_snapshot, sales!inner(store_id, sale_date, status)")
        .eq("sales.store_id", storeId)
        .gte("sales.sale_date", from).lte("sales.sale_date", to),
      svc.from("payments")
        .select("sale_id, method, amount, paid_at, sales(sale_date, status, deleted_at, customer_id, created_by)")
        .eq("store_id", storeId)
        .gte("paid_at", fromIso).lte("paid_at", toIso),
      svc.from("returns")
        .select("id, created_at, sale_id, reason, status, notes, created_by")
        .eq("store_id", storeId)
        .gte("created_at", fromIso).lte("created_at", toIso),
      svc.from("return_items")
        .select("return_id, product_id, qty, refund_amount, restock, returns!inner(store_id, created_at, reason)")
        .eq("returns.store_id", storeId)
        .gte("returns.created_at", fromIso).lte("returns.created_at", toIso),
      svc.from("stock_movements")
        .select("id, created_at, product_id, movement_type, qty, unit_cost, total_amount, supplier_id, payment_method, reason")
        .eq("store_id", storeId)
        .gte("created_at", fromIso).lte("created_at", toIso),
      svc.from("cash_entries")
        .select("id, occurred_at, entry_type, category, amount, description, reference_type, reference_id, payment_method")
        .eq("store_id", storeId)
        .gte("occurred_at", fromIso).lte("occurred_at", toIso),
      svc.from("products")
        .select("id, sku, name, on_hand, minimum_stock")
        .eq("store_id", storeId)
        .eq("is_active", true)
        .filter("on_hand", "lte", "minimum_stock")
        .order("on_hand", { ascending: true })
        .limit(30),
      svc.from("products")
        .select("id, sku, name, category_id, categories(id, name)")
        .eq("store_id", storeId),
      svc.from("customers")
        .select("id, name")
        .eq("store_id", storeId),
      svc.from("suppliers")
        .select("id, name")
        .eq("store_id", storeId),
    ]);


    const sales = (salesRes.data || []).filter((s: any) => !seller || s.created_by === seller);
    const saleIdSet = new Set(sales.map((s: any) => s.id));
    const saleItems = (saleItemsRes.data || []).filter((si: any) => !seller || saleIdSet.has(si.sale_id));
    const payments = (paymentsRes.data || []).filter((p: any) => !seller || saleIdSet.has(p.sale_id));
    const returns = (returnsRes.data || []).filter((r: any) => !seller || r.created_by === seller);
    const returnIdSet = new Set(returns.map((r: any) => r.id));
    const returnItems = (returnItemsRes.data || []).filter((ri: any) => !seller || returnIdSet.has(ri.return_id));
    const stockMoves = (stockMovesRes.data || []).filter((m: any) => !seller || m.created_by === seller);
    const cashEntries = (cashRes.data || []).filter((c: any) => !seller || c.created_by === seller);
    const lowStock = lowStockRes.data || [];
    const products = productsRes.data || [];
    const customers = customersRes.data || [];
    const suppliers = suppliersRes.data || [];

    const productMap = new Map(products.map(p => [p.id, p]));
    const customerMap = new Map(customers.map(c => [c.id, c.name]));
    const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));

    // "Vendas válidas" = não canceladas, não estornadas, não soft-deletadas
    // "Vendas válidas" = não canceladas, não estornadas, não soft-deletadas (filtradas por sale_date)
    const realizedSales = sales.filter(s => s.status !== "cancelled" && s.status !== "refunded" && !s.deleted_at);
    const paidSales = sales.filter(s => s.status === "paid" && (s.payment_status === "paid" || !s.payment_status) && !s.deleted_at);

    // --- Summary ---
    const grossRevenue = realizedSales.reduce((s, r) => s + num(r.gross_total), 0);
    const netRevenue = realizedSales.reduce((s, r) => s + num(r.net_total), 0);
    const discountsTotal = realizedSales.reduce((s, r) => s + num(r.discount_total), 0);
    const shippingTotal = realizedSales.reduce((s, r) => s + num(r.shipping_fee), 0);
    const costTotal = realizedSales.reduce((s, r) => s + num(r.cost_total), 0);
    const grossProfit = realizedSales.reduce((s, r) => s + num(r.profit_gross), 0);

    // --- Pagamentos válidos (descarta vendas canceladas/excluídas e method='pending')
    const validPayments = payments.filter((p: any) => {
      const s = p.sales;
      if (!s) return true; // pagamento solto: conta como recebido
      if (s.deleted_at) return false;
      if (s.status === "cancelled" || s.status === "refunded") return false;
      return p.method !== "pending";
    });

    // Recebido total no período (paid_at)
    const amountReceived = validPayments.reduce((s, p: any) => s + num(p.amount), 0);

    // Separação: recebido de vendas FEITAS no período (sale_date in [from,to]) vs de contas ANTIGAS
    const receivedFromPeriodSales = validPayments.reduce((s, p: any) => {
      const sd = p.sales?.sale_date;
      if (sd && sd >= from && sd <= to) return s + num(p.amount);
      return s;
    }, 0);
    const receivedFromOldSales = validPayments.reduce((s, p: any) => {
      const sd = p.sales?.sale_date;
      if (sd && sd < from) return s + num(p.amount);
      return s;
    }, 0);
    const receivedFromOther = round2(amountReceived - receivedFromPeriodSales - receivedFromOldSales);

    // Pendente = saldo em aberto gerado pelas vendas realizadas NO período
    const amountPending = realizedSales.reduce((s, r) => s + num(r.amount_pending ?? 0), 0);
    const pendingSalesCount = realizedSales.filter(s => s.payment_status === "pending" || s.payment_status === "partial").length;
    const todayStr = new Date().toISOString().slice(0, 10);
    const overdueSales = realizedSales.filter(s =>
      (s.payment_status === "pending" || s.payment_status === "partial") &&
      s.due_date && s.due_date < todayStr
    );
    const overdueAmount = overdueSales.reduce((s, r) => s + num(r.amount_pending ?? 0), 0);

    const totalRefund = returnItems.reduce((s, r) => s + num(r.refund_amount), 0);
    const totalReturnsCount = returns.length;

    const purchasesEntries = stockMoves.filter(m => m.movement_type === "purchase_in");
    const purchaseTotal = purchasesEntries.reduce((s, m) => s + num(m.total_amount ?? num(m.unit_cost) * num(m.qty)), 0);

    const expensesIn = cashEntries.filter(e => e.entry_type === "expense");
    const incomeIn = cashEntries.filter(e => e.entry_type === "income");
    const expenseTotal = expensesIn.reduce((s, e) => s + num(e.amount), 0);
    const incomeTotal = incomeIn.reduce((s, e) => s + num(e.amount), 0);

    const balance = incomeTotal - expenseTotal;

    // --- Sales detail ---
    const salesCount = realizedSales.length;
    const ticketAvg = salesCount > 0 ? netRevenue / salesCount : 0;

    // BLOCO B: formas de pagamento — RECEBIMENTOS NO PERÍODO (paid_at)
    const paymentMethods: Record<string, { amount: number; count: number }> = {};
    for (const p of validPayments as any[]) {
      const m = (p.method || "outro").toLowerCase();
      if (!paymentMethods[m]) paymentMethods[m] = { amount: 0, count: 0 };
      paymentMethods[m].amount += num(p.amount);
      paymentMethods[m].count += 1;
    }

    // BLOCO A: formas de pagamento das VENDAS DO PERÍODO (espelho da página /vendas)
    // Regra: para cada venda do período, somar pagamentos por método (independente de paid_at)
    // e marcar a parte pendente (amount_pending) como "a_prazo". Cada venda é contada 1x sob
    // sua forma "primária" (método de maior valor pago, ou a_prazo se só houver pendência).
    const realizedSaleIds = realizedSales.map(s => s.id);
    const realizedSaleIdSet = new Set(realizedSaleIds);

    // Buscar TODOS os pagamentos dessas vendas (independente de paid_at) para espelhar /vendas
    let salePaymentsAll: Array<{ sale_id: string; method: string; amount: number }> = [];
    if (realizedSaleIds.length > 0) {
      const { data: spa } = await svc.from("payments")
        .select("sale_id, method, amount")
        .eq("store_id", storeId)
        .in("sale_id", realizedSaleIds);
      salePaymentsAll = (spa || []).filter((p: any) => p.method !== "pending");
    }

    // Agrupa pagamentos por venda
    const paysBySale = new Map<string, Array<{ method: string; amount: number }>>();
    for (const p of salePaymentsAll) {
      if (!realizedSaleIdSet.has(p.sale_id)) continue;
      const arr = paysBySale.get(p.sale_id) || [];
      arr.push({ method: (p.method || "outro").toLowerCase(), amount: num(p.amount) });
      paysBySale.set(p.sale_id, arr);
    }

    const paymentMethodsRealized: Record<string, { amount: number; count: number }> = {};
    const primaryMethodBySale = new Map<string, string>();

    for (const s of realizedSales) {
      const pays = paysBySale.get(s.id) || [];
      // somatório por método (valores pagos)
      const perMethod: Record<string, number> = {};
      for (const p of pays) {
        perMethod[p.method] = (perMethod[p.method] || 0) + p.amount;
      }
      // parte pendente vira a_prazo
      const pending = num(s.amount_pending ?? 0);
      if (pending > 0) perMethod["a_prazo"] = (perMethod["a_prazo"] || 0) + pending;

      // soma valores em paymentMethodsRealized
      for (const [m, amt] of Object.entries(perMethod)) {
        if (!paymentMethodsRealized[m]) paymentMethodsRealized[m] = { amount: 0, count: 0 };
        paymentMethodsRealized[m].amount += amt;
      }
      // método primário = maior valor (desempate: a_prazo se igual)
      const entries = Object.entries(perMethod).sort((a, b) => b[1] - a[1]);
      const primary = entries.length > 0 ? entries[0][0] : (
        s.payment_status === "pending" || s.payment_status === "partial" || !!s.due_date ? "a_prazo" : "outro"
      );
      primaryMethodBySale.set(s.id, primary);
      if (!paymentMethodsRealized[primary]) paymentMethodsRealized[primary] = { amount: 0, count: 0 };
      paymentMethodsRealized[primary].count += 1;
    }
    // arredonda
    for (const k of Object.keys(paymentMethodsRealized)) {
      paymentMethodsRealized[k].amount = round2(paymentMethodsRealized[k].amount);
    }

    // Mapa sale_id -> forma primária (usado em productSold e timeline)
    const _saleMethodMap = new Map<string, string>(primaryMethodBySale);

    const productSold: Record<string, { sku: string; name: string; qty: number; revenue: number; methods: Record<string, number> }> = {};
    const categorySold: Record<string, { category: string; qty: number; revenue: number }> = {};
    for (const it of saleItems) {
      if (!realizedSaleIdSet.has(it.sale_id)) continue;
      const p: any = productMap.get(it.product_id);
      const snapName = (it as any).product_name_snapshot as string | null;
      const snapSku = (it as any).product_sku_snapshot as string | null;
      const snapCat = (it as any).product_category_snapshot as string | null;
      const name = snapName || p?.name || "Produto não identificado";
      const sku = snapSku || p?.sku || "-";
      const catName = snapCat || p?.categories?.name || "Sem categoria";
      const key = it.product_id;
      if (!productSold[key]) {
        productSold[key] = { sku, name, qty: 0, revenue: 0, methods: {} };
      }
      productSold[key].qty += num(it.qty);
      productSold[key].revenue += num(it.line_total);
      const m = _saleMethodMap.get(it.sale_id) || "outro";
      productSold[key].methods[m] = (productSold[key].methods[m] || 0) + 1;

      const ckey = catName;
      if (!categorySold[ckey]) categorySold[ckey] = { category: catName, qty: 0, revenue: 0 };
      categorySold[ckey].qty += num(it.qty);
      categorySold[ckey].revenue += num(it.line_total);
    }
    const topProducts = Object.values(productSold)
      .sort((a: any, b: any) => (b.qty - a.qty) || (b.revenue - a.revenue))
      .slice(0, 10)
      .map(p => {
        const entries = Object.entries(p.methods).sort((a, b) => b[1] - a[1]);
        return { sku: p.sku, name: p.name, qty: p.qty, revenue: p.revenue, methods: entries.map(([k]) => k) };
      });
    const salesByCategory = Object.values(categorySold).sort((a, b) => b.qty - a.qty);

    // --- Returns detail ---
    const returnReasons: Record<string, number> = {};
    for (const r of returns) {
      const k = r.reason || "outro";
      returnReasons[k] = (returnReasons[k] || 0) + 1;
    }
    const returnedProducts: Record<string, { sku: string; name: string; qty: number; refund: number }> = {};
    for (const ri of returnItems) {
      const p = productMap.get(ri.product_id);
      const key = ri.product_id;
      if (!returnedProducts[key]) {
        returnedProducts[key] = { sku: p?.sku || "?", name: p?.name || "?", qty: 0, refund: 0 };
      }
      returnedProducts[key].qty += num(ri.qty);
      returnedProducts[key].refund += num(ri.refund_amount);
    }
    const topReturned = Object.values(returnedProducts).sort((a, b) => b.qty - a.qty).slice(0, 10);

    // --- Stock detail ---
    const stockByType: Record<string, { count: number; qty: number; value: number }> = {};
    for (const m of stockMoves) {
      const t = m.movement_type;
      if (!stockByType[t]) stockByType[t] = { count: 0, qty: 0, value: 0 };
      stockByType[t].count += 1;
      stockByType[t].qty += Math.abs(num(m.qty));
      stockByType[t].value += num(m.total_amount ?? num(m.unit_cost) * Math.abs(num(m.qty)));
    }

    const movedProducts: Record<string, { sku: string; name: string; in: number; out: number }> = {};
    for (const m of stockMoves) {
      const p = productMap.get(m.product_id);
      const key = m.product_id;
      if (!movedProducts[key]) movedProducts[key] = { sku: p?.sku || "?", name: p?.name || "?", in: 0, out: 0 };
      const q = num(m.qty);
      if (q >= 0) movedProducts[key].in += q;
      else movedProducts[key].out += Math.abs(q);
    }
    const topMoved = Object.values(movedProducts)
      .sort((a, b) => (b.in + b.out) - (a.in + a.out))
      .slice(0, 10);

    // --- Finance detail ---
    const expenseByCategory: Record<string, number> = {};
    const expenseByPayment: Record<string, number> = {};
    for (const e of expensesIn) {
      const k = e.category || "outros";
      expenseByCategory[k] = (expenseByCategory[k] || 0) + num(e.amount);
      const pm = e.payment_method || "nao_informado";
      expenseByPayment[pm] = (expenseByPayment[pm] || 0) + num(e.amount);
    }
    const incomeByCategory: Record<string, number> = {};
    for (const i of incomeIn) {
      const k = i.category || "outros";
      incomeByCategory[k] = (incomeByCategory[k] || 0) + num(i.amount);
    }

    // --- Timeline (events sorted by time) ---
    const timeline: Array<{
      time: string;
      type: string;
      label: string;
      description: string;
      amount?: number;
    }> = [];

    // Build sale -> payment method map (use early so timeline can use it)
    const _salePaymentEarly = new Map<string, string>();
    for (const p of payments) {
      if (p.sale_id && !_salePaymentEarly.has(p.sale_id)) {
        _salePaymentEarly.set(p.sale_id, p.method || "outro");
      }
    }

    for (const s of realizedSales) {
      const pm = _salePaymentEarly.get(s.id);
      const customer = customerMap.get(s.customer_id || "") || "Sem cliente";
      const ps = s.payment_status || "paid";
      const statusSuffix = ps === "pending" ? " · pendente" : ps === "partial" ? " · parcial" : "";
      timeline.push({
        time: s.created_at,
        type: "sale",
        label: "Venda realizada",
        description: (pm ? `${customer} · ${pm}` : customer) + statusSuffix,
        amount: num(s.net_total),
      });
    }
    for (const r of returns) {
      const items = returnItems.filter(ri => ri.return_id === r.id);
      const refund = items.reduce((s, ri) => s + num(ri.refund_amount), 0);
      timeline.push({
        time: r.created_at,
        type: "return",
        label: "Troca/Devolução",
        description: `Motivo: ${r.reason || "—"}`,
        amount: refund,
      });
    }
    for (const m of stockMoves) {
      const p = productMap.get(m.product_id);
      const sup = supplierMap.get(m.supplier_id || "");
      const labels: Record<string, string> = {
        purchase_in: "Entrada (compra)",
        adjustment: "Ajuste de estoque",
        loss: "Perda de estoque",
        sale_out: "Saída (venda)",
        return_in: "Retorno ao estoque",
      };
      timeline.push({
        time: m.created_at,
        type: `stock_${m.movement_type}`,
        label: labels[m.movement_type] || m.movement_type,
        description: `${p?.sku || "?"} · ${p?.name || ""} · ${num(m.qty)} un${sup ? ` · ${sup}` : ""}`,
        amount: num(m.total_amount ?? num(m.unit_cost) * Math.abs(num(m.qty))),
      });
    }
    // Map sale_id -> primary payment method (first payment of the sale)
    const salePaymentMap = new Map<string, string>();
    for (const p of payments) {
      if (p.sale_id && !salePaymentMap.has(p.sale_id)) {
        salePaymentMap.set(p.sale_id, p.method || "outro");
      }
    }

    for (const e of cashEntries) {
      // Skip entries already represented by sale/return/stock to avoid double counting in timeline
      if (e.reference_type === "sale" || e.reference_type === "return") continue;
      const pm = e.payment_method ? ` · ${e.payment_method}` : "";
      timeline.push({
        time: e.occurred_at,
        type: e.entry_type === "income" ? "income" : "expense",
        label: e.entry_type === "income" ? "Recebimento" : "Despesa",
        description: `${e.category}${pm}${e.description ? ` · ${e.description}` : ""}`,
        amount: num(e.amount),
      });
    }
    timeline.sort((a, b) => a.time.localeCompare(b.time));

    // --- Daily series (sparkline data) ---
    const dayKeys: string[] = [];
    {
      const d0 = new Date(from + "T00:00:00Z");
      const d1 = new Date(to + "T00:00:00Z");
      // Cap to 60 days to keep payload small
      const maxDays = 60;
      let count = 0;
      for (let d = new Date(d0); d <= d1 && count < maxDays; d.setUTCDate(d.getUTCDate() + 1)) {
        dayKeys.push(d.toISOString().slice(0, 10));
        count++;
      }
    }
    const initSeries = () => Object.fromEntries(dayKeys.map((d) => [d, 0])) as Record<string, number>;
    const salesByDay = initSeries();
    const receivedByDay = initSeries();
    const profitByDay = initSeries();
    const expenseByDay = initSeries();
    const pendingByDay = initSeries();
    for (const s of realizedSales) {
      const d = String(s.sale_date || s.created_at).slice(0, 10);
      if (d in salesByDay) {
        salesByDay[d] += num(s.net_total);
        profitByDay[d] += num(s.profit_gross);
        pendingByDay[d] += num(s.amount_pending ?? 0);
      }
    }
    for (const p of payments) {
      const d = String(p.paid_at).slice(0, 10);
      if (d in receivedByDay) receivedByDay[d] += num(p.amount);
    }
    for (const e of expensesIn) {
      const d = String(e.occurred_at).slice(0, 10);
      if (d in expenseByDay) expenseByDay[d] += num(e.amount);
    }
    const dailySeries = dayKeys.map((d) => ({
      day: d,
      sales: round2(salesByDay[d]),
      received: round2(receivedByDay[d]),
      profit: round2(profitByDay[d]),
      expense: round2(expenseByDay[d]),
      pending: round2(pendingByDay[d]),
    }));

    // --- Comparison period (optional) ---
    let previous: Record<string, number> | null = null;
    if (compareFrom && compareTo) {
      const cFromIso = startOfDayBR(compareFrom);
      const cToIso = endOfDayBR(compareTo);
      const [pSalesRes, pCashRes, pReturnItemsRes, pPaymentsRes] = await Promise.all([
        svc.from("sales")
          .select("status, payment_status, gross_total, net_total, profit_gross, amount_paid, amount_pending, deleted_at")
          .eq("store_id", storeId)
          .gte("sale_date", compareFrom).lte("sale_date", compareTo),
        svc.from("cash_entries")
          .select("entry_type, amount")
          .eq("store_id", storeId)
          .gte("occurred_at", cFromIso).lte("occurred_at", cToIso),
        svc.from("return_items")
          .select("refund_amount, returns!inner(store_id, created_at)")
          .eq("returns.store_id", storeId)
          .gte("returns.created_at", cFromIso).lte("returns.created_at", cToIso),
        svc.from("payments")
          .select("amount")
          .eq("store_id", storeId)
          .gte("paid_at", cFromIso).lte("paid_at", cToIso),
      ]);
      const pSales = (pSalesRes.data || []).filter((s: any) => s.status !== "cancelled" && s.status !== "refunded" && !s.deleted_at);
      const pExpense = (pCashRes.data || []).filter((e: any) => e.entry_type === "expense").reduce((s: number, e: any) => s + num(e.amount), 0);
      const pIncome = (pCashRes.data || []).filter((e: any) => e.entry_type === "income").reduce((s: number, e: any) => s + num(e.amount), 0);
      const pReceived = (pPaymentsRes.data || []).reduce((s: number, p: any) => s + num(p.amount), 0);
      previous = {
        gross_revenue: round2(pSales.reduce((s: number, r: any) => s + num(r.gross_total), 0)),
        net_revenue: round2(pSales.reduce((s: number, r: any) => s + num(r.net_total), 0)),
        gross_profit: round2(pSales.reduce((s: number, r: any) => s + num(r.profit_gross), 0)),
        expense_total: round2(pExpense),
        income_total: round2(pIncome),
        balance: round2(pIncome - pExpense),
        sales_count: pSales.length,
        amount_sold: round2(pSales.reduce((s: number, r: any) => s + num(r.net_total), 0)),
        amount_received: round2(pReceived),
        amount_pending: round2(pSales.reduce((s: number, r: any) => s + num(r.amount_pending ?? 0), 0)),
        refund_total: round2((pReturnItemsRes.data || []).reduce((s: number, r: any) => s + num(r.refund_amount), 0)),
      };
    }

    return json({
      period: { from, to },
      compare_period: compareFrom && compareTo ? { from: compareFrom, to: compareTo } : null,
      previous,
      daily_series: dailySeries,
      summary: {
        gross_revenue: round2(grossRevenue),
        net_revenue: round2(netRevenue),
        discounts_total: round2(discountsTotal),
        shipping_total: round2(shippingTotal),
        cost_total: round2(costTotal),
        gross_profit: round2(grossProfit),
        expense_total: round2(expenseTotal),
        income_total: round2(incomeTotal),
        purchase_total: round2(purchaseTotal),
        sales_count: salesCount,
        returns_count: totalReturnsCount,
        refund_total: round2(totalRefund),
        balance: round2(balance),
        // Separação Vendido x Recebido x Pendente (vendido = sale_date, recebido = paid_at)
        amount_sold: round2(netRevenue),
        amount_received: round2(amountReceived),
        amount_received_from_period_sales: round2(receivedFromPeriodSales),
        amount_received_from_old_sales: round2(receivedFromOldSales),
        amount_received_from_other: round2(receivedFromOther),
        amount_pending: round2(amountPending),
        pending_sales_count: pendingSalesCount,
        overdue_sales_count: overdueSales.length,
        overdue_amount: round2(overdueAmount),
        // Caixa líquido REAL = recebimentos no período − despesas − devoluções − compras
        net_real_total: round2(amountReceived - totalRefund - expenseTotal - purchaseTotal),
      },
      sales: {
        count: salesCount,
        ticket_avg: round2(ticketAvg),
        gross: round2(grossRevenue),
        net: round2(netRevenue),
        discounts: round2(discountsTotal),
        shipping: round2(shippingTotal),
        amount_received: round2(amountReceived),
        amount_pending: round2(amountPending),
        // BLOCO B: recebimentos reais no período (por paid_at)
        payment_methods: paymentMethods,
        // BLOCO A: formas de pagamento das vendas realizadas no período (por sale_date)
        payment_methods_realized: paymentMethodsRealized,

        top_products: topProducts.map(p => ({ ...p, revenue: round2(p.revenue) })),
        by_category: salesByCategory.map(c => ({ ...c, revenue: round2(c.revenue) })),
        list: realizedSales.map(s => ({
          id: s.id,
          time: s.created_at,
          customer: customerMap.get(s.customer_id || "") || "—",
          gross: round2(num(s.gross_total)),
          discount: round2(num(s.discount_total)),
          shipping: round2(num(s.shipping_fee)),
          net: round2(num(s.net_total)),
          profit: round2(num(s.profit_gross)),
          payment_method: _salePaymentEarly.get(s.id) || null,
          payment_status: s.payment_status || "paid",
          amount_paid: round2(num(s.amount_paid ?? s.net_total)),
          amount_pending: round2(num(s.amount_pending ?? 0)),
          due_date: s.due_date || null,
          notes: s.notes || null,
        })),
      },
      returns: {
        count: totalReturnsCount,
        refund_total: round2(totalRefund),
        reasons: returnReasons,
        top_products: topReturned.map(p => ({ ...p, refund: round2(p.refund) })),
        list: returns.map(r => ({
          id: r.id,
          time: r.created_at,
          reason: r.reason,
          notes: r.notes,
          items_count: returnItems.filter(ri => ri.return_id === r.id).length,
          refund: round2(returnItems.filter(ri => ri.return_id === r.id).reduce((s, ri) => s + num(ri.refund_amount), 0)),
        })),
      },
      stock: {
        by_type: Object.fromEntries(
          Object.entries(stockByType).map(([k, v]) => [k, { ...v, value: round2(v.value) }])
        ),
        top_moved: topMoved,
        low_stock: lowStock,
        purchases: purchasesEntries.map(p => ({
          id: p.id,
          time: p.created_at,
          product: productMap.get(p.product_id)?.name || "?",
          sku: productMap.get(p.product_id)?.sku || "?",
          qty: num(p.qty),
          unit_cost: round2(num(p.unit_cost)),
          total: round2(num(p.total_amount ?? num(p.unit_cost) * num(p.qty))),
          supplier: supplierMap.get(p.supplier_id || "") || "—",
          payment_method: p.payment_method || "—",
        })),
      },
      finance: {
        income_total: round2(incomeTotal),
        expense_total: round2(expenseTotal),
        balance: round2(balance),
        income_by_category: Object.fromEntries(
          Object.entries(incomeByCategory).map(([k, v]) => [k, round2(v)])
        ),
        expense_by_category: Object.fromEntries(
          Object.entries(expenseByCategory).map(([k, v]) => [k, round2(v)])
        ),
        expense_by_payment_method: Object.fromEntries(
          Object.entries(expenseByPayment).map(([k, v]) => [k, round2(v)])
        ),
        entries: cashEntries.map(e => ({
          id: e.id,
          time: e.occurred_at,
          type: e.entry_type,
          category: e.category,
          amount: round2(num(e.amount)),
          description: e.description,
          reference_type: e.reference_type,
          payment_method: e.payment_method || null,
        })),
      },
      timeline: timeline.map(t => ({ ...t, amount: t.amount !== undefined ? round2(t.amount) : undefined })),
    });
  } catch (e) {
    console.error("reports-detailed error:", e);
    return json({ error: "internal_error", message: "Erro interno." }, 500);
  }
});
