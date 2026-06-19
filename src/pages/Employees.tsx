import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { usePermissions } from '@/hooks/usePermissions';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { toast } from 'sonner';
import { UserPlus, MoreVertical, BarChart3, Pencil, KeyRound, Trash2, Ban, CheckCircle } from 'lucide-react';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { startOfMonthUTCISO, startOfTodayUTCISO } from '@/lib/dateBR';
import { ROLE_LABEL } from '@/lib/roleAccess';

interface Employee {
  profile_id: string;
  auth_user_id: string;
  full_name: string | null;
  email: string | null;
  phone?: string | null;
  role: string;
  is_active: boolean;
  created_at: string;
  last_sign_in_at: string | null;
}

interface PerfRow {
  profile_id: string;
  sales_count: number; sales_revenue: number; avg_ticket: number;
  sales_paid: number; sales_pending: number;
  returns_count: number; returns_value: number;
}

const fmtBRL = (n: number) => Number(n).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

export default function Employees() {
  const { profile } = useAuth();
  const { canManageEmployees, isOwner } = usePermissions();
  const [list, setList] = useState<Employee[]>([]);
  const [phones, setPhones] = useState<Record<string, string | null>>({});
  const [perfMonth, setPerfMonth] = useState<Record<string, PerfRow>>({});
  const [perfToday, setPerfToday] = useState<Record<string, PerfRow>>({});
  const [loading, setLoading] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [editTarget, setEditTarget] = useState<Employee | null>(null);
  const [pwdTarget, setPwdTarget] = useState<Employee | null>(null);
  const [delTarget, setDelTarget] = useState<Employee | null>(null);
  const [drawer, setDrawer] = useState<Employee | null>(null);
  const [recent, setRecent] = useState<any[]>([]);

  const load = async () => {
    setLoading(true);
    const [empRes, monthRes, todayRes, phonesRes] = await Promise.all([
      supabase.rpc('list_employees'),
      supabase.rpc('get_employee_performance', { p_start: startOfMonthUTCISO(), p_end: new Date(Date.now() + 86400000).toISOString() }),
      supabase.rpc('get_employee_performance', { p_start: startOfTodayUTCISO(), p_end: new Date(Date.now() + 86400000).toISOString() }),
      supabase.from('profiles').select('id, phone'),
    ]);
    setList((empRes.data || []) as Employee[]);
    const ph: Record<string, string | null> = {};
    (phonesRes.data || []).forEach((p: any) => { ph[p.id] = p.phone || null; });
    setPhones(ph);
    const mMap: Record<string, PerfRow> = {};
    (monthRes.data || []).forEach((r: PerfRow) => { mMap[r.profile_id] = r; });
    setPerfMonth(mMap);
    const tMap: Record<string, PerfRow> = {};
    (todayRes.data || []).forEach((r: PerfRow) => { tMap[r.profile_id] = r; });
    setPerfToday(tMap);
    setLoading(false);
  };

  useEffect(() => { if (profile) load(); }, [profile?.id]);

  const openDrawer = async (e: Employee) => {
    setDrawer(e);
    const { data } = await supabase.from('audit_logs')
      .select('*').eq('store_id', profile!.store_id)
      .order('created_at', { ascending: false }).limit(50);
    setRecent((data || []).filter((a: any) => a.actor_profile_id === e.profile_id));
  };

  const setActive = async (p: Employee, active: boolean) => {
    const { error } = await supabase.rpc('set_employee_active', { p_profile_id: p.profile_id, p_active: active });
    if (error) return toast.error(error.message);
    toast.success(active ? 'Funcionário ativado' : 'Acesso bloqueado');
    load();
  };

  if (!canManageEmployees) {
    return <div className="p-6"><p className="text-muted-foreground">Sem permissão para acessar funcionários.</p></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Funcionários</h1>
          <p className="text-sm text-muted-foreground">Cada funcionário acessa o sistema com login próprio.</p>
        </div>
        <Dialog open={openCreate} onOpenChange={setOpenCreate}>
          <DialogTrigger asChild>
            <Button><UserPlus className="mr-2 h-4 w-4" />Adicionar funcionário</Button>
          </DialogTrigger>
          <CreateDialog onDone={() => { setOpenCreate(false); load(); }} canCreateOwnerOrAdmin={isOwner} />
        </Dialog>
      </div>

      <Card>
        <CardHeader><CardTitle>Equipe</CardTitle></CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Funcionário</TableHead>
                <TableHead>Cargo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Vendas mês</TableHead>
                <TableHead className="text-right">Faturamento mês</TableHead>
                <TableHead className="text-right">Ticket médio</TableHead>
                <TableHead className="text-right">Devoluções</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loading && <TableRow><TableCell colSpan={8}>Carregando…</TableCell></TableRow>}
              {!loading && list.map((e) => {
                const m = perfMonth[e.profile_id];
                return (
                  <TableRow key={e.profile_id}>
                    <TableCell>
                      <div className="font-medium">{e.full_name || '—'}</div>
                      <div className="text-xs text-muted-foreground">{e.email}</div>
                      {phones[e.profile_id] && <div className="text-xs text-muted-foreground">{phones[e.profile_id]}</div>}
                    </TableCell>
                    <TableCell><Badge variant="secondary">{ROLE_LABEL[e.role] || e.role}</Badge></TableCell>
                    <TableCell>{e.is_active ? <Badge>Ativo</Badge> : <Badge variant="outline">Bloqueado</Badge>}</TableCell>
                    <TableCell className="text-right">{m?.sales_count ?? 0}</TableCell>
                    <TableCell className="text-right">{fmtBRL(m?.sales_revenue ?? 0)}</TableCell>
                    <TableCell className="text-right">{fmtBRL(m?.avg_ticket ?? 0)}</TableCell>
                    <TableCell className="text-right">{m?.returns_count ?? 0}</TableCell>
                    <TableCell>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost"><MoreVertical className="h-4 w-4" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openDrawer(e)}>
                            <BarChart3 className="mr-2 h-4 w-4" />Ver desempenho
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setEditTarget({ ...e, phone: phones[e.profile_id] })}>
                            <Pencil className="mr-2 h-4 w-4" />Editar
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setPwdTarget(e)}>
                            <KeyRound className="mr-2 h-4 w-4" />Redefinir senha
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setActive(e, !e.is_active)}>
                            {e.is_active ? <><Ban className="mr-2 h-4 w-4" />Bloquear acesso</> : <><CheckCircle className="mr-2 h-4 w-4" />Reativar acesso</>}
                          </DropdownMenuItem>
                          {isOwner && e.role !== 'owner' && (
                            <>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem className="text-destructive" onClick={() => setDelTarget(e)}>
                                <Trash2 className="mr-2 h-4 w-4" />Excluir funcionário
                              </DropdownMenuItem>
                            </>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {editTarget && <EditDialog target={editTarget} canCreateOwnerOrAdmin={isOwner} onClose={() => setEditTarget(null)} onDone={() => { setEditTarget(null); load(); }} />}
      {pwdTarget && <ResetPwdDialog target={pwdTarget} onClose={() => setPwdTarget(null)} onDone={() => setPwdTarget(null)} />}
      {delTarget && <DeleteDialog target={delTarget} onClose={() => setDelTarget(null)} onDone={() => { setDelTarget(null); load(); }} />}

      <Sheet open={!!drawer} onOpenChange={(o) => !o && setDrawer(null)}>
        <SheetContent className="sm:max-w-md overflow-y-auto">
          <SheetHeader><SheetTitle>{drawer?.full_name || 'Funcionário'}</SheetTitle></SheetHeader>
          {drawer && (() => {
            const t = perfToday[drawer.profile_id]; const m = perfMonth[drawer.profile_id];
            return (
              <div className="space-y-4 mt-4">
                <div className="grid grid-cols-2 gap-3">
                  <Stat label="Vendas hoje" value={t?.sales_count ?? 0} />
                  <Stat label="Faturado hoje" value={fmtBRL(t?.sales_revenue ?? 0)} />
                  <Stat label="Vendas no mês" value={m?.sales_count ?? 0} />
                  <Stat label="Faturado no mês" value={fmtBRL(m?.sales_revenue ?? 0)} />
                  <Stat label="Ticket médio" value={fmtBRL(m?.avg_ticket ?? 0)} />
                  <Stat label="Pendentes" value={m?.sales_pending ?? 0} />
                  <Stat label="Devoluções" value={m?.returns_count ?? 0} />
                  <Stat label="Valor devolvido" value={fmtBRL(m?.returns_value ?? 0)} />
                </div>
                <div>
                  <h3 className="font-semibold mb-2">Últimas ações</h3>
                  <div className="space-y-2">
                    {recent.length === 0 && <p className="text-sm text-muted-foreground">Sem registros.</p>}
                    {recent.map((a) => (
                      <div key={a.id} className="text-xs border rounded p-2">
                        <div className="font-medium">{a.action} <span className="text-muted-foreground">— {a.entity}</span></div>
                        <div className="text-muted-foreground">{new Date(a.created_at).toLocaleString('pt-BR')}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: any }) {
  return <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="text-lg font-semibold">{value}</p></div>;
}

function rolesFor(canCreateOwnerOrAdmin: boolean) {
  const base = ['manager', 'sales', 'stock', 'finance', 'viewer'];
  return canCreateOwnerOrAdmin ? ['owner', 'admin', ...base] : base;
}

function CreateDialog({ onDone, canCreateOwnerOrAdmin }: { onDone: () => void; canCreateOwnerOrAdmin: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [role, setRole] = useState('sales');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name || !email) return toast.error('Preencha nome e email');
    if (password.length < 6) return toast.error('Senha deve ter pelo menos 6 caracteres');
    if (password !== confirm) return toast.error('Senhas não coincidem');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('employees-invite', {
        body: { email, full_name: name, role, password, phone: phone || null },
      });
      let payload: any = data;
      if (error && (error as any).context?.json) { try { payload = await (error as any).context.json(); } catch {} }
      if (payload?.error) return toast.error(payload.error);
      if (error) return toast.error(error.message || 'Falha');
      toast.success(payload?.message || 'Funcionário criado');
      onDone();
    } finally { setBusy(false); }
  };

  const allowed = rolesFor(canCreateOwnerOrAdmin);

  return (
    <DialogContent>
      <DialogHeader><DialogTitle>Adicionar funcionário</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div><Label>Nome completo</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
        <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
        <div><Label>Telefone (opcional)</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
        <div>
          <Label>Cargo</Label>
          <Select value={role} onValueChange={setRole}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{allowed.map(r => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Senha inicial</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
        <div><Label>Confirmar senha</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        <p className="text-xs text-muted-foreground">O funcionário poderá entrar imediatamente usando email e senha.</p>
      </div>
      <DialogFooter><Button onClick={submit} disabled={busy}>{busy ? 'Criando…' : 'Criar funcionário'}</Button></DialogFooter>
    </DialogContent>
  );
}

function EditDialog({ target, canCreateOwnerOrAdmin, onClose, onDone }: { target: Employee; canCreateOwnerOrAdmin: boolean; onClose: () => void; onDone: () => void }) {
  const [name, setName] = useState(target.full_name || '');
  const [email, setEmail] = useState(target.email || '');
  const [phone, setPhone] = useState(target.phone || '');
  const [role, setRole] = useState(target.role);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('employees-admin', {
        body: { action: 'update', profile_id: target.profile_id, full_name: name, email: email !== target.email ? email : undefined, phone, role },
      });
      let payload: any = data;
      if (error && (error as any).context?.json) { try { payload = await (error as any).context.json(); } catch {} }
      if (payload?.error) return toast.error(payload.error);
      if (error) return toast.error(error.message || 'Falha');
      toast.success('Funcionário atualizado');
      onDone();
    } finally { setBusy(false); }
  };

  const allowed = rolesFor(canCreateOwnerOrAdmin);

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Editar funcionário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nome</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label>Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
          <div><Label>Telefone</Label><Input value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
          <div>
            <Label>Cargo</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{allowed.map(r => <SelectItem key={r} value={r}>{ROLE_LABEL[r]}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>{busy ? 'Salvando…' : 'Salvar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ResetPwdDialog({ target, onClose, onDone }: { target: Employee; onClose: () => void; onDone: () => void }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (password.length < 6) return toast.error('Senha deve ter pelo menos 6 caracteres');
    if (password !== confirm) return toast.error('Senhas não coincidem');
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('employees-admin', {
        body: { action: 'reset_password', profile_id: target.profile_id, password },
      });
      let payload: any = data;
      if (error && (error as any).context?.json) { try { payload = await (error as any).context.json(); } catch {} }
      if (payload?.error) return toast.error(payload.error);
      if (error) return toast.error(error.message || 'Falha');
      toast.success('Senha redefinida');
      onDone();
    } finally { setBusy(false); }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Redefinir senha — {target.full_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Nova senha</Label><Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
          <div><Label>Confirmar senha</Label><Input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} /></div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={busy}>{busy ? 'Salvando…' : 'Redefinir'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DeleteDialog({ target, onClose, onDone }: { target: Employee; onClose: () => void; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke('employees-admin', {
        body: { action: 'delete', profile_id: target.profile_id },
      });
      let payload: any = data;
      if (error && (error as any).context?.json) { try { payload = await (error as any).context.json(); } catch {} }
      if (payload?.error) return toast.error(payload.error);
      if (error) return toast.error(error.message || 'Falha');
      toast.success('Funcionário excluído');
      onDone();
    } finally { setBusy(false); }
  };
  return (
    <AlertDialog open onOpenChange={(o) => !o && onClose()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Excluir {target.full_name}?</AlertDialogTitle>
          <AlertDialogDescription>
            O acesso será removido permanentemente. O histórico de vendas e ações deste funcionário será preservado.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Cancelar</AlertDialogCancel>
          <AlertDialogAction onClick={submit} disabled={busy} className="bg-destructive hover:bg-destructive/90">
            {busy ? 'Excluindo…' : 'Excluir'}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
