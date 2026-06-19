import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit, Tag, Search, Archive, RotateCcw, Loader2, Palette } from 'lucide-react';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';

interface Category {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  color: string;
  icon: string;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  _product_count?: number;
}

const ICON_OPTIONS = [
  'Tag', 'Smartphone', 'Battery', 'Cable', 'Shield', 'Monitor', 'Headphones',
  'Camera', 'Cpu', 'HardDrive', 'Wifi', 'Bluetooth', 'Zap', 'Box', 'Package',
];

const COLOR_OPTIONS = [
  '#3B82F6', '#EF4444', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899',
  '#06B6D4', '#F97316', '#6366F1', '#14B8A6', '#6B7280', '#84CC16',
];

export default function Categories() {
  const { profile } = useAuth();
  const isMobile = useIsMobile();
  const [categories, setCategories] = useState<Category[]>([]);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState<'all' | 'active' | 'inactive'>('active');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [form, setForm] = useState({ name: '', description: '', color: '#3B82F6', icon: 'Tag', sort_order: '0' });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const storeId = profile?.store_id;

  const fetchCategories = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data } = await supabase
      .from('categories')
      .select('*')
      .eq('store_id', storeId)
      .order('sort_order')
      .order('name');

    // Get product counts per category
    const { data: products } = await supabase
      .from('products')
      .select('category_id')
      .eq('store_id', storeId)
      .eq('is_active', true);

    const countMap: Record<string, number> = {};
    (products || []).forEach((p: any) => {
      if (p.category_id) countMap[p.category_id] = (countMap[p.category_id] || 0) + 1;
    });

    const enriched = ((data as any[]) || []).map(c => ({
      ...c,
      _product_count: countMap[c.id] || 0,
    }));

    setCategories(enriched);
    setLoading(false);
  }, [storeId]);

  useEffect(() => { fetchCategories(); }, [fetchCategories]);

  const openNew = () => {
    setEditing(null);
    setForm({ name: '', description: '', color: '#3B82F6', icon: 'Tag', sort_order: '0' });
    setErrors({});
    setDialogOpen(true);
  };

  const openEdit = (c: Category) => {
    setEditing(c);
    setForm({
      name: c.name,
      description: c.description || '',
      color: c.color || '#3B82F6',
      icon: c.icon || 'Tag',
      sort_order: String(c.sort_order || 0),
    });
    setErrors({});
    setDialogOpen(true);
  };

  const validate = (): boolean => {
    const e: Record<string, string> = {};
    if (!form.name.trim()) e.name = 'Informe o nome da categoria';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!storeId) { toast.error('Perfil não encontrado. Faça login novamente.'); return; }
    if (!validate()) return;
    setSaving(true);

    try {
      // Check name uniqueness
      const { data: existing } = await supabase
        .from('categories')
        .select('id')
        .eq('store_id', storeId)
        .ilike('name', form.name.trim())
        .maybeSingle();

      if (existing && (!editing || existing.id !== editing.id)) {
        setErrors({ name: 'Já existe uma categoria com esse nome' });
        setSaving(false);
        return;
      }

      const payload: any = {
        store_id: storeId,
        name: form.name.trim(),
        description: form.description.trim() || null,
        color: form.color,
        icon: form.icon,
        sort_order: parseInt(form.sort_order) || 0,
      };

      if (editing) {
        payload.updated_by = profile?.id || null;
        const { error } = await supabase.from('categories').update(payload).eq('id', editing.id);
        if (error) throw error;
        toast.success('Categoria atualizada!');
      } else {
        payload.created_by = profile?.id || null;
        payload.updated_by = profile?.id || null;
        const { error } = await supabase.from('categories').insert(payload);
        if (error) throw error;
        toast.success('Categoria criada!');
      }

      setDialogOpen(false);
      fetchCategories();
    } catch (err: any) {
      if (err.message?.includes('categories_name_store_unique')) {
        setErrors({ name: 'Já existe uma categoria com esse nome' });
      } else {
        toast.error(err.message || 'Erro ao salvar categoria');
      }
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (c: Category) => {
    if (c.is_active && c._product_count && c._product_count > 0) {
      if (!confirm(`Esta categoria possui ${c._product_count} produto(s) vinculado(s). Deseja inativá-la mesmo assim?`)) return;
    }
    const { error } = await supabase.from('categories').update({ is_active: !c.is_active }).eq('id', c.id);
    if (error) { toast.error(error.message); return; }
    toast.success(c.is_active ? 'Categoria inativada' : 'Categoria reativada');
    fetchCategories();
  };

  const filtered = categories.filter(c => {
    if (filterStatus === 'active' && !c.is_active) return false;
    if (filterStatus === 'inactive' && c.is_active) return false;
    if (search && !c.name.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const FieldError = ({ field }: { field: string }) =>
    errors[field] ? <p className="text-xs text-destructive mt-1">{errors[field]}</p> : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl md:text-2xl font-bold">Categorias</h1>
          <p className="text-sm text-muted-foreground">{categories.filter(c => c.is_active).length} ativas</p>
        </div>
        <Button onClick={openNew} size={isMobile ? 'sm' : 'default'}>
          <Plus className="mr-1 h-4 w-4" /> {isMobile ? 'Nova' : 'Nova Categoria'}
        </Button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar categoria..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-11" />
      </div>

      <div className="flex gap-2">
        <Button variant={filterStatus === 'active' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStatus('active')}>Ativas</Button>
        <Button variant={filterStatus === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStatus('all')}>Todas</Button>
        <Button variant={filterStatus === 'inactive' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStatus('inactive')}>Inativas</Button>
      </div>

      {loading ? (
        <div className="space-y-3">{[1, 2, 3].map(i => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}</div>
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map(c => (
            <Card key={c.id} className={`overflow-hidden ${!c.is_active ? 'opacity-60' : ''}`} onClick={() => openEdit(c)}>
              <CardContent className="p-3">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg flex items-center justify-center shrink-0" style={{ backgroundColor: c.color + '20' }}>
                    <Tag className="h-5 w-5" style={{ color: c.color }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm truncate">{c.name}</p>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="secondary" className="text-xs">{c._product_count} prod.</Badge>
                        {!c.is_active && <Badge variant="destructive" className="text-xs">Inativa</Badge>}
                      </div>
                    </div>
                    {c.description && <p className="text-xs text-muted-foreground mt-0.5 truncate">{c.description}</p>}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Tag className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>Nenhuma categoria encontrada</p>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">Cor</TableHead>
                  <TableHead>Nome</TableHead>
                  <TableHead>Descrição</TableHead>
                  <TableHead className="text-center">Produtos</TableHead>
                  <TableHead className="text-center">Ordem</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(c => (
                  <TableRow key={c.id} className={`cursor-pointer hover:bg-muted/50 ${!c.is_active ? 'opacity-60' : ''}`} onClick={() => openEdit(c)}>
                    <TableCell>
                      <div className="h-8 w-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: c.color + '20' }}>
                        <div className="h-4 w-4 rounded-full" style={{ backgroundColor: c.color }} />
                      </div>
                    </TableCell>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">{c.description || '-'}</TableCell>
                    <TableCell className="text-center">
                      <Badge variant="secondary">{c._product_count}</Badge>
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">{c.sort_order}</TableCell>
                    <TableCell>
                      <Badge className={c.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400' : 'bg-destructive/10 text-destructive'}>
                        {c.is_active ? 'Ativa' : 'Inativa'}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(c)}><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleToggleActive(c)} title={c.is_active ? 'Inativar' : 'Reativar'}>
                          {c.is_active ? <Archive className="h-4 w-4 text-muted-foreground" /> : <RotateCcw className="h-4 w-4 text-emerald-600" />}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center py-8 text-muted-foreground">
                      <Tag className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhuma categoria encontrada
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!saving) setDialogOpen(o); }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{editing ? 'Editar Categoria' : 'Nova Categoria'}</DialogTitle>
            <DialogDescription>
              {editing ? 'Altere os dados da categoria.' : 'Preencha os dados para criar uma nova categoria.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} placeholder="Ex: Telas, Baterias, Capas..." className={errors.name ? 'border-destructive' : ''} />
              <FieldError field="name" />
            </div>
            <div>
              <Label>Descrição</Label>
              <Textarea value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} placeholder="Descrição opcional..." rows={2} />
            </div>
            <div>
              <Label>Cor</Label>
              <div className="flex flex-wrap gap-2 mt-1.5">
                {COLOR_OPTIONS.map(color => (
                  <button
                    key={color}
                    onClick={() => setForm(p => ({ ...p, color }))}
                    className={`h-8 w-8 rounded-full border-2 transition-all ${form.color === color ? 'border-foreground scale-110' : 'border-transparent'}`}
                    style={{ backgroundColor: color }}
                  />
                ))}
                <div className="flex items-center gap-1">
                  <input
                    type="color"
                    value={form.color}
                    onChange={e => setForm(p => ({ ...p, color: e.target.value }))}
                    className="h-8 w-8 rounded-full cursor-pointer border-0"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex-1">
                <Label>Ordem de exibição</Label>
                <Input type="number" value={form.sort_order} onChange={e => setForm(p => ({ ...p, sort_order: e.target.value }))} />
              </div>
              <div className="pt-5">
                <div className="h-12 w-12 rounded-xl flex items-center justify-center" style={{ backgroundColor: form.color + '20' }}>
                  <Tag className="h-6 w-6" style={{ color: form.color }} />
                </div>
              </div>
            </div>

            {editing && (
              <Button variant="outline" className="w-full" onClick={() => { setDialogOpen(false); handleToggleActive(editing); }}>
                {editing.is_active ? (
                  <><Archive className="h-4 w-4 mr-2" /> Inativar categoria</>
                ) : (
                  <><RotateCcw className="h-4 w-4 mr-2" /> Reativar categoria</>
                )}
              </Button>
            )}

            <Button onClick={handleSave} disabled={saving} className="w-full">
              {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
              {editing ? 'Salvar alterações' : 'Criar categoria'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
