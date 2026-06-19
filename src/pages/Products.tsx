import { useEffect, useState, useCallback, useMemo } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Plus, Edit, Package, ImagePlus, Search, Archive, Loader2, ChevronLeft, ChevronRight, Copy, Layers, History, Download, ScanLine } from 'lucide-react';
import { useBarcodeScanner, beep } from '@/hooks/useBarcodeScanner';
import { toast } from 'sonner';
import { useIsMobile } from '@/hooks/use-mobile';
import { Skeleton } from '@/components/ui/skeleton';
import PageHeader from '@/components/PageHeader';
import { ShimmerList } from '@/components/ShimmerSkeleton';
import BulkProductDialog from '@/components/BulkProductDialog';
import BulkEditProductsDialog from '@/components/BulkEditProductsDialog';
import ProductHistoryDialog from '@/components/ProductHistoryDialog';
import { downloadCsv } from '@/lib/receipt';
import { useCanViewCost } from '@/hooks/useCanViewCost';
import { usePermissions } from '@/hooks/usePermissions';

interface Product {
  id: string; sku: string | null; name: string; brand: string | null; model: string | null;
  cost_price: number; sale_price: number; on_hand: number; minimum_stock: number;
  is_active: boolean; category_id: string | null; image_path: string | null; barcode: string | null;
  categories?: { name: string } | null;
}
interface Category { id: string; name: string; }
interface Supplier { id: string; name: string; }

interface FormErrors { [key: string]: string; }

const PAGE_SIZE = 30;

export default function Products() {
  const { profile, user } = useAuth();
  const { canManageProducts } = usePermissions();
  const isMobile = useIsMobile();
  const canViewCost = useCanViewCost();
  const [products, setProducts] = useState<Product[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [categories, setCategories] = useState<Category[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [search, setSearch] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStock, setFilterStock] = useState('all');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState({
    sku: '', name: '', brand: '', model: '', cost_price: '', sale_price: '',
    minimum_stock: '0', on_hand: '0', category_id: '', barcode: '',
  });
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [errors, setErrors] = useState<FormErrors>({});
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [historyProduct, setHistoryProduct] = useState<Product | null>(null);
  const [scanMode, setScanMode] = useState<null | 'search' | 'form'>(null);

  // Scanner global em Produtos:
  // - Sem dialog: dispara busca pelo barcode (ou abre o produto se houver match exato)
  // - Com dialog aberto e scanMode=form: preenche o campo barcode do formulário
  useBarcodeScanner({
    enabled: true,
    onScan: async (code) => {
      if (!storeId) return;
      if (dialogOpen && scanMode === 'form') {
        setForm(f => ({ ...f, barcode: code }));
        beep(60, 1200);
        toast.success('Código capturado');
        setScanMode(null);
        return;
      }
      // Busca pelo barcode
      const { data } = await supabase
        .from('products')
        .select('*, categories(name)')
        .eq('store_id', storeId)
        .eq('barcode', code)
        .maybeSingle();
      if (!data) { beep(150, 220); toast.error('Produto não encontrado para este código.'); return; }
      beep(60, 1200);
      openEdit(data as any);
    },
  });

  const storeId = profile?.store_id;
  const debouncedSearch = useDebouncedValue(search, 350);

  const fetchProducts = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    let query = supabase.from('products').select('*, categories(name)', { count: 'exact' })
      .eq('store_id', storeId).eq('is_active', true);
    const q = debouncedSearch.trim();
    if (q) {
      const safe = q.replace(/[%,]/g, '');
      query = query.or(`name.ilike.%${safe}%,brand.ilike.%${safe}%,model.ilike.%${safe}%,barcode.ilike.%${safe}%`);
    }
    if (filterCategory !== 'all') query = query.eq('category_id', filterCategory);
    if (filterStock === 'zero') query = query.eq('on_hand', 0);
    // 'low' filter: filtered client-side from current page (server filter would need raw SQL)
    const { data, count } = await query.order('name').range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    setProducts((data as any[]) || []);
    setTotal(count || 0);
    setLoading(false);
  }, [storeId, debouncedSearch, filterCategory, filterStock, page]);

  const fetchMeta = useCallback(async () => {
    if (!storeId) return;
    const [catRes, supRes] = await Promise.all([
      supabase.from('categories').select('*').eq('store_id', storeId).eq('is_active', true).order('sort_order').order('name'),
      supabase.from('suppliers').select('id, name').eq('store_id', storeId).order('name'),
    ]);
    setCategories(catRes.data || []);
    setSuppliers(supRes.data || []);
  }, [storeId]);

  useEffect(() => { fetchProducts(); }, [fetchProducts]);
  useEffect(() => { fetchMeta(); }, [fetchMeta]);
  useEffect(() => { setPage(0); }, [debouncedSearch, filterCategory, filterStock]);

  const totalPages = Math.ceil(total / PAGE_SIZE);


  const getImageUrl = (path: string | null) => {
    if (!path) return null;
    const { data } = supabase.storage.from('product-images').getPublicUrl(path);
    return data.publicUrl;
  };

  const openNew = () => {
    setEditing(null);
    setForm({ sku: '', name: '', brand: '', model: '', cost_price: '', sale_price: '', minimum_stock: '0', on_hand: '0', category_id: '', barcode: '' });
    setImageFile(null); setImagePreview(null); setErrors({}); setDialogOpen(true);
  };

  const openEdit = (p: Product) => {
    setEditing(p);
    setForm({
      sku: p.sku || '', name: p.name, brand: p.brand || '', model: p.model || '',
      cost_price: String(p.cost_price), sale_price: String(p.sale_price),
      minimum_stock: String(p.minimum_stock), on_hand: String(p.on_hand),
      category_id: p.category_id || '', barcode: p.barcode || '',
    });
    setImageFile(null); setImagePreview(p.image_path ? getImageUrl(p.image_path) : null);
    setErrors({}); setDialogOpen(true);
  };

  const openDuplicate = (p: Product) => {
    setEditing(null);
    setForm({
      sku: '', name: `${p.name} (cópia)`,
      brand: p.brand || '', model: p.model || '',
      cost_price: String(p.cost_price), sale_price: String(p.sale_price),
      minimum_stock: String(p.minimum_stock), on_hand: '0',
      category_id: p.category_id || '', barcode: '',
    });
    setImageFile(null);
    setImagePreview(p.image_path ? getImageUrl(p.image_path) : null);
    setErrors({});
    setDialogOpen(true);
    toast.info('Edite o nome ou modelo da cópia');
  };

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { toast.error('Imagem deve ter no máximo 5MB'); return; }
    setImageFile(file); setImagePreview(URL.createObjectURL(file));
  };

  const uploadImage = async (productId: string): Promise<string | null> => {
    if (!imageFile || !storeId) return null;
    const ext = imageFile.name.split('.').pop() || 'jpg';
    const path = `${storeId}/${productId}.${ext}`;
    const { error } = await supabase.storage.from('product-images').upload(path, imageFile, { upsert: true });
    if (error) return null;
    return path;
  };

  const validate = (): boolean => {
    const e: FormErrors = {};
    if (!form.name.trim()) e.name = 'Informe o nome do produto';
    const costPrice = parseFloat(form.cost_price);
    const salePrice = parseFloat(form.sale_price);
    if (form.cost_price && (isNaN(costPrice) || costPrice < 0)) e.cost_price = 'O preço de custo deve ser maior ou igual a zero';
    if (form.sale_price && (isNaN(salePrice) || salePrice < 0)) e.sale_price = 'O preço de venda deve ser maior ou igual a zero';
    const onHand = parseInt(form.on_hand);
    const minStock = parseInt(form.minimum_stock);
    if (form.on_hand && (isNaN(onHand) || onHand < 0)) e.on_hand = 'Quantidade não pode ser negativa';
    if (form.minimum_stock && (isNaN(minStock) || minStock < 0)) e.minimum_stock = 'Estoque mínimo não pode ser negativo';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleSave = async () => {
    if (saving) return;
    if (!storeId) { toast.error('Perfil não encontrado. Faça login novamente.'); return; }
    if (!canManageProducts) {
      toast.error('Seu perfil não tem permissão para cadastrar ou editar produtos nesta loja. Solicite ao responsável da loja a função de Estoque, Gerente ou Administrador.');
      return;
    }
    if (!validate()) return;

    setSaving(true);
    try {
      const skuTrimmed = form.sku.trim();
      const barcodeTrimmed = form.barcode.trim();
      // SKU é opcional. Se preenchido, garante unicidade na loja.
      if (skuTrimmed) {
        const { data: existing } = await supabase.from('products')
          .select('id, is_active').eq('store_id', storeId).eq('sku', skuTrimmed).maybeSingle();
        if (existing && (!editing || existing.id !== editing.id)) {
          setErrors(prev => ({ ...prev, sku: existing.is_active ? 'Esse código já existe nesta loja' : 'Código já utilizado por um produto inativo' }));
          setSaving(false);
          return;
        }
      }

      // Barcode opcional, mas único por loja quando preenchido
      if (barcodeTrimmed) {
        const { data: existingBc } = await supabase.from('products')
          .select('id, name')
          .eq('store_id', storeId)
          .eq('barcode', barcodeTrimmed)
          .maybeSingle();
        if (existingBc && (!editing || existingBc.id !== editing.id)) {
          toast.error(`Este código já está vinculado ao produto ${existingBc.name}`);
          setSaving(false);
          return;
        }
      }

      if (!user?.id) { toast.error('Sessão expirada. Faça login novamente.'); return; }

      const productId = editing?.id || crypto.randomUUID();
      const previousStock = editing?.on_hand || 0;
      const newStock = parseInt(form.on_hand) || 0;
      const quantity = newStock - previousStock;
      const payload: any = {
        id: productId,
        store_id: storeId, sku: skuTrimmed || null, name: form.name.trim(),
        brand: form.brand.trim() || null, model: form.model.trim() || null,
        cost_price: parseFloat(form.cost_price) || 0, sale_price: parseFloat(form.sale_price) || 0,
        minimum_stock: parseInt(form.minimum_stock) || 0,
        on_hand: newStock,
        category_id: form.category_id || null, barcode: form.barcode.trim() || null,
      };

      if (imageFile) {
        const path = await uploadImage(productId);
        if (path) payload.image_path = path;
      }

      const stockPayload = quantity !== 0 ? {
        store_id: storeId,
        product_id: productId,
        quantity,
        movement_type: editing ? 'adjustment' : 'initial_stock',
        reason: editing ? 'Ajuste manual via edição do produto' : 'Estoque inicial',
        created_by: user.id,
        previous_stock: previousStock,
        new_stock: newStock,
        unit_cost: parseFloat(form.cost_price) || 0,
      } : null;

      const { data, error } = await supabase.rpc('create_or_update_product_with_stock', {
        p_product: payload,
        p_stock: stockPayload,
      });
      if (error) throw error;

      const result = data as any;
      if (editing && result?.quantity) {
        toast.success(`Produto atualizado! Estoque ajustado em ${result.quantity > 0 ? '+' : ''}${result.quantity}.`);
      } else {
        toast.success(editing ? 'Produto atualizado!' : 'Produto cadastrado!');
      }
      setDialogOpen(false);
      fetchProducts();
    } catch (err: any) {
      console.error('[Products] Falha técnica ao salvar produto/estoque:', err);
      const msg = err?.message || '';
      if (msg.includes('row-level security') || err?.code === '42501' || msg.includes('sem_permissao')) {
        toast.error('Seu perfil não tem permissão para cadastrar produtos nesta loja. Solicite ao responsável a função Estoque, Gerente ou Administrador.');
      } else if (msg.includes('sku_duplicado')) {
        toast.error('Este SKU já está em uso nesta loja.');
      } else if (msg.includes('barcode_duplicado')) {
        toast.error('Este código de barras já está em uso nesta loja.');
      } else if (msg.includes('movement_type_invalido')) {
        toast.error('Tipo de movimentação de estoque inválido. Atualize a página e tente novamente.');
      } else {
        toast.error(`Não foi possível salvar o produto. ${msg ? `(${msg})` : 'Verifique sua permissão ou tente novamente.'}`);
      }
    } finally { setSaving(false); }
  };

  const handleInactivate = async (p: Product) => {
    if (!confirm(`Deseja inativar "${p.name}"? O produto não aparecerá nas buscas mas o histórico será preservado.`)) return;
    const { error } = await supabase.from('products').update({ is_active: false }).eq('id', p.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Produto inativado');
    fetchProducts();
  };

  const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const marginPct = (p: Product) => p.sale_price > 0 ? ((p.sale_price - p.cost_price) / p.sale_price) * 100 : 0;
  const marginBadge = (p: Product) => {
    const m = marginPct(p);
    if (p.sale_price <= 0) return <span className="text-xs text-muted-foreground">—</span>;
    const cls = m < 0 ? 'bg-destructive/10 text-destructive'
      : m < 10 ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
      : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200';
    return <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${cls}`}>{m.toFixed(0)}%</span>;
  };

  const filtered = useMemo(() => {
    if (filterStock === 'low') return products.filter(p => p.on_hand > 0 && p.on_hand <= p.minimum_stock);
    return products;
  }, [products, filterStock]);

  const exportCsv = () => {
    const header = ['Nome','Categoria','Marca','Modelo',
      ...(canViewCost ? ['Custo'] : []),
      'Preço','Margem%','Estoque','Mínimo'];
    const rows: (string|number|null)[][] = [
      header,
      ...filtered.map(p => [p.name, p.categories?.name || '', p.brand || '', p.model || '',
        ...(canViewCost ? [p.cost_price] : []),
        p.sale_price, marginPct(p).toFixed(2), p.on_hand, p.minimum_stock]),
    ];
    downloadCsv(`produtos-${new Date().toISOString().slice(0,10)}.csv`, rows);
    toast.success('CSV exportado');
  };

  const stockBadge = (p: Product) => {
    if (p.on_hand === 0) return <Badge variant="destructive">Zerado</Badge>;
    if (p.on_hand <= p.minimum_stock) return <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200">Baixo</Badge>;
    return <Badge variant="secondary" className="bg-emerald-50 text-emerald-700 dark:bg-emerald-900 dark:text-emerald-200">OK</Badge>;
  };

  const FieldError = ({ field }: { field: string }) => errors[field] ? <p className="text-xs text-destructive mt-1">{errors[field]}</p> : null;

  return (
    <div className="space-y-4 md:space-y-6">
      <PageHeader
        title="Produtos"
        description={`${total} produto(s) cadastrado(s)`}
        actions={
          <div className="flex gap-2 flex-wrap">
            <Button onClick={exportCsv} variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Download className="h-4 w-4" /> {isMobile ? 'CSV' : 'Exportar CSV'}
            </Button>
            <Button onClick={() => setBulkOpen(true)} variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Layers className="h-4 w-4" /> {isMobile ? 'Lote' : 'Cadastro em Lote'}
            </Button>
            <Button onClick={() => setBulkEditOpen(true)} variant="outline" size={isMobile ? 'sm' : 'default'} className="gap-2">
              <Edit className="h-4 w-4" /> {isMobile ? 'Editar' : 'Editar em massa'}
            </Button>
            <Button onClick={openNew} variant="premium" size={isMobile ? 'sm' : 'default'} className="gap-2" disabled={!canManageProducts} title={!canManageProducts ? 'Sem permissão para cadastrar produtos' : undefined}>
              <Plus className="h-4 w-4" /> {isMobile ? 'Novo' : 'Novo Produto'}
            </Button>
          </div>
        }
      />

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input placeholder="Buscar por nome, marca, modelo, código de barras..." value={search} onChange={e => setSearch(e.target.value)} className="pl-10 h-11" />
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <Button variant={filterStock === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStock('all')}>Todos</Button>
        <Button variant={filterStock === 'low' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStock('low')}>Estoque baixo</Button>
        <Button variant={filterStock === 'zero' ? 'default' : 'outline'} size="sm" onClick={() => setFilterStock('zero')}>Sem estoque</Button>
        {!isMobile && categories.length > 0 && (
          <Select value={filterCategory} onValueChange={setFilterCategory}>
            <SelectTrigger className="w-40 h-8"><SelectValue placeholder="Categoria" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todas categorias</SelectItem>
              {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Loading skeleton */}
      {loading ? (
        <ShimmerList count={6} rowClassName="h-20 w-full" />
      ) : isMobile ? (
        <div className="space-y-3">
          {filtered.map((p) => (
            <Card key={p.id} className="overflow-hidden" onClick={() => openEdit(p)}>
              <CardContent className="p-3">
                <div className="flex gap-3">
                  {p.image_path ? (
                    <img src={getImageUrl(p.image_path)!} alt={p.name} className="h-14 w-14 rounded-lg object-cover shrink-0" loading="lazy" />
                  ) : (
                    <div className="h-14 w-14 rounded-lg bg-muted flex items-center justify-center shrink-0">
                      <Package className="h-6 w-6 text-muted-foreground" />
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-sm truncate">{p.name}</p>
                        {(p.brand || p.model) && <p className="text-xs text-muted-foreground truncate">{[p.brand, p.model].filter(Boolean).join(' · ')}</p>}
                      </div>
                      {stockBadge(p)}
                    </div>
                    <div className="flex items-center justify-between mt-1.5">
                      <div className="text-xs text-muted-foreground">{p.categories?.name || 'Sem categoria'} {p.brand ? `• ${p.brand}` : ''}</div>
                      <p className="text-sm font-semibold">{fmt(p.sale_price)}</p>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <span className="text-xs text-muted-foreground">Estoque: {p.on_hand} (mín. {p.minimum_stock})</span>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openDuplicate(p); }}>
                          <Copy className="h-3 w-3 mr-1" /> Duplicar
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={(e) => { e.stopPropagation(); openEdit(p); }}>
                          <Edit className="h-3 w-3 mr-1" /> Editar
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          {filtered.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="mx-auto h-10 w-10 mb-2 opacity-50" />
              <p>Nenhum produto encontrado</p>
            </div>
          )}
        </div>
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12"></TableHead>
                  <TableHead>Produto</TableHead>
                  <TableHead>Categoria</TableHead>
                  <TableHead>Marca/Modelo</TableHead>
                  {canViewCost && <TableHead className="text-right">Custo</TableHead>}
                  <TableHead className="text-right">Preço</TableHead>
                  <TableHead className="text-center">Margem</TableHead>
                  <TableHead className="text-center">Estoque</TableHead>
                  <TableHead className="text-center">Mín.</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((p) => (
                  <TableRow key={p.id} className="cursor-pointer hover:bg-muted/50" onClick={() => openEdit(p)}>
                    <TableCell>
                      {p.image_path ? (
                        <img src={getImageUrl(p.image_path)!} alt={p.name} className="h-8 w-8 rounded object-cover" loading="lazy" />
                      ) : (
                        <div className="h-8 w-8 rounded bg-muted flex items-center justify-center"><Package className="h-4 w-4 text-muted-foreground" /></div>
                      )}
                    </TableCell>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell className="text-muted-foreground text-sm">{p.categories?.name || '-'}</TableCell>
                    <TableCell className="text-sm">{[p.brand, p.model].filter(Boolean).join(' / ') || '-'}</TableCell>
                    {canViewCost && <TableCell className="text-right text-sm">{fmt(p.cost_price)}</TableCell>}
                    <TableCell className="text-right text-sm font-medium">{fmt(p.sale_price)}</TableCell>
                    <TableCell className="text-center">{marginBadge(p)}</TableCell>
                    <TableCell className="text-center">
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${p.on_hand <= p.minimum_stock ? 'bg-destructive/10 text-destructive' : 'bg-emerald-50 text-emerald-700'}`}>{p.on_hand}</span>
                    </TableCell>
                    <TableCell className="text-center text-sm text-muted-foreground">{p.minimum_stock}</TableCell>
                    <TableCell>
                      <div className="flex gap-1" onClick={e => e.stopPropagation()}>
                        <Button variant="ghost" size="icon" onClick={() => setHistoryProduct(p)} title="Histórico"><History className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openEdit(p)} title="Editar"><Edit className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => openDuplicate(p)} title="Duplicar"><Copy className="h-4 w-4" /></Button>
                        <Button variant="ghost" size="icon" onClick={() => handleInactivate(p)} title="Inativar"><Archive className="h-4 w-4 text-muted-foreground" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtered.length === 0 && (
                  <TableRow><TableCell colSpan={canViewCost ? 10 : 9} className="text-center py-8 text-muted-foreground"><Package className="mx-auto h-8 w-8 mb-2 opacity-50" />Nenhum produto encontrado</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">{total} produto(s) — Pág {page + 1}/{totalPages}</p>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}><ChevronLeft className="h-4 w-4" /></Button>
            <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={o => { if (!saving) { setDialogOpen(o); if (!o) setScanMode(null); } }}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing ? 'Editar Produto' : 'Novo Produto'}</DialogTitle></DialogHeader>
          <div className="grid gap-4 py-2">
            <div className="space-y-2">
              <Label>Imagem</Label>
              <div className="flex items-center gap-4">
                {imagePreview ? (
                  <img src={imagePreview} alt="Preview" className="h-16 w-16 rounded-lg object-cover border" />
                ) : (
                  <div className="h-16 w-16 rounded-lg bg-muted flex items-center justify-center border border-dashed"><ImagePlus className="h-6 w-6 text-muted-foreground" /></div>
                )}
                <div>
                  <Input type="file" accept="image/*" onChange={handleImageChange} className="w-auto" />
                  <p className="text-xs text-muted-foreground mt-1">JPG, PNG. Máx 5MB.</p>
                </div>
              </div>
            </div>

            <div className="space-y-1">
              <Label>Código de barras</Label>
              <div className="flex gap-2">
                <Input value={form.barcode} onChange={e => setForm({ ...form, barcode: e.target.value })} placeholder="Opcional" className="h-11" data-no-scan />
                <Button
                  type="button"
                  variant={scanMode === 'form' ? 'default' : 'outline'}
                  className="h-11 gap-1 shrink-0"
                  onClick={() => { setScanMode(scanMode === 'form' ? null : 'form'); toast.info('Aponte o leitor para o código de barras'); }}
                >
                  <ScanLine className="h-4 w-4" /> {scanMode === 'form' ? 'Aguardando…' : 'Escanear'}
                </Button>
              </div>
            </div>


            <div className="space-y-1">
              <Label>Nome *</Label>
              <Input value={form.name} onChange={e => { setForm({ ...form, name: e.target.value }); setErrors(prev => ({ ...prev, name: '' })); }} placeholder="Tela iPhone 11" className={`h-11 ${errors.name ? 'border-destructive' : ''}`} />
              <FieldError field="name" />
            </div>

            <div className="space-y-1">
              <Label>Categoria</Label>
              <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1"><Label>Marca</Label><Input value={form.brand} onChange={e => setForm({ ...form, brand: e.target.value })} className="h-11" /></div>
              <div className="space-y-1"><Label>Modelo</Label><Input value={form.model} onChange={e => setForm({ ...form, model: e.target.value })} className="h-11" /></div>
            </div>

            <div className={`grid ${canViewCost ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
              {canViewCost && (
                <div className="space-y-1">
                  <Label>Custo (R$)</Label>
                  <Input type="number" step="0.01" min="0" value={form.cost_price} onChange={e => { setForm({ ...form, cost_price: e.target.value }); setErrors(prev => ({ ...prev, cost_price: '' })); }} className={`h-11 ${errors.cost_price ? 'border-destructive' : ''}`} />
                  <FieldError field="cost_price" />
                </div>
              )}
              <div className="space-y-1">
                <Label>Preço de venda (R$) *</Label>
                <Input type="number" step="0.01" min="0" value={form.sale_price} onChange={e => { setForm({ ...form, sale_price: e.target.value }); setErrors(prev => ({ ...prev, sale_price: '' })); }} className={`h-11 ${errors.sale_price ? 'border-destructive' : ''}`} />
                <FieldError field="sale_price" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1">
                <Label>{editing ? 'Estoque atual' : 'Quantidade inicial'}</Label>
                <Input type="number" min="0" value={form.on_hand} onChange={e => { setForm({ ...form, on_hand: e.target.value }); setErrors(prev => ({ ...prev, on_hand: '' })); }} className={`h-11 ${errors.on_hand ? 'border-destructive' : ''}`} />
                <FieldError field="on_hand" />
                {editing && <p className="text-xs text-muted-foreground">A diferença será registrada como ajuste no histórico.</p>}
              </div>
              <div className="space-y-1">
                <Label>Estoque mínimo</Label>
                <Input type="number" min="0" value={form.minimum_stock} onChange={e => { setForm({ ...form, minimum_stock: e.target.value }); setErrors(prev => ({ ...prev, minimum_stock: '' })); }} className={`h-11 ${errors.minimum_stock ? 'border-destructive' : ''}`} />
                <FieldError field="minimum_stock" />
              </div>
            </div>

            <div className="flex gap-2 mt-2">
              <Button onClick={handleSave} className="flex-1 h-11" disabled={saving}>
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Salvando...</> : editing ? 'Salvar Alterações' : 'Cadastrar Produto'}
              </Button>
              {editing && (
                <Button variant="outline" className="h-11" onClick={() => { setDialogOpen(false); handleInactivate(editing); }}>
                  <Archive className="h-4 w-4 mr-1" /> Inativar
                </Button>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {storeId && (
        <BulkProductDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          storeId={storeId}
          userId={user?.id}
          categories={categories}
          suppliers={suppliers}
          onSuccess={fetchProducts}
        />
      )}

      <ProductHistoryDialog
        productId={historyProduct?.id || null}
        productName={historyProduct?.name}
        open={!!historyProduct}
        onOpenChange={(o) => !o && setHistoryProduct(null)}
      />

      <BulkEditProductsDialog
        open={bulkEditOpen}
        onOpenChange={setBulkEditOpen}
        onSaved={fetchProducts}
      />
    </div>
  );
}
