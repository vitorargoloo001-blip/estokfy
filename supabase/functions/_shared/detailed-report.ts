/* eslint-disable @typescript-eslint/no-explicit-any */
// Shared server-side aggregation for detailed reports, summaries and AI analyses.
// The Supabase query client is structural so this module works in Deno and test runners.
import { fetchAllReportRows, isValidReportSale, isCashReportMethod, reportDay, roundReportMoney } from "./report-utils.ts";
export interface ReportOptions { from: string; to: string; seller?: string | null; compareFrom?: string | null; compareTo?: string | null; }
interface ReportClient { from(table: string): any; }
const num = (v: unknown) => Number(v ?? 0);
const round2 = roundReportMoney;
export async function loadDetailedReport(svc: ReportClient, storeId: string, options: ReportOptions) {
  const read = async (query: () => any): Promise<{ data: any[] }> => ({ data: await fetchAllReportRows<any>(query) });
    // Hoje em America/Sao_Paulo (UTC-3)
    const todayBR = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
    const from = options.from;
    const to = options.to;
    const compareFrom = options.compareFrom;
    const compareTo = options.compareTo;
    const seller = options.seller;
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
      read(() => svc.from("sales")
        .select("id, created_at, sale_date, registered_at, status, customer_id, gross_total, discount_total, shipping_fee, net_total, cost_total, profit_gross, payment_status, amount_paid, amount_pending, due_date, deleted_at, notes, created_by")
        .eq("store_id", storeId)
        .gte("sale_date", from).lte("sale_date", to).order("id")),
      read(() => svc.from("sale_items")
        .select("sale_id, product_id, qty, unit_price, line_total, product_name_snapshot, product_sku_snapshot, product_category_snapshot, sales!inner(store_id, sale_date, status)")
        .eq("sales.store_id", storeId)
        .gte("sales.sale_date", from).lte("sales.sale_date", to).order("sale_id").order("product_id")),
      read(() => svc.from("payments")
        .select("id, sale_id, method, amount, paid_at, created_by, sales(sale_date, status, deleted_at, customer_id, created_by)")
        .eq("store_id", storeId)
        .gte("paid_at", fromIso).lte("paid_at", toIso).order("id")),
      read(() => svc.from("returns")
        .select("id, created_at, sale_id, reason, status, notes, created_by")
        .eq("store_id", storeId)
        .gte("created_at", fromIso).lte("created_at", toIso).order("id")),
      read(() => svc.from("return_items")
        .select("id, return_id, product_id, qty, refund_amount, restock, returns!inner(store_id, created_at, reason)")
        .eq("returns.store_id", storeId)
        .gte("returns.created_at", fromIso).lte("returns.created_at", toIso).order("id")),
      read(() => svc.from("stock_movements")
        .select("id, created_at, product_id, movement_type, qty, unit_cost, total_amount, supplier_id, payment_method, reason, created_by")
        .eq("store_id", storeId)
        .gte("created_at", fromIso).lte("created_at", toIso).order("id")),
      read(() => svc.from("cash_entries")
        .select("id, occurred_at, entry_type, category, amount, description, reference_type, reference_id, payment_method, created_by")
        .eq("store_id", storeId)
        .gte("occurred_at", fromIso).lte("occurred_at", toIso).order("id")),
      read(() => svc.from("products")
        .select("id, sku, name, on_hand, minimum_stock")
        .eq("store_id", storeId)
        .eq("is_active", true).order("id")),
      read(() => svc.from("products")
        .select("id, sku, name, category_id, categories(id, name)")
        .eq("store_id", storeId).order("id")),
      read(() => svc.from("customers")
        .select("id, name")
        .eq("store_id", storeId).order("id")),
      read(() => svc.from("suppliers")
        .select("id, name")
        .eq("store_id", storeId).order("id")), 
    ]);


    const sales = (salesRes.data || []).filter((s: any) => !seller || s.created_by === seller);
    const saleIdSet = new Set(sales.map((s: any) => s.id));
    const saleItems = (saleItemsRes.data || []).filter((si: any) => !seller || saleIdSet.has(si.sale_id));
    const payments = (paymentsRes.data || []).filter((p: any) => !seller || (p.sales?.created_by ?? p.created_by) === seller);
    const returns = (returnsRes.data || []).filter((r: any) => r.status !== "cancelled" && (!seller || r.created_by === seller));
    const returnIdSet = new Set(returns.map((r: any) => r.id));
    const returnItems = (returnItemsRes.data || []).filter((ri: any) => returnIdSet.has(ri.return_id));
    const stockMoves = (stockMovesRes.data || []).filter((m: any) => !seller || m.created_by === seller);
    const rawCashEntries = (cashRes.data || []).filter((c: any) => !seller || c.created_by === seller);
    const lowStock = lowStockRes.data.filter(p => num(p.on_hand) <= num(p.minimum_stock)).sort((a, b) => num(a.on_hand) - num(b.on_hand));
    const products = productsRes.data || [];
    const customers = customersRes.data || [];
    const suppliers = suppliersRes.data || [];

    const productMap = new Map(products.map(p => [p.id, p]));
    const customerMap = new Map(customers.map(c => [c.id, c.name]));
    const supplierMap = new Map(suppliers.map(s => [s.id, s.name]));

    // "Vendas válidas" = não canceladas, não estornadas, não soft-deletadas
    // "Vendas válidas" = não canceladas, não estornadas, não soft-deletadas (filtradas por sale_date)
    const realizedSales = sales.filter(isValidReportSale);

    // --- Summary ---
    const grossRevenue = realizedSales.reduce((s, r) => s + num(r.gross_total), 0);
    const netRevenue = realizedSales.reduce((s, r) => s + num(r.net_total), 0);
    const discountsTotal = realizedSales.reduce((s, r) => s + num(r.discount_total), 0);
    const shippingTotal = realizedSales.reduce((s, r) => s + num(r.shipping_fee), 0);
    const costTotal = realizedSales.reduce((s, r) => s + num(r.cost_total), 0);
    const grossProfit = realizedSales.reduce((s, r) => s + num(r.profit_gross), 0);

    // --- Pagamentos válidos (descarta vendas canceladas/excluídas, method='pending'
    // e method='return_offset' — abatimento de devolução em dívida, nunca
    // dinheiro recebido de verdade)
    const validPayments = payments.filter((p: any) => isCashReportMethod(p.method) && (!p.sales || isValidReportSale(p.sales)));
    // payments is authoritative for sale receipts. Legacy sale cash entries may be
    // duplicated or reflect a different date; never add both representations.
    const cashEntries = [
      ...rawCashEntries.filter(e => !(e.entry_type === "income" && ["sale", "sale_payment", "payment"].includes(e.reference_type))),
      ...validPayments.map(p => ({ id: `payment:${p.id}`, occurred_at: p.paid_at,
        entry_type: "income", category: p.sale_id ? "venda" : "outros recebimentos",
        amount: num(p.amount), description: p.sale_id ? `Recebimento da venda ${p.sale_id}` : "Recebimento sem venda vinculada",
        reference_type: "payment", reference_id: p.id, payment_method: p.method, created_by: p.created_by })),
    ].sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));

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
    const todayStr = todayBR;
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
      const { data: spa } = await read(() => svc.from("payments")
        .select("id, sale_id, method, amount, sales!inner(store_id, sale_date)")
        .eq("store_id", storeId).eq("sales.store_id", storeId)
        .gte("sales.sale_date", from).lte("sales.sale_date", to).order("id"));
      salePaymentsAll = spa.filter((p: any) => !["pending", "a_prazo"].includes(p.method));
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
      const entries = Object.entries(perMethod).sort((a, b) => (b[1] - a[1]) || (a[0] === "a_prazo" ? -1 : 1));
      const primary = entries.length > 0 ? entries[0][0] : (
        s.payment_status === "pending" || s.payment_status === "partial" || !!s.due_date ? "a_prazo" : "outro"
      );
      primaryMethodBySale.set(s.id, primary);
      if (!paymentMethodsRealized[primary]) paymentMethodsRealized[primary] = { amount: 0, count: 0 };
      paymentMethodsRealized[primary].count += 1;
    }
    // arredonda
    for (const v of Object.values(paymentMethods)) v.amount = round2(v.amount);
    for (const k of Object.keys(paymentMethodsRealized)) {
      paymentMethodsRealized[k].amount = round2(paymentMethodsRealized[k].amount);
    }

    // Mapa sale_id -> forma primária (usado em productSold e timeline)
    const _saleMethodMap = new Map<string, string>(primaryMethodBySale);

    const itemsBySale = new Map<string, Array<{ id: string; product_id: string | null; name: string; sku: string; qty: number; unit_price: number; line_total: number }>>();
    for (const it of saleItems) {
      if (!realizedSaleIdSet.has(it.sale_id)) continue;
      const product = productMap.get(it.product_id);
      const items = itemsBySale.get(it.sale_id) || [];
      items.push({ id: `${it.sale_id}:${it.product_id}`, product_id: it.product_id, name: it.product_name_snapshot || product?.name || "Produto não identificado",
        sku: it.product_sku_snapshot || product?.sku || "-", qty: num(it.qty), unit_price: round2(num(it.unit_price)), line_total: round2(num(it.line_total)) });
      itemsBySale.set(it.sale_id, items);
    }

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
      const key = it.product_id || `${sku}:${name}`;
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

    // Payment labels use all payments of each sale, independent of receipt date.
    const _salePaymentEarly = primaryMethodBySale;

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



      for (let d = new Date(d0); d <= d1; d.setUTCDate(d.getUTCDate() + 1)) {
        dayKeys.push(d.toISOString().slice(0, 10));

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
    for (const p of validPayments) {
      const d = reportDay(p.paid_at);
      if (d in receivedByDay) receivedByDay[d] += num(p.amount);
    }
    for (const e of expensesIn) {
      const d = reportDay(e.occurred_at);
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
      const comparison = await loadDetailedReport(svc, storeId, { from: compareFrom, to: compareTo, seller });
      previous = comparison.summary;
    }

    return {
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
        // Cash purchases and cash refunds are already in cash_entries expenses.
        net_real_total: round2(balance),
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
          sale_date: s.sale_date || reportDay(s.created_at),
          customer_id: s.customer_id,
          items: itemsBySale.get(s.id) || [],
          payment_methods: [...new Set([...(paysBySale.get(s.id) || []).map(p => p.method), ...(num(s.amount_pending) > 0 ? ["a_prazo"] : [])])],
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
};
}
