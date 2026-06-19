import { useEffect, useMemo, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ShoppingBag, FileText, Download, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { todayStrBR, firstOfMonthStrBR, startOfDayBRtoUTCISO, endOfDayBRtoUTCISO } from '@/lib/dateBR';

interface MovementRow {
  id: string;
  created_at: string;
  qty: number;
  unit_cost: number | null;
  total_amount: number | null;
  payment_method: string | null;
  receipt_path: string | null;
  reason: string | null;
  supplier_id: string | null;
  product_id: string;
  products?: { name: string; sku?: string | null } | null;
  suppliers?: { name: string } | null;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function PurchasesReport() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;

  const [from, setFrom] = useState(firstOfMonthStrBR());
  const [to, setTo] = useState(todayStrBR());
  const [supplierFilter, setSupplierFilter] = useState<string>('all');
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [rows, setRows] = useState<MovementRow[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const fromIso = startOfDayBRtoUTCISO(from);
      const toIso = endOfDayBRtoUTCISO(to);

      let query = supabase
        .from('stock_movements')
        .select('id, created_at, qty, unit_cost, total_amount, payment_method, receipt_path, reason, supplier_id, product_id, products(name), suppliers(name)')
        .eq('store_id', storeId)
        .eq('movement_type', 'purchase_in')
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .order('created_at', { ascending: false })
        .limit(500);

      if (supplierFilter !== 'all') {
        if (supplierFilter === 'none') query = query.is('supplier_id', null);
        else query = query.eq('supplier_id', supplierFilter);
      }

      const { data, error } = await query;
      if (error) throw error;
      setRows((data as unknown as MovementRow[]) || []);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao carregar relatório');
    } finally {
      setLoading(false);
    }
  }, [storeId, from, to, supplierFilter]);

  useEffect(() => {
    if (!storeId) return;
    supabase.from('suppliers').select('id, name').eq('store_id', storeId).order('name')
      .then(({ data }) => setSuppliers(data || []));
  }, [storeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Aggregate by supplier
  const grouped = useMemo(() => {
    const map = new Map<string, { name: string; qty: number; total: number; count: number }>();
    for (const r of rows) {
      const key = r.supplier_id || '__none__';
      const name = r.suppliers?.name || 'Sem fornecedor';
      const total = Number(r.total_amount) || (Number(r.unit_cost || 0) * Number(r.qty || 0));
      const cur = map.get(key) || { name, qty: 0, total: 0, count: 0 };
      cur.qty += Number(r.qty) || 0;
      cur.total += total;
      cur.count += 1;
      map.set(key, cur);
    }
    return Array.from(map.entries())
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => b.total - a.total);
  }, [rows]);

  const totals = useMemo(() => {
    const totalValue = rows.reduce((s, r) => s + (Number(r.total_amount) || (Number(r.unit_cost || 0) * Number(r.qty || 0))), 0);
    const totalQty = rows.reduce((s, r) => s + Number(r.qty || 0), 0);
    return { totalValue, totalQty, count: rows.length };
  }, [rows]);

  const openReceipt = async (path: string) => {
    const { data, error } = await supabase.storage
      .from('purchase-receipts')
      .createSignedUrl(path, 60 * 5);
    if (error || !data?.signedUrl) {
      toast.error('Não foi possível abrir a nota.');
      return;
    }
    window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
  };

  const exportCsv = () => {
    const header = ['Data', 'Produto', 'Fornecedor', 'Qty', 'Custo unit.', 'Total', 'Pagamento', 'Observação'];
    const lines = rows.map(r => [
      new Date(r.created_at).toLocaleDateString('pt-BR'),
      r.products?.name || '',
      r.suppliers?.name || 'Sem fornecedor',
      String(r.qty),
      Number(r.unit_cost || 0).toFixed(2),
      Number(r.total_amount || (Number(r.unit_cost || 0) * Number(r.qty || 0))).toFixed(2),
      r.payment_method || '',
      (r.reason || '').replace(/[\r\n,;]+/g, ' '),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    const csv = [header.join(','), ...lines].join('\n');
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `compras_${from}_${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-5 w-5 text-primary" />
          <h1 className="text-xl md:text-2xl font-bold">Relatório de Compras</h1>
        </div>
        <Button variant="outline" size="sm" onClick={exportCsv} disabled={!rows.length}>
          <Download className="h-4 w-4 mr-2" /> Exportar CSV
        </Button>
      </div>

      <Card>
        <CardContent className="p-3 md:p-4">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">De</Label>
              <Input type="date" value={from} onChange={e => setFrom(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Até</Label>
              <Input type="date" value={to} onChange={e => setTo(e.target.value)} className="h-10" />
            </div>
            <div className="space-y-1 sm:col-span-2">
              <Label className="text-xs">Fornecedor</Label>
              <Select value={supplierFilter} onValueChange={setSupplierFilter}>
                <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Todos</SelectItem>
                  <SelectItem value="none">Sem fornecedor</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-3 gap-3">
        <Card><CardContent className="p-3 md:p-4">
          <p className="text-xs text-muted-foreground">Compras</p>
          <p className="text-xl md:text-2xl font-bold">{totals.count}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 md:p-4">
          <p className="text-xs text-muted-foreground">Itens</p>
          <p className="text-xl md:text-2xl font-bold">{totals.totalQty}</p>
        </CardContent></Card>
        <Card><CardContent className="p-3 md:p-4">
          <p className="text-xs text-muted-foreground">Total gasto</p>
          <p className="text-xl md:text-2xl font-bold">{fmt(totals.totalValue)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="text-base md:text-lg">Por fornecedor</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : grouped.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhuma compra no período.</p>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-center">Compras</TableHead>
                <TableHead className="text-center">Itens</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {grouped.map(g => (
                  <TableRow key={g.key}>
                    <TableCell className="font-medium">{g.name}</TableCell>
                    <TableCell className="text-center">{g.count}</TableCell>
                    <TableCell className="text-center">{g.qty}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(g.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="p-3 md:p-6">
          <CardTitle className="text-base md:text-lg">Movimentações de compra</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-4 space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : rows.length === 0 ? (
            <p className="text-center py-8 text-muted-foreground">Nenhuma compra no período.</p>
          ) : isMobile ? (
            <div className="divide-y">
              {rows.map(r => (
                <div key={r.id} className="px-3 py-2.5 space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium truncate">{r.products?.name || '-'}</p>
                    <span className="text-sm font-semibold">{fmt(Number(r.total_amount) || (Number(r.unit_cost || 0) * Number(r.qty || 0)))}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>{new Date(r.created_at).toLocaleDateString('pt-BR')} · {r.qty} un.</span>
                    <Badge variant="secondary" className="text-xs">{r.suppliers?.name || 'Sem fornecedor'}</Badge>
                  </div>
                  {r.receipt_path && (
                    <button onClick={() => openReceipt(r.receipt_path!)} className="text-xs text-primary inline-flex items-center gap-1 hover:underline">
                      <FileText className="h-3 w-3" /> Ver nota
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Table>
              <TableHeader><TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Produto</TableHead>
                <TableHead>Fornecedor</TableHead>
                <TableHead className="text-center">Qty</TableHead>
                <TableHead className="text-right">Custo unit.</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Pagamento</TableHead>
                <TableHead className="text-center">Nota</TableHead>
              </TableRow></TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="text-sm">{new Date(r.created_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="text-sm font-medium">{r.products?.name || '-'}</TableCell>
                    <TableCell className="text-sm">{r.suppliers?.name || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center">{r.qty}</TableCell>
                    <TableCell className="text-right">{fmt(Number(r.unit_cost) || 0)}</TableCell>
                    <TableCell className="text-right font-semibold">{fmt(Number(r.total_amount) || (Number(r.unit_cost || 0) * Number(r.qty || 0)))}</TableCell>
                    <TableCell className="text-sm capitalize">{r.payment_method || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="text-center">
                      {r.receipt_path ? (
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openReceipt(r.receipt_path!)} aria-label="Abrir nota">
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      ) : <span className="text-muted-foreground text-xs">—</span>}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
