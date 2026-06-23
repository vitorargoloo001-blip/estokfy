import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Link } from 'react-router-dom';
import { Search, ShieldCheck, ShieldOff, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { useIsMobile } from '@/hooks/use-mobile';
import { BUSINESS_TYPE_OPTIONS, BusinessType } from '@/lib/businessProfiles';

interface StoreRow {
  id: string;
  name: string;
  email: string | null;
  plan: string;
  subscription_status: string;
  access_enabled: boolean;
  created_at: string;
  expires_at: string | null;
  business_type: string | null;
}

const BIZ_LABEL: Record<string, string> = Object.fromEntries(
  BUSINESS_TYPE_OPTIONS.map(o => [o.value, o.label]),
);

const STATUS_LABELS: Record<string, string> = {
  active: 'Ativo',
  suspended: 'Suspenso',
  blocked: 'Bloqueado',
  inactive: 'Inativo',
  trial: 'Trial',
  overdue: 'Inadimplente',
  expired: 'Expirado',
  canceled: 'Cancelado',
};

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  trial: 'secondary',
  suspended: 'outline',
  blocked: 'destructive',
  overdue: 'destructive',
  inactive: 'outline',
};

export default function SuperAdminStores() {
  const { user } = useAuth();
  const isMobile = useIsMobile();
  const [stores, setStores] = useState<StoreRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [bizFilter, setBizFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  useEffect(() => { fetchStores(); }, []);

  const fetchStores = async () => {
    setLoading(true);
    const { data, error } = await supabase.from('stores').select('id, name, email, plan, subscription_status, access_enabled, created_at, expires_at, business_type');
    if (!error && data) setStores(data as StoreRow[]);
    setLoading(false);
  };

  const toggleAccess = async (store: StoreRow, enable: boolean) => {
    const before = { access_enabled: store.access_enabled, subscription_status: store.subscription_status };
    const newStatus = enable ? 'active' : 'suspended';
    
    const { error } = await supabase.from('stores').update({ access_enabled: enable, subscription_status: newStatus }).eq('id', store.id);
    if (error) { toast.error('Erro ao atualizar acesso'); return; }

    await supabase.from('super_admin_logs').insert({
      admin_user_id: user!.id,
      store_id: store.id,
      action: enable ? 'enable_access' : 'disable_access',
      before_json: before,
      after_json: { access_enabled: enable, subscription_status: newStatus },
    });

    toast.success(enable ? 'Acesso ativado' : 'Acesso suspenso');
    fetchStores();
  };

  const setBusinessType = async (store: StoreRow, biz: string) => {
    const { error } = await supabase.rpc('super_admin_set_business_type' as any, {
      p_store_id: store.id,
      p_business_type: biz,
    });
    if (error) { toast.error('Erro ao atualizar segmento'); return; }
    toast.success('Segmento atualizado');
    fetchStores();
  };

  const filtered = stores.filter(s => {
    const matchSearch = !search || s.name.toLowerCase().includes(search.toLowerCase()) || (s.email || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = statusFilter === 'all' || s.subscription_status === statusFilter || (statusFilter === 'blocked' && !s.access_enabled);
    const matchBiz = bizFilter === 'all' || (s.business_type || 'retail') === bizFilter;
    return matchSearch && matchStatus && matchBiz;
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Gerenciar Lojas</h1>

      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input placeholder="Buscar por nome ou e-mail..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos status</SelectItem>
            <SelectItem value="active">Ativos</SelectItem>
            <SelectItem value="suspended">Suspensos</SelectItem>
            <SelectItem value="blocked">Bloqueados</SelectItem>
            <SelectItem value="trial">Trial</SelectItem>
            <SelectItem value="overdue">Inadimplentes</SelectItem>
          </SelectContent>
        </Select>
        <Select value={bizFilter} onValueChange={setBizFilter}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos segmentos</SelectItem>
            {BUSINESS_TYPE_OPTIONS.map(o => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isMobile ? (
        <div className="space-y-3">
          {filtered.map(s => (
            <Card key={s.id}>
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <p className="font-semibold">{s.name}</p>
                    <p className="text-xs text-muted-foreground">{s.email}</p>
                  </div>
                  <Badge variant={STATUS_VARIANT[s.subscription_status] || 'outline'}>
                    {STATUS_LABELS[s.subscription_status] || s.subscription_status}
                  </Badge>
                </div>
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>Plano: {s.plan}</span>
                  <span>•</span>
                  <span>{new Date(s.created_at).toLocaleDateString('pt-BR')}</span>
                </div>
                <div className="flex gap-2 pt-1">
                  <Button size="sm" variant="outline" asChild className="flex-1">
                    <Link to={`/super-admin/stores/${s.id}`}><Eye className="mr-1 h-3 w-3" />Detalhes</Link>
                  </Button>
                  {s.access_enabled ? (
                    <ConfirmButton label="Suspender" variant="destructive" message={`Suspender acesso de "${s.name}"?`} onConfirm={() => toggleAccess(s, false)} />
                  ) : (
                    <ConfirmButton label="Ativar" variant="default" message={`Reativar acesso de "${s.name}"?`} onConfirm={() => toggleAccess(s, true)} />
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Loja</TableHead>
                  <TableHead>E-mail</TableHead>
                  <TableHead>Segmento</TableHead>
                  <TableHead>Plano</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Acesso</TableHead>
                  <TableHead>Criada em</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(s => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-muted-foreground">{s.email || '—'}</TableCell>
                    <TableCell>
                      <Select
                        value={s.business_type || 'retail'}
                        onValueChange={v => setBusinessType(s, v)}
                      >
                        <SelectTrigger className="h-7 text-xs w-36 border-0 shadow-none px-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {BUSINESS_TYPE_OPTIONS.map(o => (
                            <SelectItem key={o.value} value={o.value} className="text-xs">{o.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>{s.plan}</TableCell>
                    <TableCell>
                      <Badge variant={STATUS_VARIANT[s.subscription_status] || 'outline'}>
                        {STATUS_LABELS[s.subscription_status] || s.subscription_status}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.access_enabled ? 'default' : 'destructive'}>
                        {s.access_enabled ? 'Ativo' : 'Bloqueado'}
                      </Badge>
                    </TableCell>
                    <TableCell>{new Date(s.created_at).toLocaleDateString('pt-BR')}</TableCell>
                    <TableCell className="text-right space-x-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={`/super-admin/stores/${s.id}`}><Eye className="mr-1 h-3 w-3" />Detalhes</Link>
                      </Button>
                      {s.access_enabled ? (
                        <ConfirmButton label="Suspender" variant="destructive" message={`Suspender acesso de "${s.name}"?`} onConfirm={() => toggleAccess(s, false)} />
                      ) : (
                        <ConfirmButton label="Ativar" variant="default" message={`Reativar acesso de "${s.name}"?`} onConfirm={() => toggleAccess(s, true)} />
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function ConfirmButton({ label, variant, message, onConfirm }: { label: string; variant: 'default' | 'destructive'; message: string; onConfirm: () => void }) {
  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button size="sm" variant={variant}>
          {variant === 'destructive' ? <ShieldOff className="mr-1 h-3 w-3" /> : <ShieldCheck className="mr-1 h-3 w-3" />}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar ação</AlertDialogTitle>
          <AlertDialogDescription>{message}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>{label}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
