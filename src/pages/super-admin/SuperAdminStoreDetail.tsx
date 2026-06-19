import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { ArrowLeft, ShieldCheck, ShieldOff, Save, Users, Package, ShoppingCart, UserCheck } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Skeleton } from '@/components/ui/skeleton';

interface StoreDetail {
  id: string; name: string; email: string | null; phone: string | null;
  cnpj: string | null; city: string | null; state: string | null;
  plan: string; subscription_status: string; access_enabled: boolean;
  trial_ends_at: string | null; expires_at: string | null; notes: string | null;
  created_at: string;
}

export default function SuperAdminStoreDetail() {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const [store, setStore] = useState<StoreDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editPlan, setEditPlan] = useState('');
  const [editStatus, setEditStatus] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editExpires, setEditExpires] = useState('');
  const [counts, setCounts] = useState({ users: 0, products: 0, sales: 0, customers: 0 });
  const [logs, setLogs] = useState<any[]>([]);

  useEffect(() => { if (id) fetchAll(); }, [id]);

  const fetchAll = async () => {
    setLoading(true);
    const { data: s } = await supabase.from('stores').select('*').eq('id', id!).single();
    if (s) {
      const st = s as unknown as StoreDetail;
      setStore(st);
      setEditPlan(st.plan);
      setEditStatus(st.subscription_status);
      setEditNotes(st.notes || '');
      setEditExpires(st.expires_at ? st.expires_at.slice(0, 10) : '');
    }

    const [p, pr, sa, cu, lg] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('store_id', id!),
      supabase.from('products').select('id', { count: 'exact', head: true }).eq('store_id', id!),
      supabase.from('sales').select('id', { count: 'exact', head: true }).eq('store_id', id!),
      supabase.from('customers').select('id', { count: 'exact', head: true }).eq('store_id', id!),
      supabase.from('super_admin_logs').select('*').eq('store_id', id!).order('created_at', { ascending: false }).limit(20),
    ]);
    setCounts({ users: p.count || 0, products: pr.count || 0, sales: sa.count || 0, customers: cu.count || 0 });
    setLogs(lg.data || []);
    setLoading(false);
  };

  const saveChanges = async () => {
    if (!store || !user) return;
    setSaving(true);
    const before = { plan: store.plan, subscription_status: store.subscription_status, notes: store.notes, expires_at: store.expires_at };
    const after = { plan: editPlan, subscription_status: editStatus, notes: editNotes || null, expires_at: editExpires ? new Date(editExpires).toISOString() : null };

    const { error } = await supabase.from('stores').update(after).eq('id', store.id);
    if (error) { toast.error('Erro ao salvar'); setSaving(false); return; }

    await supabase.from('super_admin_logs').insert({
      admin_user_id: user.id, store_id: store.id, action: 'update_store',
      before_json: before, after_json: after,
    });

    toast.success('Alterações salvas');
    fetchAll();
    setSaving(false);
  };

  const toggleAccess = async (enable: boolean) => {
    if (!store || !user) return;
    const before = { access_enabled: store.access_enabled, subscription_status: store.subscription_status };
    const newStatus = enable ? 'active' : 'suspended';
    await supabase.from('stores').update({ access_enabled: enable, subscription_status: newStatus }).eq('id', store.id);
    await supabase.from('super_admin_logs').insert({
      admin_user_id: user.id, store_id: store.id, action: enable ? 'enable_access' : 'disable_access',
      before_json: before, after_json: { access_enabled: enable, subscription_status: newStatus },
    });
    toast.success(enable ? 'Acesso ativado' : 'Acesso suspenso');
    fetchAll();
  };

  if (loading) return <div className="space-y-4"><Skeleton className="h-8 w-48" /><Skeleton className="h-64 w-full" /></div>;
  if (!store) return <p className="text-muted-foreground">Loja não encontrada.</p>;

  const countCards = [
    { label: 'Usuários', value: counts.users, icon: Users },
    { label: 'Produtos', value: counts.products, icon: Package },
    { label: 'Vendas', value: counts.sales, icon: ShoppingCart },
    { label: 'Clientes', value: counts.customers, icon: UserCheck },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <Button variant="ghost" size="icon" asChild><Link to="/super-admin/stores"><ArrowLeft /></Link></Button>
        <h1 className="text-lg sm:text-2xl font-bold truncate max-w-[200px] sm:max-w-none">{store.name}</h1>
        <Badge variant={store.access_enabled ? 'default' : 'destructive'}>
          {store.access_enabled ? 'Ativo' : 'Bloqueado'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {countCards.map(c => (
          <Card key={c.label}>
            <CardContent className="pt-4 pb-3 text-center">
              <c.icon className="mx-auto h-5 w-5 mb-1 text-muted-foreground" />
              <p className="text-xl font-bold">{c.value}</p>
              <p className="text-xs text-muted-foreground">{c.label}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-lg">Dados da Loja</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p><strong>E-mail:</strong> {store.email || '—'}</p>
            <p><strong>Telefone:</strong> {store.phone || '—'}</p>
            <p><strong>CNPJ:</strong> {store.cnpj || '—'}</p>
            <p><strong>Cidade/UF:</strong> {[store.city, store.state].filter(Boolean).join('/') || '—'}</p>
            <p><strong>Criada em:</strong> {new Date(store.created_at).toLocaleDateString('pt-BR')}</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-lg">Gerenciar Acesso</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Plano</Label>
                <Select value={editPlan} onValueChange={setEditPlan}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['trial','basic','pro','premium','custom'].map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Status</Label>
                <Select value={editStatus} onValueChange={setEditStatus}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {['active','trial','suspended','blocked','overdue','canceled','expired','inactive'].map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Vencimento</Label>
              <Input type="date" value={editExpires} onChange={e => setEditExpires(e.target.value)} />
            </div>
            <div>
              <Label>Observações internas</Label>
              <Textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} rows={3} />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <Button onClick={saveChanges} disabled={saving} className="w-full sm:w-auto"><Save className="mr-1 h-4 w-4" />{saving ? 'Salvando...' : 'Salvar'}</Button>
              {store.access_enabled ? (
                <AlertDialog>
                  <AlertDialogTrigger asChild><Button variant="destructive"><ShieldOff className="mr-1 h-4 w-4" />Suspender</Button></AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader><AlertDialogTitle>Suspender acesso?</AlertDialogTitle><AlertDialogDescription>A loja "{store.name}" não poderá utilizar o sistema.</AlertDialogDescription></AlertDialogHeader>
                    <AlertDialogFooter><AlertDialogCancel>Cancelar</AlertDialogCancel><AlertDialogAction onClick={() => toggleAccess(false)}>Suspender</AlertDialogAction></AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              ) : (
                <Button onClick={() => toggleAccess(true)}><ShieldCheck className="mr-1 h-4 w-4" />Ativar Acesso</Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-lg">Histórico de Ações</CardTitle></CardHeader>
        <CardContent>
          {logs.length === 0 ? <p className="text-sm text-muted-foreground">Sem histórico.</p> : (
            <div className="space-y-2">
              {logs.map(l => (
                <div key={l.id} className="border-b pb-2 last:border-0 text-sm">
                  <div className="flex justify-between">
                    <Badge variant="outline">{l.action}</Badge>
                    <span className="text-xs text-muted-foreground">{new Date(l.created_at).toLocaleString('pt-BR')}</span>
                  </div>
                  {l.notes && <p className="text-xs mt-1">{l.notes}</p>}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
