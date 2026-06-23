import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, Save, Plus, Trash2, ChevronDown, ChevronUp } from 'lucide-react';
import { CustomerSearch } from '@/components/CustomerSearch';
import { toast } from 'sonner';
import { useBusinessLabels } from '@/hooks/useBusinessLabels';

interface EquipmentRow {
  device: string;
  brand: string;
  model: string;
  serial_number: string;
  inventory_number: string;
  condition: string;
  accessories: string;
}

const blankEquip = (): EquipmentRow => ({
  device: '', brand: '', model: '', serial_number: '',
  inventory_number: '', condition: '', accessories: '',
});

export default function NewServiceOrder() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const { labels } = useBusinessLabels();
  const [saving, setSaving] = useState(false);
  const [techs, setTechs] = useState<{ id: string; full_name: string | null; role: string }[]>([]);
  const [isPro, setIsPro] = useState(false);
  const [equipments, setEquipments] = useState<EquipmentRow[]>([blankEquip()]);
  const [showExtraCosts, setShowExtraCosts] = useState(false);

  const [form, setForm] = useState({
    customer_id: '' as string | null,
    customer_name: '',
    customer_phone: '',
    reported_issue: '',
    internal_notes: '',
    priority: 'normal',
    technician_profile_id: '',
    estimated_delivery: '',
    service_description: '',
    service_value: '',
    warranty_days: '',
    warranty_description: '',
    travel_cost: '',
    toll_cost: '',
    km_driven: '',
    km_rate: '',
    other_costs: '',
    other_costs_desc: '',
  });

  useEffect(() => {
    if (!profile?.store_id) return;
    (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('id, full_name, role')
        .eq('store_id', profile.store_id)
        .eq('is_active', true);
      setTechs((data || []) as any);
    })();
  }, [profile?.store_id]);

  const update = (k: keyof typeof form, v: any) => setForm(p => ({ ...p, [k]: v }));

  const updateEquip = (idx: number, field: keyof EquipmentRow, val: string) => {
    setEquipments(prev => prev.map((e, i) => i === idx ? { ...e, [field]: val } : e));
  };

  const addEquip = () => setEquipments(prev => [...prev, blankEquip()]);
  const removeEquip = (idx: number) => setEquipments(prev => prev.filter((_, i) => i !== idx));

  const totalExtraCosts =
    (Number(form.travel_cost) || 0) +
    (Number(form.toll_cost) || 0) +
    (Number(form.km_driven) || 0) * (Number(form.km_rate) || 0) +
    (Number(form.other_costs) || 0);

  async function submit() {
    if (!form.customer_name.trim()) { toast.error('Informe o cliente'); return; }
    const mainEquip = equipments[0];
    if (!mainEquip.device.trim()) { toast.error(`Informe o ${labels.equipment.toLowerCase()}`); return; }
    if (!form.reported_issue.trim()) { toast.error(`Informe ${labels.defect.toLowerCase()}`); return; }
    setSaving(true);
    try {
      const payload = {
        customer_id: form.customer_id || null,
        customer_name: form.customer_name,
        customer_phone: form.customer_phone,
        device: mainEquip.device,
        brand: mainEquip.brand,
        model: mainEquip.model,
        imei_serial: mainEquip.serial_number,
        device_condition: mainEquip.condition,
        accessories: mainEquip.accessories,
        reported_issue: form.reported_issue,
        internal_notes: form.internal_notes,
        priority: form.priority,
        technician_profile_id: form.technician_profile_id || null,
        estimated_delivery: form.estimated_delivery || null,
        is_pro: isPro,
        warranty_days: form.warranty_days ? parseInt(form.warranty_days) : null,
        warranty_description: form.warranty_description || null,
        travel_cost: Number(form.travel_cost) || 0,
        toll_cost: Number(form.toll_cost) || 0,
        km_driven: Number(form.km_driven) || 0,
        km_rate: Number(form.km_rate) || 0,
        other_costs: Number(form.other_costs) || 0,
        other_costs_desc: form.other_costs_desc || null,
      };

      const { data: osId, error } = await (supabase as any).rpc('create_service_order', { p_payload: payload });
      if (error) throw error;

      const val = Number(form.service_value);
      if (val > 0) {
        await (supabase as any).rpc('so_add_service', {
          p_os: osId,
          p_description: form.service_description.trim() || 'Serviço',
          p_qty: 1,
          p_unit_price: val,
        });
      }

      if (isPro && equipments.length > 1) {
        for (let i = 1; i < equipments.length; i++) {
          const eq = equipments[i];
          if (!eq.device.trim()) continue;
          await (supabase as any).rpc('so_add_equipment', { p_os: osId, p_payload: eq });
        }
      }

      toast.success('OS criada!');
      navigate(`/os/${osId}`);
    } catch (e: any) {
      toast.error(e.message || 'Erro ao criar OS');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" onClick={() => navigate('/os')}><ArrowLeft className="h-4 w-4 mr-1" />Voltar</Button>
        <h1 className="text-2xl font-bold">Nova {labels.work_order}</h1>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Modo PRO</span>
          <button
            type="button"
            onClick={() => setIsPro(p => !p)}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${isPro ? 'bg-primary' : 'bg-muted-foreground/30'}`}
          >
            <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${isPro ? 'translate-x-6' : 'translate-x-1'}`} />
          </button>
        </div>
      </div>

      {/* CLIENTE */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Cliente</h2>
        <CustomerSearch
          storeId={profile?.store_id || ''}
          value={form.customer_id}
          onChange={(id, c) => {
            update('customer_id', id);
            if (c) { update('customer_name', c.name); update('customer_phone', c.phone || ''); }
          }}
          allowNone={false}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome do cliente *"><Input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} /></Field>
          <Field label="Telefone"><Input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} /></Field>
        </div>
      </Card>

      {/* EQUIPAMENTOS */}
      <Card className="p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">{isPro ? 'Equipamentos' : labels.os_title}</h2>
          {isPro && (
            <Button type="button" size="sm" variant="outline" onClick={addEquip}>
              <Plus className="h-4 w-4 mr-1" />Adicionar equipamento
            </Button>
          )}
        </div>
        {equipments.map((eq, idx) => (
          <div key={idx} className={`space-y-3 ${idx > 0 ? 'pt-4 border-t' : ''}`}>
            {equipments.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Equipamento #{idx + 1}</span>
                {idx > 0 && (
                  <Button type="button" size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeEquip(idx)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label={`${labels.equipment} *`}><Input value={eq.device} onChange={e => updateEquip(idx, 'device', e.target.value)} placeholder={labels.equipment} /></Field>
              <Field label="Marca"><Input value={eq.brand} onChange={e => updateEquip(idx, 'brand', e.target.value)} /></Field>
              <Field label="Modelo"><Input value={eq.model} onChange={e => updateEquip(idx, 'model', e.target.value)} /></Field>
              <Field label="Nº de série / IMEI"><Input value={eq.serial_number} onChange={e => updateEquip(idx, 'serial_number', e.target.value)} /></Field>
              {isPro && <Field label="Patrimônio / Inventário"><Input value={eq.inventory_number} onChange={e => updateEquip(idx, 'inventory_number', e.target.value)} /></Field>}
              <Field label="Acessórios inclusos"><Input value={eq.accessories} onChange={e => updateEquip(idx, 'accessories', e.target.value)} /></Field>
            </div>
            <Field label={`Estado do ${labels.equipment.toLowerCase()}`}>
              <Textarea rows={2} value={eq.condition} onChange={e => updateEquip(idx, 'condition', e.target.value)} placeholder="Descreva as condições..." />
            </Field>
          </div>
        ))}
      </Card>

      {/* SOLICITAÇÃO */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Solicitação</h2>
        <Field label={`${labels.defect} *`}><Textarea rows={3} value={form.reported_issue} onChange={e => update('reported_issue', e.target.value)} /></Field>
        <Field label="Observações internas"><Textarea rows={2} value={form.internal_notes} onChange={e => update('internal_notes', e.target.value)} /></Field>
      </Card>

      {/* VALOR DO SERVIÇO */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Valor do serviço</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Descrição do serviço">
            <Input value={form.service_description} onChange={e => update('service_description', e.target.value)} placeholder="Troca de tela, limpeza de placa..." />
          </Field>
          <Field label="Mão de obra (R$)">
            <Input type="number" step="0.01" min="0" value={form.service_value} onChange={e => update('service_value', e.target.value)} placeholder="0,00" />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Peças podem ser adicionadas depois de criar a OS.</p>
      </Card>

      {/* CUSTOS EXTRAS (PRO) */}
      {isPro && (
        <Card className="p-6 space-y-4">
          <button type="button" className="flex items-center justify-between w-full text-left" onClick={() => setShowExtraCosts(p => !p)}>
            <h2 className="font-semibold">Custos de deslocamento</h2>
            {showExtraCosts ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </button>
          {showExtraCosts && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Field label="Deslocamento (R$)">
                <Input type="number" step="0.01" min="0" value={form.travel_cost} onChange={e => update('travel_cost', e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Pedágio (R$)">
                <Input type="number" step="0.01" min="0" value={form.toll_cost} onChange={e => update('toll_cost', e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Km rodado">
                <Input type="number" step="0.1" min="0" value={form.km_driven} onChange={e => update('km_driven', e.target.value)} placeholder="0" />
              </Field>
              <Field label="R$/km">
                <Input type="number" step="0.01" min="0" value={form.km_rate} onChange={e => update('km_rate', e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Outros custos (R$)" className="col-span-2">
                <Input type="number" step="0.01" min="0" value={form.other_costs} onChange={e => update('other_costs', e.target.value)} placeholder="0,00" />
              </Field>
              <Field label="Descrição (outros)" className="col-span-2">
                <Input value={form.other_costs_desc} onChange={e => update('other_costs_desc', e.target.value)} placeholder="Ex: hospedagem, alimentação..." />
              </Field>
            </div>
          )}
          {totalExtraCosts > 0 && (
            <p className="text-sm text-muted-foreground">Total extras: <span className="font-semibold text-foreground">R$ {totalExtraCosts.toFixed(2).replace('.', ',')}</span></p>
          )}
        </Card>
      )}

      {/* GARANTIA (PRO) */}
      {isPro && (
        <Card className="p-6 space-y-4">
          <h2 className="font-semibold">Garantia</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Field label="Prazo (dias)">
              <Input type="number" min="0" value={form.warranty_days} onChange={e => update('warranty_days', e.target.value)} placeholder="Ex: 90" />
            </Field>
            <Field label="Descrição da garantia">
              <Input value={form.warranty_description} onChange={e => update('warranty_description', e.target.value)} placeholder="Coberturas e exclusões..." />
            </Field>
          </div>
        </Card>
      )}

      {/* ATENDIMENTO */}
      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Atendimento</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label={`${labels.responsible} responsável`}>
            <Select value={form.technician_profile_id} onValueChange={v => update('technician_profile_id', v)}>
              <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
              <SelectContent>
                {techs.map(t => <SelectItem key={t.id} value={t.id}>{t.full_name || 'Sem nome'} ({t.role})</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Previsão de entrega"><Input type="date" value={form.estimated_delivery} onChange={e => update('estimated_delivery', e.target.value)} /></Field>
          <Field label="Prioridade">
            <Select value={form.priority} onValueChange={v => update('priority', v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="baixa">Baixa</SelectItem>
                <SelectItem value="normal">Normal</SelectItem>
                <SelectItem value="alta">Alta</SelectItem>
                <SelectItem value="urgente">Urgente</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate('/os')}>Cancelar</Button>
        <Button onClick={submit} disabled={saving}><Save className="h-4 w-4 mr-2" />{saving ? 'Salvando...' : 'Criar OS'}</Button>
      </div>
    </div>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className}`}>
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}
