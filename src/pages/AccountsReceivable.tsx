import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { useIsMobile } from '@/hooks/use-mobile';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import PageHeader from '@/components/PageHeader';
import { ShimmerList } from '@/components/ShimmerSkeleton';
import BatchSettlePaymentDialog from '@/components/BatchSettlePaymentDialog';
import { Wallet, Clock, AlertCircle, DollarSign, Search, Users, ChevronRight, Inbox, Package, DollarSign as DollarIcon, FileText, MessageCircle } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import EmployeeFilter from '@/components/EmployeeFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { generateCustomerStatementPDF, statementFileName, type StatementSale } from '@/lib/customerStatementPdf';
import { toast } from 'sonner';

interface SaleItemLite {
  qty: number;
  product_name_snapshot: string | null;
  products: { name: string } | null;
}

interface PendingSale {
  id: string;
  created_at: string;
  net_total: number;
  amount_paid: number;
  amount_pending: number;
  payment_status: string;
  due_date: string | null;
  notes: string | null;
  customer_id: string | null;
  customers: { name: string; phone: string | null } | null;
  sale_items: SaleItemLite[] | null;
}

function itemName(it: SaleItemLite): string {
  return (it.product_name_snapshot || it.products?.name || 'Produto').trim();
}

function saleItemsSummary(items: SaleItemLite[] | null | undefined): {
  primary: string;
  secondary: string;
  full: string;
} {
  const list = items || [];
  if (list.length === 0) return { primary: 'Venda sem itens', secondary: '', full: '' };
  const names = list.map(itemName);
  if (list.length === 1) {
    const qty = list[0].qty > 1 ? `${list[0].qty}× ` : '';
    return { primary: `${qty}${names[0]}`, secondary: '', full: `${qty}${names[0]}` };
  }
  const full = names.map((n, i) => `${list[i].qty}× ${n}`).join(', ');
  return {
    primary: names[0],
    secondary: `+${list.length - 1} ite${list.length - 1 > 1 ? 'ns' : 'm'}`,
    full,
  };
}

interface CustomerGroup {
  id: string; // customer id or 'avulso'
  name: string;
  phone: string | null;
  initial: string;
  count: number;
  total: number;
  sales: PendingSale[];
}

const fmt = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const todayISO = () => new Date().toISOString().slice(0, 10);

// Deterministic avatar color based on name
const AVATAR_COLORS = [
  'bg-blue-500',
  'bg-emerald-500',
  'bg-violet-500',
  'bg-amber-500',
  'bg-rose-500',
  'bg-cyan-500',
  'bg-fuchsia-500',
  'bg-indigo-500',
  'bg-orange-500',
  'bg-teal-500',
];
const colorFor = (s: string) => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
};

function Avatar({ name, className }: { name: string; className?: string }) {
  const initial = (name?.trim()?.[0] || '?').toUpperCase();
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full text-white font-semibold shrink-0',
        colorFor(name || '?'),
        className,
      )}
    >
      {initial}
    </div>
  );
}

export default function AccountsReceivable() {
  const { profile } = useAuth();
  const { canManageEmployees, canManageReceivables } = usePermissions();
  const canBatchSettle = canManageReceivables;
  const isMobile = useIsMobile();
  const [sales, setSales] = useState<PendingSale[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState<'all' | 'overdue' | 'upcoming'>('all');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mobileListOpen, setMobileListOpen] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [batchOpen, setBatchOpen] = useState(false);
  const [statementOpen, setStatementOpen] = useState(false);
  const [statementScope, setStatementScope] = useState<'all' | 'overdue'>('all');
  const [statementAction, setStatementAction] = useState<'pdf' | 'whatsapp'>('pdf');

  const fetchData = useCallback(async () => {
    if (!profile) return;
    setLoading(true);
    let q = supabase
      .from('sales')
      .select(
        'id, created_at, net_total, amount_paid, amount_pending, payment_status, due_date, notes, customer_id, customers(name, phone), sale_items(qty, product_name_snapshot, products(name))',
      )
      .eq('store_id', profile.store_id)
      .is('deleted_at', null)
      .in('payment_status', ['pending', 'partial']);
    if (sellerId) q = q.eq('created_by', sellerId);
    const { data } = await q.order('due_date', { ascending: true, nullsFirst: false });
    setSales((data as any) || []);
    setLoading(false);
  }, [profile, sellerId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const today = todayISO();
  const isOverdue = (s: PendingSale) => s.due_date && s.due_date < today;

  // Filtered sales by status filter
  const filteredSales = useMemo(() => {
    return sales.filter((s) => {
      if (filter === 'overdue') return !!isOverdue(s);
      if (filter === 'upcoming') return !s.due_date || s.due_date >= today;
      return true;
    });
  }, [sales, filter, today]);

  // Group by customer
  const customerGroups = useMemo<CustomerGroup[]>(() => {
    const map = new Map<string, CustomerGroup>();
    for (const s of filteredSales) {
      const id = s.customer_id || 'avulso';
      const name = s.customers?.name || 'Avulso';
      const phone = s.customers?.phone || null;
      const g = map.get(id) || {
        id,
        name,
        phone,
        initial: (name[0] || '?').toUpperCase(),
        count: 0,
        total: 0,
        sales: [],
      };
      g.count += 1;
      g.total += Number(s.amount_pending);
      g.sales.push(s);
      map.set(id, g);
    }
    return Array.from(map.values()).sort((a, b) => b.total - a.total);
  }, [filteredSales]);

  // Search filter
  const visibleGroups = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customerGroups;
    return customerGroups.filter((g) => {
      if (g.name.toLowerCase().includes(q)) return true;
      if (g.phone?.toLowerCase().includes(q)) return true;
      return g.sales.some((s) => s.notes?.toLowerCase().includes(q));
    });
  }, [customerGroups, search]);

  // Auto-select first
  useEffect(() => {
    if (visibleGroups.length === 0) {
      setSelectedId(null);
      return;
    }
    if (!selectedId || !visibleGroups.some((g) => g.id === selectedId)) {
      setSelectedId(visibleGroups[0].id);
    }
  }, [visibleGroups, selectedId]);

  const selected = visibleGroups.find((g) => g.id === selectedId) || null;

  // KPIs (over filtered scope)
  const totalPending = filteredSales.reduce((s, r) => s + Number(r.amount_pending), 0);
  const totalOverdue = filteredSales
    .filter((s) => isOverdue(s))
    .reduce((s, r) => s + Number(r.amount_pending), 0);
  const overdueCount = filteredSales.filter((s) => isOverdue(s)).length;

  const renderCustomerList = () => (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-1 pb-3">
        <Users className="h-4 w-4 text-muted-foreground" />
        <h3 className="font-semibold text-sm">Clientes</h3>
        <Badge variant="secondary" className="ml-auto text-[10px]">
          {visibleGroups.length}
        </Badge>
      </div>
      <div className="relative px-1 pb-3">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder="Buscar cliente..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-8 h-9 text-sm"
        />
      </div>
      <div className="flex-1 overflow-y-auto space-y-1.5 px-1 pb-2">
        {loading ? (
          <ShimmerList count={5} rowClassName="h-14 w-full" />
        ) : visibleGroups.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground text-xs">
            <Inbox className="mx-auto h-8 w-8 mb-2 opacity-40" />
            Nenhum cliente
          </div>
        ) : (
          visibleGroups.map((g) => {
            const active = g.id === selectedId;
            return (
              <button
                key={g.id}
                onClick={() => {
                  setSelectedId(g.id);
                  setMobileListOpen(false);
                }}
                className={cn(
                  'w-full flex items-center gap-3 p-2.5 rounded-lg border text-left transition-all',
                  active
                    ? 'bg-primary/5 border-primary/30 shadow-sm'
                    : 'bg-card border-transparent hover:bg-muted/50 hover:border-border',
                )}
              >
                <Avatar name={g.name} className="h-9 w-9 text-sm" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{g.name}</p>
                  <p className="text-[11px] text-muted-foreground">
                    {g.count} conta{g.count > 1 ? 's' : ''}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  <span className="text-sm font-semibold text-destructive">{fmt(g.total)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
                </div>
              </button>
            );
          })
        )}
      </div>
      {selected && (
        <div className="mt-2 p-3 rounded-lg bg-muted/40 border">
          <p className="text-[11px] text-muted-foreground">Total do cliente selecionado</p>
          <p className="text-lg font-bold text-destructive mt-0.5">{fmt(selected.total)}</p>
        </div>
      )}
    </div>
  );

  const statusBadge = (s: PendingSale) => {
    if (isOverdue(s))
      return (
        <Badge className="bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/15 text-[10px]">
          Vencida
        </Badge>
      );
    if (s.payment_status === 'partial')
      return (
        <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 text-[10px]">
          Parcial
        </Badge>
      );
    return (
      <Badge className="bg-amber-500/10 text-amber-700 dark:text-amber-400 border border-amber-500/20 hover:bg-amber-500/15 text-[10px]">
        Pendente
      </Badge>
    );
  };

  const renderDetails = () => {
    if (!selected) {
      return (
        <div className="h-full flex items-center justify-center text-muted-foreground text-sm py-20">
          Selecione um cliente para ver as contas
        </div>
      );
    }
    const totalAmount = selected.sales.reduce((s, r) => s + Number(r.net_total), 0);
    const totalPaid = selected.sales.reduce((s, r) => s + Number(r.amount_paid), 0);
    const totalDue = selected.sales.reduce((s, r) => s + Number(r.amount_pending), 0);

    return (
      <div className="space-y-5">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <Avatar name={selected.name} className="h-12 w-12 text-base" />
            <div>
              <h3 className="font-bold text-lg leading-tight">{selected.name}</h3>
              <p className="text-xs text-muted-foreground">
                {selected.count} conta{selected.count > 1 ? 's' : ''} pendente
                {selected.count > 1 ? 's' : ''}
                {selected.phone ? ` · ${selected.phone}` : ''}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="text-right">
              <p className="text-xs text-muted-foreground">Total a receber</p>
              <p className="text-2xl font-bold text-destructive">{fmt(totalDue)}</p>
            </div>
            {selected.sales.length > 0 && (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  className="h-12"
                  onClick={() => { setStatementAction('pdf'); setStatementScope('all'); setStatementOpen(true); }}
                >
                  <FileText className="h-4 w-4 mr-1.5" />
                  Gerar Extrato PDF
                </Button>
                {selected.phone && (
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-400"
                    onClick={() => { setStatementAction('whatsapp'); setStatementScope('all'); setStatementOpen(true); }}
                  >
                    <MessageCircle className="h-4 w-4 mr-1.5" />
                    Enviar pelo WhatsApp
                  </Button>
                )}
              </>
            )}
            {canBatchSettle && selected.sales.length > 0 && (
              <Button size="lg" className="h-12" onClick={() => setBatchOpen(true)}>
                <DollarIcon className="h-4 w-4 mr-1.5" />
                Lançar pagamento
              </Button>
            )}
          </div>
        </div>


        {/* Table desktop / Cards mobile */}
        {isMobile ? (
          <div className="space-y-2">
            {[...selected.sales].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((s) => {
              const sum = saleItemsSummary(s.sale_items);
              return (
              <Card
                key={s.id}
                className={cn(isOverdue(s) && 'border-destructive/40 bg-destructive/5')}
              >
                <CardContent className="p-3 space-y-2">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-muted-foreground">
                        {new Date(s.created_at).toLocaleDateString('pt-BR')} · #{s.id.slice(0, 6)}
                      </p>
                      <p className="text-sm font-medium leading-tight line-clamp-2 break-words" title={sum.full}>
                        {sum.primary}
                      </p>
                      {sum.secondary && (
                        <p className="text-[11px] text-muted-foreground mt-0.5">{sum.secondary}</p>
                      )}
                    </div>
                    {statusBadge(s)}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs pt-1 border-t">
                    <div>
                      <p className="text-muted-foreground">Total</p>
                      <p className="font-medium">{fmt(s.net_total)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">Recebido</p>
                      <p className="font-medium text-emerald-600">{fmt(s.amount_paid)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">A receber</p>
                      <p className="font-bold text-destructive">{fmt(s.amount_pending)}</p>
                    </div>
                  </div>
                  {s.due_date && (
                    <p
                      className={cn(
                        'text-[11px]',
                        isOverdue(s) ? 'text-destructive font-medium' : 'text-muted-foreground',
                      )}
                    >
                      Vencimento: {new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR')}
                    </p>
                  )}
                </CardContent>
              </Card>
              );
            })}
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden">
            <TooltipProvider delayDuration={150}>
            <Table>
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs">Data</TableHead>
                  <TableHead className="text-xs">Descrição</TableHead>
                  <TableHead className="text-xs">Vencimento</TableHead>
                  <TableHead className="text-right text-xs">Total</TableHead>
                  <TableHead className="text-right text-xs">Recebido</TableHead>
                  <TableHead className="text-right text-xs">A receber</TableHead>
                  <TableHead className="text-center text-xs">Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...selected.sales].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((s) => {
                  const sum = saleItemsSummary(s.sale_items);
                  return (
                  <TableRow
                    key={s.id}
                    className={cn(isOverdue(s) && 'bg-destructive/5')}
                  >
                    <TableCell className="py-2.5 text-sm whitespace-nowrap">
                      {new Date(s.created_at).toLocaleDateString('pt-BR')}
                    </TableCell>
                    <TableCell className="py-2.5 text-sm max-w-[280px]">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="flex items-start gap-2 cursor-default">
                            <Package className="h-3.5 w-3.5 mt-0.5 text-muted-foreground shrink-0" />
                            <div className="min-w-0">
                              <p className="font-medium leading-tight line-clamp-2 break-words">{sum.primary}</p>
                              {sum.secondary && (
                                <p className="text-[11px] text-muted-foreground">{sum.secondary}</p>
                              )}
                              <p className="text-[10px] text-muted-foreground/70">#{s.id.slice(0, 6)}</p>
                            </div>
                          </div>
                        </TooltipTrigger>
                        <TooltipContent side="top" className="max-w-xs">
                          <p className="text-xs whitespace-pre-wrap">{sum.full || 'Sem itens'}</p>
                        </TooltipContent>
                      </Tooltip>
                    </TableCell>
                    <TableCell
                      className={cn(
                        'py-2.5 text-sm',
                        isOverdue(s) && 'text-destructive font-medium',
                      )}
                    >
                      {s.due_date
                        ? new Date(s.due_date + 'T00:00:00').toLocaleDateString('pt-BR')
                        : '—'}
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-sm">{fmt(s.net_total)}</TableCell>
                    <TableCell className="py-2.5 text-right text-sm text-emerald-600">
                      {fmt(s.amount_paid)}
                    </TableCell>
                    <TableCell className="py-2.5 text-right text-sm font-semibold">
                      {fmt(s.amount_pending)}
                    </TableCell>
                    <TableCell className="py-2.5 text-center">{statusBadge(s)}</TableCell>
                  </TableRow>
                  );
                })}
              </TableBody>
            </Table>

            </TooltipProvider>
          </div>
        )}

        {/* Resumo do cliente */}
        <div className="pt-3 border-t">
          <p className="text-xs font-medium text-muted-foreground mb-2">Resumo do cliente</p>
          <div className="grid grid-cols-3 gap-3">
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-[11px] text-muted-foreground">Total</p>
              <p className="text-base font-bold mt-0.5">{fmt(totalAmount)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-[11px] text-muted-foreground">Recebido</p>
              <p className="text-base font-bold mt-0.5 text-emerald-600">{fmt(totalPaid)}</p>
            </div>
            <div className="p-3 rounded-lg border bg-card">
              <p className="text-[11px] text-muted-foreground">A receber</p>
              <p className="text-base font-bold mt-0.5 text-destructive">{fmt(totalDue)}</p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Contas a Receber"
        description={`${filteredSales.length} venda(s) pendente(s)`}
      />

      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Wallet className="h-3.5 w-3.5" /> Total a receber
            </div>
            <p className="text-2xl font-bold mt-1">{fmt(totalPending)}</p>
          </CardContent>
        </Card>
        <Card className={overdueCount > 0 ? 'border-destructive/40 bg-destructive/5' : ''}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <AlertCircle className="h-3.5 w-3.5" /> Vencido
            </div>
            <p className="text-2xl font-bold mt-1 text-destructive">{fmt(totalOverdue)}</p>
            <p className="text-xs text-muted-foreground">{overdueCount} venda(s)</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <DollarSign className="h-3.5 w-3.5" /> Pendentes
            </div>
            <p className="text-2xl font-bold mt-1">{filteredSales.length}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <Button
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('all')}
        >
          Todas
        </Button>
        <Button
          variant={filter === 'overdue' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('overdue')}
        >
          Vencidas
        </Button>
        <Button
          variant={filter === 'upcoming' ? 'default' : 'outline'}
          size="sm"
          onClick={() => setFilter('upcoming')}
        >
          A vencer
        </Button>
        {canManageEmployees && (
          <EmployeeFilter value={sellerId} onChange={setSellerId} className="h-9 w-[200px]" />
        )}
        {isMobile && (
          <Sheet open={mobileListOpen} onOpenChange={setMobileListOpen}>
            <SheetTrigger asChild>
              <Button size="sm" variant="outline" className="ml-auto">
                <Users className="h-4 w-4 mr-1" /> Clientes
              </Button>
            </SheetTrigger>
            <SheetContent side="left" className="w-[85vw] sm:w-[380px] p-4">
              {renderCustomerList()}
            </SheetContent>
          </Sheet>
        )}
      </div>

      {/* Two column layout */}
      {loading && sales.length === 0 ? (
        <ShimmerList count={5} rowClassName="h-20 w-full" />
      ) : isMobile ? (
        <Card>
          <CardContent className="p-4">{renderDetails()}</CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[320px_1fr] gap-4">
          <Card>
            <CardContent className="p-3 h-[calc(100vh-340px)] min-h-[480px]">
              {renderCustomerList()}
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-5">{renderDetails()}</CardContent>
          </Card>
        </div>
      )}

      <BatchSettlePaymentDialog
        customerName={selected?.name || ''}
        sales={(selected?.sales || []).map((s) => ({
          id: s.id,
          created_at: s.created_at,
          due_date: s.due_date,
          amount_pending: Number(s.amount_pending),
          description: saleItemsSummary(s.sale_items).primary,
        }))}
        open={batchOpen}
        onOpenChange={setBatchOpen}
        onSettled={fetchData}
      />

      <Dialog open={statementOpen} onOpenChange={setStatementOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statementAction === 'whatsapp' ? 'Enviar extrato pelo WhatsApp' : 'Gerar Extrato PDF'}
            </DialogTitle>
            <DialogDescription>
              Escolha quais títulos incluir no extrato de {selected?.name || ''}.
            </DialogDescription>
          </DialogHeader>
          <RadioGroup value={statementScope} onValueChange={(v) => setStatementScope(v as any)} className="space-y-2">
            <div className="flex items-center gap-2 p-3 rounded-md border">
              <RadioGroupItem value="all" id="scope-all" />
              <Label htmlFor="scope-all" className="cursor-pointer flex-1">
                Todas as pendências
                <span className="block text-xs text-muted-foreground">
                  {selected?.sales.length || 0} título(s)
                </span>
              </Label>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-md border">
              <RadioGroupItem value="overdue" id="scope-overdue" />
              <Label htmlFor="scope-overdue" className="cursor-pointer flex-1">
                Apenas vencidas
                <span className="block text-xs text-muted-foreground">
                  {(selected?.sales || []).filter((s) => isOverdue(s)).length} título(s)
                </span>
              </Label>
            </div>
          </RadioGroup>
          <DialogFooter>
            <Button variant="outline" onClick={() => setStatementOpen(false)}>Cancelar</Button>
            <Button onClick={async () => {
              if (!selected) return;
              const list = (statementScope === 'overdue'
                ? selected.sales.filter((s) => isOverdue(s))
                : selected.sales
              ).slice().sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

              if (list.length === 0) {
                toast.error('Nenhum título para incluir no extrato.');
                return;
              }

              // Fetch store info
              let store: { name?: string | null; phone?: string | null; address?: string | null } | null = null;
              if (profile?.store_id) {
                const { data } = await supabase
                  .from('stores')
                  .select('name, phone, whatsapp, address')
                  .eq('id', profile.store_id)
                  .maybeSingle();
                if (data) store = { name: data.name, phone: data.phone || data.whatsapp, address: data.address };
              }

              const sales: StatementSale[] = list.map((s) => ({
                id: s.id,
                created_at: s.created_at,
                due_date: s.due_date,
                net_total: Number(s.net_total),
                amount_paid: Number(s.amount_paid),
                amount_pending: Number(s.amount_pending),
                payment_status: s.payment_status,
                description: saleItemsSummary(s.sale_items).primary,
                overdue: !!isOverdue(s),
              }));

              const doc = generateCustomerStatementPDF({
                store,
                customer: { name: selected.name, phone: selected.phone },
                sales,
                onlyOverdue: statementScope === 'overdue',
              });

              const filename = statementFileName(selected.name);
              doc.save(filename);
              setStatementOpen(false);

              if (statementAction === 'whatsapp' && selected.phone) {
                const phoneDigits = selected.phone.replace(/\D/g, '');
                const intl = phoneDigits.startsWith('55') ? phoneDigits : `55${phoneDigits}`;
                const msg = `Olá, ${selected.name}.\n\nSegue em anexo o extrato atualizado das pendências registradas em nosso sistema.\n\nQualquer dúvida estamos à disposição.\n\nObrigado.`;
                window.open(`https://wa.me/${intl}?text=${encodeURIComponent(msg)}`, '_blank');
                toast.success('PDF gerado. Anexe no WhatsApp que abrimos.');
              } else {
                toast.success('Extrato gerado com sucesso.');
              }
            }}>
              {statementAction === 'whatsapp' ? 'Gerar e abrir WhatsApp' : 'Gerar PDF'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
