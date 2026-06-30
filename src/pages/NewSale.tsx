import { useEffect, useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction, validateUserProfile } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { Trash2, ShoppingCart, Search, Plus, CheckCircle2, CalendarIcon, Clock } from 'lucide-react';
import { toast } from 'sonner';
import { maskPhone, validatePhone } from '@/lib/masks';
import { cn } from '@/lib/utils';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { CustomerSearch } from '@/components/CustomerSearch';
import { useBarcodeScanner, beep } from '@/hooks/useBarcodeScanner';
import { usePrintSettings } from '@/hooks/usePrintSettings';
import { printThermalReceipt, type ReceiptData } from '@/lib/receipt';

interface Product { id: string; sku: string; name: string; brand: string | null; model: string | null; sale_price: number; on_hand: number; category_name?: string | null; }
interface SaleItem { product_id: string; product_name: string; qty: number; unit_price: number; available: number; }
interface Customer { id: string; name: string; phone: string | null; }
interface PaymentLine { method: string; amount: number; }

const PAYMENT_METHODS: { value: string; label: string }[] = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'credit_card', label: 'Cartão Crédito' },
  { value: 'debit_card', label: 'Cartão Débito' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'pending', label: 'A prazo / Pendente' },
];

export default function NewSale() {
  const { session, user, profile } = useAuth();
  const navigate = useNavigate();
  const [products, setProducts] = useState<Product[]>([]);
  const [items, setItems] = useState<SaleItem[]>([]);
  const [customerId, setCustomerId] = useState<string>('');
  const [payments, setPayments] = useState<PaymentLine[]>([{ method: 'pix', amount: 0 }]);
  const [discount, setDiscount] = useState(0);
  const [deliveryMethod, setDeliveryMethod] = useState('pickup');
  const [shippingFee, setShippingFee] = useState(0);
  const [dueDate, setDueDate] = useState<Date | undefined>(undefined);
  const [saleDate, setSaleDate] = useState<Date>(new Date());
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [productSearch, setProductSearch] = useState('');
  const [success, setSuccess] = useState<string | null>(null);
  const idempotencyRef = useRef<string | null>(null);
  const searchDropdownRef = useRef<HTMLDivElement>(null);

  const storeId = profile?.store_id;

  const [searchResults, setSearchResults] = useState<Product[]>([]);
  const [searching, setSearching] = useState(false);
  const debouncedSearch = useDebouncedValue(productSearch, 300);

  const fetchData = useCallback(async () => {
    if (!storeId) return;
    const prodRes = await supabase
      .from('products')
      .select('id, sku, name, brand, model, sale_price, on_hand, categories(name)')
      .eq('store_id', storeId)
      .eq('is_active', true)
      .order('on_hand', { ascending: false })
      .order('name')
      .limit(5000);
    const mapped: Product[] = (prodRes.data || []).map((p: any) => ({
      id: p.id, sku: p.sku, name: p.name, brand: p.brand, model: p.model,
      sale_price: p.sale_price, on_hand: p.on_hand,
      category_name: p.categories?.name ?? null,
    }));
    setProducts(mapped);
  }, [storeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (searchDropdownRef.current && !searchDropdownRef.current.contains(e.target as Node)) {
        setProductSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // DB-side search (covers all products, not just initially loaded)
  useEffect(() => {
    const q = debouncedSearch.trim();
    if (!q || !storeId) { setSearchResults([]); setSearching(false); return; }

    let cancelled = false;
    setSearching(true);
    (async () => {
      const escaped = q.replace(/[%,]/g, ' ').trim();
      const like = `%${escaped}%`;
      const { data, error } = await supabase
        .from('products')
        .select('id, sku, name, brand, model, sale_price, on_hand, categories(name)')
        .eq('store_id', storeId)
        .eq('is_active', true)
        .or(`name.ilike.${like},brand.ilike.${like},model.ilike.${like}`)
        .order('on_hand', { ascending: false })
        .order('name')
        .limit(50);
      if (cancelled) return;
      let rows: Product[] = (data || []).map((p: any) => ({
        id: p.id, sku: p.sku, name: p.name, brand: p.brand, model: p.model,
        sale_price: p.sale_price, on_hand: p.on_hand,
        category_name: p.categories?.name ?? null,
      }));
      // Client-side category match (Postgrest .or não atravessa join facilmente)
      const lower = q.toLowerCase();
      const extra = products.filter(p =>
        (p.category_name || '').toLowerCase().includes(lower) &&
        !rows.some(r => r.id === p.id)
      );
      rows = [...rows, ...extra];
      if (error) console.error('[NewSale] product search error', error);
      setSearchResults(rows);
      setSearching(false);
    })();
    return () => { cancelled = true; };
  }, [debouncedSearch, storeId, products]);

  const filteredProducts = searchResults;

  const addItem = (productId: string, opts?: { confirmNoStock?: boolean }) => {
    const p = (searchResults.find(pr => pr.id === productId)) || products.find(pr => pr.id === productId);
    if (!p) return;
    const existingIdx = items.findIndex(i => i.product_id === p.id);
    if (existingIdx >= 0) {
      const updated = [...items];
      const newQty = updated[existingIdx].qty + 1;
      if (newQty > updated[existingIdx].available) { toast.error(`Estoque insuficiente para ${p.name}`); return; }
      updated[existingIdx].qty = newQty;
      setItems(updated);
    } else {
      if (p.on_hand <= 0) {
        if (!opts?.confirmNoStock) {
          const ok = window.confirm(`${p.name} está sem estoque. Deseja adicionar mesmo assim?`);
          if (!ok) return;
        }
        setItems([...items, { product_id: p.id, product_name: p.name, qty: 1, unit_price: p.sale_price, available: Math.max(p.on_hand, 1) }]);
      } else {
        setItems([...items, { product_id: p.id, product_name: p.name, qty: 1, unit_price: p.sale_price, available: p.on_hand }]);
      }
    }
    setProductSearch('');
    setSearchResults([]);
  };

  // ===== Scanner: lookup por barcode =====
  const { settings: printSettings } = usePrintSettings();
  const handleBarcodeScan = useCallback(async (code: string) => {
    if (!storeId) return;
    const { data, error } = await supabase
      .from('products')
      .select('id, sku, name, brand, model, sale_price, on_hand, categories(name)')
      .eq('store_id', storeId)
      .eq('barcode', code)
      .eq('is_active', true)
      .maybeSingle();
    if (error || !data) {
      beep(150, 220);
      toast.error('Produto não encontrado para este código.');
      return;
    }
    const p: Product = {
      id: data.id, sku: data.sku, name: data.name, brand: data.brand, model: data.model,
      sale_price: data.sale_price, on_hand: data.on_hand,
      category_name: (data as any).categories?.name ?? null,
    };
    // injeta na lista para addItem encontrar
    setProducts(prev => prev.some(x => x.id === p.id) ? prev : [...prev, p]);
    setSearchResults(prev => prev.some(x => x.id === p.id) ? prev : [p, ...prev]);
    beep(60, 1200);
    addItem(p.id, { confirmNoStock: true });
    toast.success(`+ ${p.name}`);
  }, [storeId]);

  useBarcodeScanner({ onScan: handleBarcodeScan, enabled: !success });

  const updateItem = (idx: number, field: 'qty' | 'unit_price', value: number) => {
    const updated = [...items];
    if (field === 'qty') {
      if (value > updated[idx].available) { toast.error(`Máximo disponível: ${updated[idx].available}`); return; }
      if (value < 1) return;
    }
    if (field === 'unit_price' && value < 0) return;
    (updated[idx] as any)[field] = value;
    setItems(updated);
  };

  const removeItem = (idx: number) => setItems(items.filter((_, i) => i !== idx));

  const subtotal = items.reduce((s, i) => s + i.qty * i.unit_price, 0);
  const total = Math.max(0, subtotal - discount + shippingFee);
  const paymentsSum = payments.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const pendingSum = payments.filter(p => p.method === 'pending').reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const remaining = Math.max(0, total - paymentsSum);
  const hasPending = pendingSum > 0;

  // Auto-ajusta pagamento único ao total final (após desconto/frete).
  // Para múltiplos pagamentos, o usuário ajusta manualmente (ou via botão).
  useEffect(() => {
    if (payments.length === 1 && Math.abs(payments[0].amount - total) > 0.01) {
      setPayments([{ ...payments[0], amount: total }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  const autoAdjustPayments = () => {
    if (payments.length === 1) {
      setPayments([{ ...payments[0], amount: total }]);
      return;
    }
    // Múltiplos: ajusta a última linha para fechar o total
    const others = payments.slice(0, -1).reduce((s, p) => s + (Number(p.amount) || 0), 0);
    const lastAmount = Math.max(0, total - others);
    const updated = [...payments];
    updated[updated.length - 1] = { ...updated[updated.length - 1], amount: lastAmount };
    setPayments(updated);
  };

  const updatePayment = (idx: number, field: 'method' | 'amount', value: string | number) => {
    const updated = [...payments];
    if (field === 'amount') updated[idx].amount = Math.max(0, Number(value) || 0);
    else updated[idx].method = String(value);
    setPayments(updated);
  };
  const addPaymentLine = () => setPayments([...payments, { method: 'pending', amount: remaining }]);
  const removePaymentLine = (idx: number) => {
    if (payments.length === 1) return;
    setPayments(payments.filter((_, i) => i !== idx));
  };

  const handleSubmit = async () => {
    if (submitting) return;
    if (!session?.access_token || !user) { toast.error('Sessão expirada. Faça login novamente.'); navigate('/login'); return; }
    if (!profile) { toast.error('Perfil não carregado.'); return; }
    if (!storeId) { toast.error('Loja não identificada.'); return; }

    try {
      await validateUserProfile();
    } catch (err: any) {
      toast.error(err?.message || 'Erro de autenticação. Faça login novamente.');
      navigate('/login');
      return;
    }

    if (items.length === 0) { toast.error('Adicione pelo menos um produto'); return; }
    if (!Number.isFinite(discount) || discount < 0) { toast.error('Desconto inválido'); return; }
    if (!Number.isFinite(shippingFee) || shippingFee < 0) { toast.error('Frete inválido'); return; }
    if (!Number.isFinite(total) || total <= 0) { toast.error('Valor da venda inválido'); return; }

    const invalidItem = items.find(i => !i.product_id || i.qty <= 0 || !Number.isFinite(i.unit_price) || i.unit_price < 0);
    if (invalidItem) { toast.error(`Dados inválidos para ${invalidItem.product_name}`); return; }
    for (const item of items) {
      if (item.qty > item.available) { toast.error(`Estoque insuficiente para ${item.product_name}`); return; }
    }

    const cleanPayments = payments.filter(p => p.amount > 0);
    if (cleanPayments.length === 0) { toast.error('Informe pelo menos um pagamento'); return; }
    if (Math.abs(paymentsSum - total) > 0.01) {
      toast.error(`Soma dos pagamentos (${paymentsSum.toFixed(2)}) deve ser igual ao total (${total.toFixed(2)})`); return;
    }

    const resolvedCustomerId = (!customerId || customerId === 'none') ? null : customerId;

    // V12: venda a prazo exige cliente vinculado (sem cliente, não há como cobrar depois)
    if (hasPending && !resolvedCustomerId) {
      toast.error('Venda a prazo exige cliente vinculado. Selecione ou cadastre um cliente.');
      return;
    }
    if (hasPending && !dueDate) {
      toast.error('Venda a prazo exige uma data de vencimento.');
      return;
    }

    // Bloqueia data futura
    const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999);
    if (saleDate.getTime() > todayEnd.getTime()) {
      toast.error('Não é possível registrar uma venda em uma data futura.');
      return;
    }

    if (!idempotencyRef.current) idempotencyRef.current = crypto.randomUUID();

    // Se o usuário escolheu uma data anterior a hoje, usar 12:00 desse dia para evitar problemas de fuso.
    const todayStr = format(new Date(), 'yyyy-MM-dd');
    const chosenStr = format(saleDate, 'yyyy-MM-dd');
    let saleDateISO: string | null = null;
    if (chosenStr !== todayStr) {
      const d = new Date(saleDate); d.setHours(12, 0, 0, 0);
      saleDateISO = d.toISOString();
    }

    const payload = {
      store_id: storeId,
      customer_id: resolvedCustomerId,
      discount,
      items: items.map(i => ({ product_id: i.product_id, qty: i.qty, unit_price: i.unit_price })),
      payments: cleanPayments,
      delivery: deliveryMethod === 'pickup' ? null : { method: deliveryMethod, shipping_fee: shippingFee, delivery_cost: 0 },
      due_date: hasPending && dueDate ? format(dueDate, 'yyyy-MM-dd') : null,
      sale_date: saleDateISO,
      notes: notes.trim() ? notes.trim().slice(0, 1000) : null,
    };

    setSubmitting(true);
    try {
      const body = await invokeEdgeFunction<{ sale_id: string }>('sales-create', {
        headers: { 'Idempotency-Key': idempotencyRef.current! },
        body: payload,
      });
      setSuccess(body.sale_id);
      toast.success(hasPending ? 'Venda registrada (com pendência)!' : 'Venda registrada!');

      // Auto-print térmico se habilitado nas configurações
      if (printSettings.enabled && printSettings.auto_print && body.sale_id) {
        try {
          const [storeRes, itemsRes, payRes] = await Promise.all([
            supabase.from('stores').select('name, phone, whatsapp').eq('id', storeId).maybeSingle(),
            supabase.from('sale_items').select('qty, unit_price, line_total, products(name)').eq('sale_id', body.sale_id),
            supabase.from('payments').select('method').eq('sale_id', body.sale_id),
          ]);
          const customer = customerId && customerId !== 'none'
            ? (await supabase.from('customers').select('name').eq('id', customerId).maybeSingle()).data?.name
            : null;
          const data: ReceiptData = {
            storeName: storeRes.data?.name || 'Loja',
            storePhone: storeRes.data?.whatsapp || storeRes.data?.phone || null,
            saleId: body.sale_id,
            createdAt: new Date().toISOString(),
            customerName: customer || null,
            sellerName: profile?.full_name || null,
            notes: notes.trim() || null,
            items: (itemsRes.data || []).map((it: any) => ({
              name: it.products?.name || 'Produto',
              qty: it.qty,
              unit_price: Number(it.unit_price),
              line_total: Number(it.line_total),
            })),
            gross: subtotal, net: total, discount, shipping: shippingFee,
            amountPaid: paymentsSum - pendingSum, amountPending: pendingSum,
            paymentStatus: hasPending ? (paymentsSum - pendingSum > 0 ? 'partial' : 'pending') : 'paid',
            paymentMethods: Array.from(new Set((payRes.data || []).map((p: any) => p.method).filter((m: string) => m !== 'pending'))),
          };
          printThermalReceipt(data, {
            paperWidth: printSettings.paper_width,
            copies: printSettings.copies,
            showLogo: printSettings.show_logo,
            showNotes: printSettings.show_notes,
            footerMessage: printSettings.footer_message,
          });
        } catch (printErr) {
          console.warn('[NewSale] auto-print failed', printErr);
        }
      }
    } catch (err: any) {
      idempotencyRef.current = null;
      const message = err?.message || 'Erro inesperado.';
      if (message.includes('Sessão expirada')) navigate('/login');
      toast.error(message);
    } finally { setSubmitting(false); }
  };

  const handleNewSale = () => {
    setItems([]); setCustomerId(''); setDiscount(0); setShippingFee(0);
    setPayments([{ method: 'pix', amount: 0 }]); setDeliveryMethod('pickup');
    setDueDate(undefined); setSaleDate(new Date()); setNotes(''); setSuccess(null); idempotencyRef.current = null;
    fetchData();
  };



  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

  if (success) {
    return (
      <div className="flex flex-col items-center justify-center py-20 space-y-6 max-w-md mx-auto text-center">
        <CheckCircle2 className="h-16 w-16 text-emerald-500" />
        <h2 className="text-2xl font-bold">Venda registrada!</h2>
        <p className="text-muted-foreground">ID: {success.slice(0, 8)}...</p>
        <div className="flex gap-3 w-full">
          <Button variant="outline" className="flex-1 h-11" onClick={() => navigate('/vendas')}>Ver Vendas</Button>
          <Button className="flex-1 h-11" onClick={handleNewSale}>Nova Venda</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 md:space-y-6 max-w-4xl">
      <div>
        <h1 className="text-xl md:text-2xl font-bold">Nova Venda</h1>
        <p className="text-sm text-muted-foreground">Registre uma nova venda</p>
      </div>

      <div className="grid gap-4 md:gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Itens</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0 space-y-3">
              <div className="relative" ref={searchDropdownRef}>
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar por nome, marca, modelo ou categoria..." value={productSearch} onChange={e => setProductSearch(e.target.value)} className="pl-10 h-11" />
                {productSearch && (
                  <div className="absolute z-10 mt-1 w-full rounded-md border bg-popover shadow-lg max-h-72 overflow-y-auto">
                    {searching && (
                      <div className="px-3 py-3 text-sm text-muted-foreground flex items-center gap-2">
                        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
                        Buscando...
                      </div>
                    )}
                    {!searching && filteredProducts.length === 0 && (
                      <div className="px-3 py-3 text-sm text-muted-foreground">Nenhum produto encontrado</div>
                    )}
                    {!searching && filteredProducts.map(p => {
                      const out = p.on_hand <= 0;
                      return (
                        <button
                          key={p.id}
                          className="w-full text-left px-3 py-2.5 text-sm hover:bg-accent flex justify-between items-center gap-2"
                          onClick={() => addItem(p.id)}
                        >
                          <span className="truncate min-w-0">
                            {p.name}
                            {(p.brand || p.model || p.category_name) && (
                              <span className="text-muted-foreground ml-1 text-xs">
                                ({[p.brand, p.model, p.category_name].filter(Boolean).join(' • ')})
                              </span>
                            )}
                          </span>
                          <span className="ml-2 shrink-0 text-xs flex items-center gap-2">
                            <span className="text-muted-foreground">{fmt(p.sale_price)}</span>
                            {out
                              ? <span className="rounded bg-destructive/10 text-destructive px-1.5 py-0.5">Sem estoque</span>
                              : <span className="text-muted-foreground">{p.on_hand} disp.</span>}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {items.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <ShoppingCart className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhum item adicionado
                </div>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={item.product_id} className="rounded-lg border p-2.5 md:p-3">
                      <div className="flex items-center justify-between mb-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium truncate">{item.product_name}</p>
                          <p className="text-xs text-muted-foreground">{item.available} disponível</p>
                        </div>
                        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => removeItem(idx)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                      <div className="flex items-center gap-2">
                        <Input type="number" min={1} max={item.available} value={item.qty} onChange={e => updateItem(idx, 'qty', parseInt(e.target.value) || 1)} className="w-16 h-9 text-center" />
                        <span className="text-xs text-muted-foreground">×</span>
                        <Input type="number" step="0.01" min={0} value={item.unit_price} onChange={e => updateItem(idx, 'unit_price', parseFloat(e.target.value) || 0)} className="w-24 h-9 text-right" />
                        <span className="text-sm font-medium ml-auto">{fmt(item.qty * item.unit_price)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Cliente & Entrega</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0 grid gap-3 grid-cols-1 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Cliente (opcional)</Label>
                {storeId && (
                  <CustomerSearch
                    storeId={storeId}
                    value={customerId && customerId !== 'none' ? customerId : null}
                    onChange={(id) => setCustomerId(id ?? '')}
                  />
                )}
              </div>
              <div className="space-y-2">
                <Label>Entrega</Label>
                <Select value={deliveryMethod} onValueChange={setDeliveryMethod}>
                  <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pickup">Retirada na loja</SelectItem>
                    <SelectItem value="correios">Correios</SelectItem>
                    <SelectItem value="99">99 Entrega</SelectItem>
                    <SelectItem value="motoboy">Motoboy</SelectItem>
                    <SelectItem value="transportadora">Transportadora</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="p-3 md:p-6 pb-2">
              <CardTitle className="text-base md:text-lg">Observações da venda</CardTitle>
            </CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0 space-y-2">
              <Textarea
                value={notes}
                onChange={e => setNotes(e.target.value.slice(0, 1000))}
                placeholder="Digite observações sobre esta venda..."
                rows={3}
                className="resize-y"
              />
              <div className="flex items-start justify-between gap-3 text-xs text-muted-foreground">
                <div className="space-y-0.5">
                  <p className="font-medium">Ex:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>cliente vai pagar restante amanhã</li>
                    <li>produto reservado</li>
                    <li>entrega combinada</li>
                    <li>aparelho voltou para ajuste</li>
                  </ul>
                </div>
                <span className="shrink-0 tabular-nums">{notes.length}/1000</span>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="md:sticky md:top-4">
            <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Pagamento</CardTitle></CardHeader>
            <CardContent className="p-3 pt-0 md:p-6 md:pt-0 space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">Data da venda</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button variant="outline" className="w-full h-10 justify-start text-left font-normal">
                      <CalendarIcon className="mr-2 h-4 w-4" />
                      {format(saleDate, 'dd/MM/yyyy')}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={saleDate}
                      onSelect={(d) => d && setSaleDate(d)}
                      disabled={(date) => date > new Date()}
                      initialFocus
                      className={cn('p-3 pointer-events-auto')}
                    />
                  </PopoverContent>
                </Popover>
                {format(saleDate, 'yyyy-MM-dd') !== format(new Date(), 'yyyy-MM-dd') && (
                  <p className="text-xs text-amber-700 dark:text-amber-400 flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    Venda retroativa: será registrada em {format(saleDate, 'dd/MM/yyyy')}.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                {payments.map((p, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Select value={p.method} onValueChange={v => updatePayment(idx, 'method', v)}>
                      <SelectTrigger className="h-10 flex-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                    <Input type="number" step="0.01" min="0" value={p.amount}
                      onChange={e => updatePayment(idx, 'amount', e.target.value)}
                      className="h-10 w-28 text-right" />
                    {payments.length > 1 && (
                      <Button variant="ghost" size="icon" className="h-10 w-10 shrink-0" onClick={() => removePaymentLine(idx)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                ))}
                <Button variant="outline" size="sm" className="w-full" onClick={addPaymentLine}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Adicionar pagamento
                </Button>
                {Math.abs(paymentsSum - total) > 0.01 && total > 0 && (
                  <div className="flex items-center justify-between gap-2 rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-2">
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      {payments.length > 1
                        ? `Total atualizado para ${fmt(total)}. Ajuste os pagamentos para fechar a venda.`
                        : `Faltam ${fmt(Math.max(0, total - paymentsSum))} para fechar a venda.`}
                    </p>
                    <Button type="button" variant="outline" size="sm" onClick={autoAdjustPayments}>
                      Ajustar pagamento
                    </Button>
                  </div>
                )}
              </div>

              {hasPending && (
                <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900 p-3">
                  <div className="flex items-center gap-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                    <Clock className="h-3.5 w-3.5" /> Venda com {fmt(pendingSum)} pendente
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Data prevista para pagamento (opcional)</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button variant="outline" className={cn('w-full h-10 justify-start text-left font-normal', !dueDate && 'text-muted-foreground')}>
                          <CalendarIcon className="mr-2 h-4 w-4" />
                          {dueDate ? format(dueDate, 'dd/MM/yyyy') : 'Sem data'}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar mode="single" selected={dueDate} onSelect={setDueDate} initialFocus className={cn('p-3 pointer-events-auto')} />
                      </PopoverContent>
                    </Popover>
                    {dueDate && (
                      <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setDueDate(undefined)}>Limpar data</Button>
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label>Desconto</Label>
                  <Input type="number" step="0.01" min="0" value={discount} onChange={e => setDiscount(Math.max(0, parseFloat(e.target.value) || 0))} className="h-11" />
                </div>
                <div className="space-y-2">
                  <Label>Frete</Label>
                  <Input type="number" step="0.01" min="0" value={shippingFee} onChange={e => setShippingFee(Math.max(0, parseFloat(e.target.value) || 0))} className="h-11" />
                </div>
              </div>

              <div className="rounded-lg bg-muted/50 p-3 space-y-1.5">
                <div className="flex justify-between text-sm"><span>Subtotal</span><span>{fmt(subtotal)}</span></div>
                {discount > 0 && <div className="flex justify-between text-sm text-destructive"><span>Desconto</span><span>-{fmt(discount)}</span></div>}
                {shippingFee > 0 && <div className="flex justify-between text-sm"><span>Frete</span><span>{fmt(shippingFee)}</span></div>}
                <div className="flex justify-between text-base font-bold pt-1.5 border-t"><span>Total</span><span>{fmt(total)}</span></div>
                {hasPending && (
                  <div className="flex justify-between text-xs text-amber-700 dark:text-amber-400 pt-1">
                    <span>A receber</span><span>{fmt(pendingSum)}</span>
                  </div>
                )}
              </div>

              <Button className="w-full h-12" disabled={submitting || items.length === 0 || total <= 0} onClick={handleSubmit}>
                {submitting ? 'Registrando...' : 'Finalizar Venda'}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>

    </div>
  );
}
