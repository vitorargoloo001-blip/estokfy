import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Separator } from '@/components/ui/separator';
import { CalendarIcon, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { SearchableSelect } from '@/components/ui/searchable-select';

interface EditSaleDialogProps {
  saleId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

const METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit_card', label: 'Cartão Crédito' },
  { value: 'debit_card', label: 'Cartão Débito' },
  { value: 'transfer', label: 'Transferência' },
];

// "partial" foi removido do editor: parciais devem ser tratados via
// fluxo "Receber pagamento" (SettlePaymentDialog), evitando inconsistências
// de amount_paid/amount_pending sem coleta dos valores reais.
const PAY_STATUS = [
  { value: 'paid', label: 'Pago' },
  { value: 'pending', label: 'Pendente (a prazo)' },
];

const fmt = (v: number) => (Number.isFinite(v) ? v : 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

interface ItemRow {
  product_id: string;
  qty: number;
  unit_price: number;
  product_name?: string;
  on_hand?: number;
}

export default function EditSaleDialog({ saleId, open, onOpenChange, onSaved }: EditSaleDialogProps) {
  const { profile } = useAuth();
  const role = profile?.role || '';
  const canEdit = ['owner', 'admin', 'manager'].includes(role);
  const canForceNegative = ['owner', 'admin'].includes(role);

  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [origSale, setOrigSale] = useState<any | null>(null);
  const [origItems, setOrigItems] = useState<ItemRow[]>([]);
  const [customers, setCustomers] = useState<any[]>([]);
  const [products, setProducts] = useState<any[]>([]);

  // editable state
  const [customerId, setCustomerId] = useState<string>('');
  const [createdAt, setCreatedAt] = useState<Date>(new Date());
  const [discount, setDiscount] = useState(0);
  const [shipping, setShipping] = useState(0);
  const [notes, setNotes] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('pix');
  const [paymentStatus, setPaymentStatus] = useState('paid');
  const [items, setItems] = useState<ItemRow[]>([]);
  const [reason, setReason] = useState('');

  const [showConfirm, setShowConfirm] = useState(false);
  const [allowNegative, setAllowNegative] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);

  useEffect(() => {
    if (!open || !saleId || !profile) return;
    setLoading(true);
    setReason('');
    setShowConfirm(false);
    setAllowNegative(false);
    setConfirmRevert(false);

    // Carrega produtos com paginação para suportar lojas grandes (>2000 itens)
    const loadAllProducts = async () => {
      const PAGE = 1000;
      const all: any[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('products')
          .select('id, name, sku, on_hand, sale_price')
          .eq('store_id', profile.store_id)
          .eq('is_active', true)
          .order('name')
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (!data || data.length === 0) break;
        all.push(...data);
        if (data.length < PAGE) break;
        if (all.length > 20000) break; // safety
      }
      return all;
    };

    Promise.all([
      supabase.from('sales').select('*').eq('id', saleId).maybeSingle(),
      supabase.from('sale_items').select('*, products(name, on_hand)').eq('sale_id', saleId),
      // V1: pega o ÚLTIMO pagamento (mais recente), não o primeiro
      supabase.from('payments').select('method').eq('sale_id', saleId).order('paid_at', { ascending: false }).limit(1),
      supabase.from('customers').select('id, name').eq('store_id', profile.store_id).order('name'),
      loadAllProducts(),
    ]).then(([s, si, pm, cs, prAll]) => {
      const sale = s.data as any;
      setOrigSale(sale);
      const oItems: ItemRow[] = (si.data || []).map((r: any) => ({
        product_id: r.product_id, qty: r.qty, unit_price: Number(r.unit_price),
        product_name: r.products?.name, on_hand: r.products?.on_hand,
      }));
      setOrigItems(oItems);
      setItems(oItems.map(i => ({ ...i })));
      setCustomers(cs.data || []);
      setProducts(prAll || []);
      if (sale) {
        setCustomerId(sale.customer_id || '');
        setCreatedAt(new Date(sale.created_at));
        setDiscount(Number(sale.discount_total) || 0);
        setShipping(Number(sale.shipping_fee) || 0);
        setNotes(sale.notes || '');
        // V4: se a venda estava 'partial', tratamos como 'pending' no editor
        const ps = sale.payment_status || 'paid';
        setPaymentStatus(ps === 'partial' ? 'pending' : ps);
        setPaymentMethod(pm.data?.[0]?.method || 'pix');
      }
      setLoading(false);
    }).catch((err) => {
      console.error('[EditSaleDialog] load error', err);
      toast.error('Erro ao carregar a venda: ' + (err?.message || 'desconhecido'));
      setLoading(false);
    });
  }, [open, saleId, profile]);

  const subtotal = useMemo(() => items.reduce((s, i) => s + (Number(i.unit_price) || 0) * (Number(i.qty) || 0), 0), [items]);
  const total = Math.max(0, subtotal - (Number(discount) || 0) + (Number(shipping) || 0));

  const updateItem = (idx: number, patch: Partial<ItemRow>) => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, ...patch } : it));
  };
  const removeItem = (idx: number) => setItems(prev => prev.filter((_, i) => i !== idx));
  const addItem = () => setItems(prev => [...prev, { product_id: '', qty: 1, unit_price: 0 }]);
  const onSelectProduct = (idx: number, productId: string) => {
    const p = products.find(x => x.id === productId);
    updateItem(idx, {
      product_id: productId,
      product_name: p?.name,
      on_hand: p?.on_hand,
      unit_price: items[idx].unit_price || Number(p?.sale_price) || 0,
    });
  };

  // Detect stock issues with new items considering reverted old items
  const stockWarnings = useMemo(() => {
    const warnings: string[] = [];
    const oldByProd: Record<string, number> = {};
    origItems.forEach(i => { oldByProd[i.product_id] = (oldByProd[i.product_id] || 0) + i.qty; });
    items.forEach(it => {
      if (!it.product_id) return;
      const p = products.find(x => x.id === it.product_id);
      if (!p) return;
      const effective = (p.on_hand || 0) + (oldByProd[it.product_id] || 0) - it.qty;
      if (effective < 0) warnings.push(`${p.name}: saldo ficaria ${effective}`);
    });
    return warnings;
  }, [items, origItems, products]);

  const wasPaid = origSale?.payment_status === 'paid';
  const willRevertPayment = wasPaid && paymentStatus !== 'paid';

  const validate = (): string | null => {
    if (!canEdit) return 'Sem permissão para editar vendas';
    if (!reason.trim() || reason.trim().length < 3) return 'Informe o motivo da edição (mín. 3 caracteres)';
    if (items.length === 0) return 'A venda precisa ter ao menos um item';
    for (const it of items) {
      if (!it.product_id) return 'Selecione o produto em todos os itens';
      if (!it.qty || it.qty <= 0) return 'Quantidade deve ser maior que zero';
      if (it.unit_price < 0) return 'Preço unitário não pode ser negativo';
    }
    if (total < 0) return 'Total não pode ser negativo';
    return null;
  };

  const openConfirm = () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setShowConfirm(true);
  };

  const handleSave = async () => {
    if (!saleId) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('edit_sale_atomic', {
        p_sale_id: saleId,
        p_reason: reason.trim(),
        p_customer_id: customerId || null,
        p_created_at: createdAt.toISOString(),
        p_discount_total: Number(discount) || 0,
        p_shipping_fee: Number(shipping) || 0,
        p_notes: notes.trim() || null,
        p_payment_method: paymentMethod,
        p_payment_status: paymentStatus,
        p_items: items.map(i => ({
          product_id: i.product_id,
          qty: Number(i.qty),
          unit_price: Number(i.unit_price),
        })) as any,
        p_allow_negative_stock: allowNegative,
        p_confirm_revert_payment: confirmRevert || !willRevertPayment,
      });
      if (error) throw error;
      const res = data as any;
      toast.success('Venda atualizada com sucesso');
      if (res?.loyalty_blocked) {
        toast.message('Fidelidade não recalculada', { description: 'O crédito gerado por esta venda já foi utilizado.' });
      }
      onOpenChange(false);
      onSaved?.();
    } catch (err: any) {
      const msg = err?.message || 'Erro ao salvar edição';
      if (msg.includes('CONFIRM_REVERT_PAYMENT_REQUIRED')) {
        toast.error('Confirme o estorno do pagamento para prosseguir');
        setConfirmRevert(false);
      } else if (msg.includes('Estoque insuficiente')) {
        toast.error(msg);
      } else {
        toast.error(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!canEdit && open) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Sem permissão</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">Apenas owner, admin ou manager podem editar vendas.</p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Editar venda</DialogTitle>
          <DialogDescription>
            {saleId ? `ID: ${saleId.slice(0, 8)}…` : ''}
            {origSale && ` • Original: ${fmt(Number(origSale.net_total))}`}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Carregando...</p>
        ) : showConfirm ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/30 p-4 space-y-2">
              <h3 className="text-sm font-semibold">Resumo da edição</h3>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span>Total:</span>
                  <span><span className="text-muted-foreground line-through mr-2">{fmt(Number(origSale?.net_total) || 0)}</span><b>{fmt(total)}</b></span>
                </div>
                <div className="flex justify-between"><span>Status pagamento:</span>
                  <span><span className="text-muted-foreground line-through mr-2">{origSale?.payment_status}</span><b>{paymentStatus}</b></span>
                </div>
                <div className="flex justify-between"><span>Itens:</span>
                  <span><span className="text-muted-foreground line-through mr-2">{origItems.length}</span><b>{items.length}</b></span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground pt-2">Estoque, financeiro e relatórios serão atualizados.</p>
            </div>

            {willRevertPayment && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold text-destructive">Atenção: estorno de pagamento</p>
                    <p className="text-xs text-muted-foreground">A venda estava paga. Será criado um lançamento de saída no caixa para estornar {fmt(Number(origSale?.amount_paid) || Number(origSale?.net_total) || 0)}.</p>
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={confirmRevert} onChange={e => setConfirmRevert(e.target.checked)} />
                  Confirmo o estorno do pagamento
                </label>
              </div>
            )}

            {stockWarnings.length > 0 && (
              <div className="rounded-lg border border-amber-300 bg-amber-50 dark:bg-amber-950/20 p-3 space-y-2">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
                  <div className="text-sm">
                    <p className="font-semibold text-amber-800 dark:text-amber-300">Estoque ficará negativo</p>
                    <ul className="text-xs text-amber-700 dark:text-amber-400 list-disc pl-4">
                      {stockWarnings.map((w, i) => <li key={i}>{w}</li>)}
                    </ul>
                  </div>
                </div>
                {canForceNegative ? (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={allowNegative} onChange={e => setAllowNegative(e.target.checked)} />
                    Permitir estoque negativo (somente owner/admin)
                  </label>
                ) : (
                  <p className="text-xs text-destructive">Sem permissão para confirmar estoque negativo. Solicite a um owner/admin.</p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => setShowConfirm(false)} disabled={submitting}>Voltar</Button>
              <Button
                className="flex-1"
                onClick={handleSave}
                disabled={submitting
                  || (willRevertPayment && !confirmRevert)
                  || (stockWarnings.length > 0 && (!canForceNegative || !allowNegative))}
              >
                {submitting ? 'Salvando...' : 'Confirmar edição'}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Seção 1 — Dados */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Dados da venda</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Cliente</Label>
                  <SearchableSelect
                    value={customerId || '__none__'}
                    onChange={(v) => setCustomerId(v === '__none__' ? '' : v)}
                    placeholder="Avulso (sem cliente)"
                    emptyText="Nenhum cliente encontrado"
                    options={[
                      { value: '__none__', label: 'Avulso (sem cliente)' },
                      ...customers.map((c) => ({ value: c.id, label: c.name })),
                    ]}
                    triggerClassName="h-10"
                  />
                </div>
                <div className="space-y-1">
                  <Label>Data da venda</Label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn('w-full h-10 justify-start text-left font-normal')}>
                        <CalendarIcon className="mr-2 h-4 w-4" />
                        {format(createdAt, 'dd/MM/yyyy HH:mm')}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={createdAt} onSelect={d => d && setCreatedAt(d)} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>
            </section>

            <Separator />

            {/* Seção 2 — Itens */}
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Itens ({items.length})</h3>
                <Button size="sm" variant="outline" onClick={addItem}><Plus className="h-3.5 w-3.5 mr-1" /> Adicionar</Button>
              </div>
              <div className="space-y-2">
                {items.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-end p-2 rounded-md border bg-muted/20">
                    <div className="col-span-12 sm:col-span-6 space-y-1">
                      <Label className="text-xs">Produto</Label>
                      <SearchableSelect
                        value={it.product_id}
                        onChange={(v) => onSelectProduct(idx, v)}
                        placeholder="Selecionar produto..."
                        emptyText="Nenhum produto encontrado"
                        options={products.map((p) => ({
                          value: p.id,
                          label: p.name,
                          hint: `estoque ${p.on_hand}`,
                        }))}
                        triggerClassName="h-9"
                      />
                    </div>
                    <div className="col-span-4 sm:col-span-2 space-y-1">
                      <Label className="text-xs">Qtd</Label>
                      <Input type="number" min="1" value={it.qty} onChange={e => updateItem(idx, { qty: parseInt(e.target.value) || 0 })} className="h-9" />
                    </div>
                    <div className="col-span-6 sm:col-span-3 space-y-1">
                      <Label className="text-xs">Unitário</Label>
                      <Input type="number" step="0.01" min="0" value={it.unit_price} onChange={e => updateItem(idx, { unit_price: parseFloat(e.target.value) || 0 })} className="h-9" />
                    </div>
                    <div className="col-span-2 sm:col-span-1 flex justify-end">
                      <Button size="sm" variant="ghost" className="h-9 w-9 p-0 text-destructive" onClick={() => removeItem(idx)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {items.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sem itens — adicione ao menos um.</p>}
              </div>
            </section>

            <Separator />

            {/* Seção 3 — Pagamento */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Pagamento</h3>
              <div className="grid sm:grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label>Status</Label>
                  <Select value={paymentStatus} onValueChange={setPaymentStatus}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{PAY_STATUS.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Forma</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                    <SelectContent>{METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              {willRevertPayment && (
                <p className="text-xs text-amber-700 dark:text-amber-400">⚠ Mudança de pago para {paymentStatus} — exige confirmação na próxima tela.</p>
              )}
            </section>

            <Separator />

            {/* Seção 4 — Valores */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Valores</h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Subtotal</Label>
                  <Input value={fmt(subtotal)} readOnly className="h-9 bg-muted" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Desconto</Label>
                  <Input type="number" step="0.01" min="0" value={discount} onChange={e => setDiscount(parseFloat(e.target.value) || 0)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Frete</Label>
                  <Input type="number" step="0.01" min="0" value={shipping} onChange={e => setShipping(parseFloat(e.target.value) || 0)} className="h-9" />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Total</Label>
                  <Input value={fmt(total)} readOnly className="h-9 bg-muted font-semibold" />
                </div>
              </div>
              {discount > subtotal && <p className="text-xs text-destructive">Desconto maior que o subtotal.</p>}
            </section>

            <Separator />

            {/* Seção 5 — Observação + Motivo */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold">Observação e motivo</h3>
              <div className="space-y-1">
                <Label>Observação da venda</Label>
                <Textarea value={notes} onChange={e => setNotes(e.target.value.slice(0, 1000))} rows={2} placeholder="Notas internas sobre esta venda" />
              </div>
              <div className="space-y-1">
                <Label className="text-destructive">Motivo da edição *</Label>
                <Textarea
                  value={reason}
                  onChange={e => setReason(e.target.value.slice(0, 500))}
                  rows={2}
                  placeholder="Ex.: Corrigido valor informado errado / Cliente alterado / Erro no desconto"
                  required
                />
                <p className="text-xs text-muted-foreground text-right">{reason.length}/500</p>
              </div>
            </section>

            <div className="flex gap-2 sticky bottom-0 bg-background pt-3 border-t">
              <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancelar</Button>
              <Button className="flex-1" onClick={openConfirm}>Revisar e confirmar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
