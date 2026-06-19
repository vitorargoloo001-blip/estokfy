import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useIsMobile } from '@/hooks/use-mobile';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import PageHeader from '@/components/PageHeader';
import { ShimmerList } from '@/components/ShimmerSkeleton';
import PayableFormDialog, { PayableRow } from '@/components/PayableFormDialog';
import { Plus, Wallet, AlertCircle, CheckCircle2, Clock, Pencil, Trash2, CircleDollarSign } from 'lucide-react';
import { toast } from 'sonner';

interface Payable extends PayableRow {
  status: 'pending' | 'paid' | 'cancelled';
  paid_at: string | null;
  paid_amount: number | null;
  suppliers?: { name: string } | null;
}

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString().slice(0, 10);

export default function AccountsPayable() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [rows, setRows] = useState<Payable[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'pending' | 'overdue' | 'paid' | 'all'>('pending');
  const [editing, setEditing] = useState<PayableRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [confirmPay, setConfirmPay] = useState<Payable | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Payable | null>(null);

  const fetchData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('accounts_payable')
      .select('id, description, category, supplier_id, amount, due_date, payment_method, notes, status, paid_at, paid_amount, suppliers(name)')
      .eq('store_id', profile.store_id)
      .order('due_date', { ascending: true });
    if (error) toast.error(error.message);
    setRows((data as any) || []);
    setLoading(false);
  }, [profile]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const today = todayISO();
  const isOverdue = (r: Payable) => r.status === 'pending' && r.due_date < today;

  const filtered = useMemo(() => rows.filter(r => {
    if (filter === 'all') return true;
    if (filter === 'paid') return r.status === 'paid';
    if (filter === 'overdue') return isOverdue(r);
    if (filter === 'pending') return r.status === 'pending';
    return true;
  }), [rows, filter, today]);

  const totals = useMemo(() => {
    const pending = rows.filter(r => r.status === 'pending');
    const overdue = pending.filter(r => r.due_date < today);
    return {
      pendingAmount: pending.reduce((s, r) => s + Number(r.amount), 0),
      overdueAmount: overdue.reduce((s, r) => s + Number(r.amount), 0),
      pendingCount: pending.length,
      overdueCount: overdue.length,
    };
  }, [rows, today]);

  const handlePay = async () => {
    if (!confirmPay) return;
    try {
      const { error } = await supabase.rpc('settle_payable', {
        p_payable_id: confirmPay.id,
        p_payment_method: confirmPay.payment_method || 'cash',
        p_paid_amount: confirmPay.amount,
      });
      if (error) throw error;
      toast.success('Conta paga e despesa lançada no caixa');
      setConfirmPay(null);
      fetchData();
    } catch (e: any) {
      toast.error(e?.message || 'Erro ao quitar conta');
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    const { error } = await supabase.from('accounts_payable').delete().eq('id', confirmDelete.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Conta removida');
    setConfirmDelete(null);
    fetchData();
  };

  const statusBadge = (r: Payable) => {
    if (r.status === 'paid') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30">Paga</Badge>;
    if (r.status === 'cancelled') return <Badge variant="outline">Cancelada</Badge>;
    if (isOverdue(r)) return <Badge variant="destructive">Vencida</Badge>;
    return <Badge variant="secondary">Pendente</Badge>;
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Contas a Pagar"
        description={`${totals.pendingCount} pendente(s) • ${totals.overdueCount} vencida(s)`}
        actions={
          <Button onClick={() => { setEditing(null); setCreating(true); }} className="gap-2">
            <Plus className="h-4 w-4" /> Nova conta
          </Button>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><Wallet className="h-3.5 w-3.5" /> Total a pagar</div>
            <p className="text-2xl font-bold mt-1">{fmt(totals.pendingAmount)}</p>
            <p className="text-xs text-muted-foreground">{totals.pendingCount} conta(s) pendente(s)</p>
          </CardContent>
        </Card>
        <Card className={totals.overdueCount > 0 ? 'border-destructive/50' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><AlertCircle className="h-3.5 w-3.5" /> Vencido</div>
            <p className="text-2xl font-bold mt-1 text-destructive">{fmt(totals.overdueAmount)}</p>
            <p className="text-xs text-muted-foreground">{totals.overdueCount} conta(s) atrasada(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground"><CheckCircle2 className="h-3.5 w-3.5" /> Pagas no histórico</div>
            <p className="text-2xl font-bold mt-1">{rows.filter(r => r.status === 'paid').length}</p>
          </CardContent>
        </Card>
      </div>

      <div className="flex gap-2 flex-wrap">
        {(['pending', 'overdue', 'paid', 'all'] as const).map(f => (
          <Button key={f} variant={filter === f ? 'default' : 'outline'} size="sm" onClick={() => setFilter(f)}>
            {f === 'pending' ? 'Pendentes' : f === 'overdue' ? 'Vencidas' : f === 'paid' ? 'Pagas' : 'Todas'}
          </Button>
        ))}
      </div>

      {loading ? (
        <ShimmerList count={5} rowClassName="h-20 w-full" />
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">
          <Clock className="mx-auto h-10 w-10 mb-2 opacity-50" />
          <p>Nenhuma conta nesta visão</p>
        </div>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map(r => (
            <Card key={r.id} className={isOverdue(r) ? 'border-destructive/50' : ''}>
              <CardContent className="p-3 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="font-medium text-sm truncate">{r.description}</p>
                    <p className="text-xs text-muted-foreground capitalize">{r.category} • {r.suppliers?.name || 'sem fornecedor'}</p>
                  </div>
                  {statusBadge(r)}
                </div>
                <div className="flex justify-between items-end pt-1 border-t">
                  <div>
                    <p className="text-xs text-muted-foreground">Valor</p>
                    <p className="text-lg font-bold">{fmt(Number(r.amount))}</p>
                  </div>
                  <p className={`text-xs ${isOverdue(r) ? 'text-destructive font-medium' : 'text-muted-foreground'}`}>
                    Venc: {new Date(r.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                  </p>
                </div>
                <div className="flex gap-2">
                  {r.status === 'pending' && (
                    <Button size="sm" className="flex-1 h-9" onClick={() => setConfirmPay(r)}>
                      <CircleDollarSign className="h-4 w-4 mr-1" /> Marcar paga
                    </Button>
                  )}
                  <Button size="sm" variant="outline" className="h-9" onClick={() => { setEditing(r); setCreating(true); }}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button size="sm" variant="outline" className="h-9 text-destructive" onClick={() => setConfirmDelete(r)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
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
                  <TableHead>Descrição</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Fornecedor</TableHead>
                  <TableHead>Vencimento</TableHead>
                  <TableHead className="text-right">Valor</TableHead>
                  <TableHead className="text-center">Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(r => (
                  <TableRow key={r.id} className={isOverdue(r) ? 'bg-destructive/5' : ''}>
                    <TableCell className="text-sm font-medium">{r.description}</TableCell>
                    <TableCell className="text-sm capitalize">{r.category}</TableCell>
                    <TableCell className="text-sm text-muted-foreground">{r.suppliers?.name || '—'}</TableCell>
                    <TableCell className={`text-sm ${isOverdue(r) ? 'text-destructive font-medium' : ''}`}>
                      {new Date(r.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="text-right text-sm font-semibold">{fmt(Number(r.amount))}</TableCell>
                    <TableCell className="text-center">{statusBadge(r)}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex gap-1 justify-end">
                        {r.status === 'pending' && (
                          <Button size="sm" onClick={() => setConfirmPay(r)} className="gap-1">
                            <CircleDollarSign className="h-3.5 w-3.5" /> Pagar
                          </Button>
                        )}
                        <Button size="icon" variant="ghost" onClick={() => { setEditing(r); setCreating(true); }}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" className="text-destructive" onClick={() => setConfirmDelete(r)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <PayableFormDialog open={creating} onOpenChange={setCreating} initial={editing} onSaved={fetchData} />

      <AlertDialog open={!!confirmPay} onOpenChange={o => !o && setConfirmPay(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirmar pagamento</AlertDialogTitle>
            <AlertDialogDescription>
              Marcar <strong>{confirmPay?.description}</strong> como paga ({fmt(Number(confirmPay?.amount || 0))})?
              A despesa será lançada automaticamente no caixa.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handlePay}>Confirmar pagamento</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={o => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir conta</AlertDialogTitle>
            <AlertDialogDescription>
              Tem certeza que deseja excluir <strong>{confirmDelete?.description}</strong>? Esta ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground">Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
