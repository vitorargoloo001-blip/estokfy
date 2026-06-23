import { useEffect, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Plus, ShoppingCart, ChevronLeft, ChevronRight, Search, Wallet, Pencil, Trash2, Loader2 } from 'lucide-react';
import SaleDetailDialog from '@/components/SaleDetailDialog';
import SettlePaymentDialog from '@/components/SettlePaymentDialog';
import EditSaleDialog from '@/components/EditSaleDialog';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { toast } from '@/hooks/use-toast';
import { useIsMobile } from '@/hooks/use-mobile';
import PageHeader from '@/components/PageHeader';
import { ShimmerList } from '@/components/ShimmerSkeleton';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import EmployeeFilter from '@/components/EmployeeFilter';
import { usePermissions } from '@/hooks/usePermissions';

const PAGE_SIZE = 20;

export default function Sales() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [sales, setSales] = useState<any[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [selectedSaleId, setSelectedSaleId] = useState<string | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [status, setStatus] = useState('all');
  const [clientSearch, setClientSearch] = useState('');
  const [notesSearch, setNotesSearch] = useState('');
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const { canManageEmployees } = usePermissions();

  useEffect(() => {
    if (!profile) return;
  }, [profile]);

  const debouncedClientSearch = useDebouncedValue(clientSearch, 350);
  const debouncedNotesSearch = useDebouncedValue(notesSearch, 350);

  const fetchSales = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const showRefunded = status === 'refunded';
    let query = supabase.from('sales').select('*, customers(name), profiles!sales_created_by_fkey(full_name), payments(method, amount)', { count: 'exact' }).eq('store_id', profile.store_id);
    if (!showRefunded) query = query.is('deleted_at', null);
    if (dateFrom) query = query.gte('created_at', dateFrom);
    if (dateTo) query = query.lte('created_at', dateTo + 'T23:59:59');
    if (status !== 'all') query = query.eq('status', status);
    if (sellerId) query = query.eq('created_by', sellerId);
    if (debouncedNotesSearch.trim()) {
      query = query.ilike('notes', `%${debouncedNotesSearch.trim()}%`);
    }
    query = query.order('created_at', { ascending: false }).range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    const { data, count } = await query;
    let filtered = data || [];
    if (debouncedClientSearch.trim()) {
      const q = debouncedClientSearch.toLowerCase();
      filtered = filtered.filter(s => (s.customers as any)?.name?.toLowerCase().includes(q));
    }
    setSales(filtered);
    setTotal(count || 0);
    setLoading(false);
  }, [profile, dateFrom, dateTo, status, page, debouncedClientSearch, debouncedNotesSearch, sellerId]);

  useEffect(() => { fetchSales(); }, [fetchSales]);
  useEffect(() => { setPage(0); }, [dateFrom, dateTo, status, debouncedClientSearch, debouncedNotesSearch, sellerId]);

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const PM_LABEL: Record<string, string> = {
    pix: 'PIX', card: 'Cartão', cash: 'Dinheiro', transfer: 'Transferência', other: 'Outro',
    credit_card: 'Cartão', debit_card: 'Cartão', pending: 'A prazo',
  };
  const primaryPayment = (s: any): string => {
    const ps = (s.payments || []) as Array<{ method: string; amount: number }>;
    if (!ps.length) return '—';
    const top = [...ps].sort((a, b) => Number(b.amount) - Number(a.amount))[0];
    return PM_LABEL[top.method] || top.method;
  };

  const todayStr = new Date().toISOString().slice(0, 10);
  const paymentStatusBadge = (s: any) => {
    const ps = s.payment_status || 'paid';
    const overdue = (ps === 'pending' || ps === 'partial') && s.due_date && s.due_date < todayStr;
    if (overdue) return { label: 'Vencida', cls: 'bg-destructive/15 text-destructive' };
    if (ps === 'paid') return { label: 'Pago', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' };
    if (ps === 'partial') return { label: 'Parcial', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' };
    return { label: 'Pendente', cls: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400' };
  };

  const statusMap: Record<string, { label: string; cls: string }> = {
    paid: { label: 'Pago', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' },
    draft: { label: 'Rascunho', cls: 'bg-muted text-muted-foreground' },
    cancelled: { label: 'Cancelado', cls: 'bg-destructive/10 text-destructive' },
    refunded: { label: 'Devolvida', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400' },
    partial_refund: { label: 'Reembolso parcial', cls: 'bg-amber-100 text-amber-700' },
  };

  const [settleSale, setSettleSale] = useState<any | null>(null);
  const [editSaleId, setEditSaleId] = useState<string | null>(null);
  const [deleteSale, setDeleteSale] = useState<any | null>(null);
  const [deleteReason, setDeleteReason] = useState('');
  const [deleting, setDeleting] = useState(false);
  const canEditSales = ['owner', 'admin', 'manager'].includes(profile?.role || '');
  const canDeleteSales = ['owner', 'admin', 'manager'].includes(profile?.role || '');
  const openDetail = (id: string) => { setSelectedSaleId(id); setDetailOpen(true); };

  const confirmDelete = async () => {
    if (!deleteSale) return;
    const reason = deleteReason.trim();
    if (reason.length < 3) {
      toast({ title: 'Informe o motivo da exclusão', variant: 'destructive' });
      return;
    }
    setDeleting(true);
    try {
      const { data, error } = await supabase.rpc('delete_sale_permanently' as any, {
        p_sale_id: deleteSale.id, p_reason: reason,
      });
      if (error) throw error;
      const map: Record<string, string> = {
        forbidden_role: 'Você não tem permissão para excluir vendas.',
        forbidden_store: 'Você não tem permissão para excluir esta venda.',
        sale_not_found: 'Venda não encontrada.',
        sale_already_deleted: 'Esta venda já foi excluída.',
        reason_required: 'Informe o motivo da exclusão.',
      };
      const result: any = data;
      toast({ title: 'Venda excluída', description: result?.impacts?.cash_reverted ? `Estorno de ${fmt(Number(result.impacts.cash_reverted))} lançado no caixa.` : 'Estoque e impactos foram revertidos.' });
      setDeleteSale(null);
      setDeleteReason('');
      fetchSales();
    } catch (e: any) {
      const code = e?.message || '';
      const map: Record<string, string> = {
        forbidden_role: 'Você não tem permissão para excluir vendas.',
        forbidden_store: 'Você não tem permissão para excluir esta venda.',
        sale_not_found: 'Venda não encontrada.',
        sale_already_deleted: 'Esta venda já foi excluída.',
        reason_required: 'Informe o motivo da exclusão.',
      };
      const friendly = Object.keys(map).find(k => code.includes(k));
      toast({ title: 'Erro ao excluir venda', description: friendly ? map[friendly] : (e?.message || 'Tente novamente.'), variant: 'destructive' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Vendas"
        description={`${total} venda(s) no histórico`}
        actions={
          <Button asChild variant="premium" size={isMobile ? 'sm' : 'default'} className="gap-2">
            <Link to="/vendas/nova"><Plus className="h-4 w-4" /> {isMobile ? 'Nova' : 'Nova Venda'}</Link>
          </Button>
        }
      />

      {/* Filter chips + expandable filters */}
      <div className="flex gap-2 flex-wrap">
        <Button variant={status === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('all')}>Todas</Button>
        <Button variant={status === 'paid' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('paid')}>Pagas</Button>
        <Button variant={status === 'cancelled' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('cancelled')}>Canceladas</Button>
        <Button variant={status === 'refunded' ? 'default' : 'outline'} size="sm" onClick={() => setStatus('refunded')}>Devolvidas</Button>
        <Button variant="outline" size="sm" onClick={() => setShowFilters(!showFilters)}>
          <Search className="h-3.5 w-3.5 mr-1" /> Filtros
        </Button>
      </div>

      {showFilters && (
        <Card>
          <CardContent className="pt-4 pb-4">
            <div className="grid gap-3 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
              <div className="space-y-1"><Label className="text-xs">De</Label><Input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="h-11" /></div>
              <div className="space-y-1"><Label className="text-xs">Até</Label><Input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} className="h-11" /></div>
              <div className="space-y-1"><Label className="text-xs">Status</Label>
                <Select value={status} onValueChange={setStatus}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos</SelectItem>
                    <SelectItem value="paid">Pago</SelectItem>
                    <SelectItem value="draft">Rascunho</SelectItem>
                    <SelectItem value="cancelled">Cancelado</SelectItem>
                    <SelectItem value="refunded">Devolvida</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label className="text-xs">Cliente</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder="Buscar..." value={clientSearch} onChange={e => setClientSearch(e.target.value)} className="pl-10 h-11" />
                </div>
              </div>
              {canManageEmployees && (
                <div className="space-y-1"><Label className="text-xs">Vendedor</Label>
                  <EmployeeFilter value={sellerId} onChange={(id) => setSellerId(id)} className="h-11" />
                </div>
              )}
              <div className="space-y-1 sm:col-span-2 lg:col-span-4"><Label className="text-xs">Observação</Label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input placeholder='Ex: "garantia", "retirar amanhã", "reservado"' value={notesSearch} onChange={e => setNotesSearch(e.target.value)} className="pl-10 h-11" />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Mobile: Cards / Desktop: Table */}
      {loading ? (
        <ShimmerList count={6} rowClassName="h-20 w-full" />
      ) : sales.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <ShoppingCart className="mx-auto h-10 w-10 mb-2 opacity-50" />
          <p>Nenhuma venda encontrada</p>
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {sales.map((s) => {
            const ps = paymentStatusBadge(s);
            const canSettle = s.payment_status === 'pending' || s.payment_status === 'partial';
            return (
              <Card key={s.id} className="cursor-pointer active:bg-muted/30" onClick={() => openDetail(s.id)}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <p className="font-medium text-sm truncate">{(s.customers as any)?.name || 'Avulso'}</p>
                      <p className="text-xs text-muted-foreground">{new Date(s.created_at).toLocaleDateString('pt-BR')} • {new Date(s.created_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${ps.cls}`}>{ps.label}</span>
                  </div>
                  <div className="flex items-center justify-between mt-2 pt-2 border-t">
                    <div>
                      <span className="text-lg font-bold">{fmt(s.net_total)}</span>
                      {Number(s.amount_pending) > 0 && (
                        <p className="text-xs text-amber-600 dark:text-amber-400">A receber: {fmt(s.amount_pending)}</p>
                      )}
                    </div>
                    <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{primaryPayment(s)}</Badge>
                  </div>
                  {(canSettle || canEditSales || canDeleteSales) && (
                    <div className="flex gap-2 mt-2">
                      {canSettle && (
                        <Button size="sm" variant="outline" className="flex-1 h-8" onClick={e => { e.stopPropagation(); setSettleSale(s); }}>
                          <Wallet className="h-3.5 w-3.5 mr-1" /> Receber
                        </Button>
                      )}
                      {canEditSales && (
                        <Button size="sm" variant="outline" className="flex-1 h-8" onClick={e => { e.stopPropagation(); setEditSaleId(s.id); }}>
                          <Pencil className="h-3.5 w-3.5 mr-1" /> Editar
                        </Button>
                      )}
                      {canDeleteSales && (
                        <Button size="sm" variant="outline" className="h-8 text-destructive hover:text-destructive" onClick={e => { e.stopPropagation(); setDeleteSale(s); }}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Cliente</TableHead>
                  <TableHead className="hidden md:table-cell">Vendedor</TableHead>
                  <TableHead className="text-right hidden sm:table-cell">Bruto</TableHead>
                  <TableHead className="text-right hidden lg:table-cell">Desconto</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                  <TableHead className="text-right hidden md:table-cell">Lucro</TableHead>
                  <TableHead className="hidden md:table-cell">Pagamento</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right w-24">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => {
                  const ps = paymentStatusBadge(s);
                  const canSettle = s.payment_status === 'pending' || s.payment_status === 'partial';
                  return (
                    <TableRow key={s.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openDetail(s.id)}>
                      <TableCell className="text-sm">{new Date(s.created_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell className="text-sm">{(s.customers as any)?.name || 'Avulso'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground hidden md:table-cell">{(s.profiles as any)?.full_name || '-'}</TableCell>
                      <TableCell className="text-right text-sm hidden sm:table-cell">{fmt(s.gross_total)}</TableCell>
                      <TableCell className="text-right text-sm text-destructive hidden lg:table-cell">{s.discount_total > 0 ? `-${fmt(s.discount_total)}` : '-'}</TableCell>
                      <TableCell className="text-right text-sm font-medium">
                        {fmt(s.net_total)}
                        {Number(s.amount_pending) > 0 && (
                          <div className="text-[11px] text-amber-600 dark:text-amber-400">A receber: {fmt(s.amount_pending)}</div>
                        )}
                      </TableCell>
                      <TableCell className="text-right text-sm hidden md:table-cell">{fmt(s.profit_gross)}</TableCell>
                      <TableCell className="text-sm hidden md:table-cell"><Badge variant="secondary" className="text-xs">{primaryPayment(s)}</Badge></TableCell>
                      <TableCell className="text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ps.cls}`}>{ps.label}</span>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canSettle && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Receber pagamento" onClick={e => { e.stopPropagation(); setSettleSale(s); }}>
                              <Wallet className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canEditSales && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" title="Editar venda" onClick={e => { e.stopPropagation(); setEditSaleId(s.id); }}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          {canDeleteSales && (
                            <Button size="sm" variant="ghost" className="h-7 w-7 p-0 text-destructive hover:text-destructive" title="Excluir venda" onClick={e => { e.stopPropagation(); setDeleteSale(s); }}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} venda(s) — Pág {page + 1}/{totalPages}</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <SaleDetailDialog saleId={selectedSaleId} open={detailOpen} onOpenChange={setDetailOpen} />
      <SettlePaymentDialog
        saleId={settleSale?.id || null}
        amountPending={Number(settleSale?.amount_pending) || 0}
        open={!!settleSale}
        onOpenChange={open => !open && setSettleSale(null)}
        onSettled={fetchSales}
      />
      <EditSaleDialog
        saleId={editSaleId}
        open={!!editSaleId}
        onOpenChange={open => !open && setEditSaleId(null)}
        onSaved={fetchSales}
      />

      <Dialog open={!!deleteSale} onOpenChange={open => { if (!open && !deleting) { setDeleteSale(null); setDeleteReason(''); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="text-destructive">Excluir venda permanentemente</DialogTitle>
            <DialogDescription>
              Esta ação irá remover a venda do sistema e desfazer seus impactos em estoque, financeiro, contas a receber e fidelidade.
              {deleteSale && (
                <span className="block mt-2 text-foreground font-medium">
                  Venda de {(deleteSale.customers as any)?.name || 'Avulso'} — {fmt(Number(deleteSale.net_total) || 0)}
                </span>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="del-reason">Motivo da exclusão *</Label>
            <Textarea
              id="del-reason"
              placeholder="Ex: venda registrada duplicada / venda lançada no cliente errado / erro de valor"
              value={deleteReason}
              onChange={e => setDeleteReason(e.target.value)}
              rows={3}
              disabled={deleting}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setDeleteSale(null); setDeleteReason(''); }} disabled={deleting}>Cancelar</Button>
            <Button variant="destructive" onClick={confirmDelete} disabled={deleting || deleteReason.trim().length < 3}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Confirmar exclusão
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
