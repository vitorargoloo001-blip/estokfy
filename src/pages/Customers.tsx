import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Plus, Search, Edit, Users, Loader2, ChevronLeft, ChevronRight, Eye, Download } from 'lucide-react';
import Customer360Dialog from '@/components/Customer360Dialog';
import { downloadCsv } from '@/lib/receipt';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { maskPhone, validatePhone } from '@/lib/masks';
import { Skeleton } from '@/components/ui/skeleton';
import PageHeader from '@/components/PageHeader';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';

interface Customer {
  id: string; name: string; phone: string | null; email: string | null; doc_id: string | null; created_at: string;
}

interface FormErrors { [key: string]: string; }

const PAGE_SIZE = 30;

export default function Customers() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [form, setForm] = useState({ name: '', phone: '', email: '', doc_id: '' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [view360Id, setView360Id] = useState<string | null>(null);

  const storeId = profile?.store_id;
  const debouncedSearch = useDebouncedValue(search, 350);

  const fetchCustomers = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    let query = supabase.from('customers').select('*', { count: 'exact' }).eq('store_id', storeId);
    const q = debouncedSearch.trim();
    if (q) {
      const safe = q.replace(/[%,]/g, '');
      query = query.or(`name.ilike.%${safe}%,phone.ilike.%${safe}%,email.ilike.%${safe}%`);
    }
    const { data, count } = await query.order('name').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setCustomers((data as Customer[]) || []);
    setTotal(count || 0);
    setLoading(false);
  }, [storeId, debouncedSearch, page]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);
  useEffect(() => { setPage(0); }, [debouncedSearch]);

  const totalPages = Math.ceil(total / PAGE_SIZE);

  const openNew = () => { setEditing(null); setForm({ name: '', phone: '', email: '', doc_id: '' }); setErrors({}); setDialogOpen(true); };
  const openEdit = (c: Customer) => { setEditing(c); setForm({ name: c.name, phone: c.phone || '', email: c.email || '', doc_id: c.doc_id || '' }); setErrors({}); setDialogOpen(true); };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = 'Informe o nome do cliente';
    if (!form.phone.trim()) e.phone = 'Informe o telefone';
    else if (!validatePhone(form.phone)) e.phone = 'Telefone inválido';
    if (form.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) e.email = 'E-mail inválido';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!storeId) { toast.error('Perfil não encontrado. Faça login novamente.'); return; }
    if (!validate()) return;

    setSaving(true);
    try {
      const phoneDigits = form.phone.replace(/\D/g, '');

      // Check duplicate phone (only for new or changed phone) - search by both formatted and digits
      if (!editing || (editing.phone?.replace(/\D/g, '') !== phoneDigits)) {
        const { data: dups } = await supabase.from('customers')
          .select('id, name, phone').eq('store_id', storeId);
        const dup = (dups || []).find(c => c.phone?.replace(/\D/g, '') === phoneDigits && (!editing || c.id !== editing.id));
        if (dup) {
          const useExisting = confirm(`Já existe um cliente "${dup.name}" com este telefone. Deseja abrir o cadastro existente?`);
          if (useExisting) { openEdit(dup as any); setSaving(false); return; }
        }
      }

      const payload = {
        store_id: storeId, name: form.name.trim(),
        phone: form.phone.trim() || null, email: form.email.trim() || null,
        doc_id: form.doc_id.trim() || null,
      };

      if (editing) {
        const { error } = await supabase.from('customers').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Cliente atualizado!');
      } else {
        const { error } = await supabase.from('customers').insert(payload);
        if (error) throw error;
        toast.success('Cliente cadastrado!');
      }
      setDialogOpen(false);
      fetchCustomers();
    } catch (err: any) {
      toast.error(err.message || 'Não foi possível salvar. Tente novamente.');
    } finally { setSaving(false); }
  };

  const filtered = customers;

  const FieldError = ({ field }: { field: string }) => errors[field] ? <p className="text-xs text-destructive mt-1">{errors[field]}</p> : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Clientes"
        description={`${total} cliente(s) cadastrado(s)`}
        actions={
          <div className="flex gap-2">
            <Button
              onClick={() => downloadCsv(`clientes-${new Date().toISOString().slice(0,10)}.csv`,
                [['Nome','Telefone','Email','CPF/CNPJ'], ...customers.map(c => [c.name, c.phone || '', c.email || '', c.doc_id || ''])])}
              variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Download className="h-4 w-4" /> {isMobile ? 'CSV' : 'Exportar CSV'}
            </Button>
            <Button onClick={openNew} variant="premium" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Plus className="h-4 w-4" /> {isMobile ? 'Novo' : 'Novo Cliente'}
            </Button>
          </div>
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome, telefone ou e-mail..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-11" />
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1,2,3,4].map(i => <Skeleton key={i} className="h-14 w-full rounded-lg" />)}
        </div>
      ) : isMobile ? (
        <div className="space-y-2">
          {filtered.map(c => (
            <Card key={c.id} onClick={() => openEdit(c)} className="cursor-pointer active:bg-muted/30">
              <CardContent className="p-3">
                <div className="flex items-center justify-between">
                  <div className="min-w-0">
                    <p className="font-medium text-sm">{c.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.phone || 'Sem telefone'} {c.email ? `• ${c.email}` : ''}
                    </p>
                  </div>
                  <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={(e) => { e.stopPropagation(); openEdit(c); }}>
                    <Edit className="h-4 w-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground"><Users className="mx-auto h-10 w-10 mb-2 opacity-50" />Nenhum cliente</div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader><TableRow><TableHead>Nome</TableHead><TableHead>Telefone</TableHead><TableHead>Email</TableHead><TableHead>CPF/CNPJ</TableHead><TableHead></TableHead></TableRow></TableHeader>
              <TableBody>
                {filtered.map(c => (
                  <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setView360Id(c.id)}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell>{c.phone || '-'}</TableCell>
                    <TableCell>{c.email || '-'}</TableCell>
                    <TableCell>{c.doc_id || '-'}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => setView360Id(c.id)} title="Visão 360"><Eye className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)} title="Editar"><Edit className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && <TableRow><TableCell colSpan={5} className="text-center py-8 text-muted-foreground"><Users className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhum cliente</TableCell></TableRow>}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} cliente(s) — Pág {page + 1}/{totalPages}</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={o => { if (!saving) setDialogOpen(o); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing ? 'Editar Cliente' : 'Novo Cliente'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setErrors(prev => ({ ...prev, name: '' })); }} className={`h-11 ${errors.name ? 'border-destructive' : ''}`} placeholder="Nome completo" />
              <FieldError field="name" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>Telefone / WhatsApp *</Label>
                <Input value={form.phone} onChange={e => { setForm({ ...form, phone: maskPhone(e.target.value) }); setErrors(prev => ({ ...prev, phone: '' })); }} className={`h-11 ${errors.phone ? 'border-destructive' : ''}`} placeholder="(11) 99999-9999" />
                <FieldError field="phone" />
              </div>
              <div className="space-y-1">
                <Label>Email</Label>
                <Input type="email" value={form.email} onChange={e => { setForm({ ...form, email: e.target.value }); setErrors(prev => ({ ...prev, email: '' })); }} className={`h-11 ${errors.email ? 'border-destructive' : ''}`} placeholder="email@exemplo.com" />
                <FieldError field="email" />
              </div>
            </div>
            <div className="space-y-1"><Label>CPF/CNPJ</Label><Input value={form.doc_id} onChange={e => setForm({ ...form, doc_id: e.target.value })} className="h-11" /></div>
            <Button onClick={handleSave} className="w-full h-11" disabled={saving}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : editing ? 'Salvar' : 'Cadastrar'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Customer360Dialog
        customerId={view360Id}
        open={!!view360Id}
        onOpenChange={(o) => !o && setView360Id(null)}
      />
    </div>
  );
}
