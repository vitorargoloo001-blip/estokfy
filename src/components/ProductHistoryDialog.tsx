import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';

interface Props {
  productId: string | null;
  productName?: string;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}

interface HistoryRow {
  occurred_at: string;
  event_type: string;
  qty: number | null;
  unit_value: number | null;
  total_value: number | null;
  reference_type: string | null;
  reference_id: string | null;
  actor_name: string | null;
  notes: string | null;
}

interface AnalyticsRow {
  product_id: string;
  on_hand: number;
  minimum_stock: number;
  cost_price: number;
  sale_price: number;
  margin_value: number;
  margin_pct: number;
  qty_sold_30d: number;
  daily_avg: number;
  days_to_empty: number | null;
  last_sale_at: string | null;
  days_idle: number | null;
}

const fmtBRL = (n: number | null | undefined) =>
  Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const labelEvent = (t: string) => ({
  purchase_in: 'Compra (entrada)',
  sale_out: 'Venda',
  return_in: 'Devolução (retorno)',
  adjust_in: 'Ajuste +',
  adjust_out: 'Ajuste -',
  loss: 'Perda',
  'audit:update': 'Alteração',
  'audit:create': 'Criado',
}[t] || t);

export default function ProductHistoryDialog({ productId, productName, open, onOpenChange }: Props) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [analytics, setAnalytics] = useState<AnalyticsRow | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open || !productId) return;
    setLoading(true);
    Promise.all([
      supabase.rpc('product_history', { p_product_id: productId }),
      supabase.rpc('product_analytics', { p_store_id: '00000000-0000-0000-0000-000000000000' }), // store filter via RLS context
    ]).then(([h, a]) => {
      setHistory((h.data as HistoryRow[]) || []);
      const stats = (a.data as AnalyticsRow[] || []).find(r => r.product_id === productId) || null;
      setAnalytics(stats);
      setLoading(false);
    });
  }, [open, productId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Histórico do produto{productName ? ` — ${productName}` : ''}</DialogTitle>
        </DialogHeader>
        <Tabs defaultValue="overview">
          <TabsList>
            <TabsTrigger value="overview">Visão geral</TabsTrigger>
            <TabsTrigger value="history">Histórico</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="space-y-3">
            {loading && <Skeleton className="h-24" />}
            {analytics && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <StatCard label="Estoque" value={`${analytics.on_hand} un`}
                  hint={`mín ${analytics.minimum_stock}`}
                  alert={analytics.on_hand <= 0 ? 'critical' : analytics.on_hand <= analytics.minimum_stock ? 'warn' : ''} />
                <StatCard label="Margem" value={`${Number(analytics.margin_pct || 0).toFixed(1)}%`}
                  hint={fmtBRL(analytics.margin_value)}
                  alert={analytics.margin_pct < 10 ? 'warn' : analytics.margin_pct < 0 ? 'critical' : ''} />
                <StatCard label="Vendas 30d" value={`${Number(analytics.qty_sold_30d).toFixed(0)} un`}
                  hint={`${Number(analytics.daily_avg).toFixed(2)}/dia`} />
                <StatCard label="Dias p/ acabar"
                  value={analytics.days_to_empty != null ? `${Math.round(analytics.days_to_empty)} d` : '—'}
                  hint={analytics.days_idle != null ? `Última venda há ${analytics.days_idle}d` : 'Sem vendas'}
                  alert={analytics.days_to_empty != null && analytics.days_to_empty < 7 ? 'warn' : ''} />
              </div>
            )}
            {!loading && !analytics && (
              <p className="text-sm text-muted-foreground">Sem dados analíticos ainda.</p>
            )}
          </TabsContent>
          <TabsContent value="history">
            {loading && <Skeleton className="h-32" />}
            {!loading && history.length === 0 && (
              <p className="text-sm text-muted-foreground py-8 text-center">Sem movimentações registradas.</p>
            )}
            <div className="space-y-1.5">
              {history.map((h, i) => (
                <div key={i} className="flex items-start gap-3 rounded-lg border bg-card p-2.5 text-xs">
                  <Badge variant="outline" className="shrink-0">{labelEvent(h.event_type)}</Badge>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium">
                      {h.qty != null && `${h.qty > 0 ? '+' : ''}${h.qty} un`}
                      {h.unit_value != null && ` • ${fmtBRL(h.unit_value)}/un`}
                    </p>
                    {h.notes && <p className="text-muted-foreground">{h.notes}</p>}
                    <p className="text-muted-foreground/70">
                      {new Date(h.occurred_at).toLocaleString('pt-BR')}
                      {h.actor_name && ` • ${h.actor_name}`}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({ label, value, hint, alert }: { label: string; value: string; hint?: string; alert?: string }) {
  const cls = alert === 'critical' ? 'border-destructive/40 bg-destructive/5'
    : alert === 'warn' ? 'border-warning/40 bg-warning/5' : '';
  return (
    <Card className={cls}>
      <CardContent className="p-3">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="text-lg font-semibold mt-0.5">{value}</p>
        {hint && <p className="text-[10px] text-muted-foreground">{hint}</p>}
      </CardContent>
    </Card>
  );
}
