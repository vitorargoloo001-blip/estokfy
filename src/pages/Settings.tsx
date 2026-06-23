import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useStoreSettings } from '@/hooks/useStoreSettings';
import { useTheme } from '@/hooks/useTheme';
import { SettingSwitch, SettingInput, SettingSelect } from '@/components/settings/SettingControls';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  Store, Users, Settings2, Package, ShoppingCart, DollarSign, Truck, RotateCcw,
  BarChart3, Bell, Bot, Shield, Plug, Database, Save, Loader2, Search,
  Plus, UserCog, Eye, RefreshCw, AlertTriangle, Download, Upload, BookOpen,
  Zap, Copy, Check, EyeOff, Globe, Activity, Code, Wifi, WifiOff,
  CheckCircle2, XCircle, Clock, Send, Printer,
} from 'lucide-react';
import PrintingSettings from '@/components/settings/PrintingSettings';
import { cn } from '@/lib/utils';
import { maskCNPJ, maskPhone, maskCEP, validateCNPJ, validatePhone, validateCEP } from '@/lib/masks';
import { useIsMobile } from '@/hooks/use-mobile';
import { BUSINESS_TYPE_OPTIONS } from '@/lib/businessProfiles';
import { useBusinessLabels } from '@/hooks/useBusinessLabels';

const TABS = [
  { id: 'store', label: 'Dados da Loja', icon: Store },
  { id: 'users', label: 'Usuários e Permissões', icon: Users },
  { id: 'preferences', label: 'Preferências', icon: Settings2 },
  { id: 'inventory', label: 'Produtos e Estoque', icon: Package },
  { id: 'sales', label: 'Vendas', icon: ShoppingCart },
  { id: 'finance', label: 'Financeiro', icon: DollarSign },
  { id: 'shipping', label: 'Entregas', icon: Truck },
  { id: 'returns', label: 'Trocas e Devoluções', icon: RotateCcw },
  { id: 'dashboard', label: 'Relatórios e Dashboard', icon: BarChart3 },
  { id: 'printing', label: 'Impressão', icon: Printer },
  { id: 'notifications', label: 'Notificações', icon: Bell },
  { id: 'ai_agent', label: 'Assistente IA', icon: Bot },
  { id: 'security', label: 'Segurança', icon: Shield },
  { id: 'integrations', label: 'Integrações', icon: Plug },
  { id: 'backup', label: 'Backup e Dados', icon: Database },
];

function SaveBar({ dirty, saving, onSave }: { dirty: boolean; saving: boolean; onSave: () => void }) {
  if (!dirty) return null;
  return (
    <div className="sticky bottom-0 z-10 bg-background border-t p-3 flex items-center justify-between -mx-6 -mb-6 mt-4">
      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400">
        <AlertTriangle className="h-4 w-4" />
        Alterações não salvas
      </div>
      <Button onClick={onSave} disabled={saving} size="sm">
        {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
        Salvar alterações
      </Button>
    </div>
  );
}

function SectionTitle({ children, description }: { children: React.ReactNode; description?: string }) {
  return (
    <div className="mb-4">
      <h3 className="text-base font-semibold">{children}</h3>
      {description && <p className="text-sm text-muted-foreground mt-0.5">{description}</p>}
    </div>
  );
}

// ─── TAB: DADOS DA LOJA ────────────────────────────────────────────
function StoreTab() {
  const { profile } = useAuth();
  const [store, setStore] = useState<any>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!profile) return;
    supabase.from('stores').select('*').eq('id', profile.store_id).single()
      .then(({ data }) => { if (data) setStore(data); setLoading(false); });
  }, [profile]);

  const upd = (k: string, v: string) => { setStore((p: any) => ({ ...p, [k]: v })); setDirty(true); };

  const save = async () => {
    const newErrors: Record<string, string> = {};
    if (store.cnpj && !validateCNPJ(store.cnpj)) newErrors.cnpj = 'CNPJ inválido';
    if (store.phone && !validatePhone(store.phone)) newErrors.phone = 'Telefone inválido';
    if (store.whatsapp && !validatePhone(store.whatsapp)) newErrors.whatsapp = 'WhatsApp inválido';
    if (store.zip_code && !validateCEP(store.zip_code)) newErrors.zip_code = 'CEP inválido';
    setErrors(newErrors);
    if (Object.keys(newErrors).length > 0) { toast.error('Corrija os campos inválidos'); return; }
    setSaving(true);
    const { error } = await supabase.from('stores').update({
      name: store.name, trade_name: store.trade_name, legal_name: store.legal_name,
      cnpj: store.cnpj, state_registration: store.state_registration,
      phone: store.phone, whatsapp: store.whatsapp, email: store.email,
      address: store.address, zip_code: store.zip_code, city: store.city, state: store.state,
      primary_color: store.primary_color, secondary_color: store.secondary_color,
    }).eq('id', profile!.store_id);
    if (error) toast.error('Erro ao salvar'); else { toast.success('Dados da loja salvos!'); setDirty(false); }
    setSaving(false);
  };

  if (loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;

  return (
    <div className="space-y-6">
      <SectionTitle description="Informações principais da sua empresa.">Dados da Loja</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingInput label="Nome da loja" value={store.name} onChange={v => upd('name', v)} />
        <SettingInput label="Nome fantasia" value={store.trade_name} onChange={v => upd('trade_name', v)} />
        <SettingInput label="Razão social" value={store.legal_name} onChange={v => upd('legal_name', v)} />
        <SettingInput label="CNPJ" value={store.cnpj} onChange={v => upd('cnpj', v)} placeholder="00.000.000/0000-00" mask={maskCNPJ} error={errors.cnpj} />
        <SettingInput label="Inscrição estadual" value={store.state_registration} onChange={v => upd('state_registration', v)} />
        <SettingInput label="Telefone principal" value={store.phone} onChange={v => upd('phone', v)} placeholder="(00) 0000-0000" mask={maskPhone} error={errors.phone} />
        <SettingInput label="WhatsApp" value={store.whatsapp} onChange={v => upd('whatsapp', v)} placeholder="(00) 00000-0000" mask={maskPhone} error={errors.whatsapp} />
        <SettingInput label="E-mail" value={store.email} onChange={v => upd('email', v)} type="email" />
      </div>
      <Separator />
      <SectionTitle description="Endereço completo da loja.">Endereço</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2"><SettingInput label="Endereço" value={store.address} onChange={v => upd('address', v)} /></div>
        <SettingInput label="CEP" value={store.zip_code} onChange={v => upd('zip_code', v)} placeholder="00000-000" mask={maskCEP} error={errors.zip_code} />
        <SettingInput label="Cidade" value={store.city} onChange={v => upd('city', v)} />
        <SettingInput label="Estado" value={store.state} onChange={v => upd('state', v)} />
      </div>
      <Separator />
      <SectionTitle description="Personalização visual.">Aparência</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-sm">Cor principal</Label>
          <div className="flex gap-2 items-center">
            <input type="color" value={store.primary_color || '#3B82F6'} onChange={e => upd('primary_color', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
            <Input value={store.primary_color || '#3B82F6'} onChange={e => upd('primary_color', e.target.value)} className="w-28" />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm">Cor secundária</Label>
          <div className="flex gap-2 items-center">
            <input type="color" value={store.secondary_color || '#1E40AF'} onChange={e => upd('secondary_color', e.target.value)} className="h-9 w-12 rounded border cursor-pointer" />
            <Input value={store.secondary_color || '#1E40AF'} onChange={e => upd('secondary_color', e.target.value)} className="w-28" />
          </div>
        </div>
      </div>
      <Separator />
      <SectionTitle description="Define como o Estokfy se adapta ao seu segmento: menus, terminologia e campos específicos.">
        Perfil do Negócio
      </SectionTitle>
      {profile?.store_id && (
        <BusinessTypeSelector storeId={profile.store_id} currentType={store.business_type} />
      )}
      <SaveBar dirty={dirty} saving={saving} onSave={save} />
    </div>
  );
}

function BusinessTypeSelector({ storeId, currentType }: { storeId: string; currentType?: string }) {
  const { invalidate } = useBusinessLabels();
  const [savingType, setSavingType] = useState(false);
  const [value, setValue] = useState(currentType || 'retail');

  useEffect(() => { if (currentType) setValue(currentType); }, [currentType]);

  const handleChange = async (v: string) => {
    setValue(v);
    setSavingType(true);
    const { error } = await supabase.rpc('set_store_business_type' as any, {
      p_store_id: storeId,
      p_business_type: v,
    });
    setSavingType(false);
    if (error) { toast.error('Erro ao salvar tipo de negócio'); return; }
    invalidate();
    toast.success('Tipo de negócio atualizado! Recarregue a página para ver as mudanças.');
  };

  return (
    <div className="space-y-3">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {BUSINESS_TYPE_OPTIONS.map(opt => (
          <button
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            disabled={savingType}
            className={cn(
              'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition-all text-left',
              value === opt.value
                ? 'border-primary bg-primary/5 text-primary'
                : 'border-border hover:border-primary/40 hover:bg-muted/40'
            )}
          >
            {value === opt.value && <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" />}
            {opt.label}
          </button>
        ))}
      </div>
      {savingType && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Salvando...
        </p>
      )}
    </div>
  );
}

// ─── TAB: USUÁRIOS E PERMISSÕES ────────────────────────────────────
function UsersTab() {
  const { profile } = useAuth();
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [addOpen, setAddOpen] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', full_name: '', role: 'sales' });

  useEffect(() => {
    if (!profile) return;
    supabase.from('profiles').select('*').eq('store_id', profile.store_id).order('created_at')
      .then(({ data }) => { setUsers(data || []); setLoading(false); });
  }, [profile]);

  const roles = [
    { value: 'owner', label: 'Proprietário' },
    { value: 'admin', label: 'Administrador' },
    { value: 'manager', label: 'Gerente' },
    { value: 'sales', label: 'Vendedor' },
    { value: 'stock', label: 'Estoquista' },
    { value: 'finance', label: 'Financeiro' },
    { value: 'viewer', label: 'Visualizador' },
  ];

  const roleLabel = (r: string) => roles.find(x => x.value === r)?.label || r;

  const toggleActive = async (u: any) => {
    await supabase.from('profiles').update({ is_active: !u.is_active }).eq('id', u.id);
    setUsers(prev => prev.map(x => x.id === u.id ? { ...x, is_active: !x.is_active } : x));
    toast.success(u.is_active ? 'Usuário desativado' : 'Usuário ativado');
  };

  const changeRole = async (userId: string, role: string) => {
    await supabase.from('profiles').update({ role }).eq('id', userId);
    setUsers(prev => prev.map(x => x.id === userId ? { ...x, role } : x));
    toast.success('Função atualizada');
  };

  const handleAddUser = async () => {
    if (!newUser.email || !newUser.password || !newUser.full_name) {
      toast.error('Preencha todos os campos'); return;
    }
    toast.info('Para adicionar usuários, use o convite por e-mail na tela de autenticação.');
    setAddOpen(false);
  };

  const PERMS = [
    'Ver dashboard', 'Cadastrar produto', 'Editar produto', 'Excluir produto',
    'Ajustar estoque', 'Criar venda', 'Cancelar venda', 'Registrar gasto',
    'Ver relatórios', 'Gerenciar entregas', 'Registrar trocas', 'Acessar configurações', 'Gerenciar usuários',
  ];

  const rolePerms: Record<string, boolean[]> = {
    owner:   [true,true,true,true,true,true,true,true,true,true,true,true,true],
    admin:   [true,true,true,true,true,true,true,true,true,true,true,true,true],
    manager: [true,true,true,false,true,true,true,true,true,true,true,true,false],
    sales:   [true,false,false,false,false,true,false,false,false,false,false,false,false],
    stock:   [true,true,true,false,true,false,false,false,false,false,false,false,false],
    finance: [true,false,false,false,false,false,false,true,true,false,false,false,false],
    viewer:  [true,false,false,false,false,false,false,false,true,false,false,false,false],
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <SectionTitle description="Gerencie os colaboradores e suas permissões.">Usuários e Permissões</SectionTitle>
        <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Adicionar usuário</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Função</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Ações</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin mx-auto" /></TableCell></TableRow>
              ) : users.map(u => (
                <TableRow key={u.id}>
                  <TableCell>
                    <div>
                      <p className="text-sm font-medium">{u.full_name || 'Sem nome'}</p>
                      <p className="text-xs text-muted-foreground">{u.auth_user_id?.slice(0, 8)}...</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Select value={u.role} onValueChange={v => changeRole(u.id, v)}>
                      <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {roles.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </TableCell>
                  <TableCell>
                    <Badge className={u.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}>
                      {u.is_active ? 'Ativo' : 'Inativo'}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="sm" onClick={() => toggleActive(u)}>
                      {u.is_active ? 'Desativar' : 'Ativar'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-sm flex items-center gap-2"><UserCog className="h-4 w-4" /> Matriz de Permissões</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="min-w-[140px]">Permissão</TableHead>
                {roles.map(r => <TableHead key={r.value} className="text-center text-xs min-w-[80px]">{r.label}</TableHead>)}
              </TableRow>
            </TableHeader>
            <TableBody>
              {PERMS.map((perm, i) => (
                <TableRow key={perm}>
                  <TableCell className="text-xs">{perm}</TableCell>
                  {roles.map(r => (
                    <TableCell key={r.value} className="text-center">
                      {rolePerms[r.value]?.[i] ? (
                        <span className="text-emerald-500">✓</span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Adicionar Usuário</DialogTitle>
            <DialogDescription>Preencha os dados do novo colaborador.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <SettingInput label="Nome completo" value={newUser.full_name} onChange={v => setNewUser(p => ({ ...p, full_name: v }))} />
            <SettingInput label="E-mail" value={newUser.email} onChange={v => setNewUser(p => ({ ...p, email: v }))} type="email" />
            <SettingInput label="Senha temporária" value={newUser.password} onChange={v => setNewUser(p => ({ ...p, password: v }))} type="password" />
            <SettingSelect label="Função" value={newUser.role} onChange={v => setNewUser(p => ({ ...p, role: v }))} options={roles} />
            <Button onClick={handleAddUser} className="w-full">Criar usuário</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── TAB: PREFERÊNCIAS ──────────────────────────────────────────────
function PreferencesTab() {
  const s = useStoreSettings('preferences');
  const { dark, toggle } = useTheme();
  const { profile, toggleGuidePreference, setShowGuide } = useAuth();

  const defaults = {
    theme: dark ? 'dark' : 'light', language: 'pt-BR', date_format: 'dd/MM/yyyy',
    currency: 'BRL', timezone: 'America/Sao_Paulo', items_per_page: '20',
    sounds: true, animations: true, dashboard_mode: 'complete', fast_mode: false,
  };
  const v = (k: string) => s.settings[k] ?? (defaults as any)[k];

  return (
    <div className="space-y-6">
      <SectionTitle description="Defina como o sistema deve se comportar no dia a dia.">Preferências do Sistema</SectionTitle>
      <div className="grid gap-4 sm:grid-cols-2">
        <SettingSelect label="Tema" value={v('theme')} onChange={v2 => { s.update('theme', v2); if ((v2 === 'dark') !== dark) toggle(); }}
          options={[{ value: 'light', label: 'Claro' }, { value: 'dark', label: 'Escuro' }]} />
        <SettingSelect label="Idioma" value={v('language')} onChange={v2 => s.update('language', v2)}
          options={[{ value: 'pt-BR', label: 'Português (BR)' }]} />
        <SettingSelect label="Formato de data" value={v('date_format')} onChange={v2 => s.update('date_format', v2)}
          options={[{ value: 'dd/MM/yyyy', label: 'DD/MM/AAAA' }, { value: 'yyyy-MM-dd', label: 'AAAA-MM-DD' }]} />
        <SettingSelect label="Moeda" value={v('currency')} onChange={v2 => s.update('currency', v2)}
          options={[{ value: 'BRL', label: 'Real (BRL)' }]} />
        <SettingSelect label="Fuso horário" value={v('timezone')} onChange={v2 => s.update('timezone', v2)}
          options={[{ value: 'America/Sao_Paulo', label: 'São Paulo (GMT-3)' }]} />
        <SettingInput label="Itens por página" value={v('items_per_page')} onChange={v2 => s.update('items_per_page', v2)} type="number" />
      </div>
      <Separator />
      <SettingSwitch label="Habilitar sons de alerta" checked={v('sounds')} onChange={v2 => s.update('sounds', v2)} />
      <SettingSwitch label="Habilitar animações suaves" checked={v('animations')} onChange={v2 => s.update('animations', v2)} />
      <SettingSelect label="Dashboard" value={v('dashboard_mode')} onChange={v2 => s.update('dashboard_mode', v2)}
        options={[{ value: 'complete', label: 'Completo' }, { value: 'summary', label: 'Resumido' }]} />
      <SettingSwitch label="Modo rápido de operação" checked={v('fast_mode')} onChange={v2 => s.update('fast_mode', v2)}
        tooltip="Quando ativado, reduz etapas em vendas, estoque e cadastro." />
      <Separator />
      <SectionTitle description="Controle a exibição do guia interativo ao entrar no sistema.">Guia Interativo</SectionTitle>
      <SettingSwitch
        label="Mostrar guia ao entrar no sistema"
        checked={!!profile?.show_onboarding_guide}
        onChange={(v2) => { toggleGuidePreference(v2); toast.success(v2 ? 'Guia ativado' : 'Guia desativado'); }}
        tooltip="Quando ativado, o guia interativo aparece automaticamente a cada login."
      />
      <Button variant="outline" size="sm" onClick={() => setShowGuide(true)}>
        <BookOpen className="h-4 w-4 mr-2" />
        Abrir guia novamente
      </Button>
      <SaveBar dirty={s.dirty} saving={s.saving} onSave={s.save} />
    </div>
  );
}

// ─── TAB GENÉRICA COM SWITCHES ──────────────────────────────────────
function SettingsTabGeneric({ category, title, description, sections }: {
  category: string;
  title: string;
  description: string;
  sections: { title: string; desc?: string; items: { key: string; label: string; type?: 'switch' | 'input' | 'select'; options?: { value: string; label: string }[]; tooltip?: string; placeholder?: string }[] }[];
}) {
  const s = useStoreSettings(category);

  if (s.loading) return <div className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</div>;

  return (
    <div className="space-y-6">
      <SectionTitle description={description}>{title}</SectionTitle>
      {sections.map((sec, i) => (
        <div key={i}>
          {i > 0 && <Separator className="mb-4" />}
          {sec.title && <h4 className="text-sm font-semibold mb-1">{sec.title}</h4>}
          {sec.desc && <p className="text-xs text-muted-foreground mb-3">{sec.desc}</p>}
          <div className="space-y-1">
            {sec.items.map(item => {
              if (item.type === 'input') {
                return <SettingInput key={item.key} label={item.label} value={s.settings[item.key] || ''} onChange={v => s.update(item.key, v)} placeholder={item.placeholder} tooltip={item.tooltip} />;
              }
              if (item.type === 'select' && item.options) {
                return <SettingSelect key={item.key} label={item.label} value={s.settings[item.key] || item.options[0]?.value} onChange={v => s.update(item.key, v)} options={item.options} tooltip={item.tooltip} />;
              }
              return <SettingSwitch key={item.key} label={item.label} checked={!!s.settings[item.key]} onChange={v => s.update(item.key, v)} tooltip={item.tooltip} />;
            })}
          </div>
        </div>
      ))}
      <SaveBar dirty={s.dirty} saving={s.saving} onSave={s.save} />
    </div>
  );
}

// ─── TAB CONFIGS ────────────────────────────────────────────────────
const inventoryConfig = {
  category: 'inventory', title: 'Produtos e Estoque',
  description: 'Ajuste os parâmetros do estoque para reduzir erros operacionais.',
  sections: [
    { title: 'Controle de Estoque', items: [
      { key: 'min_stock_control', label: 'Ativar controle de estoque mínimo' },
      { key: 'default_min_stock', label: 'Quantidade mínima padrão', type: 'input' as const, placeholder: '5' },
      { key: 'allow_no_sku', label: 'Permitir produtos sem código interno' },
      { key: 'require_category', label: 'Exigir categoria no cadastro' },
      { key: 'require_supplier', label: 'Exigir fornecedor no cadastro' },
      { key: 'allow_negative_stock', label: 'Permitir estoque negativo' },
      { key: 'allow_cost_edit', label: 'Permitir edição de custo após cadastro' },
      { key: 'allow_delete_with_movement', label: 'Permitir exclusão de produto com movimentação' },
      { key: 'auto_low_stock_alert', label: 'Ativar alerta automático de estoque baixo' },
      { key: 'detailed_movement_history', label: 'Ativar histórico de movimentação detalhado' },
      { key: 'product_image_upload', label: 'Ativar upload de imagem de produto' },
    ]},
    { title: 'Regras Automáticas', desc: 'Regras que o sistema aplica automaticamente.', items: [
      { key: 'auto_deduct_on_sale', label: 'Registrar baixa automática ao vender' },
      { key: 'auto_return_on_exchange', label: 'Registrar retorno automático em troca aprovada' },
      { key: 'require_reason_manual_entry', label: 'Entrada manual com justificativa obrigatória' },
      { key: 'require_reason_loss', label: 'Perda/avaria com motivo obrigatório' },
    ]},
  ],
};

const salesConfig = {
  category: 'sales', title: 'Vendas',
  description: 'Configure regras para o processo de vendas.',
  sections: [
    { title: 'Regras de Venda', items: [
      { key: 'require_customer', label: 'Exigir cliente na venda' },
      { key: 'require_payment', label: 'Exigir forma de pagamento' },
      { key: 'require_amount', label: 'Exigir valor pago' },
      { key: 'allow_manual_discount', label: 'Permitir desconto manual' },
      { key: 'max_discount', label: 'Limite máximo de desconto sem aprovação (%)', type: 'input' as const, placeholder: '10' },
      { key: 'allow_sale_no_stock', label: 'Permitir venda com estoque insuficiente' },
      { key: 'confirm_cancel', label: 'Exigir confirmação para cancelamento' },
      { key: 'multi_payment', label: 'Permitir múltiplas formas de pagamento' },
      { key: 'fast_sale', label: 'Ativar venda rápida' },
      { key: 'print_receipt', label: 'Ativar impressão/comprovante' },
      { key: 'sale_notes', label: 'Ativar observações na venda' },
    ]},
    { title: 'Comprovante', items: [
      { key: 'receipt_text', label: 'Texto padrão do comprovante', type: 'input' as const, placeholder: 'Obrigado pela preferência!' },
      { key: 'edit_timeout', label: 'Tempo máximo para edição (minutos)', type: 'input' as const, placeholder: '60' },
    ]},
  ],
};

const financeConfig = {
  category: 'finance', title: 'Financeiro',
  description: 'Configure categorias, fechamentos e controles financeiros.',
  sections: [
    { title: 'Regras Financeiras', items: [
      { key: 'require_category', label: 'Exigir categoria em todo lançamento' },
      { key: 'require_description_expense', label: 'Exigir descrição em gastos' },
      { key: 'allow_delete_entry', label: 'Permitir exclusão de lançamento' },
      { key: 'allow_edit_closed', label: 'Permitir edição de lançamento fechado' },
      { key: 'negative_balance_alert', label: 'Alerta de caixa negativo' },
      { key: 'show_estimated_profit', label: 'Exibir lucro estimado no dashboard' },
      { key: 'cost_center', label: 'Ativar centro de custos' },
    ]},
    { title: 'Fechamento Automático', items: [
      { key: 'auto_close_daily', label: 'Fechamento automático diário' },
      { key: 'auto_close_weekly', label: 'Fechamento automático semanal' },
      { key: 'auto_close_monthly', label: 'Fechamento automático mensal' },
      { key: 'close_day', label: 'Dia padrão para fechamento mensal', type: 'input' as const, placeholder: '1' },
    ]},
    { title: 'Métodos de Pagamento', desc: 'Ative ou desative métodos aceitos.', items: [
      { key: 'pay_pix', label: 'PIX' },
      { key: 'pay_cash', label: 'Dinheiro' },
      { key: 'pay_debit', label: 'Cartão de débito' },
      { key: 'pay_credit', label: 'Cartão de crédito' },
      { key: 'pay_transfer', label: 'Transferência' },
      { key: 'pay_boleto', label: 'Boleto' },
    ]},
  ],
};

const shippingConfig = {
  category: 'shipping', title: 'Entregas e Logística',
  description: 'Configure métodos de entrega e regras logísticas.',
  sections: [
    { title: 'Métodos de Entrega', items: [
      { key: 'method_pickup', label: 'Retirada na loja' },
      { key: 'method_correios', label: 'Correios' },
      { key: 'method_99', label: '99 Entrega' },
      { key: 'method_motoboy', label: 'Motoboy' },
      { key: 'method_carrier', label: 'Transportadora' },
    ]},
    { title: 'Regras', items: [
      { key: 'require_delivery_type', label: 'Exigir tipo de entrega na venda' },
      { key: 'require_tracking_correios', label: 'Exigir código de rastreio para Correios' },
      { key: 'allow_manual_status', label: 'Permitir atualizar status manualmente' },
      { key: 'pending_delivery_alert', label: 'Ativar aviso de entrega pendente' },
      { key: 'logistics_history', label: 'Ativar histórico logístico' },
      { key: 'allow_delivery_fee', label: 'Permitir taxa de entrega' },
      { key: 'default_delivery_fee', label: 'Valor padrão da taxa', type: 'input' as const, placeholder: '0.00' },
      { key: 'estimated_delivery_time', label: 'Tempo estimado padrão (dias)', type: 'input' as const, placeholder: '3' },
    ]},
  ],
};

const returnsConfig = {
  category: 'returns', title: 'Trocas e Devoluções',
  description: 'Configure regras para trocas, devoluções e garantias.',
  sections: [
    { title: 'Regras de Troca', items: [
      { key: 'enable_returns', label: 'Ativar módulo de trocas' },
      { key: 'require_reason', label: 'Exigir motivo da troca' },
      { key: 'require_photo', label: 'Exigir foto/anexo da peça com defeito' },
      { key: 'require_sale_link', label: 'Exigir vínculo com venda original' },
      { key: 'allow_no_sale', label: 'Permitir troca sem venda vinculada' },
      { key: 'auto_restock', label: 'Reabastecer estoque quando produto em bom estado' },
    ]},
    { title: 'Garantia', items: [
      { key: 'require_manager_approval_days', label: 'Exigir aprovação de gerente para troca acima de X dias', type: 'input' as const, placeholder: '7' },
      { key: 'default_warranty_days', label: 'Prazo padrão de garantia (dias)', type: 'input' as const, placeholder: '90' },
    ]},
  ],
};

const dashboardConfig = {
  category: 'dashboard', title: 'Relatórios e Dashboard',
  description: 'Escolha quais informações exibir no painel principal.',
  sections: [
    { title: 'Widgets do Dashboard', items: [
      { key: 'show_daily_sales', label: 'Mostrar vendas do dia' },
      { key: 'show_weekly_sales', label: 'Mostrar vendas da semana' },
      { key: 'show_monthly_sales', label: 'Mostrar vendas do mês' },
      { key: 'show_gross_profit', label: 'Mostrar lucro bruto' },
      { key: 'show_net_profit', label: 'Mostrar lucro líquido' },
      { key: 'show_low_stock', label: 'Mostrar produtos com estoque baixo' },
      { key: 'show_top_products', label: 'Mostrar produtos mais vendidos' },
      { key: 'show_top_returns', label: 'Mostrar produtos com mais trocas' },
      { key: 'show_expenses_category', label: 'Mostrar despesas por categoria' },
      { key: 'show_pending_deliveries', label: 'Mostrar entregas pendentes' },
      { key: 'show_pending_payments', label: 'Mostrar pagamentos pendentes' },
    ]},
    { title: 'Exportação', items: [
      { key: 'export_pdf', label: 'Exportar relatórios em PDF' },
      { key: 'export_excel', label: 'Exportar relatórios em Excel' },
      { key: 'dashboard_by_role', label: 'Dashboard personalizado por perfil de usuário', tooltip: 'Vendedor vê vendas, gerente vê operação, financeiro vê caixa, proprietário vê visão geral.' },
    ]},
  ],
};

const notificationsConfig = {
  category: 'notifications', title: 'Notificações',
  description: 'Configure quais alertas o sistema deve enviar.',
  sections: [
    { title: 'Alertas', items: [
      { key: 'notify_low_stock', label: 'Notificar estoque baixo' },
      { key: 'notify_out_of_stock', label: 'Notificar produto sem estoque' },
      { key: 'notify_sale_cancelled', label: 'Notificar venda cancelada' },
      { key: 'notify_return', label: 'Notificar troca registrada' },
      { key: 'notify_pending_delivery', label: 'Notificar entrega pendente' },
      { key: 'notify_weekly_close', label: 'Notificar fechamento semanal' },
      { key: 'notify_monthly_close', label: 'Notificar fechamento mensal' },
      { key: 'notify_expense_limit', label: 'Notificar gasto acima de limite' },
      { key: 'notify_critical_failure', label: 'Notificar falha em operação crítica' },
      { key: 'notify_suspicious_login', label: 'Notificar login suspeito' },
    ]},
    { title: 'Canais', items: [
      { key: 'channel_in_app', label: 'Dentro do sistema' },
      { key: 'channel_email', label: 'E-mail' },
      { key: 'channel_whatsapp', label: 'WhatsApp (futuro)', tooltip: 'Disponível quando a integração WhatsApp for configurada.' },
    ]},
  ],
};

const aiConfig = {
  category: 'ai_agent', title: 'Assistente IA',
  description: 'Configure o agente de suporte para orientar usuários dentro do sistema.',
  sections: [
    { title: 'Configuração do Agente', items: [
      { key: 'enabled', label: 'Ativar agente IA' },
      { key: 'agent_name', label: 'Nome do assistente', type: 'input' as const, placeholder: 'Suporte IA' },
      { key: 'welcome_message', label: 'Mensagem de boas-vindas', type: 'input' as const, placeholder: 'Olá! Como posso ajudar?' },
      { key: 'show_floating', label: 'Mostrar chat flutuante em todas as páginas' },
      { key: 'contextual_help', label: 'Habilitar ajuda contextual por rota' },
      { key: 'onboarding', label: 'Habilitar onboarding guiado' },
      { key: 'quick_suggestions', label: 'Habilitar sugestões rápidas' },
      { key: 'allow_handoff', label: 'Permitir chamado humano quando não souber responder' },
      { key: 'store_history', label: 'Armazenar histórico de conversas' },
    ]},
    { title: 'Retenção', items: [
      { key: 'retention_days', label: 'Tempo de retenção (dias)', type: 'input' as const, placeholder: '90' },
      { key: 'show_metrics', label: 'Exibir métricas de uso do agente' },
    ]},
  ],
};

const securityConfig = {
  category: 'security', title: 'Segurança',
  description: 'Logs de auditoria ajudam a rastrear alterações críticas.',
  sections: [
    { title: 'Sessão e Autenticação', items: [
      { key: 'session_timeout_min', label: 'Tempo de expiração da sessão (minutos)', type: 'input' as const, placeholder: '60' },
      { key: 'logout_on_inactivity', label: 'Exigir logout por inatividade' },
      { key: 'require_strong_password', label: 'Exigir senha forte' },
      { key: 'force_password_change', label: 'Forçar troca de senha no primeiro acesso' },
      { key: 'two_factor', label: 'Autenticação em duas etapas (futuro)' },
      { key: 'block_after_attempts', label: 'Ativar bloqueio após várias tentativas' },
    ]},
    { title: 'Auditoria', items: [
      { key: 'login_history', label: 'Histórico de logins' },
      { key: 'critical_changes_history', label: 'Histórico de alterações críticas' },
      { key: 'confirm_sensitive_actions', label: 'Exigir confirmação para ações sensíveis' },
      { key: 'show_audit_logs', label: 'Exibir logs de auditoria' },
    ]},
  ],
};

// ─── TAB: AUDITORIA (dentro de Segurança) ───────────────────────────
function SecurityTab() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => {
    if (!profile) return;
    supabase.from('audit_logs').select('*, profiles!audit_logs_actor_profile_id_fkey(full_name)')
      .eq('store_id', profile.store_id).order('created_at', { ascending: false }).limit(50)
      .then(({ data }) => setLogs(data || []));
  }, [profile]);

  return (
    <div className="space-y-6">
      <SettingsTabGeneric {...securityConfig} />
      <Separator />
      <SectionTitle description="Últimas 50 ações registradas.">Logs de Auditoria</SectionTitle>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Usuário</TableHead>
                <TableHead>Ação</TableHead>
                <TableHead>Entidade</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center py-6 text-muted-foreground">Nenhum log encontrado</TableCell></TableRow>
              ) : logs.map(l => (
                <TableRow key={l.id}>
                  <TableCell className="text-xs">{new Date(l.created_at).toLocaleString('pt-BR')}</TableCell>
                  <TableCell className="text-xs">{(l.profiles as any)?.full_name || '-'}</TableCell>
                  <TableCell><Badge variant="outline" className="text-xs">{l.action}</Badge></TableCell>
                  <TableCell className="text-xs">{l.entity} {l.entity_id?.slice(0, 8)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── TAB: INTEGRAÇÕES ───────────────────────────────────────────────

const PIXEL_EVENT_LABELS: Record<string, string> = {
  purchase_approved: 'Compra Aprovada',
  purchase_cancelled: 'Compra Cancelada',
  refund_created: 'Reembolso Criado',
  refund_completed: 'Reembolso Concluído',
  exchange_created: 'Troca Criada',
  customer_created: 'Cliente Criado',
  payment_approved: 'Pagamento Aprovado',
  payment_failed: 'Pagamento Falhou',
};

const PIXEL_STATUS_MAP: Record<string, { label: string; cls: string }> = {
  processed: { label: 'OK', cls: 'text-green-600' },
  pending: { label: 'Pendente', cls: 'text-amber-500' },
  error: { label: 'Erro', cls: 'text-destructive' },
};

function IntegrationsTab() {
  const { profile } = useAuth();
  const [view, setView] = useState<'list' | 'pixel'>('list');
  const [pixel, setPixel] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [loadingPixel, setLoadingPixel] = useState(true);
  const [creating, setCreating] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ ok: boolean; msg: string } | null>(null);

  const storeId = profile?.store_id;
  const BASE_URL = import.meta.env.VITE_SUPABASE_URL;

  const fetchPixel = async () => {
    if (!storeId) return;
    setLoadingPixel(true);
    const { data } = await supabase.from('store_pixels').select('*').eq('store_id', storeId).maybeSingle();
    setPixel(data);
    setLoadingPixel(false);
  };

  const fetchEvents = async () => {
    if (!storeId) return;
    const { data } = await supabase
      .from('pixel_events')
      .select('id, event_type, external_order_id, processing_status, error_message, received_at')
      .eq('store_id', storeId)
      .order('received_at', { ascending: false })
      .limit(20);
    setEvents(data || []);
  };

  useEffect(() => { if (view === 'pixel') { fetchPixel(); fetchEvents(); } }, [view, storeId]);

  const createPixel = async () => {
    if (!storeId) return;
    setCreating(true);
    const { error } = await supabase.from('store_pixels').insert({ store_id: storeId });
    if (error) toast.error('Erro ao criar pixel');
    else { toast.success('Pixel criado!'); await fetchPixel(); }
    setCreating(false);
  };

  const toggleActive = async () => {
    if (!pixel) return;
    const { error } = await supabase.from('store_pixels').update({ is_active: !pixel.is_active, updated_at: new Date().toISOString() }).eq('id', pixel.id);
    if (error) toast.error('Erro');
    else { setPixel({ ...pixel, is_active: !pixel.is_active }); toast.success(pixel.is_active ? 'Desativado' : 'Ativado'); }
  };

  const addDomain = async () => {
    if (!pixel || !domainInput.trim()) return;
    const domain = domainInput.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    if (pixel.allowed_domains?.includes(domain)) { toast.info('Já existe'); return; }
    const newDomains = [...(pixel.allowed_domains || []), domain];
    const { error } = await supabase.from('store_pixels').update({ allowed_domains: newDomains, updated_at: new Date().toISOString() }).eq('id', pixel.id);
    if (error) toast.error('Erro');
    else { setPixel({ ...pixel, allowed_domains: newDomains }); setDomainInput(''); toast.success('Adicionado'); }
  };

  const removeDomain = async (d: string) => {
    if (!pixel) return;
    const newDomains = (pixel.allowed_domains || []).filter((x: string) => x !== d);
    await supabase.from('store_pixels').update({ allowed_domains: newDomains, updated_at: new Date().toISOString() }).eq('id', pixel.id);
    setPixel({ ...pixel, allowed_domains: newDomains });
  };

  const copyText = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copiado!`);
    setTimeout(() => setCopied(null), 2000);
  };

  const testPixel = async () => {
    if (!pixel) return;
    setTesting(true);
    setTestResult(null);
    try {
      const res = await fetch(`${BASE_URL}/functions/v1/pixel-events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pixel-id': pixel.pixel_id, 'x-pixel-key': pixel.secret_key },
        body: JSON.stringify({
          event_type: 'payment_approved',
          external_event_id: `test-${Date.now()}`,
          external_order_id: `TEST-${Date.now()}`,
          payload: { test: true, customer: { name: 'Teste Pixel', email: 'teste@pixel.com' }, total_amount: 1, payment_method: 'test' },
        }),
      });
      const json = await res.json();
      if (res.ok && (json.status === 'success' || json.status === 'duplicate_event')) {
        setTestResult({ ok: true, msg: 'Pixel funcionando! Evento recebido com sucesso.' });
        fetchEvents();
      } else {
        setTestResult({ ok: false, msg: json.error || json.message || 'Erro desconhecido' });
      }
    } catch (e: any) {
      setTestResult({ ok: false, msg: e.message });
    }
    setTesting(false);
  };

  const snippet = pixel
    ? `<!-- Estokfy Pixel -->\n<script>\n(function(){\n  var CPX_ID="${pixel.pixel_id}";\n  var CPX_KEY="${pixel.secret_key}";\n  var CPX_URL="${BASE_URL}/functions/v1/pixel-events";\n  var pixel={\n    track:function(eventType,data){\n      data=data||{};\n      fetch(CPX_URL,{\n        method:"POST",\n        headers:{"Content-Type":"application/json","x-pixel-id":CPX_ID,"x-pixel-key":CPX_KEY},\n        body:JSON.stringify({event_type:eventType,external_event_id:data.event_id||null,external_order_id:data.order_id||null,external_customer_id:data.customer_id||null,payload:data})\n      }).catch(function(){});\n    }\n  };\n  window.EstokfyPixel=pixel;\n  window.ControlixPixel=pixel;/* alias legado */\n})();\n</script>\n<!-- End Estokfy Pixel -->`
    : '';

  // Other integrations
  const otherIntegrations = [
    { id: 'whatsapp', name: 'WhatsApp', desc: 'Notificações de pedido e suporte', icon: '💬' },
    { id: 'correios', name: 'Correios', desc: 'Rastreio e etiquetas', icon: '📦' },
    { id: 'pix', name: 'Gateway PIX', desc: 'Recebimento automático via PIX', icon: '💸' },
    { id: 'webhooks', name: 'Webhooks', desc: 'Integração com sistemas externos', icon: '🔗' },
    { id: 'api', name: 'API Externa', desc: 'Acesso via API REST', icon: '🌐' },
  ];

  if (view === 'list') {
    return (
      <div className="space-y-6">
        <SectionTitle description="Conecte o sistema a serviços externos.">Integrações</SectionTitle>

        {/* Estokfy Pixel card - destacado */}
        <Card className="border-primary/30 bg-primary/5 hover:shadow-md transition-shadow cursor-pointer" onClick={() => setView('pixel')}>
          <CardContent className="p-4">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center"><Zap className="h-5 w-5 text-primary" /></div>
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-semibold">Estokfy Pixel</h4>
                  {loadingPixel ? <Loader2 className="h-4 w-4 animate-spin" /> : pixel?.is_active ? (
                    <Badge className="gap-1 text-xs"><Wifi className="h-3 w-3" /> Ativo</Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1 text-xs"><WifiOff className="h-3 w-3" /> {pixel ? 'Inativo' : 'Não configurado'}</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Receba vendas, cancelamentos e clientes automaticamente do seu site.</p>
                <Button size="sm" variant="outline" className="h-7 text-xs mt-3" onClick={e => { e.stopPropagation(); setView('pixel'); }}>
                  Configurar <Code className="h-3 w-3 ml-1" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2">
          {otherIntegrations.map(int => (
            <Card key={int.id} className="hover:shadow-md transition-shadow">
              <CardContent className="p-4">
                <div className="flex items-start gap-3">
                  <span className="text-2xl">{int.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-semibold">{int.name}</h4>
                      <Badge variant="outline" className="text-xs">Em breve</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{int.desc}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  // Pixel detail view
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => setView('list')}>← Voltar</Button>
        <h2 className="text-lg font-bold flex items-center gap-2"><Zap className="h-5 w-5 text-primary" /> Estokfy Pixel</h2>
        {pixel && (
          <div className="ml-auto flex items-center gap-2">
            <Badge variant={pixel.is_active ? 'default' : 'secondary'}>{pixel.is_active ? 'Ativo' : 'Inativo'}</Badge>
            <Switch checked={pixel.is_active} onCheckedChange={toggleActive} />
          </div>
        )}
      </div>

      {loadingPixel ? (
        <div className="flex justify-center py-12"><Loader2 className="h-8 w-8 animate-spin text-primary" /></div>
      ) : !pixel ? (
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-base">Criar seu Pixel</CardTitle>
            <CardDescription>Gere um pixel exclusivo para integrar seu site com o Estokfy.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={createPixel} disabled={creating} className="w-full">
              {creating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
              Gerar meu Pixel
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Credentials */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Seu Pixel Estokfy</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div>
                <Label className="text-xs text-muted-foreground">Pixel ID</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono truncate">{pixel.pixel_id}</code>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => copyText(pixel.pixel_id, 'Pixel ID')}>
                    {copied === 'Pixel ID' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Secret Key</Label>
                <div className="flex items-center gap-2 mt-1">
                  <code className="flex-1 bg-muted px-3 py-2 rounded text-sm font-mono truncate">
                    {showSecret ? pixel.secret_key : '••••••••••••••••••••'}
                  </code>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => setShowSecret(!showSecret)}>
                    {showSecret ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </Button>
                  <Button size="icon" variant="outline" className="h-8 w-8" onClick={() => copyText(pixel.secret_key, 'Secret Key')}>
                    {copied === 'Secret Key' ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Domains */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Globe className="h-4 w-4" /> Domínios Autorizados</CardTitle>
              <CardDescription className="text-xs">Deixe vazio para aceitar de qualquer domínio.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex gap-2">
                <Input placeholder="exemplo.com.br" value={domainInput} onChange={e => setDomainInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && addDomain()} className="flex-1 h-9" />
                <Button onClick={addDomain} size="sm"><Plus className="h-4 w-4 mr-1" /> Adicionar</Button>
              </div>
              {pixel.allowed_domains?.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {pixel.allowed_domains.map((d: string) => (
                    <Badge key={d} variant="secondary" className="gap-1 cursor-pointer" onClick={() => removeDomain(d)}>{d} <XCircle className="h-3 w-3" /></Badge>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Installation script */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2"><Code className="h-4 w-4" /> Script de Instalação</CardTitle>
              <CardDescription className="text-xs">Copie e cole no HTML do seu site, antes do &lt;/body&gt;.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="relative">
                <ScrollArea className="h-[160px] rounded border bg-muted p-3">
                  <pre className="text-xs font-mono whitespace-pre-wrap">{snippet}</pre>
                </ScrollArea>
                <Button size="sm" className="absolute top-2 right-2" onClick={() => copyText(snippet, 'Script')}>
                  {copied === 'Script' ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />} Copiar Script
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* How to install */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><BookOpen className="h-4 w-4" /> Como instalar o Pixel</CardTitle></CardHeader>
            <CardContent>
              <ol className="text-sm space-y-2 list-decimal list-inside text-muted-foreground">
                <li>Copie o <strong>script acima</strong></li>
                <li>Cole antes do <code className="bg-muted px-1 rounded text-xs">&lt;/body&gt;</code> do seu site</li>
                <li>Salve e publique o site</li>
                <li>Configure os eventos de compra no seu checkout</li>
                <li>Use o botão <strong>Testar Pixel</strong> para verificar</li>
              </ol>
            </CardContent>
          </Card>

          {/* Usage example */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm">Exemplo: registrar uma compra</CardTitle></CardHeader>
            <CardContent>
              <div className="relative">
                <pre className="bg-muted p-3 rounded text-xs font-mono overflow-x-auto">{`ControlixPixel.track("purchase_approved", {
  order_id: "ORD-123",
  event_id: "EVT-456",
  customer: {
    name: "Maria Silva",
    email: "maria@email.com",
    phone: "11999999999"
  },
  total_amount: 199.90,
  payment_method: "pix"
});`}</pre>
                <Button size="sm" variant="outline" className="absolute top-2 right-2 h-7 text-xs" onClick={() => copyText(`ControlixPixel.track("purchase_approved", {\n  order_id: "ORD-123",\n  event_id: "EVT-456",\n  customer: { name: "Maria Silva", email: "maria@email.com", phone: "11999999999" },\n  total_amount: 199.90,\n  payment_method: "pix"\n});`, 'Exemplo')}>
                  {copied === 'Exemplo' ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />} Copiar
                </Button>
              </div>
              <div className="mt-3">
                <p className="text-xs font-medium mb-1.5">Eventos suportados:</p>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(PIXEL_EVENT_LABELS).map(([k, v]) => (
                    <Badge key={k} variant="outline" className="text-xs">{v}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Test pixel */}
          <Card>
            <CardHeader className="pb-3"><CardTitle className="text-sm flex items-center gap-2"><Send className="h-4 w-4" /> Testar Pixel</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">Envia um evento de teste para verificar se o pixel está funcionando.</p>
              <Button onClick={testPixel} disabled={testing} variant="outline">
                {testing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                Testar Pixel
              </Button>
              {testResult && (
                <div className={cn('flex items-center gap-2 text-sm p-3 rounded', testResult.ok ? 'bg-green-50 text-green-700 dark:bg-green-900/20 dark:text-green-400' : 'bg-red-50 text-red-700 dark:bg-red-900/20 dark:text-red-400')}>
                  {testResult.ok ? <CheckCircle2 className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                  {testResult.msg}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Recent events */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm flex items-center gap-2"><Activity className="h-4 w-4" /> Últimos eventos recebidos</CardTitle>
                <Button size="sm" variant="ghost" className="h-7" onClick={fetchEvents}><RefreshCw className="h-3 w-3 mr-1" /> Atualizar</Button>
              </div>
            </CardHeader>
            <CardContent>
              {events.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">Nenhum evento recebido ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">Evento</TableHead>
                      <TableHead className="text-xs">Pedido</TableHead>
                      <TableHead className="text-xs">Status</TableHead>
                      <TableHead className="text-xs">Data</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {events.map((evt: any) => {
                      const st = PIXEL_STATUS_MAP[evt.processing_status] || PIXEL_STATUS_MAP.pending;
                      return (
                        <TableRow key={evt.id}>
                          <TableCell><Badge variant="outline" className="text-xs">{PIXEL_EVENT_LABELS[evt.event_type] || evt.event_type}</Badge></TableCell>
                          <TableCell className="text-xs font-mono">{evt.external_order_id || '—'}</TableCell>
                          <TableCell className={cn('text-xs font-medium', st.cls)}>{st.label}</TableCell>
                          <TableCell className="text-xs">{new Date(evt.received_at).toLocaleString('pt-BR')}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

// ─── TAB: BACKUP ────────────────────────────────────────────────────
function BackupTab() {
  const { profile } = useAuth();
  const [exporting, setExporting] = useState<string | null>(null);

  const exportTable = async (table: string, label: string) => {
    if (!profile) return;
    setExporting(table);
    try {
      const { data, error } = await supabase.from(table as any).select('*').eq('store_id', profile.store_id);
      if (error) throw error;
      const csv = data && data.length > 0
        ? [Object.keys(data[0]).join(','), ...data.map(r => Object.values(r).map(v => `"${v}"`).join(','))].join('\n')
        : 'Sem dados';
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `${table}_export.csv`; a.click();
      URL.revokeObjectURL(url);
      toast.success(`${label} exportado!`);
    } catch (e) {
      toast.error('Erro ao exportar');
    }
    setExporting(null);
  };

  const exports = [
    { table: 'products', label: 'Produtos', icon: Package },
    { table: 'sales', label: 'Vendas', icon: ShoppingCart },
    { table: 'cash_entries', label: 'Financeiro', icon: DollarSign },
    { table: 'customers', label: 'Clientes', icon: Users },
    { table: 'returns', label: 'Trocas', icon: RotateCcw },
    { table: 'deliveries', label: 'Entregas', icon: Truck },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle description="Exporte dados e faça backup do sistema.">Backup e Dados</SectionTitle>
      <div className="grid gap-3 sm:grid-cols-2">
        {exports.map(exp => (
          <Card key={exp.table} className="hover:shadow-md transition-shadow">
            <CardContent className="p-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <exp.icon className="h-5 w-5 text-muted-foreground" />
                <div>
                  <p className="text-sm font-medium">Exportar {exp.label}</p>
                  <p className="text-xs text-muted-foreground">Download em CSV</p>
                </div>
              </div>
              <Button size="sm" variant="outline" onClick={() => exportTable(exp.table, exp.label)} disabled={exporting === exp.table}>
                {exporting === exp.table ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>
      <Separator />
      <Card>
        <CardContent className="p-4">
          <div className="flex items-center gap-3">
            <Upload className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="text-sm font-medium">Importar dados por planilha</p>
              <p className="text-xs text-muted-foreground">CSV ou Excel — funcionalidade em breve.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── PÁGINA PRINCIPAL ───────────────────────────────────────────────
export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('store');
  const [search, setSearch] = useState('');
  const isMobile = useIsMobile();
  const filteredTabs = search
    ? TABS.filter(t => t.label.toLowerCase().includes(search.toLowerCase()))
    : TABS;

  const renderTab = () => {
    switch (activeTab) {
      case 'store': return <StoreTab />;
      case 'users': return <UsersTab />;
      case 'preferences': return <PreferencesTab />;
      case 'inventory': return <SettingsTabGeneric {...inventoryConfig} />;
      case 'sales': return <SettingsTabGeneric {...salesConfig} />;
      case 'finance': return <SettingsTabGeneric {...financeConfig} />;
      case 'shipping': return <SettingsTabGeneric {...shippingConfig} />;
      case 'returns': return <SettingsTabGeneric {...returnsConfig} />;
      case 'dashboard': return <SettingsTabGeneric {...dashboardConfig} />;
      case 'printing': return <PrintingSettings />;
      case 'notifications': return <SettingsTabGeneric {...notificationsConfig} />;
      case 'ai_agent': return <SettingsTabGeneric {...aiConfig} />;
      case 'security': return <SecurityTab />;
      case 'integrations': return <IntegrationsTab />;
      case 'backup': return <BackupTab />;
      default: return null;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Configurações do Sistema</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Gerencie dados da loja, usuários, permissões, financeiro, vendas, notificações e preferências do sistema.
        </p>
      </div>

      <div className="flex flex-col lg:flex-row gap-6">
        {/* Mobile: Select dropdown */}
        {isMobile ? (
          <div className="space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Buscar configuração..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-10" />
            </div>
            <Select value={activeTab} onValueChange={v => { setActiveTab(v); setSearch(''); }}>
              <SelectTrigger className="h-11 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {filteredTabs.map(tab => {
                  const Icon = tab.icon;
                  return (
                    <SelectItem key={tab.id} value={tab.id}>
                      <span className="flex items-center gap-2">
                        <Icon className="h-4 w-4" />
                        {tab.label}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
        ) : (
          /* Desktop: Sidebar */
          <div className="lg:w-64 flex-shrink-0">
            <div className="mb-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Buscar configuração..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 h-9" />
              </div>
            </div>
            <nav className="flex flex-col gap-1">
              {filteredTabs.map(tab => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    onClick={() => { setActiveTab(tab.id); setSearch(''); }}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
                      activeTab === tab.id
                        ? 'bg-primary text-primary-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4 flex-shrink-0" />
                    {tab.label}
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Content */}
        <Card className="flex-1 min-w-0">
          <CardContent className="p-4 md:p-6">
            {renderTab()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
