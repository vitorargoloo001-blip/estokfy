import { useEffect, useState, lazy, Suspense } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { DollarSign, Package, ShoppingCart, AlertTriangle, TrendingUp, Plus, Truck, ArrowRight, Boxes, RotateCcw, Search } from 'lucide-react';
import { toast } from 'sonner';
import { startOfTodayUTCISO, startOfMonthUTCISO, daysAgoStrBR, isoToDayBR, formatDayMonthBR } from '@/lib/dateBR';
import SmartRecommendations from '@/components/SmartRecommendations';
import TeamPerformanceCard from '@/components/TeamPerformanceCard';

// Recharts (~225KB) só é baixado quando o Dashboard renderiza
const DailySalesBar = lazy(() => import('@/components/charts/DashboardCharts').then(m => ({ default: m.DailySalesBar })));
const ProfitPie = lazy(() => import('@/components/charts/DashboardCharts').then(m => ({ default: m.ProfitPie })));

interface KPIs {
  totalProducts: number;
  lowStock: number;
  todaySales: number;
  todayRevenue: number;       // valor RECEBIDO hoje (pagamentos confirmados)
  todayPending: number;       // valor pendente gerado hoje (vendas a prazo do dia)
  monthRevenue: number;       // valor RECEBIDO no mês (pagamentos confirmados)
  monthProfit: number;
  overdueCount: number;
  overdueAmount: number;
  payableOverdueCount: number;
  payableOverdueAmount: number;
}

interface PendingDelivery {
  id: string;
  method: string;
  status: string;
  created_at: string;
  sale_id: string;
  customers_name: string | null;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [kpis, setKpis] = useState<KPIs>({ totalProducts: 0, lowStock: 0, todaySales: 0, todayRevenue: 0, todayPending: 0, monthRevenue: 0, monthProfit: 0, overdueCount: 0, overdueAmount: 0, payableOverdueCount: 0, payableOverdueAmount: 0 });
  const [recentSales, setRecentSales] = useState<any[]>([]);
  const [dailySales, setDailySales] = useState<{ day: string; total: number }[]>([]);
  const [profitByProduct, setProfitByProduct] = useState<{ name: string; profit: number }[]>([]);
  const [lowStockItems, setLowStockItems] = useState<{ name: string; on_hand: number; minimum_stock: number }[]>([]);
  const [pendingDeliveries, setPendingDeliveries] = useState<PendingDelivery[]>([]);

  useEffect(() => {
    if (!profile) return;
    const storeId = profile.store_id;

    const fetchAll = async () => {
      const today = startOfTodayUTCISO();
      const monthStart = startOfMonthUTCISO();

      const todayDate = new Date().toISOString().slice(0, 10);
      const [productsRes, todaySalesRes, monthSalesRes, todayPaymentsRes, monthPaymentsRes, todayPendingRes, recentRes, allProducts, deliveriesRes, overdueRes, payableOverdueRes] = await Promise.all([
        supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', storeId).eq('is_active', true),
        // Vendas realizadas hoje (contagem + valor vendido — inclui pagas e pendentes)
        supabase.from('sales').select('id, net_total, amount_pending').eq('store_id', storeId).eq('status', 'paid').is('deleted_at', null).gte('created_at', today),
        // Vendas do mês (para lucro e série diária de "vendido")
        supabase.from('sales').select('net_total, profit_gross, created_at').eq('store_id', storeId).eq('status', 'paid').is('deleted_at', null).gte('created_at', monthStart),
        // Pagamentos RECEBIDOS hoje (data de quitação — não data da venda)
        supabase.from('payments').select('amount').eq('store_id', storeId).gte('paid_at', today),
        // Pagamentos RECEBIDOS no mês (para receita real e gráfico diário)
        supabase.from('payments').select('amount, paid_at').eq('store_id', storeId).gte('paid_at', monthStart),
        // Pendente gerado hoje (vendas a prazo do dia)
        supabase.from('sales').select('amount_pending').eq('store_id', storeId).is('deleted_at', null).gte('created_at', today).in('payment_status', ['pending', 'partial']),
        supabase.from('sales').select('id, net_total, status, payment_status, created_at, customers(name)').eq('store_id', storeId).is('deleted_at', null).order('created_at', { ascending: false }).limit(5),
        supabase.from('products').select('name, on_hand, minimum_stock').eq('store_id', storeId).eq('is_active', true).limit(5000),
        supabase.from('deliveries').select('id, method, status, created_at, sale_id, sales(customers(name))').eq('store_id', storeId).in('status', ['pending', 'shipped']).order('created_at', { ascending: true }).limit(10),
        supabase.from('sales').select('id, amount_pending').eq('store_id', storeId).is('deleted_at', null).in('payment_status', ['pending', 'partial']).lt('due_date', todayDate),
        supabase.from('accounts_payable').select('id, amount').eq('store_id', storeId).eq('status', 'pending').lt('due_date', todayDate),
      ]);

      const overdueCount = overdueRes.data?.length || 0;
      const overdueAmount = (overdueRes.data || []).reduce((s, r) => s + Number(r.amount_pending || 0), 0);
      const payableOverdueCount = payableOverdueRes.data?.length || 0;
      const payableOverdueAmount = (payableOverdueRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      if (overdueCount > 0) {
        toast.warning(`${overdueCount} venda(s) com pagamento vencido — ${overdueAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, { id: 'overdue-alert' });
      }
      if (payableOverdueCount > 0) {
        toast.warning(`${payableOverdueCount} conta(s) a pagar vencida(s) — ${payableOverdueAmount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`, { id: 'payable-overdue-alert' });
      }
      (window as any).__estokfyOverdue = { count: overdueCount, amount: overdueAmount, payableCount: payableOverdueCount, payableAmount: payableOverdueAmount };

      const prods = allProducts.data || [];
      const lowStockCount = prods.filter(p => p.on_hand <= p.minimum_stock).length;
      const lowItems = prods.filter(p => p.on_hand <= p.minimum_stock).sort((a, b) => a.on_hand - b.on_hand).slice(0, 10);
      setLowStockItems(lowItems);

      if (lowStockCount > 0) {
        toast.warning(`${lowStockCount} produto(s) com estoque baixo`, { id: 'low-stock-alert' });
      }

      // RECEBIDO = soma dos pagamentos quitados na data (não da venda)
      const todayRevenue = (todayPaymentsRes.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
      const todayPending = (todayPendingRes.data || []).reduce((s, r) => s + Number(r.amount_pending || 0), 0);
      const monthPayments = monthPaymentsRes.data || [];
      const monthRevenue = monthPayments.reduce((s, r) => s + Number(r.amount || 0), 0);
      const monthData = monthSalesRes.data || [];
      const monthProfit = monthData.reduce((s, r) => s + Number(r.profit_gross), 0);

      setKpis({ totalProducts: productsRes.count || 0, lowStock: lowStockCount, todaySales: todaySalesRes.data?.length || 0, todayRevenue, todayPending, monthRevenue, monthProfit, overdueCount, overdueAmount, payableOverdueCount, payableOverdueAmount });
      setRecentSales(recentRes.data || []);

      setPendingDeliveries((deliveriesRes.data || []).map((d: any) => ({
        id: d.id, method: d.method, status: d.status, created_at: d.created_at,
        sale_id: d.sale_id, customers_name: d.sales?.customers?.name || null,
      })));

      // Gráfico diário: valor RECEBIDO por dia (pagamentos confirmados)
      const dailyMap = new Map<string, number>();
      for (let i = 13; i >= 0; i--) {
        dailyMap.set(daysAgoStrBR(i), 0);
      }
      for (const p of monthPayments) {
        const day = isoToDayBR(p.paid_at);
        if (dailyMap.has(day)) dailyMap.set(day, (dailyMap.get(day) || 0) + Number(p.amount));
      }
      setDailySales(Array.from(dailyMap.entries()).map(([day, total]) => ({
        day: formatDayMonthBR(day + 'T15:00:00.000Z'),
        total: Math.round(total * 100) / 100,
      })));

      const { data: saleItems } = await supabase
        .from('sale_items')
        .select('product_id, qty, unit_price, unit_cost, products(name)')
        .eq('products.store_id', storeId)
        .limit(500);

      if (saleItems) {
        const profitMap = new Map<string, { name: string; profit: number }>();
        for (const si of saleItems) {
          const pName = (si.products as any)?.name || 'Desconhecido';
          const profit = (Number(si.unit_price) - Number(si.unit_cost)) * si.qty;
          const existing = profitMap.get(si.product_id) || { name: pName, profit: 0 };
          existing.profit += profit;
          profitMap.set(si.product_id, existing);
        }
        setProfitByProduct(
          Array.from(profitMap.values()).sort((a, b) => b.profit - a.profit).slice(0, 6)
            .map(p => ({ ...p, profit: Math.round(p.profit * 100) / 100 }))
        );
      }
    };
    fetchAll();
  }, [profile]);

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const METHOD_MAP: Record<string, string> = { pickup: 'Retirada', correios: 'Correios', '99': '99', motoboy: 'Motoboy' };
  const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    pending: { label: 'Pendente', variant: 'secondary' },
    shipped: { label: 'Enviado', variant: 'default' },
  };

  const quickActions = [
    { icon: ShoppingCart, label: 'Vender', to: '/vendas/nova', color: 'bg-primary text-primary-foreground' },
    { icon: Search, label: 'Buscar produto', to: '/produtos', color: 'bg-secondary text-secondary-foreground' },
    { icon: DollarSign, label: 'Registrar gasto', to: '/financeiro', color: 'bg-destructive/10 text-destructive' },
    { icon: Boxes, label: 'Ajustar estoque', to: '/estoque', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200' },
    { icon: RotateCcw, label: 'Registrar troca', to: '/trocas', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200' },
  ];

  const cards = [
    { title: 'Vendas Hoje', value: kpis.todaySales.toString(), sub: kpis.todayPending > 0 ? `${fmt(kpis.todayRevenue)} recebido · ${fmt(kpis.todayPending)} a prazo` : `${fmt(kpis.todayRevenue)} recebido`, icon: ShoppingCart, accent: 'from-primary/15 to-accent/10', iconBg: 'bg-primary/10 text-primary', onClick: undefined as (() => void) | undefined },
    { title: 'Recebido Mês', value: fmt(kpis.monthRevenue), sub: 'pagamentos confirmados', icon: TrendingUp, accent: 'from-emerald-500/15 to-emerald-400/5', iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', onClick: undefined },
    { title: 'Lucro Mês', value: fmt(kpis.monthProfit), sub: 'bruto sobre vendas', icon: DollarSign, accent: 'from-emerald-500/15 to-emerald-400/5', iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400', onClick: undefined },
    { title: 'A Receber Vencido', value: kpis.overdueCount.toString(), sub: kpis.overdueCount > 0 ? fmt(kpis.overdueAmount) : 'sem pendências', icon: AlertTriangle, accent: kpis.overdueCount > 0 ? 'from-rose-500/20 to-rose-400/5' : 'from-muted to-muted', iconBg: kpis.overdueCount > 0 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-muted text-muted-foreground', onClick: kpis.overdueCount > 0 ? () => navigate('/contas-a-receber') : undefined },
    { title: 'A Pagar Vencido', value: kpis.payableOverdueCount.toString(), sub: kpis.payableOverdueCount > 0 ? fmt(kpis.payableOverdueAmount) : 'em dia', icon: AlertTriangle, accent: kpis.payableOverdueCount > 0 ? 'from-rose-500/20 to-rose-400/5' : 'from-muted to-muted', iconBg: kpis.payableOverdueCount > 0 ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-muted text-muted-foreground', onClick: () => navigate('/contas-a-pagar') },
    { title: 'Estoque Baixo', value: kpis.lowStock.toString(), sub: 'abaixo do mínimo', icon: Package, accent: kpis.lowStock > 0 ? 'from-amber-500/20 to-amber-400/5' : 'from-muted to-muted', iconBg: kpis.lowStock > 0 ? 'bg-amber-500/15 text-amber-600 dark:text-amber-400' : 'bg-muted text-muted-foreground', onClick: kpis.lowStock > 0 ? () => navigate('/estoque') : undefined },
  ];

  return (
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      {/* Header premium */}
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6 shadow-card">
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl md:text-3xl font-bold tracking-tight">Central Operacional</h1>
              <Badge className="bg-accent/15 text-accent border-accent/30 hover:bg-accent/20 gap-1 text-[10px] font-semibold">
                <span className="h-1.5 w-1.5 rounded-full bg-accent animate-pulse" />
                Tempo real
              </Badge>
            </div>
            <p className="text-sm text-muted-foreground mt-1">Visão geral e ações rápidas para operar sua loja</p>
          </div>
          <Button variant="premium" size="default" onClick={() => navigate('/vendas/nova')} className="gap-2 hidden md:flex">
            <Plus className="h-5 w-5" />
            Nova Venda
            <kbd className="ml-1 text-xs bg-white/20 px-1.5 py-0.5 rounded font-mono">Alt+N</kbd>
          </Button>
        </div>
      </div>

      {/* Mobile Quick Actions */}
      <div className="flex gap-2 overflow-x-auto pb-1 md:hidden px-1 scrollbar-hide">
        {quickActions.map((a) => (
          <button
            key={a.label}
            onClick={() => navigate(a.to)}
            className={`flex items-center gap-2 rounded-xl px-4 py-3 text-sm font-medium whitespace-nowrap shrink-0 ${a.color}`}
          >
            <a.icon className="h-4 w-4" />
            {a.label}
          </button>
        ))}
      </div>

      {/* KPI cards */}
      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6 md:gap-4"
      >
        {cards.map((c) => (
          <motion.div
            key={c.title}
            variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }}
            transition={{ duration: 0.35, ease: 'easeOut' }}
            className={c.title === 'Estoque Baixo' ? 'col-span-2 md:col-span-1' : ''}
          >
            <Card
              className={`relative overflow-hidden h-full ${c.onClick ? 'cursor-pointer hover:ring-1 hover:ring-primary/30' : ''} ${c.title === 'Vencidas' && kpis.overdueCount > 0 ? 'border-rose-500/40' : ''} ${c.title === 'Estoque Baixo' && kpis.lowStock > 0 ? 'border-amber-500/40' : ''}`}
              onClick={c.onClick}
            >
              <div className={`absolute inset-0 bg-gradient-to-br ${c.accent} opacity-50 pointer-events-none`} />
              <div className="relative">
                <CardHeader className="flex flex-row items-center justify-between pb-1 md:pb-2 p-3 md:p-5">
                  <CardTitle className="text-[11px] md:text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.title}</CardTitle>
                  <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.iconBg}`}>
                    <c.icon className="h-4 w-4" />
                  </span>
                </CardHeader>
                <CardContent className="p-3 pt-0 md:p-5 md:pt-0">
                  <div className="text-xl md:text-2xl font-bold tracking-tight">{c.value}</div>
                  {c.sub && <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>}
                </CardContent>
              </div>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {/* Smart recommendations */}
      <SmartRecommendations storeId={profile?.store_id ?? ''} />

      {/* Team performance */}
      <TeamPerformanceCard />

      {/* Pending deliveries + Low stock */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between p-3 md:p-6">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              <Truck className="h-5 w-5 text-primary" />
              Entregas Pendentes
              {pendingDeliveries.length > 0 && <Badge variant="secondary">{pendingDeliveries.length}</Badge>}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/entregas')} className="gap-1 text-xs">
              Ver <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {pendingDeliveries.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Nenhuma entrega pendente 🎉</p>
            ) : (
              <div className="space-y-2">
                {pendingDeliveries.slice(0, 5).map((d) => (
                  <div key={d.id} className="flex items-center justify-between rounded-lg border p-2.5 md:p-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{d.customers_name || 'Cliente avulso'}</p>
                      <p className="text-xs text-muted-foreground">{METHOD_MAP[d.method] || d.method} • {new Date(d.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <Badge variant={STATUS_MAP[d.status]?.variant || 'outline'} className="ml-2 shrink-0">
                      {STATUS_MAP[d.status]?.label || d.status}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className={lowStockItems.length > 0 ? 'border-amber-500/30' : ''}>
          <CardHeader className="flex flex-row items-center justify-between p-3 md:p-6">
            <CardTitle className="text-base md:text-lg flex items-center gap-2">
              <AlertTriangle className={`h-5 w-5 ${lowStockItems.length > 0 ? 'text-amber-500' : 'text-muted-foreground'}`} />
              Alertas de Estoque
              {lowStockItems.length > 0 && <Badge variant="destructive" className="bg-amber-500">{lowStockItems.length}</Badge>}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/estoque')} className="gap-1 text-xs">
              Ver <ArrowRight className="h-3 w-3" />
            </Button>
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {lowStockItems.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-4">Estoque saudável ✅</p>
            ) : (
              <div className="space-y-2">
                {lowStockItems.slice(0, 5).map((item) => (
                  <div key={item.name} className="flex items-center justify-between rounded-lg border p-2.5">
                    <p className="text-sm font-medium truncate flex-1 mr-2">{item.name}</p>
                    <Badge variant={item.on_hand === 0 ? 'destructive' : 'secondary'} className={item.on_hand === 0 ? '' : 'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200'}>
                      {item.on_hand}/{item.minimum_stock}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Recebido (14 dias)</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {dailySales.length > 0 ? (
              <Suspense fallback={<div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">Carregando gráfico…</div>}>
                <DailySalesBar data={dailySales} />
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
            )}
          </CardContent>
        </Card>

        <Card className="hidden md:block">
          <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Lucro por Produto (Top 6)</CardTitle></CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
            {profitByProduct.length > 0 ? (
              <Suspense fallback={<div className="h-[200px] flex items-center justify-center text-xs text-muted-foreground">Carregando gráfico…</div>}>
                <ProfitPie data={profitByProduct} />
              </Suspense>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-8">Sem dados</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Recent sales */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between p-3 md:p-6">
          <CardTitle className="text-base md:text-lg">Vendas Recentes</CardTitle>
          <Button variant="ghost" size="sm" onClick={() => navigate('/vendas')} className="gap-1 text-xs">
            Ver todas <ArrowRight className="h-3 w-3" />
          </Button>
        </CardHeader>
        <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
          {recentSales.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma venda ainda.</p>
          ) : (
            <div className="space-y-2">
              {recentSales.map((s) => (
                <div key={s.id} className="flex items-center justify-between rounded-lg border p-2.5 md:p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{(s.customers as any)?.name || 'Cliente avulso'}</p>
                    <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleString('pt-BR')}</p>
                  </div>
                  <div className="text-right ml-2 shrink-0">
                    <p className="text-sm font-semibold">{fmt(Number(s.net_total))}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${s.status === 'paid' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200' : 'bg-muted text-muted-foreground'}`}>
                      {s.status === 'paid' ? 'Pago' : s.status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
