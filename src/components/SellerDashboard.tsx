import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import {
  ShoppingCart, Users, Package, Receipt, Target, RotateCcw, Plus, Search, Boxes, QrCode, Banknote,
  CreditCard, Hourglass, Gift, ArrowLeftRight, Wallet,
} from 'lucide-react';

interface SellerStats {
  today_sales_count: number;
  today_sales_total: number;
  today_pix_count: number;
  today_pix_total: number;
  today_cash_count: number;
  today_cash_total: number;
  today_payment_methods: Record<string, { count: number; amount: number }>;
  month_sales_count: number;
  month_sales_total: number;
  avg_ticket: number;
  customers_served: number;
  products_sold: number;
  returns_count: number;
  goal_target: number | null;
}

const PM_LABEL: Record<string, string> = {
  pix: 'PIX', card: 'Cartão', credit_card: 'Cartão de crédito', debit_card: 'Cartão de débito',
  cash: 'Dinheiro', transfer: 'Transferência', pending: 'A prazo', credit: 'Crédito cliente', other: 'Outro',
};
const PM_ICON: Record<string, typeof QrCode> = {
  pix: QrCode, card: CreditCard, credit_card: CreditCard, debit_card: CreditCard,
  cash: Banknote, transfer: ArrowLeftRight, pending: Hourglass, credit: Gift, other: Wallet,
};

/**
 * Dashboard exclusivo para cargos sem visão financeira (vendedor, estoque,
 * viewer) — mostra só os próprios números, nunca lucro/recebido/caixa da
 * loja. Os dados vêm de get_seller_dashboard(), que já filtra por
 * created_by = o próprio perfil no backend (não é só ocultado na tela).
 */
export default function SellerDashboard() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { canCreateReturns } = usePermissions();
  const [stats, setStats] = useState<SellerStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile) return;
    supabase.rpc('get_seller_dashboard').then(({ data }) => {
      setStats((data as unknown as SellerStats) || null);
      setLoading(false);
    });
  }, [profile]);

  const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const quickActions = [
    { icon: ShoppingCart, label: 'Vender', to: '/vendas/nova', color: 'bg-primary text-primary-foreground' },
    { icon: Search, label: 'Buscar produto', to: '/produtos', color: 'bg-secondary text-secondary-foreground' },
    { icon: Boxes, label: 'Ajustar estoque', to: '/estoque', color: 'bg-amber-100 text-amber-700 dark:bg-amber-900 dark:text-amber-200' },
    ...(canCreateReturns ? [{ icon: RotateCcw, label: 'Registrar troca', to: '/trocas', color: 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200' }] : []),
  ];

  const cards = [
    { title: 'Minhas Vendas Hoje', value: stats?.today_sales_count?.toString() || '0', sub: fmt(stats?.today_sales_total || 0), icon: ShoppingCart, iconBg: 'bg-primary/10 text-primary' },
    { title: 'Vendas PIX Hoje', value: stats?.today_pix_count?.toString() || '0', sub: fmt(stats?.today_pix_total || 0), icon: QrCode, iconBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400' },
    { title: 'Vendas Dinheiro Hoje', value: stats?.today_cash_count?.toString() || '0', sub: fmt(stats?.today_cash_total || 0), icon: Banknote, iconBg: 'bg-lime-500/10 text-lime-600 dark:text-lime-400' },
    { title: 'Minhas Vendas no Mês', value: stats?.month_sales_count?.toString() || '0', sub: fmt(stats?.month_sales_total || 0), icon: Receipt, iconBg: 'bg-blue-500/10 text-blue-600 dark:text-blue-400' },
    { title: 'Ticket Médio', value: fmt(stats?.avg_ticket || 0), sub: 'média das minhas vendas', icon: Receipt, iconBg: 'bg-violet-500/10 text-violet-600 dark:text-violet-400' },
    { title: 'Clientes Atendidos', value: stats?.customers_served?.toString() || '0', sub: 'clientes distintos no mês', icon: Users, iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
    { title: 'Produtos Vendidos', value: stats?.products_sold?.toString() || '0', sub: 'unidades no mês', icon: Package, iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400' },
    ...(canCreateReturns ? [{ title: 'Minhas Trocas/Devoluções', value: stats?.returns_count?.toString() || '0', sub: 'no mês', icon: RotateCcw, iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400' }] : []),
  ];

  return (
    <div className="space-y-4 md:space-y-6 w-full min-w-0">
      <div className="relative overflow-hidden rounded-2xl border border-border bg-card p-5 md:p-6 shadow-card">
        <div className="absolute inset-0 bg-gradient-mesh opacity-60 pointer-events-none" />
        <div className="relative flex items-center justify-between gap-4">
          <div>
            <h1 className="text-xl md:text-3xl font-bold tracking-tight">Meu Painel</h1>
            <p className="text-sm text-muted-foreground mt-1">Suas vendas e desempenho pessoal</p>
          </div>
          <button
            onClick={() => navigate('/vendas/nova')}
            className="hidden md:flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-medium bg-primary text-primary-foreground"
          >
            <Plus className="h-4 w-4" />
            Nova Venda
          </button>
        </div>
      </div>

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

      <motion.div
        initial="hidden"
        animate="show"
        variants={{ hidden: {}, show: { transition: { staggerChildren: 0.06 } } }}
        className="grid grid-cols-2 gap-3 md:grid-cols-3 md:gap-4"
      >
        {cards.map((c) => (
          <motion.div key={c.title} variants={{ hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0 } }} transition={{ duration: 0.35, ease: 'easeOut' }}>
            <Card className="relative overflow-hidden h-full">
              <CardHeader className="flex flex-row items-center justify-between pb-1 md:pb-2 p-3 md:p-5">
                <CardTitle className="text-[11px] md:text-xs font-semibold uppercase tracking-wider text-muted-foreground">{c.title}</CardTitle>
                <span className={`flex h-9 w-9 items-center justify-center rounded-xl ${c.iconBg}`}>
                  <c.icon className="h-4 w-4" />
                </span>
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-5 md:pt-0">
                <div className="text-xl md:text-2xl font-bold tracking-tight">{loading ? '—' : c.value}</div>
                {c.sub && <p className="text-xs text-muted-foreground mt-0.5">{c.sub}</p>}
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </motion.div>

      {!loading && stats && Object.keys(stats.today_payment_methods || {}).length > 0 && (
        <div className="space-y-2">
          <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">
            Formas de pagamento (hoje)
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            {Object.entries(stats.today_payment_methods).map(([method, info]) => {
              const Icon = PM_ICON[method] || Wallet;
              const isPending = method === 'pending';
              const pct = stats.today_sales_total > 0 ? (info.amount / stats.today_sales_total) * 100 : 0;
              return (
                <Card key={method}>
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                        <Icon className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-semibold truncate">{PM_LABEL[method] || method}</div>
                        <div className="text-[11px] text-muted-foreground">{info.count} venda{info.count !== 1 ? 's' : ''}</div>
                      </div>
                    </div>
                    <div className={`text-lg font-bold tabular-nums ${isPending ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                      {fmt(info.amount)}
                    </div>
                    <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${Math.max(pct, 2)}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                      {pct.toFixed(1)}% das minhas vendas hoje{isPending ? ' · pendente' : ''}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {!loading && stats?.goal_target != null && (
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 p-3 md:p-6">
            <Target className="h-5 w-5 text-primary" />
            <CardTitle className="text-base md:text-lg">Meta do Mês (loja)</CardTitle>
          </CardHeader>
          <CardContent className="p-3 pt-0 md:p-6 md:pt-0 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">Minha contribuição: {fmt(stats.month_sales_total)}</span>
              <span className="text-muted-foreground">Meta da loja: {fmt(stats.goal_target)}</span>
            </div>
            <div className="h-2 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full bg-primary rounded-full"
                style={{ width: `${Math.min(100, (stats.month_sales_total / stats.goal_target) * 100)}%` }}
              />
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
