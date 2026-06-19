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
import { ArrowLeft, Save } from 'lucide-react';
import { CustomerSearch } from '@/components/CustomerSearch';
import { toast } from 'sonner';

export default function NewServiceOrder() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [techs, setTechs] = useState<{ id: string; full_name: string | null; role: string }[]>([]);

  const [form, setForm] = useState({
    customer_id: '' as string | null,
    customer_name: '',
    customer_phone: '',
    device: '',
    brand: '',
    model: '',
    imei_serial: '',
    device_password: '',
    accessories: '',
    device_condition: '',
    reported_issue: '',
    internal_notes: '',
    priority: 'normal',
    technician_profile_id: '',
    estimated_delivery: '',
    service_description: '',
    service_value: '',
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

  async function submit() {
    if (!form.customer_name.trim()) { toast.error('Informe o cliente'); return; }
    if (!form.device.trim()) { toast.error('Informe o aparelho'); return; }
    if (!form.reported_issue.trim()) { toast.error('Informe o defeito'); return; }
    setSaving(true);
    try {
      const { service_description, service_value, ...rest } = form;
      const payload = { ...rest, customer_id: form.customer_id || null };
      const { data, error } = await (supabase as any).rpc('create_service_order', { p_payload: payload });
      if (error) throw error;
      const val = Number(service_value);
      if (val > 0) {
        await (supabase as any).rpc('so_add_service', {
          p_os: data,
          p_description: service_description.trim() || 'Serviço',
          p_qty: 1,
          p_unit_price: val,
        });
      }
      toast.success('OS criada!');
      navigate(`/os/${data}`);
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
        <h1 className="text-2xl font-bold">Nova Ordem de Serviço</h1>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Cliente</h2>
        <CustomerSearch
          storeId={profile?.store_id || ''}
          value={form.customer_id}
          onChange={(id, c) => {
            update('customer_id', id);
            if (c) {
              update('customer_name', c.name);
              update('customer_phone', c.phone || '');
            }
          }}
          allowNone={false}
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Nome do cliente *"><Input value={form.customer_name} onChange={e => update('customer_name', e.target.value)} /></Field>
          <Field label="Telefone"><Input value={form.customer_phone} onChange={e => update('customer_phone', e.target.value)} /></Field>
        </div>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Aparelho</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Aparelho *"><Input value={form.device} onChange={e => update('device', e.target.value)} placeholder="Smartphone, Notebook..." /></Field>
          <Field label="Marca"><Input value={form.brand} onChange={e => update('brand', e.target.value)} /></Field>
          <Field label="Modelo"><Input value={form.model} onChange={e => update('model', e.target.value)} /></Field>
          <Field label="IMEI / Serial"><Input value={form.imei_serial} onChange={e => update('imei_serial', e.target.value)} /></Field>
          <Field label="Senha do aparelho"><Input value={form.device_password} onChange={e => update('device_password', e.target.value)} /></Field>
          <Field label="Acessórios deixados"><Input value={form.accessories} onChange={e => update('accessories', e.target.value)} placeholder="Capa, carregador..." /></Field>
        </div>
        <Field label="Estado do aparelho"><Textarea rows={2} value={form.device_condition} onChange={e => update('device_condition', e.target.value)} placeholder="Tela trincada, riscos, etc" /></Field>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Diagnóstico inicial</h2>
        <Field label="Defeito relatado *"><Textarea rows={3} value={form.reported_issue} onChange={e => update('reported_issue', e.target.value)} /></Field>
        <Field label="Observações internas"><Textarea rows={2} value={form.internal_notes} onChange={e => update('internal_notes', e.target.value)} /></Field>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Valor do serviço</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field label="Descrição do serviço">
            <Input
              value={form.service_description}
              onChange={e => update('service_description', e.target.value)}
              placeholder="Troca de tela, limpeza de placa..."
            />
          </Field>
          <Field label="Valor a cobrar (R$)">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={form.service_value}
              onChange={e => update('service_value', e.target.value)}
              placeholder="0,00"
            />
          </Field>
        </div>
        <p className="text-xs text-muted-foreground">Opcional — você pode adicionar ou ajustar serviços e peças depois de criar a OS.</p>
      </Card>

      <Card className="p-6 space-y-4">
        <h2 className="font-semibold">Atendimento</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <Field label="Técnico responsável">
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

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs font-medium">{label}</Label>
      {children}
    </div>
  );
}
