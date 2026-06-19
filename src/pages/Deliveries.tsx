import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Truck, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  pending: { label: 'Aguardando', variant: 'outline' },
  packed: { label: 'Embalado', variant: 'secondary' },
  sent: { label: 'Enviado', variant: 'default' },
  in_transit: { label: 'Em trânsito', variant: 'default' },
  out_for_delivery: { label: 'Saiu p/ entrega', variant: 'default' },
  delivered: { label: 'Entregue', variant: 'secondary' },
  cancelled: { label: 'Cancelado', variant: 'destructive' },
  problem: { label: 'Problema', variant: 'destructive' },
};

const METHOD_MAP: Record<string, string> = {
  pickup: 'Retirada', correios: 'Correios', '99': '99 Entrega', motoboy: 'Motoboy', transportadora: 'Transportadora',
};

export default function Deliveries() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;
  const [deliveries, setDeliveries] = useState<any[]>([]);
  const [filter, setFilter] = useState('all');
  const [editId, setEditId] = useState<string | null>(null);
  const [editStatus, setEditStatus] = useState('');
  const [editTracking, setEditTracking] = useState('');
  const [editCost, setEditCost] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    let q = supabase.from('deliveries').select('*, sales(net_total, customers(name))').eq('store_id', storeId).order('created_at', { ascending: false }).limit(100);
    if (filter !== 'all') q = q.eq('status', filter);
    const { data } = await q;
    setDeliveries(data || []);
    setLoading(false);
  }, [storeId, filter]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  const openEdit = (d: any) => {
    setEditId(d.id); setEditStatus(d.status); setEditTracking(d.tracking_code || ''); setEditCost(String(d.delivery_cost || 0));
  };

  const saveEdit = async () => {
    if (!editId || saving) return;
    setSaving(true);
    try {
      const updates: any = { status: editStatus, tracking_code: editTracking || null, delivery_cost: parseFloat(editCost) || 0 };
      if (editStatus === 'delivered') updates.delivered_at = new Date().toISOString();
      const { error } = await supabase.from('deliveries').update(updates).eq('id', editId);
      if (error) throw error;
      toast.success('Entrega atualizada!');
      setEditId(null); fetchData();
    } catch (err: any) { toast.error(err.message || 'Erro ao salvar'); } finally { setSaving(false); }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Entregas</h1>
          <p className="text-sm text-muted-foreground">Acompanhe envios e retiradas</p>
        </div>
        {!isMobile && (
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-36 h-9"><SelectValue placeholder="Filtrar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas</SelectItem>
              {Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Filter chips */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        {['all', 'pending', 'sent', 'delivered', 'cancelled'].map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" className="shrink-0" onClick={() => setFilter(f)}>
            {f === 'all' ? 'Todas' : STATUS_MAP[f]?.label || f}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : isMobile ? (
        <div className="space-y-3">
          {deliveries.map(d => {
            const st = STATUS_MAP[d.status] || { label: d.status, variant: 'outline' as const };
            return (
              <Card key={d.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{(d.sales as any)?.customers?.name || 'Avulso'}</p>
                      <p className="text-xs text-muted-foreground">{METHOD_MAP[d.method] || d.method} • {new Date(d.created_at).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <Badge variant={st.variant} className="shrink-0 ml-2">{st.label}</Badge>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t">
                    <div className="text-xs text-muted-foreground">
                      {d.tracking_code ? <span className="font-mono">{d.tracking_code}</span> : 'Sem rastreio'}
                      {d.delivery_cost > 0 && <span className="ml-2">• {fmt(d.delivery_cost)}</span>}
                    </div>
                    <Button variant="outline" size="sm" className="h-7" onClick={() => openEdit(d)}>Atualizar</Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
          {deliveries.length === 0 && (
            <div className="text-center py-12 text-muted-foreground"><Truck className="mx-auto h-10 w-10 mb-2 opacity-50" />Nenhuma entrega</div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Cliente</TableHead><TableHead>Método</TableHead><TableHead>Rastreio</TableHead><TableHead className="text-right">Custo</TableHead><TableHead>Status</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {deliveries.map(d => {
                  const st = STATUS_MAP[d.status] || { label: d.status, variant: 'outline' as const };
                  return (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm">{new Date(d.created_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-sm">{(d.sales as any)?.customers?.name || 'Avulso'}</TableCell>
                      <TableCell className="text-sm">{METHOD_MAP[d.method] || d.method}</TableCell>
                      <TableCell className="text-sm font-mono">{d.tracking_code || '-'}</TableCell>
                      <TableCell className="text-right text-sm">{fmt(Number(d.delivery_cost))}</TableCell>
                      <TableCell><Badge variant={st.variant}>{st.label}</Badge></TableCell>
                      <TableCell><Button variant="ghost" size="sm" onClick={() => openEdit(d)}>Editar</Button></TableCell>
                    </TableRow>
                  );
                })}
                {deliveries.length === 0 && <TableRow><TableCell colSpan={7} className="text-center py-8 text-muted-foreground"><Truck className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhuma entrega</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!editId} onOpenChange={open => { if (!saving && !open) setEditId(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>Atualizar Entrega</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2"><Label>Status</Label>
              <Select value={editStatus} onValueChange={setEditStatus}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>{Object.entries(STATUS_MAP).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Código de rastreio</Label><Input value={editTracking} onChange={e => setEditTracking(e.target.value)} placeholder="AA123456789BR" className="h-11" /></div>
            <div className="space-y-2"><Label>Custo da entrega (R$)</Label><Input type="number" step="0.01" min="0" value={editCost} onChange={e => setEditCost(e.target.value)} className="h-11" /></div>
            <Button className="w-full h-11" onClick={saveEdit} disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : 'Salvar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
