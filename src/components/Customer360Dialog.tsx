import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Trophy, Gift, Clock, CheckCircle2, Package, ChevronDown, ChevronUp } from 'lucide-react';
import { useCustomerLoyalty, useLoyaltySettings } from '@/hooks/useLoyalty';

interface SaleItemRow {
  sale_id: string;
  qty: number;
  unit_price: number;
  product_name_snapshot: string | null;
  products: { name: string | null } | null;
}

interface Props {
  customerId: string | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface Customer360Data {
  customer: { id: string; name: string; phone: string | null; email: string | null; doc_id: string | null };
  totals: {
    sales_count: number; total_spent: number; total_paid: number;
    total_pending: number; avg_ticket: number; last_purchase_at: string | null;
  };
  recent_sales: Array<{ id: string; created_at: string; net_total: number; payment_status: string; amount_pending: number; due_date: string | null }>;
  returns: Array<{ id: string; created_at: string; reason: string; status: string }>;
}

const fmtBRL = (n: number) => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Customer360Dialog({ customerId, open, onOpenChange }: Props) {
  const [data, setData] = useState<Customer360Data | null>(null);
  const [loading, setLoading] = useState(false);
  const [itemsBySale, setItemsBySale] = useState<Record<string, Array<{ name: string; qty: number }>>>({});
  const [expandedSales, setExpandedSales] = useState<Set<string>>(new Set());
  const { settings } = useLoyaltySettings();
  const { summary, credits, loading: loyaltyLoading, refresh: refreshLoyalty } =
    useCustomerLoyalty(open ? customerId : null);

  useEffect(() => {
    if (!open || !customerId) return;
    setLoading(true);
    setItemsBySale({});
    setExpandedSales(new Set());
    supabase.rpc('customer_360', { p_customer_id: customerId }).then(async ({ data }) => {
      const parsed = data as unknown as Customer360Data;
      setData(parsed);
      setLoading(false);
      const ids = (parsed?.recent_sales || []).map(s => s.id);
      if (ids.length) {
        const { data: items } = await supabase
          .from('sale_items')
          .select('sale_id, qty, unit_price, product_name_snapshot, products(name)')
          .in('sale_id', ids);
        const map: Record<string, Array<{ name: string; qty: number }>> = {};
        ((items as SaleItemRow[] | null) || []).forEach(it => {
          const name = it.product_name_snapshot || it.products?.name || 'Produto removido';
          if (!map[it.sale_id]) map[it.sale_id] = [];
          map[it.sale_id].push({ name, qty: Number(it.qty || 0) });
        });
        setItemsBySale(map);
      }
    });
  }, [open, customerId]);

  // Separação pago × pendente (vendas que contam ou não na fidelidade)
  const salesSplit = useMemo(() => {
    const list = data?.recent_sales || [];
    const paid = list.filter(s => s.payment_status === 'paid');
    const pending = list.filter(s => s.payment_status !== 'paid');
    const paidTotal = paid.reduce((s, x) => s + Number(x.net_total || 0), 0);
    const pendingTotal = pending.reduce((s, x) => s + Number(x.amount_pending || 0), 0);
    return { paid, pending, paidTotal, pendingTotal };
  }, [data]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{data?.customer?.name || 'Cliente'} — Visão 360</DialogTitle>
        </DialogHeader>
        {loading && <Skeleton className="h-32" />}
        {!loading && data && (
          <Tabs defaultValue="resumo">
            <TabsList>
              <TabsTrigger value="resumo">Resumo</TabsTrigger>
              <TabsTrigger value="compras">Compras</TabsTrigger>
              <TabsTrigger value="trocas">Trocas</TabsTrigger>
              <TabsTrigger value="fidelidade">
                <Trophy className="h-3.5 w-3.5 mr-1" /> Fidelidade
              </TabsTrigger>
            </TabsList>
            <TabsContent value="resumo" className="space-y-3">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Stat label="Compras" value={String(data.totals.sales_count)} />
                <Stat label="Total comprado" value={fmtBRL(data.totals.total_spent)} />
                <Stat label="Ticket médio" value={fmtBRL(data.totals.avg_ticket)} />
                <Stat label="Pendente" value={fmtBRL(data.totals.total_pending)}
                  alert={data.totals.total_pending > 0 ? 'warn' : ''} />
              </div>
              <Card><CardContent className="p-3 text-xs space-y-1">
                {data.customer.phone && <p>📞 {data.customer.phone}</p>}
                {data.customer.email && <p>✉️ {data.customer.email}</p>}
                {data.customer.doc_id && <p>📄 {data.customer.doc_id}</p>}
                {data.totals.last_purchase_at && (
                  <p className="text-muted-foreground">
                    Última compra: {new Date(data.totals.last_purchase_at).toLocaleDateString('pt-BR')}
                  </p>
                )}
              </CardContent></Card>
            </TabsContent>
            <TabsContent value="compras" className="space-y-1.5">
              {data.recent_sales.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma compra.</p>
              )}
              {data.recent_sales.map(s => {
                const overdue = s.due_date && new Date(s.due_date) < new Date() && s.payment_status !== 'paid';
                const items = itemsBySale[s.id] || [];
                const totalUnits = items.reduce((acc, it) => acc + it.qty, 0);
                const expanded = expandedSales.has(s.id);
                const visible = expanded ? items : items.slice(0, 3);
                const hidden = items.length - visible.length;
                const toggle = () => setExpandedSales(prev => {
                  const next = new Set(prev);
                  if (next.has(s.id)) next.delete(s.id); else next.add(s.id);
                  return next;
                });
                return (
                  <div key={s.id} className="rounded-lg border bg-card p-2.5 text-xs space-y-1.5">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium">{new Date(s.created_at).toLocaleDateString('pt-BR')}</p>
                        <p className="text-muted-foreground">{fmtBRL(s.net_total)}</p>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant={s.payment_status === 'paid' ? 'default' : 'outline'}>
                          {s.payment_status}
                        </Badge>
                        {overdue && <span className="text-[10px] text-destructive font-medium">vencida</span>}
                      </div>
                    </div>
                    {items.length > 0 && (
                      <div className="border-t pt-1.5 space-y-0.5">
                        <div className="flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
                          <Package className="h-3 w-3" />
                          Produtos {totalUnits > 0 && `• ${totalUnits} un no total`}
                        </div>
                        <ul className="space-y-0.5">
                          {visible.map((it, i) => (
                            <li key={i} className="flex justify-between gap-2">
                              <span className="truncate">{it.name}</span>
                              <span className="text-muted-foreground shrink-0">{it.qty} un</span>
                            </li>
                          ))}
                        </ul>
                        {(hidden > 0 || expanded) && (
                          <button
                            onClick={toggle}
                            className="text-[11px] text-primary hover:underline flex items-center gap-0.5"
                          >
                            {expanded ? (<><ChevronUp className="h-3 w-3" /> Ocultar</>) : (<><ChevronDown className="h-3 w-3" /> +{hidden} {hidden === 1 ? 'item' : 'itens'}</>)}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </TabsContent>
            <TabsContent value="trocas" className="space-y-1.5">
              {data.returns.length === 0 && (
                <p className="text-sm text-muted-foreground py-6 text-center">Nenhuma troca/devolução.</p>
              )}
              {data.returns.map(r => (
                <div key={r.id} className="rounded-lg border bg-card p-2.5 text-xs">
                  <div className="flex justify-between">
                    <span className="font-medium">{r.reason}</span>
                    <Badge variant="outline">{r.status}</Badge>
                  </div>
                  <p className="text-muted-foreground">{new Date(r.created_at).toLocaleDateString('pt-BR')}</p>
                </div>
              ))}
            </TabsContent>

            <TabsContent value="fidelidade" className="space-y-3">
              {!settings.enabled ? (
                <p className="text-sm text-muted-foreground py-6 text-center">
                  Programa de fidelidade desativado nas configurações.
                </p>
              ) : loyaltyLoading ? (
                <Skeleton className="h-32" />
              ) : !summary ? (
                <p className="text-sm text-muted-foreground py-6 text-center">Sem dados de fidelidade.</p>
              ) : (
                <>
                  {/* Progresso até a próxima premiação */}
                  <Card>
                    <CardContent className="p-4 space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-medium flex items-center gap-1">
                          <Trophy className="h-3.5 w-3.5 text-primary" />
                          Progresso até R$ {summary.goal_amount.toLocaleString('pt-BR')}
                        </span>
                        <span className="text-muted-foreground">
                          {fmtBRL(summary.current_progress)} / {fmtBRL(summary.goal_amount)}
                        </span>
                      </div>
                      <Progress
                        value={Math.min((summary.current_progress / Math.max(summary.goal_amount, 1)) * 100, 100)}
                      />
                      <p className="text-[11px] text-muted-foreground">
                        {summary.remaining_to_next > 0
                          ? `Faltam ${fmtBRL(summary.remaining_to_next)} para ganhar ${fmtBRL(summary.credit_amount)} de crédito.`
                          : `Meta atingida! Crédito de ${fmtBRL(summary.credit_amount)} gerado.`}
                      </p>
                    </CardContent>
                  </Card>

                  {/* KPIs */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    <Stat label="Pago contabilizado" value={fmtBRL(summary.total_paid)} />
                    <Stat label="Devoluções" value={fmtBRL(summary.total_refunded)} />
                    <Stat label="Vezes na meta" value={String(summary.milestones_reached)} />
                    <Stat label="Crédito disponível" value={fmtBRL(summary.credits_available)}
                      alert={summary.credits_available > 0 ? 'good' : ''} />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Stat label="Total gerado" value={fmtBRL(summary.credits_generated_total)} />
                    <Stat label="Total usado" value={fmtBRL(summary.credits_used_total)} />
                  </div>

                  {/* Vendas pagas (contam) × pendentes (não contam ainda) */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Card className="border-success/30 bg-success/5">
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <CheckCircle2 className="h-3.5 w-3.5 text-success" />
                          Vendas pagas (contam)
                        </div>
                        <p className="text-lg font-semibold">{fmtBRL(salesSplit.paidTotal)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {salesSplit.paid.length} venda(s) — entram automaticamente na fidelidade.
                        </p>
                      </CardContent>
                    </Card>
                    <Card className="border-warning/30 bg-warning/5">
                      <CardContent className="p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <Clock className="h-3.5 w-3.5 text-warning" />
                          Pendentes (não contam ainda)
                        </div>
                        <p className="text-lg font-semibold">{fmtBRL(salesSplit.pendingTotal)}</p>
                        <p className="text-[11px] text-muted-foreground">
                          {salesSplit.pending.length} venda(s) — só contarão após o pagamento ser confirmado.
                        </p>
                      </CardContent>
                    </Card>
                  </div>

                  {/* Histórico de créditos */}
                  <div>
                    <p className="text-xs font-medium mb-1.5 flex items-center gap-1">
                      <Gift className="h-3.5 w-3.5" /> Histórico de créditos
                    </p>
                    {credits.length === 0 ? (
                      <p className="text-xs text-muted-foreground py-3">
                        Nenhum crédito gerado ainda.
                      </p>
                    ) : (
                      <div className="space-y-1.5">
                        {credits.map(c => (
                          <div key={c.id} className="flex items-center justify-between rounded-lg border bg-card p-2.5 text-xs">
                            <div className="min-w-0">
                              <p className="font-medium">{fmtBRL(Number(c.amount_generated))}</p>
                              <p className="text-[11px] text-muted-foreground truncate">{c.reason}</p>
                              <p className="text-[10px] text-muted-foreground">
                                {new Date(c.generated_at).toLocaleDateString('pt-BR')}
                                {c.amount_used > 0 && ` • Usado: ${fmtBRL(Number(c.amount_used))}`}
                              </p>
                            </div>
                            <Badge variant={
                              c.status === 'cancelled' ? 'destructive' :
                              c.status === 'used' ? 'outline' :
                              c.status === 'partially_used' ? 'secondary' : 'default'
                            }>
                              {c.status === 'available' ? 'Disponível' :
                               c.status === 'partially_used' ? 'Parcial' :
                               c.status === 'used' ? 'Usado' : 'Cancelado'}
                            </Badge>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </>
              )}
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, alert }: { label: string; value: string; alert?: string }) {
  const cls =
    alert === 'warn' ? 'border-warning/40 bg-warning/5' :
    alert === 'good' ? 'border-success/40 bg-success/5' : '';
  return (
    <Card className={cls}>
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold mt-0.5">{value}</p>
      </CardContent>
    </Card>
  );
}
