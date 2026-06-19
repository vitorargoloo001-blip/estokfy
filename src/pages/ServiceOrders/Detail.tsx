import { useEffect, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { ArrowLeft, Plus, Trash2, DollarSign, FileText, Printer } from 'lucide-react';
import { StatusBadge } from '@/components/service-orders/StatusBadge';
import { SO_STATUS, SO_STATUS_LABEL, SO_PAYMENT_METHODS, ServiceOrderStatus, formatBRL } from '@/lib/serviceOrderStatus';
import { generateServiceOrderPDF } from '@/lib/serviceOrderPdf';
import { toast } from 'sonner';

export default function ServiceOrderDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();

  const [os, setOs] = useState<any>(null);
  const [items, setItems] = useState<any[]>([]);
  const [payments, setPayments] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const [serviceOpen, setServiceOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [o, it, pa, hi] = await Promise.all([
      (supabase as any).from('service_orders').select('*').eq('id', id).maybeSingle(),
      (supabase as any).from('service_order_items').select('*').eq('service_order_id', id).order('created_at'),
      (supabase as any).from('service_order_payments').select('*').eq('service_order_id', id).order('paid_at', { ascending: false }),
      (supabase as any).from('service_order_status_history').select('*').eq('service_order_id', id).order('created_at', { ascending: false }),
    ]);
    setOs(o.data); setItems(it.data || []); setPayments(pa.data || []); setHistory(hi.data || []);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function removeItem(itemId: string) {
    if (!confirm('Remover este item?')) return;
    const { error } = await (supabase as any).rpc('so_remove_item', { p_item: itemId });
    if (error) toast.error(error.message); else { toast.success('Item removido'); load(); }
  }

  function printPDF() {
    if (!os) return;
    const store = { name: 'Estokfy' };
    const doc = generateServiceOrderPDF({ store, os, items });
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
  }
  function downloadPDF() {
    if (!os) return;
    const doc = generateServiceOrderPDF({ store: { name: 'Estokfy' }, os, items });
    doc.save(`OS-${String(os.os_number).padStart(5, '0')}.pdf`);
  }

  if (loading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  if (!os) return <div className="p-8 text-center">OS não encontrada</div>;

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/os')}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <h1 className="text-2xl font-bold">OS #{String(os.os_number).padStart(5, '0')}</h1>
            <p className="text-sm text-muted-foreground">{os.customer_name} • {[os.device, os.brand, os.model].filter(Boolean).join(' ')}</p>
          </div>
          <StatusBadge status={os.status} className="ml-2" />
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setStatusOpen(true)}>Mudar status</Button>
          <Button variant="outline" onClick={printPDF}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
          <Button variant="outline" onClick={downloadPDF}><FileText className="h-4 w-4 mr-1" />PDF</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card className="p-4 space-y-2 lg:col-span-2">
          <h3 className="font-semibold mb-2">Detalhes</h3>
          <Info label="Cliente" value={`${os.customer_name}${os.customer_phone ? ' • ' + os.customer_phone : ''}`} />
          <Info label="Aparelho" value={[os.device, os.brand, os.model].filter(Boolean).join(' ')} />
          {os.imei_serial && <Info label="IMEI/Serial" value={os.imei_serial} />}
          {os.device_condition && <Info label="Estado" value={os.device_condition} />}
          {os.accessories && <Info label="Acessórios" value={os.accessories} />}
          <Info label="Defeito" value={os.reported_issue} />
          {os.internal_notes && <Info label="Obs internas" value={os.internal_notes} />}
          <Info label="Entrada" value={new Date(os.entry_date).toLocaleString('pt-BR')} />
          {os.estimated_delivery && <Info label="Previsão" value={new Date(os.estimated_delivery).toLocaleDateString('pt-BR')} />}
        </Card>

        <Card className="p-4 space-y-2">
          <h3 className="font-semibold mb-2">Valores</h3>
          <Row label="Mão de obra" value={formatBRL(os.labor_amount)} />
          <Row label="Peças" value={formatBRL(os.parts_amount)} />
          <Row label="Desconto" value={'- ' + formatBRL(os.discount)} />
          <div className="border-t pt-2 mt-2">
            <Row label="Total" value={formatBRL(os.total_amount)} bold />
            <Row label="Pago" value={formatBRL(os.paid_amount)} />
            <Row label="Pendente" value={formatBRL(os.pending_amount)} bold className={os.pending_amount > 0 ? 'text-destructive' : 'text-emerald-600'} />
          </div>
          <Button className="w-full mt-2" onClick={() => setPayOpen(true)} disabled={os.pending_amount <= 0}>
            <DollarSign className="h-4 w-4 mr-2" />Receber pagamento
          </Button>
        </Card>
      </div>

      <Card className="p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-semibold">Serviços e Peças</h3>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" onClick={() => setServiceOpen(true)}><Plus className="h-4 w-4 mr-1" />Serviço</Button>
            <Button size="sm" onClick={() => setPartOpen(true)}><Plus className="h-4 w-4 mr-1" />Peça</Button>
          </div>
        </div>
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground border-b">
            <tr><th className="text-left py-2">Tipo</th><th className="text-left">Descrição</th><th className="text-right">Qtd</th><th className="text-right">Unit.</th><th className="text-right">Total</th><th></th></tr>
          </thead>
          <tbody>
            {items.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-muted-foreground">Nenhum item adicionado</td></tr>}
            {items.map(it => (
              <tr key={it.id} className="border-b">
                <td className="py-2">{it.item_type === 'part' ? 'Peça' : 'Serviço'}</td>
                <td>{it.description}</td>
                <td className="text-right">{it.qty}</td>
                <td className="text-right">{formatBRL(it.unit_price)}</td>
                <td className="text-right font-medium">{formatBRL(it.total)}</td>
                <td className="text-right"><Button size="icon" variant="ghost" onClick={() => removeItem(it.id)}><Trash2 className="h-4 w-4 text-destructive" /></Button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card className="p-4">
          <h3 className="font-semibold mb-3">Pagamentos</h3>
          {payments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pagamento registrado</p>}
          <ul className="space-y-2">
            {payments.map(p => (
              <li key={p.id} className="flex justify-between text-sm border-b pb-2 last:border-0">
                <div>
                  <div className="font-medium">{SO_PAYMENT_METHODS.find(m => m.value === p.method)?.label || p.method}</div>
                  <div className="text-xs text-muted-foreground">{new Date(p.paid_at).toLocaleString('pt-BR')}</div>
                </div>
                <div className="font-semibold">{formatBRL(p.amount)}</div>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="p-4">
          <h3 className="font-semibold mb-3">Histórico</h3>
          <ul className="space-y-2 text-sm">
            {history.map(h => (
              <li key={h.id} className="border-l-2 border-primary pl-3">
                <div className="flex justify-between">
                  <span className="font-medium">{SO_STATUS_LABEL[h.to_status as ServiceOrderStatus] || h.to_status}</span>
                  <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                </div>
                {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <AddServiceDialog open={serviceOpen} onOpenChange={setServiceOpen} osId={os.id} onDone={load} />
      <AddPartDialog open={partOpen} onOpenChange={setPartOpen} osId={os.id} storeId={profile?.store_id || ''} onDone={load} />
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} osId={os.id} pending={os.pending_amount} onDone={load} />
      <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} osId={os.id} current={os.status} onDone={load} />
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="text-sm"><span className="text-muted-foreground">{label}: </span><span>{value}</span></div>;
}
function Row({ label, value, bold, className = '' }: { label: string; value: string; bold?: boolean; className?: string }) {
  return <div className={`flex justify-between text-sm ${bold ? 'font-bold' : ''} ${className}`}><span>{label}</span><span>{value}</span></div>;
}

function AddServiceDialog({ open, onOpenChange, osId, onDone }: any) {
  const [desc, setDesc] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  async function add() {
    if (!desc.trim()) return;
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_add_service', {
      p_os: osId, p_description: desc, p_qty: Number(qty), p_unit_price: Number(price) || 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Serviço adicionado'); setDesc(''); setQty('1'); setPrice(''); onOpenChange(false); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adicionar serviço</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Descrição</Label><Input value={desc} onChange={e => setDesc(e.target.value)} placeholder="Troca de tela, limpeza..." /></div>
          <div className="grid grid-cols-2 gap-2">
            <div><Label>Quantidade</Label><Input type="number" value={qty} onChange={e => setQty(e.target.value)} /></div>
            <div><Label>Valor unitário (R$)</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={add} disabled={saving}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddPartDialog({ open, onOpenChange, osId, storeId, onDone }: any) {
  const [products, setProducts] = useState<any[]>([]);
  const [productId, setProductId] = useState('');
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [saving, setSaving] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!open || !storeId) return;
    (async () => {
      const { data } = await supabase.from('products')
        .select('id, name, brand, model, sale_price, on_hand')
        .eq('store_id', storeId).eq('is_active', true).gt('on_hand', 0)
        .order('name').limit(200);
      setProducts(data || []);
    })();
  }, [open, storeId]);

  const filtered = products.filter(p =>
    !search || `${p.name} ${p.brand || ''} ${p.model || ''}`.toLowerCase().includes(search.toLowerCase())
  );
  const selected = products.find(p => p.id === productId);

  async function add() {
    if (!productId) { toast.error('Selecione um produto'); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_add_part', {
      p_os: osId, p_product: productId, p_qty: parseInt(qty), p_unit_price: Number(price) || 0,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Peça adicionada e estoque baixado');
    setProductId(''); setQty('1'); setPrice(''); setSearch(''); onOpenChange(false); onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Adicionar peça do estoque</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Input placeholder="Buscar produto..." value={search} onChange={e => setSearch(e.target.value)} />
          <div className="max-h-64 overflow-y-auto border rounded">
            {filtered.slice(0, 50).map(p => (
              <button key={p.id} type="button"
                onClick={() => { setProductId(p.id); setPrice(String(p.sale_price || '')); }}
                className={`w-full text-left p-2 hover:bg-muted border-b text-sm ${productId === p.id ? 'bg-primary/10' : ''}`}>
                <div className="flex justify-between">
                  <span>{p.name} {p.brand} {p.model}</span>
                  <span className="text-xs">Estoque: {p.on_hand} • {formatBRL(p.sale_price)}</span>
                </div>
              </button>
            ))}
          </div>
          {selected && (
            <div className="grid grid-cols-2 gap-2">
              <div><Label>Quantidade (máx. {selected.on_hand})</Label><Input type="number" min="1" max={selected.on_hand} value={qty} onChange={e => setQty(e.target.value)} /></div>
              <div><Label>Valor unitário (R$)</Label><Input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} /></div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={add} disabled={saving || !productId}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PaymentDialog({ open, onOpenChange, osId, pending, onDone }: any) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('pix');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (open) setAmount(String(pending || '')); }, [open, pending]);

  async function pay() {
    const val = Number(amount);
    if (!val || val <= 0) { toast.error('Informe um valor'); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_settle_payment', {
      p_os: osId, p_amount: val, p_method: method, p_note: note,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Pagamento registrado e lançado no caixa');
    onOpenChange(false); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Receber pagamento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Valor (R$)</Label><Input type="number" step="0.01" value={amount} onChange={e => setAmount(e.target.value)} /></div>
          <div><Label>Forma de pagamento</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SO_PAYMENT_METHODS.map(m => <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Observação</Label><Input value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={pay} disabled={saving}>Confirmar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusDialog({ open, onOpenChange, osId, current, onDone }: any) {
  const [status, setStatus] = useState<ServiceOrderStatus>(current);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setStatus(current); setNote(''); } }, [open, current]);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_change_status', { p_os: osId, p_status: status, p_note: note });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Status atualizado');
    onOpenChange(false); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Mudar status da OS</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Novo status</Label>
            <Select value={status} onValueChange={v => setStatus(v as ServiceOrderStatus)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {SO_STATUS.map(s => <SelectItem key={s} value={s}>{SO_STATUS_LABEL[s]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Observação</Label><Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
