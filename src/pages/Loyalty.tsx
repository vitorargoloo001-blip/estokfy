import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Trophy, Search, Gift, Target, RefreshCw, Wallet, Sparkles, TrendingUp, ArrowDownCircle, UserCheck, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import type { LoyaltyRankingItem } from '@/hooks/useLoyalty';
import Customer360Dialog from '@/components/Customer360Dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

const STATUS_LABEL: Record<LoyaltyRankingItem['status'], { label: string; variant: any; color: string }> = {
  in_progress:      { label: 'Em progresso',         variant: 'outline',   color: '' },
  near_goal:        { label: 'Próximo da meta',      variant: 'secondary', color: 'text-amber-600' },
  goal_reached:     { label: 'Meta atingida',        variant: 'default',   color: '' },
  credit_available: { label: 'Crédito disponível',   variant: 'default',   color: '' },
  credit_used:      { label: 'Crédito usado',        variant: 'outline',   color: 'text-muted-foreground' },
};

interface MonthlyTotals { generated_amount: number; generated_count: number; used_amount: number; used_customers: number; }

export default function LoyaltyPage() {
  const [rows, setRows] = useState<LoyaltyRankingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [openCustomerId, setOpenCustomerId] = useState<string | null>(null);
  const [recalculating, setRecalculating] = useState(false);
  const [monthly, setMonthly] = useState<MonthlyTotals>({ generated_amount: 0, generated_count: 0, used_amount: 0, used_customers: 0 });

  const load = async () => {
    setLoading(true);
    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
    const isoStart = monthStart.toISOString();

    const [rk, gen, used] = await Promise.all([
      supabase.rpc('loyalty_ranking'),
      supabase.from('loyalty_credits').select('amount_generated,status,generated_at').gte('generated_at', isoStart),
      supabase.from('loyalty_credit_uses').select('amount_applied,customer_id,used_at,reverted_at').gte('used_at', isoStart),
    ]);

    if (rk.error) toast.error('Erro ao carregar ranking');
    setRows((rk.data as LoyaltyRankingItem[]) || []);

    const genRows = ((gen.data as any[]) || []).filter(r => r.status !== 'cancelled');
    const usedRows = ((used.data as any[]) || []).filter(r => !r.reverted_at);
    setMonthly({
      generated_amount: genRows.reduce((s, r) => s + Number(r.amount_generated || 0), 0),
      generated_count: genRows.length,
      used_amount: usedRows.reduce((s, r) => s + Number(r.amount_applied || 0), 0),
      used_customers: new Set(usedRows.map(r => r.customer_id)).size,
    });
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  // ===== Recálculo com confirmação e preview =====
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [preview, setPreview] = useState<{
    goal_amount: number;
    credit_amount: number;
    customers_affected: number;
    new_credits_count: number;
    new_credits_amount: number;
    sample: Array<{
      customer_name: string;
      total_paid: number;
      existing_milestones: number;
      expected_milestones: number;
      new_milestones: number;
      new_credit_amount: number;
    }>;
  } | null>(null);

  const openRecalcPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreview(null);
    const { data, error } = await supabase.rpc('loyalty_recalc_preview');
    if (error) {
      toast.error('Erro ao gerar prévia do recálculo');
      setPreviewOpen(false);
    } else {
      setPreview(data as any);
    }
    setPreviewLoading(false);
  };

  const confirmRecalc = async () => {
    setRecalculating(true);
    setPreviewOpen(false);
    const { error } = await supabase.rpc('recalc_loyalty_for_store');
    if (error) toast.error('Erro ao recalcular');
    else toast.success('Recálculo concluído');
    await load();
    setRecalculating(false);
  };

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (s && !r.customer_name?.toLowerCase().includes(s) && !r.customer_phone?.includes(s)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  // KPIs operacionais
  const kpis = useMemo(() => {
    const customersWithCredit = rows.filter(r => r.credits_available > 0);
    const totalAvailable = customersWithCredit.reduce((s, r) => s + r.credits_available, 0);

    // "Quase ganhando crédito": faltam menos de R$ 200 e ainda não atingiram esta meta
    const NEAR_THRESHOLD = 200;
    const nearList = rows.filter(r => r.remaining_to_next > 0 && r.remaining_to_next < NEAR_THRESHOLD);

    // Cliente mais próximo da meta (menor remaining_to_next > 0)
    const closest = rows
      .filter(r => r.remaining_to_next > 0)
      .sort((a, b) => a.remaining_to_next - b.remaining_to_next)[0];

    return { customersWithCredit, totalAvailable, nearList, closest };
  }, [rows]);

  const goal = rows[0]?.goal_amount ?? 1000;
  const credit = rows[0]?.credit_amount ?? 80;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Trophy className="h-6 w-6 text-primary" /> Programa de Fidelidade</h1>
          <p className="text-sm text-muted-foreground mt-1">
            A cada {fmt(goal)} em compras pagas, o cliente ganha {fmt(credit)} de crédito.
          </p>
        </div>
        <Button onClick={openRecalcPreview} disabled={recalculating || previewLoading} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${recalculating ? 'animate-spin' : ''}`} />
          Recalcular
        </Button>
      </div>

      {/* ===== KPIs operacionais ===== */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {/* 1 — Crédito disponível (azul) */}
        <KpiCard
          title="Créditos disponíveis"
          icon={<Wallet className="h-4 w-4" />}
          value={fmt(kpis.totalAvailable)}
          sub={`${kpis.customersWithCredit.length} cliente(s) com crédito`}
          tone="blue"
        />

        {/* 2 — Quase ganhando crédito (amarelo) */}
        <KpiCard
          title="Quase ganhando crédito"
          icon={<Target className="h-4 w-4" />}
          value={`${kpis.nearList.length} ${kpis.nearList.length === 1 ? 'cliente' : 'clientes'}`}
          sub="faltando menos de R$ 200"
          tone="amber"
        />

        {/* 3 — Premiações geradas no mês (verde) */}
        <KpiCard
          title="Premiações geradas (mês)"
          icon={<Sparkles className="h-4 w-4" />}
          value={`${monthly.generated_count} ${monthly.generated_count === 1 ? 'premiação' : 'premiações'}`}
          sub={`${fmt(monthly.generated_amount)} gerados`}
          tone="green"
        />

        {/* 4 — Créditos usados no mês (roxo) */}
        <KpiCard
          title="Créditos utilizados (mês)"
          icon={<ArrowDownCircle className="h-4 w-4" />}
          value={fmt(monthly.used_amount)}
          sub={`${monthly.used_customers} ${monthly.used_customers === 1 ? 'cliente utilizou' : 'clientes utilizaram'}`}
          tone="purple"
        />

        {/* 5 — Cliente mais próximo da meta (cinza) */}
        <KpiCard
          title="Mais próximo da premiação"
          icon={<UserCheck className="h-4 w-4" />}
          value={kpis.closest?.customer_name ?? '—'}
          sub={kpis.closest ? `Faltam ${fmt(kpis.closest.remaining_to_next)}` : 'sem clientes em progresso'}
          tone="neutral"
          onClick={kpis.closest ? () => setOpenCustomerId(kpis.closest!.customer_id) : undefined}
          truncate
        />
      </div>

      <Card>
        <CardHeader className="pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <CardTitle className="text-base flex-1">Ranking de Clientes</CardTitle>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar cliente…" value={search} onChange={e => setSearch(e.target.value)} className="pl-8 h-9 w-56" />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="h-9 w-48"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os status</SelectItem>
                <SelectItem value="credit_available">Com crédito disponível</SelectItem>
                <SelectItem value="near_goal">Próximos da meta</SelectItem>
                <SelectItem value="goal_reached">Meta atingida</SelectItem>
                <SelectItem value="credit_used">Crédito já usado</SelectItem>
                <SelectItem value="in_progress">Em progresso</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-14 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="text-center py-12 text-sm text-muted-foreground">Nenhum cliente encontrado</div>
          ) : (
            <div className="divide-y">
              <div className="hidden md:grid grid-cols-[2fr_1fr_2fr_1fr_1fr_1fr_140px] gap-3 px-4 py-2 text-xs font-semibold text-muted-foreground bg-muted/30">
                <div>Cliente</div>
                <div className="text-right">Total pago</div>
                <div>Progresso</div>
                <div className="text-center">Premiações</div>
                <div className="text-right">Crédito disp.</div>
                <div>Status</div>
                <div></div>
              </div>
              {filtered.map(r => {
                const pct = r.goal_amount > 0 ? Math.min((r.current_progress / r.goal_amount) * 100, 100) : 0;
                const st = STATUS_LABEL[r.status];
                return (
                  <div key={r.customer_id} className="grid grid-cols-1 md:grid-cols-[2fr_1fr_2fr_1fr_1fr_1fr_140px] gap-3 px-4 py-3 items-center hover:bg-muted/40 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{r.customer_name}</div>
                      {r.customer_phone && <div className="text-xs text-muted-foreground">{r.customer_phone}</div>}
                    </div>
                    <div className="text-right tabular-nums font-medium">{fmt(r.total_eligible)}</div>
                    <div className="space-y-1">
                      <Progress value={pct} className="h-2" />
                      <div className="text-[11px] text-muted-foreground">
                        {fmt(r.current_progress)} / {fmt(r.goal_amount)}
                        {r.remaining_to_next > 0 && <> • faltam <b>{fmt(r.remaining_to_next)}</b></>}
                      </div>
                    </div>
                    <div className="text-center">
                      {r.milestones_reached > 0
                        ? <Badge variant="secondary">{r.milestones_reached}×</Badge>
                        : <span className="text-xs text-muted-foreground">—</span>}
                    </div>
                    <div className="text-right tabular-nums">
                      <span className={r.credits_available > 0 ? 'text-primary font-bold' : 'text-muted-foreground'}>
                        {fmt(r.credits_available)}
                      </span>
                      {r.credits_used_total > 0 && (
                        <div className="text-[10px] text-muted-foreground">usado: {fmt(r.credits_used_total)}</div>
                      )}
                    </div>
                    <div><Badge variant={st.variant} className={st.color}>{st.label}</Badge></div>
                    <div className="flex justify-end">
                      <Button size="sm" variant="ghost" onClick={() => setOpenCustomerId(r.customer_id)}>Detalhes</Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      <Customer360Dialog customerId={openCustomerId} open={!!openCustomerId} onOpenChange={(v) => !v && setOpenCustomerId(null)} />

      {/* ===== Diálogo de confirmação do recálculo ===== */}
      <AlertDialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <AlertDialogContent className="max-w-2xl">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Confirmar recálculo da fidelidade
            </AlertDialogTitle>
            <AlertDialogDescription>
              Veja abaixo o que será alterado. Nada é aplicado até você confirmar.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {previewLoading || !preview ? (
            <div className="space-y-2 py-4">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-32 w-full" />
            </div>
          ) : (
            <div className="space-y-4 py-2">
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-md border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Clientes afetados</p>
                  <p className="text-xl font-bold">{preview.customers_affected}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Novos créditos</p>
                  <p className="text-xl font-bold">{preview.new_credits_count}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-[11px] uppercase text-muted-foreground">Valor total</p>
                  <p className="text-xl font-bold text-emerald-600">{fmt(preview.new_credits_amount)}</p>
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Meta atual: {fmt(preview.goal_amount)} → Crédito: {fmt(preview.credit_amount)}
              </p>

              {preview.sample.length > 0 ? (
                <div className="rounded-md border max-h-64 overflow-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 sticky top-0">
                      <tr className="text-left">
                        <th className="px-3 py-2 font-medium">Cliente</th>
                        <th className="px-3 py-2 font-medium text-right">Pago</th>
                        <th className="px-3 py-2 font-medium text-center">Atual → Esperado</th>
                        <th className="px-3 py-2 font-medium text-right">Novo crédito</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.sample.map((s, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-2 truncate max-w-[180px]">{s.customer_name}</td>
                          <td className="px-3 py-2 text-right">{fmt(s.total_paid)}</td>
                          <td className="px-3 py-2 text-center">
                            <Badge variant="outline">{s.existing_milestones} → {s.expected_milestones}</Badge>
                          </td>
                          <td className="px-3 py-2 text-right text-emerald-600 font-medium">
                            +{fmt(s.new_credit_amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {preview.customers_affected > preview.sample.length && (
                    <p className="text-[11px] text-muted-foreground p-2 border-t bg-muted/30">
                      Mostrando {preview.sample.length} de {preview.customers_affected} clientes afetados.
                    </p>
                  )}
                </div>
              ) : (
                <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  Tudo já está sincronizado. Nenhuma alteração será feita.
                </div>
              )}
            </div>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={recalculating}>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); confirmRecalc(); }}
              disabled={recalculating || previewLoading}
            >
              {recalculating ? 'Recalculando…' : 'Confirmar recálculo'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// =====================================================
// Card de KPI com tom de cor dedicado por categoria
// =====================================================
type KpiTone = 'blue' | 'amber' | 'green' | 'purple' | 'neutral';

const TONE_CLASSES: Record<KpiTone, { card: string; icon: string; value: string }> = {
  blue:    { card: 'border-primary/30 bg-primary/5',                  icon: 'bg-primary/15 text-primary',                       value: 'text-primary' },
  amber:   { card: 'border-amber-500/30 bg-amber-50 dark:bg-amber-950/20', icon: 'bg-amber-500/15 text-amber-600 dark:text-amber-400', value: 'text-amber-700 dark:text-amber-400' },
  green:   { card: 'border-emerald-500/30 bg-emerald-50 dark:bg-emerald-950/20', icon: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400', value: 'text-emerald-700 dark:text-emerald-400' },
  purple:  { card: 'border-violet-500/30 bg-violet-50 dark:bg-violet-950/20', icon: 'bg-violet-500/15 text-violet-600 dark:text-violet-400', value: 'text-violet-700 dark:text-violet-400' },
  neutral: { card: 'border-border bg-muted/30',                       icon: 'bg-muted text-muted-foreground',                   value: 'text-foreground' },
};

interface KpiCardProps {
  title: string;
  icon: React.ReactNode;
  value: string;
  sub?: string;
  tone: KpiTone;
  onClick?: () => void;
  truncate?: boolean;
}

function KpiCard({ title, icon, value, sub, tone, onClick, truncate }: KpiCardProps) {
  const t = TONE_CLASSES[tone];
  return (
    <Card
      className={`${t.card} ${onClick ? 'cursor-pointer hover:shadow-md transition-shadow' : ''} min-h-[118px]`}
      onClick={onClick}
    >
      <CardContent className="p-4 flex flex-col h-full">
        <div className="flex items-center gap-2 mb-1.5">
          <div className={`${t.icon} h-7 w-7 rounded-md flex items-center justify-center shrink-0`}>
            {icon}
          </div>
          <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium leading-tight">
            {title}
          </p>
        </div>
        <p className={`text-xl font-bold ${t.value} ${truncate ? 'truncate' : ''} mt-auto`} title={truncate ? value : undefined}>
          {value}
        </p>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</p>}
      </CardContent>
    </Card>
  );
}
