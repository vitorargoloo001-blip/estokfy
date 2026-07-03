import { useEffect, useState, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { ArrowLeftRight, Search, Pencil, Ban, ScrollText, Loader2 } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { useSensitiveOpsPermission } from '@/hooks/useSensitiveOpsPermission';
import SensitiveActionDialog from '@/components/SensitiveActionDialog';
import { toast } from 'sonner';

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
  status: string;
  reason: string | null;
  notes: string | null;
}

const SETTLEMENT: Record<string, { label: string; cls: string }> = {
  a_pagar: { label: 'A pagar', cls: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30' },
  troco: { label: 'Troco', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30' },
  credito: { label: 'Crédito', cls: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30' },
  zero: { label: 'Sem diferença', cls: 'bg-muted text-muted-foreground' },
};

export default function TrocasReport() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;
  const { allowed: canManageSensitiveOps } = useSensitiveOpsPermission();

  const [loading, setLoading] = useState(true);
  const [rows, setRows] = useState<ExchangeRow[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [emps, setEmps] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [editingExchange, setEditingExchange] = useState<ExchangeRow | null>(null);
  const [editReasonVal, setEditReasonVal] = useState('');
  const [editNotesVal, setEditNotesVal] = useState('');
  const [editJustification, setEditJustification] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const [cancelingExchange, setCancelingExchange] = useState<ExchangeRow | null>(null);

  const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string) => new Date(d).toLocaleDateString('pt-BR');

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      const { data } = await supabase
        .from('exchanges')
        .select('id, customer_id, original_product_name, original_value, new_product_name, new_value, difference, settlement, amount_to_pay, troco_amount, credit_amount, is_avulsa, created_by, created_at, status, reason, notes')
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

  const openEdit = (r: ExchangeRow) => {
    setEditingExchange(r);
    setEditReasonVal(r.reason || '');
    setEditNotesVal(r.notes || '');
    setEditJustification('');
  };

  const handleSaveEdit = async () => {
    if (!editingExchange) return;
    if (editJustification.trim().length < 3) { toast.error('Informe o motivo da edição (mínimo 3 caracteres).'); return; }
    setSavingEdit(true);
    try {
      const { error } = await supabase.rpc('edit_exchange_reason' as any, {
        p_exchange_id: editingExchange.id,
        p_new_reason: editReasonVal || null,
        p_new_notes: editNotesVal || null,
        p_edit_reason: editJustification.trim(),
      } as any);
      if (error) throw error;
      toast.success('Troca atualizada!');
      setEditingExchange(null);
      load();
    } catch (err: any) {
      toast.error(err.message || 'Erro ao editar troca.');
    } finally {
      setSavingEdit(false);
    }
  };

  const handleCancelExchange = async (reason: string) => {
    if (!cancelingExchange) return;
    const { error } = await supabase.rpc('cancel_exchange_atomic' as any, { p_exchange_id: cancelingExchange.id, p_cancel_reason: reason } as any);
    if (error) { toast.error(error.message || 'Erro ao cancelar troca.'); return; }
    toast.success('Troca cancelada.');
    setCancelingExchange(null);
    load();
  };

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
                  <div className="flex items-center gap-1">
                    {r.status === 'cancelled' && <Badge variant="destructive">Cancelada</Badge>}
                    <Badge variant="outline" className={SETTLEMENT[r.settlement]?.cls}>{SETTLEMENT[r.settlement]?.label || r.settlement}</Badge>
                  </div>
                </div>
                <p className="text-sm">{r.original_product_name} <span className="text-muted-foreground">→</span> {r.new_product_name}</p>
                <p className="text-xs text-muted-foreground">{fmt(r.original_value)} → {fmt(r.new_value)} · {fmtDate(r.created_at)} · {emps[r.created_by || ''] || '—'}{r.is_avulsa ? ' · avulsa' : ''}</p>
                {canManageSensitiveOps && (
                  <div className="flex items-center gap-1 pt-1 border-t">
                    {r.status !== 'cancelled' && (
                      <>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(r)}>
                          <Pencil className="h-3 w-3 mr-1" /> Editar
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs text-destructive hover:text-destructive" onClick={() => setCancelingExchange(r)}>
                          <Ban className="h-3 w-3 mr-1" /> Cancelar
                        </Button>
                      </>
                    )}
                    <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => navigate(`/historico?entity=exchange&entity_id=${r.id}`)}>
                      <ScrollText className="h-3 w-3 mr-1" /> Auditoria
                    </Button>
                  </div>
                )}
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
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} className={r.status === 'cancelled' ? 'opacity-60' : ''}>
                    <TableCell className="whitespace-nowrap">{fmtDate(r.created_at)}</TableCell>
                    <TableCell>{names[r.customer_id || ''] || '—'}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={r.original_product_name || ''}>{r.original_product_name || '—'}</TableCell>
                    <TableCell className="max-w-[160px] truncate" title={r.new_product_name || ''}>{r.new_product_name || '—'}</TableCell>
                    <TableCell className="text-right">{fmt(r.original_value)}</TableCell>
                    <TableCell className="text-right">{fmt(r.new_value)}</TableCell>
                    <TableCell>
                      {r.status === 'cancelled' && <Badge variant="destructive" className="mr-1">Cancelada</Badge>}
                      <Badge variant="outline" className={SETTLEMENT[r.settlement]?.cls}>{SETTLEMENT[r.settlement]?.label || r.settlement}</Badge>
                      <span className="ml-1 text-xs text-muted-foreground">
                        {r.settlement === 'a_pagar' ? fmt(r.amount_to_pay) : r.settlement === 'troco' ? fmt(r.troco_amount) : r.settlement === 'credito' ? fmt(r.credit_amount) : ''}
                      </span>
                    </TableCell>
                    <TableCell>{emps[r.created_by || ''] || '—'}</TableCell>
                    <TableCell>{r.is_avulsa ? <Badge variant="outline">Avulsa</Badge> : <span className="text-xs text-muted-foreground">Venda</span>}</TableCell>
                    <TableCell>
                      {canManageSensitiveOps && (
                        <div className="flex items-center gap-1 justify-end">
                          {r.status !== 'cancelled' && (
                            <>
                              <Button variant="ghost" size="icon" className="h-7 w-7" title="Editar motivo/observação" onClick={() => openEdit(r)}>
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" title="Cancelar" onClick={() => setCancelingExchange(r)}>
                                <Ban className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                          <Button variant="ghost" size="icon" className="h-7 w-7" title="Ver auditoria" onClick={() => navigate(`/historico?entity=exchange&entity_id=${r.id}`)}>
                            <ScrollText className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Editar motivo/observação da troca */}
      <Dialog open={!!editingExchange} onOpenChange={(o) => !o && !savingEdit && setEditingExchange(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>Editar troca</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Só é possível editar motivo e observações. Para corrigir produto ou valores, cancele esta troca e registre uma nova.
            </p>
            <div className="space-y-1">
              <Label>Motivo</Label>
              <Input value={editReasonVal} onChange={(e) => setEditReasonVal(e.target.value)} className="h-11" />
            </div>
            <div className="space-y-1">
              <Label>Observações</Label>
              <Textarea value={editNotesVal} onChange={(e) => setEditNotesVal(e.target.value)} rows={2} />
            </div>
            <div className="space-y-1">
              <Label className="text-destructive">Justificativa da edição *</Label>
              <Textarea value={editJustification} onChange={(e) => setEditJustification(e.target.value.slice(0, 500))} rows={2} placeholder="Motivo desta alteração..." />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditingExchange(null)} disabled={savingEdit}>Cancelar</Button>
            <Button onClick={handleSaveEdit} disabled={savingEdit}>
              {savingEdit ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : 'Salvar alteração'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <SensitiveActionDialog
        open={!!cancelingExchange}
        onOpenChange={(o) => !o && setCancelingExchange(null)}
        title="Cancelar troca"
        summary={cancelingExchange && (
          <div>
            <p>{cancelingExchange.original_product_name} <span className="text-muted-foreground">→</span> {cancelingExchange.new_product_name}</p>
            <p className="text-muted-foreground">{names[cancelingExchange.customer_id || ''] || 'Cliente'} · {fmtDate(cancelingExchange.created_at)}</p>
          </div>
        )}
        confirmLabel="Confirmar cancelamento"
        onConfirm={handleCancelExchange}
      />
    </div>
  );
}
