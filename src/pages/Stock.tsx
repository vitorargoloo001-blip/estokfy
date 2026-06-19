import { useEffect, useState, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertTriangle, Package, Plus, Loader2, Upload, FileText, X } from 'lucide-react';
import { toast } from 'sonner';
import ProductSearch from '@/components/ProductSearch';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';
import PageHeader from '@/components/PageHeader';
import { ShimmerList } from '@/components/ShimmerSkeleton';
import { useBarcodeScanner, beep } from '@/hooks/useBarcodeScanner';

const PAYMENT_METHODS = [
  { value: 'pix', label: 'PIX' },
  { value: 'cash', label: 'Dinheiro' },
  { value: 'debit', label: 'Cartão de débito' },
  { value: 'credit', label: 'Cartão de crédito' },
  { value: 'transfer', label: 'Transferência' },
  { value: 'boleto', label: 'Boleto' },
  { value: 'other', label: 'Outro' },
];

export default function Stock() {
  const { profile, user } = useAuth();
  const isMobile = useIsMobile();
  const [products, setProducts] = useState<any[]>([]);
  const [suppliers, setSuppliers] = useState<any[]>([]);
  const [movements, setMovements] = useState<any[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState('');
  const [deltaQty, setDeltaQty] = useState('');
  const [movType, setMovType] = useState<'purchase_in' | 'adjustment' | 'loss'>('purchase_in');
  const [reason, setReason] = useState('');
  const [unitCost, setUnitCost] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('');
  const [purchaseNote, setPurchaseNote] = useState('');
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(true);

  const storeId = profile?.store_id;

  const fetchData = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const [prodRes, movRes, supRes] = await Promise.all([
      supabase.from('products').select('*').eq('store_id', storeId).eq('is_active', true).order('name'),
      supabase.from('stock_movements').select('*, products(name)').eq('store_id', storeId).order('created_at', { ascending: false }).limit(50),
      supabase.from('suppliers').select('id, name').eq('store_id', storeId).order('name'),
    ]);
    setProducts(prodRes.data || []);
    setMovements(movRes.data || []);
    setSuppliers(supRes.data || []);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Scanner global: localiza por barcode e abre o ajuste com produto pré-selecionado
  useBarcodeScanner({
    enabled: !dialogOpen,
    onScan: async (code) => {
      if (!storeId) return;
      const { data } = await supabase
        .from('products')
        .select('id, name')
        .eq('store_id', storeId)
        .eq('barcode', code)
        .maybeSingle();
      if (!data) { beep(150, 220); toast.error('Produto não encontrado para este código.'); return; }
      beep(60, 1200);
      setSelectedProduct(data.id);
      setDialogOpen(true);
    },
  });

  const lowStock = products.filter(p => p.on_hand <= p.minimum_stock);
  const typeLabels: Record<string, string> = { purchase_in: 'Compra', sale_out: 'Venda', adjustment: 'Ajuste', return_in: 'Devolução', loss: 'Perda' };

  const selectedProductObj = useMemo(
    () => products.find(p => p.id === selectedProduct),
    [products, selectedProduct]
  );

  // Pre-fill unit cost from product when switching to purchase_in
  useEffect(() => {
    if (movType === 'purchase_in' && selectedProductObj && !unitCost) {
      setUnitCost(String(selectedProductObj.cost_price || ''));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [movType, selectedProductObj?.id]);

  const totalAmount = useMemo(() => {
    const q = parseInt(deltaQty);
    const c = parseFloat(unitCost);
    if (!q || !c || q <= 0 || c <= 0) return 0;
    return q * c;
  }, [deltaQty, unitCost]);

  const resetForm = () => {
    setSelectedProduct(''); setDeltaQty(''); setReason('');
    setUnitCost(''); setSupplierId(''); setPaymentMethod(''); setPurchaseNote('');
    setReceiptFile(null);
  };

  const handleReceiptChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] || null;
    if (f) {
      const okTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
      if (!okTypes.includes(f.type)) {
        toast.error('Formato inválido. Use JPG, PNG, WEBP ou PDF.');
        return;
      }
      if (f.size > 10 * 1024 * 1024) {
        toast.error('Arquivo muito grande. Máximo 10MB.');
        return;
      }
    }
    setReceiptFile(f);
  };

  const handleAdjust = async () => {
    if (!storeId || submitting) return;
    if (!user?.id) { toast.error('Sessão expirada. Faça login novamente.'); return; }
    if (!selectedProduct) { toast.error('Selecione um produto'); return; }
    if (!selectedProductObj) { toast.error('Produto não encontrado. Atualize a página e tente novamente.'); return; }
    if (!deltaQty || parseInt(deltaQty) <= 0) { toast.error('Informe uma quantidade válida'); return; }

    if (movType === 'purchase_in') {
      const c = parseFloat(unitCost);
      if (!c || c <= 0) { toast.error('Custo unitário é obrigatório para entrada de compra'); return; }
    }

    const delta = movType === 'loss' ? -Math.abs(parseInt(deltaQty)) : parseInt(deltaQty);
    if (delta === 0) { toast.error('Quantidade inválida'); return; }
    const previousStock = Number(selectedProductObj.on_hand) || 0;
    const newStock = previousStock + delta;
    if (newStock < 0) { toast.error('Estoque insuficiente para essa movimentação.'); return; }

    setSubmitting(true);
    try {
      // Upload receipt first if present (purchase only)
      let receiptPath: string | null = null;
      if (movType === 'purchase_in' && receiptFile) {
        setUploadingReceipt(true);
        const ext = receiptFile.name.split('.').pop()?.toLowerCase() || 'bin';
        const fileName = `${storeId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        const { error: upErr } = await supabase.storage
          .from('purchase-receipts')
          .upload(fileName, receiptFile, { contentType: receiptFile.type, upsert: false });
        setUploadingReceipt(false);
        if (upErr) {
          toast.error('Falha ao enviar nota fiscal: ' + upErr.message);
          setSubmitting(false);
          return;
        }
        receiptPath = fileName;
      }

      const payload: Record<string, unknown> = {
        store_id: storeId,
        product_id: selectedProduct,
        delta_qty: delta,
        quantity: delta,
        movement_type: movType,
        reason: reason || (movType === 'loss' ? 'Perda/avaria' : movType === 'purchase_in' ? 'Compra/reposição' : 'Ajuste manual'),
        created_by: user.id,
        previous_stock: previousStock,
        new_stock: newStock,
      };
      if (movType === 'purchase_in') {
        payload.unit_cost = parseFloat(unitCost);
        if (supplierId) payload.supplier_id = supplierId;
        if (paymentMethod) payload.payment_method = paymentMethod;
        if (purchaseNote) payload.description = purchaseNote;
        if (receiptPath) payload.receipt_path = receiptPath;
      }

      const body = await invokeEdgeFunction<{ new_on_hand: number; expense_id?: string | null }>(
        'stock-adjust',
        { body: payload }
      );

      if (movType === 'purchase_in' && body.expense_id) {
        toast.success(`Estoque atualizado: ${body.new_on_hand} un. Despesa registrada no Financeiro.`);
      } else {
        toast.success(`Estoque atualizado: ${body.new_on_hand} unidades`);
      }
      setDialogOpen(false);
      resetForm();
      fetchData();
    } catch (err: any) {
      toast.error(err?.message || 'Não foi possível ajustar o estoque. Tente novamente.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Estoque"
        description="Movimentações, ajustes e entradas de produtos"
        actions={
          <Button onClick={() => setDialogOpen(true)} variant="premium" size={isMobile ? 'sm' : 'default'} className="gap-2">
            <Plus className="h-4 w-4" /> {isMobile ? 'Movimentar' : 'Movimentação'}
          </Button>
        }
      />

      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setMovType('purchase_in'); setDialogOpen(true); }}>Entrada</Button>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setMovType('adjustment'); setDialogOpen(true); }}>Ajuste</Button>
        <Button variant="outline" size="sm" className="shrink-0" onClick={() => { setMovType('loss'); setDialogOpen(true); }}>Perda</Button>
      </div>

      <ProductSearch products={products} onSelect={(p) => { setSelectedProduct(p.id); setDialogOpen(true); }} placeholder="Buscar produto para movimentar..." />

      {loading ? (
        <ShimmerList count={4} rowClassName="h-24 w-full" />
      ) : (
        <>
          {lowStock.length > 0 && (
            <Card className="border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800">
              <CardHeader className="p-3 md:p-6">
                <CardTitle className="text-base md:text-lg flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-5 w-5" /> Estoque baixo ({lowStock.length})
                </CardTitle>
              </CardHeader>
              <CardContent className="p-3 pt-0 md:p-6 md:pt-0">
                <div className="flex flex-wrap gap-2">
                  {lowStock.slice(0, isMobile ? 6 : 20).map(p => (
                    <Badge key={p.id} variant="outline" className="border-amber-300 text-amber-700 dark:text-amber-400 cursor-pointer" onClick={() => { setSelectedProduct(p.id); setMovType('purchase_in'); setDialogOpen(true); }}>
                      {p.name}: {p.on_hand}/{p.minimum_stock}
                    </Badge>
                  ))}
                  {isMobile && lowStock.length > 6 && <Badge variant="outline">+{lowStock.length - 6}</Badge>}
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="p-3 md:p-6"><CardTitle className="text-base md:text-lg">Movimentações recentes</CardTitle></CardHeader>
            <CardContent className="p-0">
              {isMobile ? (
                <div className="divide-y">
                  {movements.map(m => (
                    <div key={m.id} className="px-3 py-2.5">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium truncate">{(m.products as any)?.name || '-'}</p>
                        <span className={`text-sm font-semibold ${m.qty > 0 ? 'text-emerald-600' : 'text-destructive'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</span>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        <span className="text-xs text-muted-foreground">{new Date(m.created_at).toLocaleDateString('pt-BR')}</span>
                        <Badge variant="secondary" className="text-xs">{typeLabels[m.movement_type] || m.movement_type}</Badge>
                      </div>
                      {m.reason && <p className="text-xs text-muted-foreground mt-0.5">{m.reason}</p>}
                    </div>
                  ))}
                  {movements.length === 0 && (
                    <div className="text-center py-8 text-muted-foreground"><Package className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhuma movimentação</div>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader><TableRow><TableHead>Data</TableHead><TableHead>Produto</TableHead><TableHead>Tipo</TableHead><TableHead className="text-center">Qty</TableHead><TableHead>Motivo</TableHead></TableRow></TableHeader>
                  <TableBody>
                    {movements.map(m => (
                      <TableRow key={m.id}>
                        <TableCell className="text-sm">{new Date(m.created_at).toLocaleDateString('pt-BR')}</TableCell>
                        <TableCell className="text-sm font-medium">{(m.products as any)?.name || '-'}</TableCell>
                        <TableCell><Badge variant="secondary">{typeLabels[m.movement_type] || m.movement_type}</Badge></TableCell>
                        <TableCell className={`text-center font-medium ${m.qty > 0 ? 'text-emerald-600' : 'text-destructive'}`}>{m.qty > 0 ? `+${m.qty}` : m.qty}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{m.reason || '-'}</TableCell>
                      </TableRow>
                    ))}
                    {movements.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground"><Package className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhuma movimentação</TableCell></TableRow>}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={o => { if (!submitting) { setDialogOpen(o); if (!o) resetForm(); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Nova Movimentação</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2"><Label>Tipo *</Label>
              <Select value={movType} onValueChange={(v: any) => setMovType(v)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="purchase_in">Entrada (Compra)</SelectItem>
                  <SelectItem value="adjustment">Ajuste</SelectItem>
                  <SelectItem value="loss">Perda / Avaria</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Produto *</Label>
              <Select value={selectedProduct} onValueChange={setSelectedProduct}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecionar..." /></SelectTrigger>
                <SelectContent>{products.map(p => <SelectItem key={p.id} value={p.id}>{p.name} (atual: {p.on_hand})</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-2"><Label>Quantidade {movType === 'loss' ? '(será subtraída)' : ''} *</Label><Input type="number" min={1} value={deltaQty} onChange={e => setDeltaQty(e.target.value)} placeholder="Ex: 5" className="h-11" /></div>

            {movType === 'purchase_in' && (
              <>
                <div className="space-y-2">
                  <Label>Custo unitário (R$) *</Label>
                  <Input
                    type="number"
                    min={0}
                    step="0.01"
                    value={unitCost}
                    onChange={e => setUnitCost(e.target.value)}
                    placeholder="Ex: 12.50"
                    className="h-11"
                  />
                  {selectedProductObj && (
                    <p className="text-xs text-muted-foreground">
                      Custo atual: R$ {Number(selectedProductObj.cost_price || 0).toFixed(2)}
                    </p>
                  )}
                </div>

                <div className="rounded-lg border bg-muted/40 px-3 py-2 flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Valor total</span>
                  <span className="text-base font-semibold">
                    R$ {totalAmount.toFixed(2).replace('.', ',')}
                  </span>
                </div>

                <div className="space-y-2">
                  <Label>Fornecedor</Label>
                  <Select value={supplierId || 'none'} onValueChange={v => setSupplierId(v === 'none' ? '' : v)}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Nenhum" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Nenhum</SelectItem>
                      {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Forma de pagamento</Label>
                  <Select value={paymentMethod || 'none'} onValueChange={v => setPaymentMethod(v === 'none' ? '' : v)}>
                    <SelectTrigger className="h-11"><SelectValue placeholder="Não informado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Não informado</SelectItem>
                      {PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-2">
                  <Label>Observação</Label>
                  <Input
                    value={purchaseNote}
                    onChange={e => setPurchaseNote(e.target.value)}
                    placeholder="Nota fiscal, lote, etc."
                    className="h-11"
                  />
                </div>

                <div className="space-y-2">
                  <Label>Nota fiscal (foto ou PDF)</Label>
                  {receiptFile ? (
                    <div className="flex items-center gap-2 rounded-lg border bg-muted/40 px-3 py-2">
                      <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
                      <span className="text-sm truncate flex-1">{receiptFile.name}</span>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {(receiptFile.size / 1024).toFixed(0)} KB
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => setReceiptFile(null)}
                        aria-label="Remover arquivo"
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 h-11 rounded-lg border border-dashed cursor-pointer hover:bg-muted/30 transition-colors text-sm text-muted-foreground">
                      <Upload className="h-4 w-4" />
                      <span>Anexar nota (JPG, PNG, WEBP, PDF — até 10MB)</span>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,application/pdf"
                        className="hidden"
                        onChange={handleReceiptChange}
                      />
                    </label>
                  )}
                </div>

                <p className="text-xs text-muted-foreground">
                  Uma despesa será registrada automaticamente no Financeiro e o custo médio do produto será atualizado.
                </p>
              </>
            )}

            {movType !== 'purchase_in' && (
              <div className="space-y-2">
                <Label>Motivo</Label>
                <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="inventário, avaria..." className="h-11" />
              </div>
            )}

            <Button className="w-full h-11" onClick={handleAdjust} disabled={submitting || uploadingReceipt}>
              {submitting || uploadingReceipt ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{uploadingReceipt ? 'Enviando nota...' : 'Registrando...'}</>
              ) : 'Registrar Movimentação'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
