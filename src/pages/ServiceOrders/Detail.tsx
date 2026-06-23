import { useEffect, useState, useCallback, useRef } from 'react';
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
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import {
  ArrowLeft, Plus, Trash2, DollarSign, FileText, Printer,
  Camera, PenLine, Shield, Truck, Package, Wrench, Clock, Save, ImageIcon,
} from 'lucide-react';
import { StatusBadge } from '@/components/service-orders/StatusBadge';
import { SignaturePad } from '@/components/service-orders/SignaturePad';
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
  const [equipments, setEquipments] = useState<any[]>([]);
  const [photos, setPhotos] = useState<any[]>([]);
  const [techName, setTechName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [serviceOpen, setServiceOpen] = useState(false);
  const [partOpen, setPartOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [equipOpen, setEquipOpen] = useState(false);
  const [extraCostsOpen, setExtraCostsOpen] = useState(false);
  const [warrantyOpen, setWarrantyOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const [o, it, pa, hi, eq, ph] = await Promise.all([
      (supabase as any).from('service_orders').select('*').eq('id', id).maybeSingle(),
      (supabase as any).from('service_order_items').select('*').eq('service_order_id', id).order('created_at'),
      (supabase as any).from('service_order_payments').select('*').eq('service_order_id', id).order('paid_at', { ascending: false }),
      (supabase as any).from('service_order_status_history').select('*').eq('service_order_id', id).order('created_at', { ascending: false }),
      (supabase as any).from('service_order_equipment').select('*').eq('service_order_id', id).order('sort_order'),
      (supabase as any).from('service_order_photos').select('*').eq('service_order_id', id).order('created_at'),
    ]);

    const osData = o.data;
    setOs(osData);
    setItems(it.data || []);
    setPayments(pa.data || []);
    setHistory(hi.data || []);
    setEquipments(eq.data || []);
    setPhotos(ph.data || []);

    if (osData?.technician_profile_id) {
      const { data: techData } = await supabase
        .from('profiles')
        .select('full_name')
        .eq('id', osData.technician_profile_id)
        .maybeSingle();
      setTechName((techData as any)?.full_name || null);
    }

    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function removeItem(itemId: string) {
    if (!confirm('Remover este item?')) return;
    const { error } = await (supabase as any).rpc('so_remove_item', { p_item: itemId });
    if (error) toast.error(error.message); else { toast.success('Item removido'); load(); }
  }

  async function removeEquipment(eqId: string) {
    if (!confirm('Remover este equipamento?')) return;
    const { error } = await (supabase as any).rpc('so_remove_equipment', { p_eq_id: eqId });
    if (error) toast.error(error.message); else { toast.success('Equipamento removido'); load(); }
  }

  async function deletePhoto(photoId: string, storagePath: string) {
    if (!confirm('Remover esta foto?')) return;
    await supabase.storage.from('service-order-photos').remove([storagePath]);
    await (supabase as any).from('service_order_photos').delete().eq('id', photoId);
    load();
  }

  function buildPdfPayload() {
    return {
      store: { name: (profile as any)?.store_name || 'Estokfy' },
      os,
      items,
      equipments: equipments.length > 0 ? equipments.map((e: any) => ({
        device: e.device, brand: e.brand, model: e.model,
        serial_number: e.serial_number, inventory_number: e.inventory_number,
        condition: e.condition, accessories: e.accessories,
      })) : undefined,
      technicianName: techName,
    };
  }

  function printPDF() {
    if (!os) return;
    const doc = generateServiceOrderPDF(buildPdfPayload());
    doc.autoPrint();
    window.open(doc.output('bloburl'), '_blank');
  }

  function downloadPDF() {
    if (!os) return;
    const doc = generateServiceOrderPDF(buildPdfPayload());
    doc.save(`OS-${String(os.os_number).padStart(5, '0')}.pdf`);
  }

  const kmAmt = (os?.km_driven || 0) * (os?.km_rate || 0);
  const hasExtraCosts = (os?.travel_cost || 0) > 0 || (os?.toll_cost || 0) > 0 || kmAmt > 0 || (os?.other_costs || 0) > 0;

  if (loading) return <div className="p-8 text-center text-muted-foreground">Carregando...</div>;
  if (!os) return <div className="p-8 text-center">OS não encontrada</div>;

  const isPro = os.is_pro;
  const photosBefore = photos.filter((p: any) => p.photo_type === 'before');
  const photosAfter = photos.filter((p: any) => p.photo_type === 'after');
  const photosOther = photos.filter((p: any) => !p.photo_type || p.photo_type === 'other');

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      {/* HEADER */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/os')}><ArrowLeft className="h-4 w-4" /></Button>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold">OS #{String(os.os_number).padStart(5, '0')}</h1>
              {isPro && <Badge variant="secondary" className="text-xs bg-primary/10 text-primary border-primary/20">PRO</Badge>}
            </div>
            <p className="text-sm text-muted-foreground">{os.customer_name} • {[os.device, os.brand, os.model].filter(Boolean).join(' ')}</p>
          </div>
          <StatusBadge status={os.status} className="ml-2" />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => setStatusOpen(true)}>Mudar status</Button>
          <Button variant="outline" size="sm" onClick={printPDF}><Printer className="h-4 w-4 mr-1" />Imprimir</Button>
          <Button variant="outline" size="sm" onClick={downloadPDF}><FileText className="h-4 w-4 mr-1" />PDF</Button>
        </div>
      </div>

      <Tabs defaultValue="detalhes">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="detalhes">Detalhes</TabsTrigger>
          {isPro && equipments.length > 0 && (
            <TabsTrigger value="equipamentos"><Wrench className="h-3.5 w-3.5 mr-1" />Equipamentos ({equipments.length})</TabsTrigger>
          )}
          <TabsTrigger value="servicos"><Package className="h-3.5 w-3.5 mr-1" />Serviços e Peças</TabsTrigger>
          <TabsTrigger value="financeiro"><DollarSign className="h-3.5 w-3.5 mr-1" />Financeiro</TabsTrigger>
          {isPro && <TabsTrigger value="fotos"><Camera className="h-3.5 w-3.5 mr-1" />Fotos ({photos.length})</TabsTrigger>}
          {isPro && <TabsTrigger value="assinaturas"><PenLine className="h-3.5 w-3.5 mr-1" />Assinaturas</TabsTrigger>}
          <TabsTrigger value="historico"><Clock className="h-3.5 w-3.5 mr-1" />Histórico</TabsTrigger>
        </TabsList>

        {/* ── DETALHES ── */}
        <TabsContent value="detalhes" className="mt-4 space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold mb-2">Cliente</h3>
              <Info label="Nome" value={os.customer_name} />
              {os.customer_phone && <Info label="Telefone" value={os.customer_phone} />}
            </Card>
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold mb-2">Equipamento principal</h3>
              <Info label="Aparelho" value={[os.device, os.brand, os.model].filter(Boolean).join(' ')} />
              {os.imei_serial && <Info label="Serial/IMEI" value={os.imei_serial} />}
              {os.device_condition && <Info label="Estado" value={os.device_condition} />}
              {os.accessories && <Info label="Acessórios" value={os.accessories} />}
            </Card>
          </div>

          <Card className="p-4 space-y-2">
            <h3 className="font-semibold mb-2">Solicitação</h3>
            <Info label="Defeito" value={os.reported_issue} />
            {os.internal_notes && <Info label="Obs internas" value={os.internal_notes} />}
            <Info label="Entrada" value={new Date(os.entry_date).toLocaleString('pt-BR')} />
            {os.estimated_delivery && <Info label="Previsão" value={new Date(os.estimated_delivery).toLocaleDateString('pt-BR')} />}
            {os.delivered_at && <Info label="Entregue em" value={new Date(os.delivered_at).toLocaleString('pt-BR')} />}
            {techName && <Info label="Técnico" value={techName} />}
          </Card>

          <Card className="p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold">Serviços executados</h3>
              <Button size="sm" variant="ghost" onClick={() => setNotesOpen(true)}>
                <Save className="h-4 w-4 mr-1" />{os.executed_services_notes ? 'Editar' : 'Adicionar'}
              </Button>
            </div>
            {os.executed_services_notes
              ? <p className="text-sm whitespace-pre-wrap">{os.executed_services_notes}</p>
              : <p className="text-sm text-muted-foreground">Nenhuma nota de serviços executados.</p>
            }
          </Card>

          {isPro && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2"><Shield className="h-4 w-4 text-primary" />Garantia</h3>
                  <Button size="sm" variant="ghost" onClick={() => setWarrantyOpen(true)}>Editar</Button>
                </div>
                {os.warranty_days ? (
                  <>
                    <p className="text-sm font-medium">{os.warranty_days} dias</p>
                    {os.warranty_description && <p className="text-xs text-muted-foreground mt-1">{os.warranty_description}</p>}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">Não definida</p>
                )}
              </Card>

              <Card className="p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold flex items-center gap-2"><Truck className="h-4 w-4 text-primary" />Deslocamento</h3>
                  <Button size="sm" variant="ghost" onClick={() => setExtraCostsOpen(true)}>Editar</Button>
                </div>
                {hasExtraCosts ? (
                  <div className="space-y-1 text-sm">
                    {(os.travel_cost || 0) > 0 && <Row label="Deslocamento" value={formatBRL(os.travel_cost)} />}
                    {(os.toll_cost || 0) > 0 && <Row label="Pedágio" value={formatBRL(os.toll_cost)} />}
                    {kmAmt > 0 && <Row label={`${os.km_driven} km × ${formatBRL(os.km_rate)}`} value={formatBRL(kmAmt)} />}
                    {(os.other_costs || 0) > 0 && <Row label={os.other_costs_desc || 'Outros'} value={formatBRL(os.other_costs)} />}
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Nenhum custo de deslocamento</p>
                )}
              </Card>
            </div>
          )}
        </TabsContent>

        {/* ── EQUIPAMENTOS ── */}
        {isPro && (
          <TabsContent value="equipamentos" className="mt-4">
            <div className="flex justify-end mb-3">
              <Button size="sm" onClick={() => setEquipOpen(true)}><Plus className="h-4 w-4 mr-1" />Adicionar equipamento</Button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {equipments.map((eq: any) => (
                <Card key={eq.id} className="p-4">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <p className="font-medium">{[eq.device, eq.brand, eq.model].filter(Boolean).join(' ')}</p>
                      {eq.serial_number && <p className="text-xs text-muted-foreground">Serial: {eq.serial_number}</p>}
                      {eq.inventory_number && <p className="text-xs text-muted-foreground">Patrimônio: {eq.inventory_number}</p>}
                      {eq.condition && <p className="text-xs text-muted-foreground">Estado: {eq.condition}</p>}
                      {eq.accessories && <p className="text-xs text-muted-foreground">Acessórios: {eq.accessories}</p>}
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive shrink-0" onClick={() => removeEquipment(eq.id)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </Card>
              ))}
              {equipments.length === 0 && (
                <p className="text-sm text-muted-foreground col-span-2 text-center py-8">Nenhum equipamento adicional</p>
              )}
            </div>
          </TabsContent>
        )}

        {/* ── SERVIÇOS E PEÇAS ── */}
        <TabsContent value="servicos" className="mt-4">
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
                {items.map((it: any) => (
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
        </TabsContent>

        {/* ── FINANCEIRO ── */}
        <TabsContent value="financeiro" className="mt-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="p-4 space-y-2">
              <h3 className="font-semibold mb-2">Valores</h3>
              <Row label="Mão de obra" value={formatBRL(os.labor_amount)} />
              <Row label="Peças" value={formatBRL(os.parts_amount)} />
              {(os.travel_cost || 0) > 0 && <Row label="Deslocamento" value={formatBRL(os.travel_cost)} />}
              {(os.toll_cost || 0) > 0 && <Row label="Pedágio" value={formatBRL(os.toll_cost)} />}
              {kmAmt > 0 && <Row label={`Km (${os.km_driven} × ${formatBRL(os.km_rate)})`} value={formatBRL(kmAmt)} />}
              {(os.other_costs || 0) > 0 && <Row label={os.other_costs_desc || 'Outros'} value={formatBRL(os.other_costs)} />}
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

            <Card className="p-4">
              <h3 className="font-semibold mb-3">Pagamentos</h3>
              {payments.length === 0 && <p className="text-sm text-muted-foreground">Nenhum pagamento registrado</p>}
              <ul className="space-y-2">
                {payments.map((p: any) => (
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
          </div>
        </TabsContent>

        {/* ── FOTOS ── */}
        {isPro && (
          <TabsContent value="fotos" className="mt-4 space-y-4">
            <PhotoUploadSection osId={os.id} storeId={profile?.store_id || ''} onDone={load} />
            {[
              { label: 'Antes', group: photosBefore },
              { label: 'Depois', group: photosAfter },
              { label: 'Outras', group: photosOther },
            ].filter(({ group }) => group.length > 0).map(({ label, group }) => (
              <Card key={label} className="p-4">
                <h3 className="font-semibold mb-3">{label} ({group.length})</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {group.map((ph: any) => (
                    <div key={ph.id} className="relative group">
                      <img
                        src={supabase.storage.from('service-order-photos').getPublicUrl(ph.storage_path).data.publicUrl}
                        alt={ph.caption || label}
                        className="w-full h-32 object-cover rounded-md border"
                      />
                      {ph.caption && <p className="text-xs text-muted-foreground mt-1 truncate">{ph.caption}</p>}
                      <Button
                        size="icon"
                        variant="destructive"
                        className="absolute top-1 right-1 h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                        onClick={() => deletePhoto(ph.id, ph.storage_path)}
                      >
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
              </Card>
            ))}
            {photos.length === 0 && (
              <div className="text-center py-12 text-muted-foreground">
                <Camera className="h-10 w-10 mx-auto mb-2 opacity-30" />
                <p>Nenhuma foto adicionada ainda</p>
              </div>
            )}
          </TabsContent>
        )}

        {/* ── ASSINATURAS ── */}
        {isPro && (
          <TabsContent value="assinaturas" className="mt-4">
            <SignaturesSection os={os} onDone={load} />
          </TabsContent>
        )}

        {/* ── HISTÓRICO ── */}
        <TabsContent value="historico" className="mt-4">
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Histórico de status</h3>
            <ul className="space-y-2 text-sm">
              {history.map((h: any) => (
                <li key={h.id} className="border-l-2 border-primary pl-3">
                  <div className="flex justify-between">
                    <span className="font-medium">{SO_STATUS_LABEL[h.to_status as ServiceOrderStatus] || h.to_status}</span>
                    <span className="text-xs text-muted-foreground">{new Date(h.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {h.note && <p className="text-xs text-muted-foreground">{h.note}</p>}
                </li>
              ))}
              {history.length === 0 && <li className="text-muted-foreground">Nenhum histórico</li>}
            </ul>
          </Card>
        </TabsContent>
      </Tabs>

      <AddServiceDialog open={serviceOpen} onOpenChange={setServiceOpen} osId={os.id} onDone={load} />
      <AddPartDialog open={partOpen} onOpenChange={setPartOpen} osId={os.id} storeId={profile?.store_id || ''} onDone={load} />
      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} osId={os.id} pending={os.pending_amount} onDone={load} />
      <StatusDialog open={statusOpen} onOpenChange={setStatusOpen} osId={os.id} current={os.status} onDone={load} />
      <AddEquipmentDialog open={equipOpen} onOpenChange={setEquipOpen} osId={os.id} onDone={load} />
      <ExtraCostsDialog open={extraCostsOpen} onOpenChange={setExtraCostsOpen} os={os} onDone={load} />
      <WarrantyDialog open={warrantyOpen} onOpenChange={setWarrantyOpen} os={os} onDone={load} />
      <ExecutedNotesDialog open={notesOpen} onOpenChange={setNotesOpen} os={os} onDone={load} />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function Info({ label, value }: { label: string; value: string }) {
  return <div className="text-sm"><span className="text-muted-foreground">{label}: </span><span>{value}</span></div>;
}
function Row({ label, value, bold, className = '' }: { label: string; value: string; bold?: boolean; className?: string }) {
  return <div className={`flex justify-between text-sm ${bold ? 'font-bold' : ''} ${className}`}><span>{label}</span><span>{value}</span></div>;
}

// ── Signatures ────────────────────────────────────────────────
function SignaturesSection({ os, onDone }: { os: any; onDone: () => void }) {
  const [techSig, setTechSig] = useState<string | null>(os.technician_signature_url || null);
  const [clientSig, setClientSig] = useState<string | null>(os.client_signature_url || null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_update_signatures', {
      p_os: os.id,
      p_tech_sig: techSig,
      p_client_sig: clientSig,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Assinaturas salvas');
    onDone();
  }

  return (
    <Card className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold flex items-center gap-2"><PenLine className="h-4 w-4" />Assinaturas digitais</h3>
        <Button size="sm" onClick={save} disabled={saving}>
          <Save className="h-4 w-4 mr-1" />{saving ? 'Salvando...' : 'Salvar'}
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <SignaturePad label="Assinatura do Técnico" value={techSig} onChange={setTechSig} />
        <SignaturePad label="Assinatura do Cliente" value={clientSig} onChange={setClientSig} />
      </div>
      <p className="text-xs text-muted-foreground">As assinaturas serão incluídas no PDF.</p>
    </Card>
  );
}

// ── Photo Upload ──────────────────────────────────────────────
function PhotoUploadSection({ osId, storeId, onDone }: { osId: string; storeId: string; onDone: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [photoType, setPhotoType] = useState('before');
  const [caption, setCaption] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function upload(file: File) {
    setUploading(true);
    try {
      const ext = file.name.split('.').pop();
      const path = `${storeId}/${osId}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('service-order-photos')
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;

      const { error: dbErr } = await (supabase as any).rpc('so_add_photo_pro', {
        p_os: osId,
        p_storage_path: path,
        p_caption: caption || null,
        p_photo_type: photoType,
      });
      if (dbErr) throw dbErr;

      toast.success('Foto adicionada');
      setCaption('');
      onDone();
    } catch (e: any) {
      toast.error(e.message || 'Erro ao fazer upload');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="font-semibold mb-3 flex items-center gap-2"><ImageIcon className="h-4 w-4" />Adicionar foto</h3>
      <div className="flex flex-wrap gap-3 items-end">
        <div className="space-y-1">
          <Label className="text-xs">Tipo</Label>
          <Select value={photoType} onValueChange={setPhotoType}>
            <SelectTrigger className="w-28"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="before">Antes</SelectItem>
              <SelectItem value="after">Depois</SelectItem>
              <SelectItem value="other">Outra</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1 flex-1 min-w-[140px]">
          <Label className="text-xs">Legenda (opcional)</Label>
          <Input value={caption} onChange={e => setCaption(e.target.value)} placeholder="Descreva a foto..." />
        </div>
        <Button disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Camera className="h-4 w-4 mr-1" />{uploading ? 'Enviando...' : 'Escolher foto'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }}
        />
      </div>
    </Card>
  );
}

// ── Dialogs ───────────────────────────────────────────────────
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
    toast.success('Pagamento registrado');
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

function AddEquipmentDialog({ open, onOpenChange, osId, onDone }: any) {
  const [form, setForm] = useState({ device: '', brand: '', model: '', serial_number: '', inventory_number: '', condition: '', accessories: '' });
  const [saving, setSaving] = useState(false);
  const u = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }));

  async function add() {
    if (!form.device.trim()) { toast.error('Informe o equipamento'); return; }
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_add_equipment', { p_os: osId, p_payload: form });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Equipamento adicionado');
    setForm({ device: '', brand: '', model: '', serial_number: '', inventory_number: '', condition: '', accessories: '' });
    onOpenChange(false); onDone();
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Adicionar equipamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><Label>Equipamento *</Label><Input value={form.device} onChange={e => u('device', e.target.value)} /></div>
          <div><Label>Marca</Label><Input value={form.brand} onChange={e => u('brand', e.target.value)} /></div>
          <div><Label>Modelo</Label><Input value={form.model} onChange={e => u('model', e.target.value)} /></div>
          <div><Label>Nº de série</Label><Input value={form.serial_number} onChange={e => u('serial_number', e.target.value)} /></div>
          <div><Label>Patrimônio</Label><Input value={form.inventory_number} onChange={e => u('inventory_number', e.target.value)} /></div>
          <div className="col-span-2"><Label>Estado</Label><Input value={form.condition} onChange={e => u('condition', e.target.value)} /></div>
          <div className="col-span-2"><Label>Acessórios</Label><Input value={form.accessories} onChange={e => u('accessories', e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={add} disabled={saving}>Adicionar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExtraCostsDialog({ open, onOpenChange, os, onDone }: any) {
  const [form, setForm] = useState({ travel: '', toll: '', km: '', km_rate: '', other: '', other_desc: '' });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setForm({
      travel: String(os.travel_cost || ''),
      toll: String(os.toll_cost || ''),
      km: String(os.km_driven || ''),
      km_rate: String(os.km_rate || ''),
      other: String(os.other_costs || ''),
      other_desc: os.other_costs_desc || '',
    });
  }, [open, os]);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_update_extra_costs', {
      p_os: os.id,
      p_travel: Number(form.travel) || 0,
      p_toll: Number(form.toll) || 0,
      p_km: Number(form.km) || 0,
      p_km_rate: Number(form.km_rate) || 0,
      p_other: Number(form.other) || 0,
      p_other_desc: form.other_desc || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Custos atualizados');
    onOpenChange(false); onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Custos de deslocamento</DialogTitle></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div><Label>Deslocamento (R$)</Label><Input type="number" step="0.01" value={form.travel} onChange={e => setForm(p => ({ ...p, travel: e.target.value }))} /></div>
          <div><Label>Pedágio (R$)</Label><Input type="number" step="0.01" value={form.toll} onChange={e => setForm(p => ({ ...p, toll: e.target.value }))} /></div>
          <div><Label>Km rodado</Label><Input type="number" step="0.1" value={form.km} onChange={e => setForm(p => ({ ...p, km: e.target.value }))} /></div>
          <div><Label>R$/km</Label><Input type="number" step="0.01" value={form.km_rate} onChange={e => setForm(p => ({ ...p, km_rate: e.target.value }))} /></div>
          <div><Label>Outros (R$)</Label><Input type="number" step="0.01" value={form.other} onChange={e => setForm(p => ({ ...p, other: e.target.value }))} /></div>
          <div><Label>Descrição</Label><Input value={form.other_desc} onChange={e => setForm(p => ({ ...p, other_desc: e.target.value }))} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WarrantyDialog({ open, onOpenChange, os, onDone }: any) {
  const [days, setDays] = useState('');
  const [desc, setDesc] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) { setDays(String(os.warranty_days || '')); setDesc(os.warranty_description || ''); } }, [open, os]);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_update_warranty', {
      p_os: os.id,
      p_days: days ? parseInt(days) : null,
      p_description: desc || null,
    });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Garantia atualizada');
    onOpenChange(false); onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Garantia</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Prazo (dias)</Label><Input type="number" min="0" value={days} onChange={e => setDays(e.target.value)} placeholder="90" /></div>
          <div><Label>Descrição</Label><Textarea rows={3} value={desc} onChange={e => setDesc(e.target.value)} placeholder="Coberturas, exclusões..." /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ExecutedNotesDialog({ open, onOpenChange, os, onDone }: any) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (open) setNotes(os.executed_services_notes || ''); }, [open, os]);

  async function save() {
    setSaving(true);
    const { error } = await (supabase as any).rpc('so_update_executed_notes', { p_os: os.id, p_notes: notes });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success('Notas salvas');
    onOpenChange(false); onDone();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader><DialogTitle>Serviços executados</DialogTitle></DialogHeader>
        <Textarea rows={8} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Descreva os serviços realizados em detalhes..." />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>Salvar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
