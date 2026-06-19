import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import { Plus, Trash2, RotateCcw, Package, Loader2, CreditCard, Banknote, ArrowLeftRight, Search, ShoppingCart, Coins } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { logger } from '@/lib/logger';
import EmployeeFilter from '@/components/EmployeeFilter';
import { usePermissions } from '@/hooks/usePermissions';
import { CustomerSearch } from '@/components/CustomerSearch';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

interface Sale { id: string; created_at: string; net_total: number; customer_id: string | null; }
interface SaleItem { id: string; product_id: string; qty: number; unit_price: number; product_name?: string; }
interface ReturnItem { product_id: string; product_name: string; sale_item_id: string | null; qty: number; max_qty: number; restock: boolean; refund_amount: number; }
interface NewItem { product_id: string; name: string; qty: number; unit_price: number; }
interface ProductLite { id: string; name: string; sale_price: number; on_hand: number; }
interface ReturnRecord { id: string; sale_id: string | null; status: string; reason: string; notes: string | null; created_at: string; return_items: { qty: number; refund_amount: number; restock: boolean; product_id: string }[]; }

const REASONS = [
  { value: 'defect', label: 'Defeito' },
  { value: 'damaged', label: 'Danificado' },
  { value: 'wrong_item', label: 'Item errado' },
  { value: 'customer_regret', label: 'Arrependimento' },
  { value: 'other', label: 'Outro' },
];

const STATUS_MAP: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
  requested: { label: 'Solicitada', variant: 'outline' },
  approved: { label: 'Aprovada', variant: 'default' },
  received: { label: 'Recebida', variant: 'secondary' },
  rejected: { label: 'Rejeitada', variant: 'destructive' },
  closed: { label: 'Fechada', variant: 'secondary' },
};

const FRIENDLY_ERRORS: Record<string, string> = {
  estoque_insuficiente: 'Estoque insuficiente para o novo produto.',
  produto_invalido: 'Produto não encontrado ou inativo.',
  qty_invalida: 'Quantidade inválida.',
  store_invalida: 'Loja inválida.',
  sem_permissao_para_troca: 'Você não tem permissão para registrar trocas.',
  sem_permissao_para_vender: 'Você não tem permissão para vender (necessário para trocas).',
  sem_permissao: 'Você não tem permissão para esta ação.',
  perfil_nao_encontrado: 'Perfil não encontrado. Faça login novamente.',
  usuario_inativo: 'Usuário inativo. Contate o administrador.',
  venda_nao_encontrada: 'Venda não encontrada.',
  cliente_obrigatorio_para_troca: 'Selecione o cliente da troca.',
  cliente_obrigatorio_para_credito: 'Selecione o cliente para gerar o crédito.',
  sem_item_devolvido: 'Selecione o produto que está sendo devolvido.',
  sem_itens_novos: 'Selecione o novo produto.',
  sem_itens: 'Adicione pelo menos um item.',
  valor_invalido: 'Valor inválido.',
  sem_divida_pendente: 'Este cliente não possui contas pendentes para abater.',
  cliente_obrigatorio_para_abatimento: 'Selecione o cliente para abater em dívida.',
};

function resolveFriendlyError(msg: string): string {
  if (!msg) return 'Erro ao registrar a operação.';
  for (const [key, friendly] of Object.entries(FRIENDLY_ERRORS)) {
    if (msg.includes(key)) return friendly;
  }
  return msg;
}

interface DebtRow {
  id: string;
  sale_date: string | null;
  due_date: string | null;
  net_total: number;
  amount_paid: number;
  amount_pending: number;
}

export default function Returns() {
  const { profile, session } = useAuth();
  const { canManageEmployees } = usePermissions();
  const isMobile = useIsMobile();
  const storeId = profile?.store_id;

  const [returns, setReturns] = useState<ReturnRecord[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);

  // operação
  const [operation, setOperation] = useState<'devolucao' | 'troca'>('devolucao');
  const [isAvulsa, setIsAvulsa] = useState(false);
  const [reason, setReason] = useState('defect');
  const [notes, setNotes] = useState('');

  // venda de origem (quando não avulsa)
  const [selectedSaleId, setSelectedSaleId] = useState('');
  const [saleItems, setSaleItems] = useState<SaleItem[]>([]);
  const [saleCustomerId, setSaleCustomerId] = useState<string | null>(null);
  const [manualCustomerId, setManualCustomerId] = useState<string | null>(null);

  // itens devolvidos
  const [items, setItems] = useState<ReturnItem[]>([]);
  const [refundMode, setRefundMode] = useState<'credit' | 'cash' | 'abatimento'>('credit');
  // Abatimento em dívida pendente
  const [debts, setDebts] = useState<DebtRow[]>([]);
  const [debtsLoading, setDebtsLoading] = useState(false);
  const [debtMode, setDebtMode] = useState<'oldest' | 'manual'>('oldest');
  const [targetSaleId, setTargetSaleId] = useState<string>('');

  // busca de produto devolvido (avulsa)
  const [retQuery, setRetQuery] = useState('');
  const [retResults, setRetResults] = useState<ProductLite[]>([]);

  // novos itens (troca)
  const [newItems, setNewItems] = useState<NewItem[]>([]);
  const [prodQuery, setProdQuery] = useState('');
  const [prodResults, setProdResults] = useState<ProductLite[]>([]);
  const [diffPayMethod, setDiffPayMethod] = useState('pix');
  const [surplusMode, setSurplusMode] = useState<'credit' | 'cash'>('credit');

  const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString('pt-BR') : '—');
  const effectiveCustomerId = isAvulsa ? manualCustomerId : (saleCustomerId || manualCustomerId);

  // Carrega as contas pendentes do cliente quando a opção "abater em dívida" estiver ativa
  useEffect(() => {
    let cancelled = false;
    if (refundMode !== 'abatimento' || !effectiveCustomerId || !storeId) {
      setDebts([]);
      return;
    }
    setDebtsLoading(true);
    (async () => {
      const { data, error } = await supabase
        .from('sales')
        .select('id, sale_date, due_date, net_total, amount_paid, amount_pending')
        .eq('store_id', storeId)
        .eq('customer_id', effectiveCustomerId)
        .gt('amount_pending', 0)
        .in('payment_status', ['pending', 'partial'])
        .is('deleted_at', null)
        .order('due_date', { ascending: true, nullsFirst: true })
        .order('sale_date', { ascending: true });
      if (cancelled) return;
      if (error) { setDebts([]); } else { setDebts((data as any as DebtRow[]) || []); }
      setDebtsLoading(false);
    })();
    return () => { cancelled = true; };
  }, [refundMode, effectiveCustomerId, storeId, dialogOpen]);

  // Dívida selecionada para abatimento (manual) ou a mais antiga (automático)
  const targetDebt = debtMode === 'manual'
    ? debts.find((d) => d.id === targetSaleId) || null
    : (debts[0] || null);
  const abatimentoSurplus = refundMode === 'abatimento' && targetDebt
    ? Math.max(0, items.reduce((s, i) => s + i.refund_amount * i.qty, 0) - targetDebt.amount_pending)
    : 0;

  const loadReturns = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      let q = supabase
        .from('returns')
        .select('id, sale_id, status, reason, notes, created_at, return_items(qty, refund_amount, restock, product_id)')
        .eq('store_id', storeId);
      if (sellerId) q = q.eq('created_by', sellerId);
      const { data, error } = await q.order('created_at', { ascending: false }).limit(50);
      if (error) { logger.error('Returns.loadReturns', error); toast.error('Erro ao carregar devoluções.'); }
      setReturns((data as any) || []);
    } finally {
      setLoading(false);
    }
  }, [storeId, sellerId]);

  useEffect(() => {
    if (!storeId) return;
    loadReturns();
    supabase.from('sales').select('id, created_at, net_total, customer_id')
      .eq('store_id', storeId).eq('status', 'paid').is('deleted_at', null)
      .order('created_at', { ascending: false }).limit(100)
      .then(({ data }) => setSales(data || []));
  }, [storeId, loadReturns]);

  // Busca de produto (reutilizada para devolvido-avulso e novo)
  const searchProducts = async (term: string): Promise<ProductLite[]> => {
    if (!storeId || !term.trim()) return [];
    const safe = term.trim().replace(/[%,]/g, ' ');
    const { data } = await supabase.from('products')
      .select('id, name, sale_price, on_hand')
      .eq('store_id', storeId).eq('is_active', true)
      .or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,barcode.ilike.%${safe}%`)
      .limit(8);
    return (data as any) || [];
  };

  const debouncedRet = useDebouncedValue(retQuery, 250);
  useEffect(() => {
    if (!isAvulsa || !debouncedRet.trim()) { setRetResults([]); return; }
    let cancel = false;
    searchProducts(debouncedRet).then(r => { if (!cancel) setRetResults(r); });
    return () => { cancel = true; };
  }, [debouncedRet, isAvulsa, storeId]);

  const debouncedProd = useDebouncedValue(prodQuery, 250);
  useEffect(() => {
    if (operation !== 'troca' || !debouncedProd.trim()) { setProdResults([]); return; }
    let cancel = false;
    searchProducts(debouncedProd).then(r => { if (!cancel) setProdResults(r); });
    return () => { cancel = true; };
  }, [debouncedProd, operation, storeId]);

  const onSelectSale = async (saleId: string) => {
    setSelectedSaleId(saleId); setItems([]);
    const sale = sales.find(s => s.id === saleId);
    setSaleCustomerId(sale?.customer_id || null);
    if (!saleId) { setSaleItems([]); return; }
    const { data } = await supabase.from('sale_items')
      .select('id, product_id, qty, unit_price, products(name)')
      .eq('sale_id', saleId) as any;
    setSaleItems((data || []).map((si: any) => ({
      id: si.id, product_id: si.product_id, qty: si.qty,
      unit_price: si.unit_price, product_name: si.products?.name || 'Produto',
    })));
  };

  const addItemFromSale = (si: SaleItem) => {
    if (items.find(i => i.product_id === si.product_id)) return;
    setItems([...items, { product_id: si.product_id, product_name: si.product_name || '', sale_item_id: si.id, qty: 1, max_qty: si.qty, restock: true, refund_amount: si.unit_price }]);
  };
  const addReturnedProduct = (p: ProductLite) => {
    if (items.find(i => i.product_id === p.id)) return;
    setItems([...items, { product_id: p.id, product_name: p.name, sale_item_id: null, qty: 1, max_qty: 9999, restock: true, refund_amount: Number(p.sale_price) || 0 }]);
    setRetQuery(''); setRetResults([]);
  };
  const updateItem = (idx: number, updates: Partial<ReturnItem>) => {
    const copy = [...items]; copy[idx] = { ...copy[idx], ...updates }; setItems(copy);
  };
  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const addNewItem = (p: ProductLite) => {
    if (newItems.find(i => i.product_id === p.id)) return;
    setNewItems([...newItems, { product_id: p.id, name: p.name, qty: 1, unit_price: Number(p.sale_price) || 0 }]);
    setProdQuery(''); setProdResults([]);
  };
  const updateNewItem = (idx: number, patch: Partial<NewItem>) => {
    const copy = [...newItems]; copy[idx] = { ...copy[idx], ...patch }; setNewItems(copy);
  };
  const removeNewItem = (idx: number) => setNewItems(newItems.filter((_, i) => i !== idx));

  const totalReturn = items.reduce((s, i) => s + i.refund_amount * i.qty, 0);
  const newTotal = newItems.reduce((s, i) => s + i.unit_price * i.qty, 0);
  const difference = newTotal - totalReturn; // >0 cliente paga | <0 sobra p/ cliente

  const resetForm = () => {
    setOperation('devolucao'); setIsAvulsa(false); setReason('defect'); setNotes('');
    setSelectedSaleId(''); setSaleItems([]); setSaleCustomerId(null); setManualCustomerId(null);
    setItems([]); setRefundMode('credit');
    setDebts([]); setDebtMode('oldest'); setTargetSaleId('');
    setRetQuery(''); setRetResults([]);
    setNewItems([]); setProdQuery(''); setProdResults([]); setDiffPayMethod('pix'); setSurplusMode('credit');
  };

  const failWith = (err: any, ctx: string) => {
    // Mostra o erro REAL no console e um toast claro
    console.error(`[Trocas/${ctx}]`, err);
    logger.error(`Returns.${ctx}`, err);
    toast.error(resolveFriendlyError(err?.message || err?.error_description || err?.code || ''));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (operation === 'troca') { handleExchange(); return; }

    // ---- DEVOLUÇÃO ----
    if (!session?.access_token || !storeId) { toast.error('Sessão expirada. Faça login novamente.'); return; }
    if (items.length === 0) { toast.error('Adicione pelo menos um item para devolver.'); return; }
    for (const it of items) {
      if (it.qty <= 0 || it.qty > it.max_qty) { toast.error(`Quantidade inválida para ${it.product_name}.`); return; }
      if (!Number.isFinite(it.refund_amount) || it.refund_amount < 0) { toast.error(`Valor inválido para ${it.product_name}.`); return; }
    }
    if (!reason) { toast.error('Selecione o motivo.'); return; }
    if (refundMode === 'credit' && !effectiveCustomerId) { toast.error('Para gerar crédito, selecione o cliente.'); return; }
    if (refundMode === 'abatimento') {
      if (!effectiveCustomerId) { toast.error('Selecione o cliente para abater em dívida.'); return; }
      if (debts.length === 0) { toast.error('Este cliente não possui contas pendentes para abater.'); return; }
      if (debtMode === 'manual' && !targetSaleId) { toast.error('Selecione qual dívida será abatida.'); return; }
    }

    setSubmitting(true);
    const payload: Record<string, any> = {
      p_store_id: storeId,
      p_sale_id: isAvulsa ? null : (selectedSaleId || null),
      p_customer_id: effectiveCustomerId,
      p_reason: reason,
      p_items: items.map(i => ({ product_id: i.product_id, sale_item_id: i.sale_item_id, qty: i.qty, restock: i.restock, refund_amount: i.refund_amount * i.qty })),
      p_notes: notes || null,
      p_refund_mode: refundMode,
    };
    if (refundMode === 'abatimento') {
      payload.p_target_sale_id = debtMode === 'manual' ? targetSaleId : null;
      payload.p_surplus_mode = surplusMode;
    }
    logger.group('process_return_with_credit', { payload });
    try {
      const { error } = await supabase.rpc('process_return_with_credit' as any, payload as any);
      if (error) { failWith(error, 'devolucao'); return; }
      toast.success(
        refundMode === 'credit' ? 'Devolução registrada! Crédito gerado para o cliente.'
        : refundMode === 'abatimento' ? (abatimentoSurplus > 0
            ? `Devolução abatida na dívida! Sobra de ${fmt(abatimentoSurplus)} ${surplusMode === 'cash' ? 'devolvida em dinheiro' : 'virou crédito'}.`
            : 'Devolução usada para abater a dívida do cliente!')
        : 'Devolução registrada com sucesso!');
      setDialogOpen(false); resetForm(); loadReturns();
    } catch (err: any) {
      failWith(err, 'devolucao');
    } finally {
      setSubmitting(false);
    }
  };

  const handleExchange = async () => {
    if (!session?.access_token || !storeId) { toast.error('Sessão expirada. Faça login novamente.'); return; }
    if (!effectiveCustomerId) { toast.error('Selecione o cliente da troca.'); return; }
    if (items.length === 0) { toast.error('Selecione o produto que o cliente está devolvendo.'); return; }
    if (newItems.length === 0) { toast.error('Selecione o novo produto.'); return; }
    for (const it of items) {
      if (it.qty <= 0 || it.qty > it.max_qty) { toast.error(`Quantidade inválida para ${it.product_name}.`); return; }
    }
    setSubmitting(true);
    const payload = {
      p_store_id: storeId,
      p_sale_id: isAvulsa ? null : (selectedSaleId || null),
      p_customer_id: effectiveCustomerId,
      p_reason: reason,
      p_return_items: items.map(i => ({ product_id: i.product_id, sale_item_id: i.sale_item_id, qty: i.qty, restock: i.restock, refund_amount: i.refund_amount * i.qty })),
      p_new_items: newItems.map(i => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price })),
      p_payments: difference > 0 ? [{ method: diffPayMethod, amount: Number(difference.toFixed(2)) }] : [],
      p_notes: notes || 'Troca',
      p_surplus_mode: surplusMode,
      p_is_avulsa: isAvulsa,
    };
    logger.group('process_exchange_atomic', { payload });
    try {
      const { error } = await supabase.rpc('process_exchange_atomic' as any, payload as any);
      if (error) { failWith(error, 'troca'); return; }
      toast.success(
        difference > 0 ? `Troca registrada! Diferença a pagar: ${fmt(difference)}`
        : difference < 0 ? (surplusMode === 'cash' ? `Troca registrada! Troco de ${fmt(-difference)}.` : `Troca registrada! ${fmt(-difference)} viraram crédito.`)
        : 'Troca registrada com sucesso!'
      );
      setDialogOpen(false); resetForm(); loadReturns();
    } catch (err: any) {
      failWith(err, 'troca');
    } finally {
      setSubmitting(false);
    }
  };

  const showCustomerPicker = ((operation === 'devolucao' && (refundMode === 'credit' || refundMode === 'abatimento')) || operation === 'troca');

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Trocas & Devoluções</h1>
          <p className="text-sm text-muted-foreground">Devoluções com crédito e trocas (com ou sem venda)</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canManageEmployees && (
            <EmployeeFilter value={sellerId} onChange={setSellerId} className="h-9 w-[200px]" />
          )}
          <Dialog open={dialogOpen} onOpenChange={(open) => { setDialogOpen(open); if (!open) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size={isMobile ? 'sm' : 'default'}><Plus className="mr-1 h-4 w-4" /> {isMobile ? 'Nova' : 'Nova operação'}</Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
              <DialogHeader><DialogTitle>{operation === 'troca' ? 'Registrar Troca' : 'Registrar Devolução'}</DialogTitle></DialogHeader>
              <div className="space-y-4 pt-2">
                {/* Tipo de operação */}
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setOperation('devolucao')}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition ${operation === 'devolucao' ? 'border-primary bg-primary/5 ring-1 ring-primary text-primary' : 'hover:bg-accent'}`}>
                    <RotateCcw className="h-4 w-4" /> Devolução
                  </button>
                  <button type="button" onClick={() => setOperation('troca')}
                    className={`flex items-center justify-center gap-2 rounded-lg border p-2.5 text-sm font-medium transition ${operation === 'troca' ? 'border-primary bg-primary/5 ring-1 ring-primary text-primary' : 'hover:bg-accent'}`}>
                    <ArrowLeftRight className="h-4 w-4" /> Troca
                  </button>
                </div>

                {/* Avulsa */}
                <label className="flex items-center gap-2 rounded-lg border p-2.5 text-sm cursor-pointer">
                  <Checkbox checked={isAvulsa} onCheckedChange={(v) => { setIsAvulsa(!!v); setSelectedSaleId(''); setSaleItems([]); setSaleCustomerId(null); setItems([]); }} />
                  <span className="font-medium">Sem venda vinculada (avulsa)</span>
                  <span className="text-[11px] text-muted-foreground">— cliente não tem a nota/venda</span>
                </label>

                <div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
                  {!isAvulsa && (
                    <div className="space-y-2"><Label>Venda</Label>
                      <Select value={selectedSaleId} onValueChange={onSelectSale}>
                        <SelectTrigger className="h-11"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                        <SelectContent>{sales.map(s => <SelectItem key={s.id} value={s.id}>{new Date(s.created_at).toLocaleDateString('pt-BR')} — {fmt(s.net_total)}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  )}
                  <div className="space-y-2"><Label>Motivo *</Label>
                    <Select value={reason} onValueChange={setReason}>
                      <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                      <SelectContent>{REASONS.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                </div>

                {operation === 'devolucao' && (
                  <div className="space-y-2">
                    <Label>O que fazer com o valor?</Label>
                    <div className="grid grid-cols-3 gap-2">
                      <button type="button" onClick={() => setRefundMode('credit')}
                        className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition ${refundMode === 'credit' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                        <CreditCard className="h-4 w-4 text-primary shrink-0" />
                        <div className="text-xs font-medium leading-tight">Crédito ao cliente</div>
                        <div className="text-[10px] text-muted-foreground leading-tight">Vira saldo pra usar depois</div>
                      </button>
                      <button type="button" onClick={() => setRefundMode('cash')}
                        className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition ${refundMode === 'cash' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                        <Banknote className="h-4 w-4 shrink-0" />
                        <div className="text-xs font-medium leading-tight">Dinheiro</div>
                        <div className="text-[10px] text-muted-foreground leading-tight">Saída do caixa</div>
                      </button>
                      <button type="button" onClick={() => setRefundMode('abatimento')}
                        className={`flex flex-col gap-1 rounded-lg border p-2.5 text-left transition ${refundMode === 'abatimento' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                        <Coins className="h-4 w-4 shrink-0" />
                        <div className="text-xs font-medium leading-tight">Abater em dívida</div>
                        <div className="text-[10px] text-muted-foreground leading-tight">Quita conta pendente</div>
                      </button>
                    </div>

                    {refundMode === 'abatimento' && (
                      <div className="rounded-lg border bg-muted/30 p-3 space-y-3">
                        {!effectiveCustomerId ? (
                          <p className="text-xs text-muted-foreground">Selecione o cliente abaixo para ver as contas pendentes.</p>
                        ) : debtsLoading ? (
                          <p className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="h-3 w-3 animate-spin" /> Carregando contas pendentes...</p>
                        ) : debts.length === 0 ? (
                          <p className="text-xs text-amber-600">Este cliente não possui contas pendentes. Escolha Crédito ou Dinheiro.</p>
                        ) : (
                          <>
                            <div className="grid grid-cols-2 gap-2">
                              <button type="button" onClick={() => setDebtMode('oldest')}
                                className={`rounded-md border p-2 text-xs text-left transition ${debtMode === 'oldest' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                                Abater na mais antiga (automático)
                              </button>
                              <button type="button" onClick={() => setDebtMode('manual')}
                                className={`rounded-md border p-2 text-xs text-left transition ${debtMode === 'manual' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                                Escolher manualmente
                              </button>
                            </div>
                            <div className="space-y-1.5 max-h-44 overflow-y-auto">
                              {debts.map((d) => {
                                const selected = debtMode === 'manual' ? targetSaleId === d.id : targetDebt?.id === d.id;
                                return (
                                  <button key={d.id} type="button"
                                    onClick={() => { if (debtMode === 'manual') setTargetSaleId(d.id); }}
                                    className={`w-full rounded-md border p-2 text-left transition ${selected ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'} ${debtMode === 'oldest' ? 'cursor-default' : ''}`}>
                                    <div className="flex items-center justify-between text-xs">
                                      <span className="font-medium">Venda {fmtDate(d.sale_date)}{debtMode === 'oldest' && targetDebt?.id === d.id ? ' · será abatida' : ''}</span>
                                      <span className="font-semibold text-destructive">{fmt(d.amount_pending)}</span>
                                    </div>
                                    <div className="text-[10px] text-muted-foreground">
                                      Venc: {fmtDate(d.due_date)} · Total {fmt(d.net_total)} · Recebido {fmt(d.amount_paid)} · Restante {fmt(d.amount_pending)}
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            {abatimentoSurplus > 0 && (
                              <div className="space-y-1.5 border-t pt-2">
                                <Label className="text-xs">A devolução é maior que a dívida. Sobra de {fmt(abatimentoSurplus)}:</Label>
                                <div className="grid grid-cols-2 gap-2">
                                  <button type="button" onClick={() => setSurplusMode('credit')}
                                    className={`rounded-md border p-2 text-xs text-left transition ${surplusMode === 'credit' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>Gerar crédito</button>
                                  <button type="button" onClick={() => setSurplusMode('cash')}
                                    className={`rounded-md border p-2 text-xs text-left transition ${surplusMode === 'cash' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>Devolver troco</button>
                                </div>
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {showCustomerPicker && (
                  isAvulsa || !saleCustomerId ? (
                    storeId ? (
                      <div className="space-y-2">
                        <Label>Cliente *</Label>
                        <CustomerSearch storeId={storeId} value={manualCustomerId} onChange={(id) => setManualCustomerId(id)} allowNone={false} />
                      </div>
                    ) : null
                  ) : (
                    <p className="text-xs text-muted-foreground">✓ Cliente da venda selecionada.</p>
                  )
                )}

                {/* Seleção do produto devolvido */}
                {isAvulsa ? (
                  <div className="space-y-2">
                    <Label>Produto devolvido *</Label>
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input value={retQuery} onChange={e => setRetQuery(e.target.value)} placeholder="Buscar produto que o cliente trouxe..." className="h-10 pl-9" />
                      {retResults.length > 0 && (
                        <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-auto">
                          {retResults.map(p => (
                            <button key={p.id} type="button" onClick={() => addReturnedProduct(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2">
                              <span className="truncate">{p.name}</span>
                              <span className="text-xs text-muted-foreground shrink-0">{fmt(Number(p.sale_price))}</span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ) : (selectedSaleId && saleItems.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-3"><CardTitle className="text-sm">Itens da venda</CardTitle></CardHeader>
                    <CardContent className="px-3 pb-3 space-y-2">
                      {saleItems.filter(si => !items.find(i => i.product_id === si.product_id)).map(si => (
                        <div key={si.id} className="flex items-center justify-between rounded border p-2 text-sm">
                          <span className="truncate">{si.product_name} (x{si.qty}) · {fmt(si.unit_price)}</span>
                          <Button size="sm" variant="outline" onClick={() => addItemFromSale(si)}><Plus className="mr-1 h-3 w-3" /> Devolver</Button>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                ))}

                {/* Itens a devolver (produto antigo) */}
                {items.length > 0 && (
                  <Card>
                    <CardHeader className="py-3 px-3"><CardTitle className="text-sm flex items-center gap-1"><RotateCcw className="h-4 w-4" /> Produto devolvido</CardTitle></CardHeader>
                    <CardContent className="px-3 pb-3 space-y-3">
                      {items.map((item, idx) => (
                        <div key={item.product_id} className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium truncate">{item.product_name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{fmt(item.refund_amount * item.qty)}</span>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeItem(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </div>
                          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3">
                            <div className="space-y-1"><Label className="text-xs">Qtd{item.max_qty < 9999 ? ` (max ${item.max_qty})` : ''}</Label>
                              <Input type="number" min={1} max={item.max_qty} value={item.qty} onChange={e => updateItem(idx, { qty: Math.min(parseInt(e.target.value) || 1, item.max_qty) })} className="h-9" />
                            </div>
                            <div className="space-y-1"><Label className="text-xs">Valor unit.</Label>
                              <Input type="number" step="0.01" min={0} value={item.refund_amount} onChange={e => updateItem(idx, { refund_amount: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-9" />
                            </div>
                            <div className="flex items-end gap-2 pb-1 col-span-2 sm:col-span-1">
                              <Checkbox id={`restock-${idx}`} checked={item.restock} onCheckedChange={v => updateItem(idx, { restock: !!v })} />
                              <Label htmlFor={`restock-${idx}`} className="text-xs flex items-center gap-1"><Package className="h-3 w-3" /> Repor estoque</Label>
                            </div>
                          </div>
                        </div>
                      ))}
                      <div className="flex justify-between font-medium pt-2 border-t"><span>{operation === 'troca' ? 'Valor do produto devolvido' : 'Total'}</span><span>{fmt(totalReturn)}</span></div>
                    </CardContent>
                  </Card>
                )}

                {/* Novo produto (troca) */}
                {operation === 'troca' && (
                  <Card>
                    <CardHeader className="py-3 px-3"><CardTitle className="text-sm flex items-center gap-1"><ShoppingCart className="h-4 w-4" /> Produto novo (o que o cliente vai levar)</CardTitle></CardHeader>
                    <CardContent className="px-3 pb-3 space-y-3">
                      <div className="relative">
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input value={prodQuery} onChange={e => setProdQuery(e.target.value)} placeholder="Buscar produto por nome/código..." className="h-10 pl-9" />
                        {prodResults.length > 0 && (
                          <div className="absolute z-50 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-56 overflow-auto">
                            {prodResults.map(p => (
                              <button key={p.id} type="button" onClick={() => addNewItem(p)} className="w-full text-left px-3 py-2 text-sm hover:bg-accent flex items-center justify-between gap-2">
                                <span className="truncate">{p.name}</span>
                                <span className="text-xs text-muted-foreground shrink-0">{fmt(Number(p.sale_price))} · est {p.on_hand}</span>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {newItems.map((it, idx) => (
                        <div key={it.product_id} className="rounded-lg border p-3 space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-sm font-medium truncate">{it.name}</span>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-semibold">{fmt(it.unit_price * it.qty)}</span>
                              <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => removeNewItem(idx)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                            </div>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-1"><Label className="text-xs">Qtd</Label>
                              <Input type="number" min={1} value={it.qty} onChange={e => updateNewItem(idx, { qty: Math.max(1, parseInt(e.target.value) || 1) })} className="h-9" />
                            </div>
                            <div className="space-y-1"><Label className="text-xs">Valor unit.</Label>
                              <Input type="number" step="0.01" min={0} value={it.unit_price} onChange={e => updateNewItem(idx, { unit_price: Math.max(0, parseFloat(e.target.value) || 0) })} className="h-9" />
                            </div>
                          </div>
                        </div>
                      ))}

                      {newItems.length > 0 && (
                        <div className="rounded-lg bg-muted/40 p-3 space-y-1 text-sm">
                          <div className="flex justify-between"><span>Produto devolvido</span><span className="font-medium">{fmt(totalReturn)}</span></div>
                          <div className="flex justify-between"><span>Produto novo</span><span className="font-medium">{fmt(newTotal)}</span></div>
                          <div className="flex justify-between border-t pt-1 font-semibold text-base">
                            {difference > 0
                              ? <><span>Cliente paga</span><span className="text-orange-600">{fmt(difference)}</span></>
                              : difference < 0
                                ? <><span>Saldo do cliente</span><span className="text-green-600">{fmt(-difference)}</span></>
                                : <><span>Sem diferença</span><span className="text-green-600">{fmt(0)}</span></>}
                          </div>
                          {difference > 0 && (
                            <div className="pt-2 space-y-1">
                              <Label className="text-xs">Como o cliente paga a diferença?</Label>
                              <Select value={diffPayMethod} onValueChange={setDiffPayMethod}>
                                <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="pix">PIX</SelectItem>
                                  <SelectItem value="cash">Dinheiro</SelectItem>
                                  <SelectItem value="card">Cartão</SelectItem>
                                  <SelectItem value="pending">A prazo (fiado / contas a receber)</SelectItem>
                                </SelectContent>
                              </Select>
                            </div>
                          )}
                          {difference < 0 && (
                            <div className="pt-2 space-y-1">
                              <Label className="text-xs">O que fazer com o saldo a favor do cliente?</Label>
                              <div className="grid grid-cols-2 gap-2">
                                <button type="button" onClick={() => setSurplusMode('credit')}
                                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition ${surplusMode === 'credit' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                                  <CreditCard className="h-4 w-4 text-primary shrink-0" /><span className="text-xs font-medium">Gerar crédito</span>
                                </button>
                                <button type="button" onClick={() => setSurplusMode('cash')}
                                  className={`flex items-center gap-2 rounded-lg border p-2.5 text-left transition ${surplusMode === 'cash' ? 'border-primary bg-primary/5 ring-1 ring-primary' : 'hover:bg-accent'}`}>
                                  <Coins className="h-4 w-4 shrink-0" /><span className="text-xs font-medium">Devolver troco</span>
                                </button>
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                )}

                <div className="space-y-2"><Label>Observações{isAvulsa ? ' *' : ''}</Label><Textarea value={notes} onChange={e => setNotes(e.target.value)} placeholder={isAvulsa ? 'Descreva a peça/situação (recomendado em troca avulsa)' : 'Opcional...'} /></div>
                <Button className="w-full h-11" onClick={handleSubmit} disabled={submitting || items.length === 0 || (operation === 'troca' && newItems.length === 0)}>
                  {submitting ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Registrando...</> : operation === 'troca' ? 'Registrar Troca' : 'Registrar Devolução'}
                </Button>
              </div>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Lista */}
      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-20 w-full rounded-lg" />)}</div>
      ) : isMobile ? (
        <div className="space-y-3">
          {returns.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground"><RotateCcw className="mx-auto h-10 w-10 mb-2 opacity-50" />Nenhuma operação</div>
          ) : returns.map(r => {
            const status = STATUS_MAP[r.status] || { label: r.status, variant: 'outline' as const };
            const refund = r.return_items?.reduce((s, i) => s + i.refund_amount, 0) || 0;
            const totalQty = r.return_items?.reduce((s, i) => s + i.qty, 0) || 0;
            return (
              <Card key={r.id}>
                <CardContent className="p-3">
                  <div className="flex items-start justify-between">
                    <div>
                      <p className="text-sm font-medium">{REASONS.find(rr => rr.value === r.reason)?.label || r.reason}</p>
                      <p className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString('pt-BR')} • {totalQty} item(s)</p>
                    </div>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </div>
                  <div className="mt-2 pt-2 border-t"><span className="text-sm font-semibold">{fmt(refund)}</span></div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Motivo</TableHead><TableHead>Itens</TableHead><TableHead>Valor</TableHead><TableHead>Status</TableHead></TableRow></TableHeader>
              <TableBody>
                {returns.length === 0 ? (
                  <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground"><RotateCcw className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhuma operação</TableCell></TableRow>
                ) : returns.map(r => {
                  const status = STATUS_MAP[r.status] || { label: r.status, variant: 'outline' as const };
                  const refund = r.return_items?.reduce((s, i) => s + i.refund_amount, 0) || 0;
                  const totalQty = r.return_items?.reduce((s, i) => s + i.qty, 0) || 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell>{new Date(r.created_at).toLocaleDateString('pt-BR')}</TableCell>
                      <TableCell>{REASONS.find(rr => rr.value === r.reason)?.label || r.reason}</TableCell>
                      <TableCell>{totalQty} item(s)</TableCell>
                      <TableCell>{fmt(refund)}</TableCell>
                      <TableCell><Badge variant={status.variant}>{status.label}</Badge></TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
