import { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Clock, FileDown, Search, AlertTriangle, TrendingDown } from 'lucide-react';
import { exportIdleProductsPdf, suggestIdleAction } from '@/lib/reportPdf';
import { toast } from 'sonner';
import PageHeader from '@/components/PageHeader';

interface Row {
  product_id: string;
  name: string;
  sku: string | null;
  on_hand: number;
  cost_price: number;
  sale_price: number;
  margin_pct: number;
  qty_sold_30d: number;
  days_idle: number | null;
  last_sale_at: string | null;
}

export default function IdleProducts() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState<string>('60');
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!profile?.store_id) return;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase.rpc('product_analytics', { p_store_id: profile.store_id });
      if (error) toast.error('Erro ao carregar produtos');
      setRows((data || []) as Row[]);
      setLoading(false);
    })();
  }, [profile?.store_id]);

  const filtered = useMemo(() => {
    const minDays = parseInt(days, 10) || 0;
    const term = search.trim().toLowerCase();
    return rows
      .filter(r => r.on_hand > 0)
      .filter(r => (r.days_idle ?? 9999) >= minDays)
      .filter(r => !term || r.name.toLowerCase().includes(term))
      .sort((a, b) => (b.days_idle ?? 9999) - (a.days_idle ?? 9999));
  }, [rows, days, search]);

  const totals = useMemo(() => {
    const stockValue = filtered.reduce((s, r) => s + Number(r.cost_price) * r.on_hand, 0);
    return { count: filtered.length, stockValue };
  }, [filtered]);

  const handleExport = async () => {
    if (!profile?.store_id) return;
    try {
      await exportIdleProductsPdf(profile.store_id, parseInt(days, 10) || 60);
      toast.success('PDF gerado');
    } catch (e: any) {
      toast.error('Erro ao gerar PDF: ' + e.message);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Produtos Parados"
        description="Produtos com estoque sem venda recente. Identifique candidatos para liquidação ou devolução."
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Produtos parados</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">{totals.count}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Capital parado (custo)</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold text-amber-600">R$ {totals.stockValue.toFixed(2)}</p></CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground">Filtro atual</CardTitle></CardHeader>
          <CardContent><p className="text-2xl font-bold">≥ {days} dias</p></CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div className="flex flex-1 flex-col gap-2 md:flex-row md:items-center">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar por nome..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9" />
            </div>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger className="w-full md:w-[180px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="30">30+ dias parado</SelectItem>
                <SelectItem value="60">60+ dias parado</SelectItem>
                <SelectItem value="90">90+ dias parado</SelectItem>
                <SelectItem value="120">120+ dias parado</SelectItem>
                <SelectItem value="180">180+ dias parado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" onClick={handleExport} disabled={!filtered.length}>
            <FileDown className="mr-2 h-4 w-4" />Exportar PDF
          </Button>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-2">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
          ) : filtered.length === 0 ? (
            <div className="py-12 text-center text-muted-foreground">
              <Clock className="mx-auto mb-3 h-10 w-10 opacity-50" />
              <p>Nenhum produto parado nesse filtro. 🎉</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Produto</TableHead>
                    <TableHead className="text-right">Estoque</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead className="text-right">Dias parado</TableHead>
                    <TableHead>Ação sugerida</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(r => {
                    const idle = r.days_idle ?? 9999;
                    const action = suggestIdleAction(r);
                    return (
                      <TableRow key={r.product_id}>
                        <TableCell>
                          <div className="font-medium">{r.name}</div>
                        </TableCell>
                        <TableCell className="text-right">{r.on_hand}</TableCell>
                        <TableCell className="text-right">
                          {Number(r.margin_pct) < 15
                            ? <Badge variant="destructive" className="gap-1"><TrendingDown className="h-3 w-3" />{Number(r.margin_pct).toFixed(1)}%</Badge>
                            : <span>{Number(r.margin_pct).toFixed(1)}%</span>}
                        </TableCell>
                        <TableCell className="text-right">
                          <Badge variant={idle >= 120 ? 'destructive' : idle >= 60 ? 'secondary' : 'outline'}>
                            {r.days_idle == null ? 'sem venda' : `${idle}d`}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">{action}</TableCell>
                        <TableCell className="text-right">
                          <Button variant="ghost" size="sm" onClick={() => navigate('/produtos')}>Abrir</Button>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
