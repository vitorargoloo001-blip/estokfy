import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Wallet, Search, Users, History, Gift, RotateCcw, ArrowLeftRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface CreditRow {
  id: string;
  customer_id: string;
  amount_generated: number;
  amount_used: number;
  amount_available: number;
  origin: string | null;
  reason: string | null;
  status: string;
  generated_at: string;
  source_sale_id: string | null;
}
interface UseRow {
  id: string;
  customer_id: string;
  credit_id: string;
  sale_id: string;
  amount_applied: number;
  used_at: string;
  reverted_at: string | null;
}
interface CustomerAgg {
  customer_id: string;
  name: string;
  phone: string | null;
  saldo: number;
  gerado: number;
  usado: number;
  credits: CreditRow[];
}

const ORIGIN_MAP: Record<string, { label: string; icon: any; cls: string }> = {
  loyalty: { label: 'Fidelidade', icon: Gift, cls: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  devolucao: { label: 'Devolução', icon: RotateCcw, cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' },
  troca: { label: 'Troca', icon: ArrowLeftRight, cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
};
function originInfo(o: string | null) {
  return ORIGIN_MAP[o || 'loyalty'] || ORIGIN_MAP.loyalty;
}

export default function CustomerCredits() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;

  const [loading, setLoading] = useState(true);
  const [customers, setCustomers] = useState<CustomerAgg[]>([]);
  const [uses, setUses] = useState<UseRow[]>([]);
  const [search, setSearch] = useState('');
  const [detail, setDetail] = useState<CustomerAgg | null>(null);

  const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const [creditsRes, usesRes] = await Promise.all([
        supabase
          .from('loyalty_credits')
          .select('id, customer_id, amount_generated, amount_used, amount_available, origin, reason, status, generated_at, source_sale_id')
          .eq('store_id', storeId)
          .order('generated_at', { ascending: false }),
        supabase
          .from('loyalty_credit_uses')
          .select('id, customer_id, credit_id, sale_id, amount_applied, used_at, reverted_at')
          .eq('store_id', storeId)
          .is('reverted_at', null)
          .order('used_at', { ascending: false }),
      ]);

      const credits = (creditsRes.data as any as CreditRow[]) || [];
      setUses((usesRes.data as any as UseRow[]) || []);

      const custIds = Array.from(new Set(credits.map((c) => c.customer_id))).filter(Boolean);
      let nameMap: Record<string, { name: string; phone: string | null }> = {};
      if (custIds.length) {
        const { data: custs } = await supabase
          .from('customers')
          .select('id, name, phone')
          .in('id', custIds);
        for (const c of (custs as any[]) || []) nameMap[c.id] = { name: c.name, phone: c.phone };
      }

      const byCustomer: Record<string, CustomerAgg> = {};
      for (const c of credits) {
        if (c.status === 'cancelled') continue;
        const agg = (byCustomer[c.customer_id] ||= {
          customer_id: c.customer_id,
          name: nameMap[c.customer_id]?.name || 'Cliente',
          phone: nameMap[c.customer_id]?.phone || null,
          saldo: 0, gerado: 0, usado: 0, credits: [],
        });
        agg.saldo += Number(c.amount_available || 0);
        agg.gerado += Number(c.amount_generated || 0);
        agg.usado += Number(c.amount_used || 0);
        agg.credits.push(c);
      }
      const list = Object.values(byCustomer).sort((a, b) => b.saldo - a.saldo);
      setCustomers(list);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return customers;
    return customers.filter((c) => c.name.toLowerCase().includes(t) || (c.phone || '').includes(t));
  }, [customers, search]);

  const totalSaldo = useMemo(() => customers.reduce((s, c) => s + c.saldo, 0), [customers]);
  const comSaldo = useMemo(() => customers.filter((c) => c.saldo > 0.001).length, [customers]);

  const detailUses = useMemo(
    () => (detail ? uses.filter((u) => u.customer_id === detail.customer_id) : []),
    [detail, uses]
  );

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2">
          <Wallet className="h-6 w-6 text-primary" /> Créditos dos Clientes
        </h1>
        <p className="text-sm text-muted-foreground">Saldo, histórico e utilização de créditos (fidelidade, devoluções e trocas)</p>
      </div>

      {/* Resumo */}
      <div className="grid grid-cols-2 gap-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground">Total em créditos</p>
            <p className="text-2xl font-bold text-primary">{fmt(totalSaldo)}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="h-3 w-3" /> Clientes com saldo</p>
            <p className="text-2xl font-bold">{comSaldo}</p>
          </CardContent>
        </Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente..." className="pl-9 h-11" />
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Wallet className="mx-auto h-10 w-10 mb-2 opacity-50" />
          Nenhum cliente com crédito ainda.
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((c) => (
            <Card key={c.customer_id} className="cursor-pointer active:scale-[0.99] transition" onClick={() => setDetail(c)}>
              <CardContent className="p-3 flex items-center justify-between">
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground">{c.phone || '—'}</p>
                </div>
                <div className="text-right">
                  <p className="font-bold text-primary">{fmt(c.saldo)}</p>
                  <p className="text-[11px] text-muted-foreground">usado {fmt(c.usado)}</p>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cliente</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead className="text-right">Gerado</TableHead>
                  <TableHead className="text-right">Usado</TableHead>
                  <TableHead className="text-right">Saldo</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.customer_id} className="cursor-pointer" onClick={() => setDetail(c)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">{c.phone || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(c.gerado)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">{fmt(c.usado)}</TableCell>
                    <TableCell className="text-right font-semibold text-primary">{fmt(c.saldo)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Detalhe do cliente */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{detail?.name}</DialogTitle>
          </DialogHeader>
          {detail && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3 text-center">
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Saldo</p><p className="text-lg font-bold text-primary">{fmt(detail.saldo)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Gerado</p><p className="text-lg font-bold">{fmt(detail.gerado)}</p></div>
                <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Usado</p><p className="text-lg font-bold">{fmt(detail.usado)}</p></div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-1"><Gift className="h-4 w-4" /> Créditos</p>
                <div className="space-y-2">
                  {detail.credits.map((cr) => {
                    const oi = originInfo(cr.origin);
                    const OiIcon = oi.icon;
                    return (
                      <div key={cr.id} className="flex items-center justify-between rounded border p-2 text-sm">
                        <div className="min-w-0">
                          <Badge variant="outline" className={oi.cls}><OiIcon className="h-3 w-3 mr-1" />{oi.label}</Badge>
                          <span className="text-xs text-muted-foreground ml-2">{fmtDate(cr.generated_at)}</span>
                          <div className="text-[11px] text-muted-foreground truncate">{cr.reason}</div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="font-semibold text-primary">{fmt(Number(cr.amount_available))}</div>
                          <div className="text-[11px] text-muted-foreground">de {fmt(Number(cr.amount_generated))}</div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div>
                <p className="text-sm font-semibold mb-2 flex items-center gap-1"><History className="h-4 w-4" /> Utilização</p>
                {detailUses.length === 0 ? (
                  <p className="text-xs text-muted-foreground">Nenhuma utilização registrada.</p>
                ) : (
                  <div className="space-y-1">
                    {detailUses.map((u) => (
                      <div key={u.id} className="flex items-center justify-between rounded border p-2 text-sm">
                        <span className="text-xs text-muted-foreground">{fmtDate(u.used_at)} • venda #{u.sale_id.slice(0, 8)}</span>
                        <span className="font-medium">- {fmt(Number(u.amount_applied))}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
