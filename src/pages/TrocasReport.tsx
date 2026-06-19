import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeftRight, Search } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface ExchangeRow {
  id: string;
  customer_id: string | null;
  original_product_name: string | null;
  original_value: number;
  new_product_name: string | null;
  new_value: number;
  difference: number;
  settlement: string;
  amount_to_pay: number;
  troco_amount: number;
  credit_amount: number;
  is_avulsa: boolean;
  created_by: string | null;
  created_at: string;
}

const SETTLEMENT: Record<string, { label: string; cls: string }> = {
  a_pagar: { label: 'A pagar', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  troco: { label: 'Troco', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  credito: { label: 'Crédito', cls: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  zero: { label: 'Sem diferença', cls: 'bg-muted text-muted-foreground' },
};

export default function TrocasReport() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExchangeRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [emps, setEmps] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');

  const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('exchanges')
        .select('id, customer_id, original_product_name, original_value, new_product_name, new_value, difference, settlement, amount_to_pay, troco_amount, credit_amount, is_avulsa, created_by, created_at')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(300);
      const list = (data as any as ExchangeRow[]) || [];
      setRows(list);

      const custIds = Array.from(new Set(list.map(r => r.customer_id).filter(Boolean))) as string[];
      const empIds = Array.from(new Set(list.map(r => r.created_by).filter(Boolean))) as string[];
      if (custIds.length) {
        const { data: c } = await supabase.from('customers').select('id, name').in('id', custIds);
        setNames(Object.fromEntries(((c as any[]) || []).map(x => [x.id, x.name])));
      }
      if (empIds.length) {
        const { data: p } = await supabase.from('profiles').select('id, full_name').in('id', empIds);
        setEmps(Object.fromEntries(((p as any[]) || []).map(x => [x.id, x.full_name])));
      }
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const t = search.trim().toLowerCase();
    if (!t) return rows;
    return rows.filter(r =>
      (names[r.customer_id || ''] || '').toLowerCase().includes(t) ||
      (r.original_product_name || '').toLowerCase().includes(t) ||
      (r.new_product_name || '').toLowerCase().includes(t)
    );
  }, [rows, search, names]);

  const totals = useMemo(() => ({
    count: rows.length,
    pay: rows.reduce((s, r) => s + Number(r.amount_to_pay || 0), 0),
    troco: rows.reduce((s, r) => s + Number(r.troco_amount || 0), 0),
    credito: rows.reduce((s, r) => s + Number(r.credit_amount || 0), 0),
  }), [rows]);

  return (
    <div className="space-y-4 md:space-y-6">
      <div>
        <h1 className="text-xl md:text-2xl font-bold flex items-center gap-2"><ArrowLeftRight className="h-6 w-6 text-primary" /> Relatório de Trocas</h1>
        <p className="text-sm text-muted-foreground">Produto devolvido, produto novo, diferença, troco/crédito, funcionário e data</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Trocas</p><p className="text-2xl font-bold">{totals.count}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Recebido (diferença)</p><p className="text-xl font-bold text-orange-600">{fmt(totals.pay)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Troco devolvido</p><p className="text-xl font-bold text-blue-600">{fmt(totals.troco)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted-foreground">Crédito gerado</p><p className="text-xl font-bold text-purple-600">{fmt(totals.credito)}</p></CardContent></Card>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar por cliente ou produto..." className="pl-9 h-11" />
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground"><ArrowLeftRight className="mx-auto h-10 w-10 mb-2 opacity-50" />Nenhuma troca registrada ainda.</div>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map(r => (
            <Card key={r.id}>
              <CardContent className="p-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{names[r.customer_id || ''] || 'Cliente'}</span>
                  <Badge variant="outline" className={SETTLEMENT[r.settlement]?.cls}>{SETTLEMENT[r.settlement]?.label || r.settlement}</Badge>
                </div>
                <p className="text-sm">{r.original_product_name} <span className="text-muted-foreground">→</span> {r.new_product_name}</p>
                <p className="text-xs text-muted-foreground">{fmt(r.original_value)} → {fmt(r.new_value)} · {fmtDate(r.created_at)} · {emps[r.created_by || ''] || '—'}{r.is_avulsa ? ' · avulsa' : ''}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0 overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead><TableHead>Cliente</TableHead>
                  <TableHead>Devolvido</TableHead><TableHead>Novo</TableHead>
                  <TableHead className="text-right">Val. dev.</TableHead><TableHead className="text-right">Val. novo</TableHead>
                  <TableHead>Resultado</TableHead><TableHead>Funcionário</TableHead><TableHead>Origem</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell>{names[r.customer_id || ''] || '—'}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={r.original_product_name || ''}>{r.original_product_name || '—'}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={r.new_product_name || ''}>{r.new_product_name || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(r.original_value)}</TableCell>
                    <TableCell className="text-right">{fmt(r.new_value)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className={SETTLEMENT[r.settlement]?.cls}>{SETTLEMENT[r.settlement]?.label || r.settlement}</Badge>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {r.settlement === 'a_pagar' ? fmt(r.amount_to_pay) : r.settlement === 'troco' ? fmt(r.troco_amount) : r.settlement === 'credito' ? fmt(r.credit_amount) : ''}
                      </span>
                    </TableCell>
                    <TableCell>{emps[r.created_by || ''] || '—'}</TableCell>
                    <TableCell>{r.is_avulsa ? <Badge variant="outline">Avulsa</Badge> : <span className="text-xs text-muted-foreground">Venda</span>}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
