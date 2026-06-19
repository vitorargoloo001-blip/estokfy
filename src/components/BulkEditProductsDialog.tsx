import { useEffect, useMemo, useState, useCallback, useRef, memo } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useIsMobile } from '@/hooks/use-mobile';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Loader2, Save, Upload, Download, Search, Filter, AlertTriangle, X, Trash2, FileDown } from 'lucide-react';
import { toast } from 'sonner';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Progress } from '@/components/ui/progress';

const PAGE_SIZE = 50;
const BULK_SERVER_BATCH_SIZE = 500;

// ============== Tradução de códigos de erro do backend ==============
const ERROR_LABELS: Record<string, { label: string; field?: string; group: string }> = {
  preco_invalido: { label: 'Preço não pode ser negativo', field: 'sale_price', group: 'price' },
  estoque_invalido: { label: 'Estoque não pode ser negativo', field: 'on_hand', group: 'stock' },
  estoque_minimo_invalido: { label: 'Estoque mínimo não pode ser negativo', field: 'minimum_stock', group: 'min_stock' },
  produto_nao_encontrado: { label: 'Produto não encontrado', group: 'not_found' },
  product_id_invalido: { label: 'ID do produto inválido', group: 'invalid_id' },
  sem_permissao: { label: 'Permissão negada', group: 'permission' },
  payload_invalido: { label: 'Payload inválido', group: 'payload' },
  lote_muito_grande: { label: 'Lote muito grande', group: 'payload' },
  categoria_invalida: { label: 'Categoria inválida', field: 'category_id', group: 'category' },
  marca_invalida: { label: 'Marca inválida', field: 'brand', group: 'brand' },
  sku_duplicado: { label: 'SKU duplicado', field: 'sku', group: 'sku' },
};
function describeError(code: string) {
  return ERROR_LABELS[code] || { label: code, group: 'unknown' };
}

const ERROR_FILTER_GROUPS: { value: string; label: string }[] = [
  { value: 'all', label: 'Todos os erros' },
  { value: 'price', label: 'Preço inválido' },
  { value: 'stock', label: 'Estoque inválido' },
  { value: 'min_stock', label: 'Estoque mínimo inválido' },
  { value: 'sku', label: 'SKU duplicado' },
  { value: 'category', label: 'Categoria inválida' },
  { value: 'brand', label: 'Marca inválida' },
  { value: 'permission', label: 'Permissão negada' },
  { value: 'not_found', label: 'Produto não encontrado' },
  { value: 'unknown', label: 'Erro desconhecido' },
];

interface ProductRow {
  id: string;
  sku: string;
  name: string;
  brand: string | null;
  model: string | null;
  category_id: string | null;
  sale_price: number;
  on_hand: number;
  minimum_stock: number;
  is_active: boolean;
}

interface RowChanges {
  sale_price?: string;
  on_hand?: string;
  minimum_stock?: string;
  category_id?: string | null;
  brand?: string;
  is_active?: boolean;
}

interface Cat { id: string; name: string; }

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved?: () => void;
}

type FilterKey = 'all' | 'no_price' | 'no_stock' | 'zero_stock' | 'no_min';

// =====================================================
// Linha de produto memoizada
// Recebe `changes` apenas dela, então só re-renderiza
// quando uma alteração própria muda.
// =====================================================
interface RowProps {
  product: ProductRow;
  changes: RowChanges | undefined;
  selected: boolean;
  cats: Cat[];
  isMobile: boolean;
  onToggleSelect: (id: string) => void;
  onChange: (id: string, patch: RowChanges) => void;
}

const ProductRowItem = memo(function ProductRowItem({
  product, changes, selected, cats, isMobile, onToggleSelect, onChange,
}: RowProps) {
  const isActive = changes?.is_active ?? product.is_active;
  const dirty = !!changes && Object.keys(changes).length > 0;
  const priceVal = changes?.sale_price ?? String(product.sale_price ?? '');
  const stockVal = changes?.on_hand ?? String(product.on_hand ?? '');
  const minVal = changes?.minimum_stock ?? String(product.minimum_stock ?? '');
  const brandVal = changes?.brand ?? (product.brand ?? '');
  const catVal = changes?.category_id ?? product.category_id ?? '';

  // Inputs não-controlados: digitação não dispara setState global.
  // Commit ocorre no onBlur.
  if (isMobile) {
    return (
      <div className={`p-3 border-b text-sm ${dirty ? 'border-l-4 border-l-primary bg-primary/5' : ''}`}>
        <div className="flex items-start gap-2 mb-2">
          <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(product.id)} className="mt-1" />
          <div className="flex-1 min-w-0">
            <div className="font-medium truncate">{product.name}</div>
            <div className="text-xs text-muted-foreground font-mono">{product.sku}</div>
          </div>
          {dirty && <Badge variant="secondary" className="text-[10px]">alterado</Badge>}
        </div>
        <div className="grid grid-cols-3 gap-2">
          <label className="text-xs">
            <span className="text-muted-foreground">Preço</span>
            <input
              type="number" step="0.01" inputMode="decimal"
              defaultValue={priceVal}
              onBlur={e => { if (e.target.value !== priceVal) onChange(product.id, { sale_price: e.target.value }); }}
              className="w-full h-8 px-2 mt-0.5 rounded border bg-background text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Estoque</span>
            <input
              type="number" inputMode="numeric"
              defaultValue={stockVal}
              onBlur={e => { if (e.target.value !== stockVal) onChange(product.id, { on_hand: e.target.value }); }}
              className="w-full h-8 px-2 mt-0.5 rounded border bg-background text-sm"
            />
          </label>
          <label className="text-xs">
            <span className="text-muted-foreground">Mínimo</span>
            <input
              type="number" inputMode="numeric"
              defaultValue={minVal}
              onBlur={e => { if (e.target.value !== minVal) onChange(product.id, { minimum_stock: e.target.value }); }}
              className="w-full h-8 px-2 mt-0.5 rounded border bg-background text-sm"
            />
          </label>
        </div>
        <div className="flex items-center justify-between mt-2">
          <label className="flex items-center gap-2 text-xs">
            <Checkbox checked={isActive} onCheckedChange={(v) => onChange(product.id, { is_active: !!v })} />
            Ativo
          </label>
        </div>
      </div>
    );
  }

  // Desktop: grid em 9 colunas (mesma proporção do header)
  return (
    <div
      className={`grid items-center gap-2 px-3 border-b hover:bg-muted/30 ${dirty ? 'bg-primary/5 border-l-2 border-l-primary' : ''}`}
      style={{ gridTemplateColumns: '32px minmax(180px,1.6fr) 110px 170px 130px 110px 90px 90px 60px', height: 52 }}
    >
      <Checkbox checked={selected} onCheckedChange={() => onToggleSelect(product.id)} />
      <div className="min-w-0">
        <div className="truncate font-medium text-sm">{product.name}</div>
        {product.model && <div className="text-xs text-muted-foreground truncate">{product.model}</div>}
      </div>
      <div className="font-mono text-xs truncate">{product.sku}</div>
      <select
        value={catVal || ''}
        onChange={e => onChange(product.id, { category_id: e.target.value || null })}
        className="h-8 px-2 rounded border bg-background text-xs"
      >
        <option value="">—</option>
        {cats.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input
        defaultValue={brandVal}
        onBlur={e => { if (e.target.value !== brandVal) onChange(product.id, { brand: e.target.value }); }}
        className="h-8 px-2 rounded border bg-background text-xs"
      />
      <input
        type="number" step="0.01" inputMode="decimal"
        defaultValue={priceVal}
        onBlur={e => { if (e.target.value !== priceVal) onChange(product.id, { sale_price: e.target.value }); }}
        className="h-8 px-2 rounded border bg-background text-xs text-right"
      />
      <input
        type="number" inputMode="numeric"
        defaultValue={stockVal}
        onBlur={e => { if (e.target.value !== stockVal) onChange(product.id, { on_hand: e.target.value }); }}
        className="h-8 px-2 rounded border bg-background text-xs text-right"
      />
      <input
        type="number" inputMode="numeric"
        defaultValue={minVal}
        onBlur={e => { if (e.target.value !== minVal) onChange(product.id, { minimum_stock: e.target.value }); }}
        className="h-8 px-2 rounded border bg-background text-xs text-right"
      />
      <div className="flex justify-center">
        <Checkbox checked={isActive} onCheckedChange={(v) => onChange(product.id, { is_active: !!v })} />
      </div>
    </div>
  );
}, (prev, next) => (
  prev.product === next.product &&
  prev.changes === next.changes &&
  prev.selected === next.selected &&
  prev.cats === next.cats &&
  prev.isMobile === next.isMobile &&
  prev.onToggleSelect === next.onToggleSelect &&
  prev.onChange === next.onChange
));

// =====================================================
// Lista compacta virtualizada (usada na aba "Aplicar em massa")
// Reutiliza estado/seleção/filtros da aba principal
// =====================================================
interface BulkSelectionListProps {
  rows: ProductRow[];
  cats: Cat[];
  loading: boolean;
  loadingMore: boolean;
  hasMore: boolean;
  totalCount: number;
  effectiveSelectedCount: number;
  selectAllMode: boolean;
  excluded: Set<string>;
  selected: Set<string>;
  isRowSelected: (id: string) => boolean;
  onToggleSelect: (id: string) => void;
  onToggleAll: () => void;
  onLoadMore: () => void;
  changes: Record<string, RowChanges>;
}

function BulkSelectionList({
  rows, cats, loading, loadingMore, hasMore, totalCount,
  effectiveSelectedCount, selectAllMode, excluded, selected,
  isRowSelected, onToggleSelect, onToggleAll, onLoadMore, changes,
}: BulkSelectionListProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const catName = useMemo(() => {
    const m = new Map<string, string>();
    cats.forEach(c => m.set(c.id, c.name));
    return m;
  }, [cats]);

  const ROW_HEIGHT = 56;
  // Mesma grid template para header e linhas — evita desalinhamento
  const GRID_COLS = '40px minmax(220px, 2fr) 120px 160px 130px 100px 80px 80px 70px';
  const MIN_WIDTH = 1100;

  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
  });

  useEffect(() => {
    const items = virt.getVirtualItems();
    if (items.length === 0) return;
    const last = items[items.length - 1];
    if (last.index >= rows.length - 5) onLoadMore();
  }, [virt.getVirtualItems(), rows.length, onLoadMore]); // eslint-disable-line react-hooks/exhaustive-deps

  const allHeaderChecked = effectiveSelectedCount > 0 && (selectAllMode ? excluded.size === 0 : selected.size === totalCount);

  return (
    <div className="flex-1 min-h-0 flex flex-col border-t bg-background">
      {/* Container com scroll vertical único; horizontal só se faltar largura */}
      <div ref={scrollRef} className="flex-1 min-h-0 overflow-auto pb-12" style={{ contain: 'strict' }}>
        <div style={{ minWidth: MIN_WIDTH }}>
          {/* Barra de seleção global — sempre visível na lista da aba bulk */}
          <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-primary/5 sticky top-0 z-20 text-xs">
            <div className="flex items-center gap-2">
              <Checkbox checked={allHeaderChecked} onCheckedChange={onToggleAll} aria-label="Selecionar todos" />
              <span>
                {selectAllMode ? (
                  <><b>{effectiveSelectedCount.toLocaleString('pt-BR')}</b> de {totalCount.toLocaleString('pt-BR')} selecionado(s) (todos do filtro){excluded.size > 0 ? ` • ${excluded.size} excluído(s)` : ''}</>
                ) : selected.size > 0 ? (
                  <><b>{selected.size.toLocaleString('pt-BR')}</b> selecionado(s) manualmente de {totalCount.toLocaleString('pt-BR')}</>
                ) : (
                  <>{totalCount.toLocaleString('pt-BR')} produto(s) no filtro atual</>
                )}
              </span>
            </div>
            <div className="flex items-center gap-2">
              {!selectAllMode && (
                <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={onToggleAll}>
                  Selecionar todos os {totalCount.toLocaleString('pt-BR')} produtos
                </Button>
              )}
              {(selectAllMode || selected.size > 0) && (
                <Button size="sm" variant="link" className="h-auto p-0 text-xs text-destructive" onClick={() => { /* limpar via toggle quando há seleção */ onToggleAll(); }}>
                  Limpar seleção
                </Button>
              )}
            </div>
          </div>
          {/* Header de colunas */}
          <div
            className="grid items-center gap-2 px-4 py-2 border-b bg-muted/60 backdrop-blur text-xs font-semibold text-muted-foreground sticky top-[37px] z-10"
            style={{ gridTemplateColumns: GRID_COLS }}
          >
            <div className="flex items-center justify-center">
              <Checkbox checked={allHeaderChecked} onCheckedChange={onToggleAll} aria-label="Selecionar todos" />
            </div>
            <div>Produto</div>
            <div>SKU</div>
            <div>Categoria</div>
            <div>Marca</div>
            <div className="text-right">Preço (R$)</div>
            <div className="text-right">Estoque</div>
            <div className="text-right">Mínimo</div>
            <div className="text-center">Ativo</div>
          </div>

          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : rows.length === 0 ? (
            <div className="text-center text-muted-foreground py-16 text-sm">Nenhum produto encontrado</div>
          ) : (
            <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
              {virt.getVirtualItems().map(vi => {
                const p = rows[vi.index];
                if (!p) return null;
                const sel = isRowSelected(p.id);
                const dirty = !!changes[p.id] && Object.keys(changes[p.id] || {}).length > 0;
                return (
                  <div
                    key={p.id}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      transform: `translateY(${vi.start}px)`,
                      height: ROW_HEIGHT,
                      gridTemplateColumns: GRID_COLS,
                    }}
                    className={`grid items-center gap-2 px-4 border-b text-sm cursor-pointer transition-colors ${
                      sel ? 'bg-primary/10 hover:bg-primary/15' : 'hover:bg-muted/40'
                    } ${dirty ? 'border-l-2 border-l-primary' : ''}`}
                    onClick={() => onToggleSelect(p.id)}
                  >
                    <div className="flex items-center justify-center">
                      <Checkbox
                        checked={sel}
                        onCheckedChange={() => onToggleSelect(p.id)}
                        onClick={e => e.stopPropagation()}
                        aria-label={`Selecionar ${p.name}`}
                      />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate font-medium">{p.name}</div>
                      {p.model && <div className="truncate text-xs text-muted-foreground">{p.model}</div>}
                    </div>
                    <div className="font-mono text-xs truncate">{p.sku}</div>
                    <div className="truncate text-xs">{p.category_id ? catName.get(p.category_id) || '—' : '—'}</div>
                    <div className="truncate text-xs">{p.brand || '—'}</div>
                    <div className="text-right text-sm tabular-nums">{Number(p.sale_price).toFixed(2)}</div>
                    <div className="text-right text-sm tabular-nums">{p.on_hand}</div>
                    <div className="text-right text-sm tabular-nums">{p.minimum_stock}</div>
                    <div className="text-center">
                      <Badge variant={p.is_active ? 'secondary' : 'outline'} className="text-[10px] px-1.5">
                        {p.is_active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {!loading && loadingMore && (
            <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando mais…
            </div>
          )}
          {!loading && !hasMore && rows.length > 0 && (
            <div className="text-center text-xs text-muted-foreground py-3">Fim dos resultados</div>
          )}
        </div>
      </div>
    </div>
  );
}

// =====================================================
// Componente principal
// =====================================================
export default function BulkEditProductsDialog({ open, onOpenChange, onSaved }: Props) {
  const { profile } = useAuth();
  const storeId = profile?.store_id;
  const isMobile = useIsMobile();

  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [saving, setSaving] = useState(false);
  const [rows, setRows] = useState<ProductRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [cats, setCats] = useState<Cat[]>([]);
  const [brands, setBrands] = useState<string[]>([]);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [filterBrand, setFilterBrand] = useState('all');
  const [filterKey, setFilterKey] = useState<FilterKey>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [changes, setChanges] = useState<Record<string, RowChanges>>({});

  // bulk apply inputs
  const [bulkPrice, setBulkPrice] = useState('');
  const [bulkStock, setBulkStock] = useState('');
  const [bulkMin, setBulkMin] = useState('');
  const [bulkCat, setBulkCat] = useState('');
  const [bulkBrand, setBulkBrand] = useState('');

  // ===== Progresso de salvamento =====
  interface BatchSample { batchIndex: number; size: number; ms: number; itemsPerSec: number; }
  const [saveProgress, setSaveProgress] = useState<{
    total: number;
    processed: number;
    updated: number;
    failed: number;
    etaSec: number;
    elapsedSec: number;
    cancelling: boolean;
    cancelled: boolean;
    batches: BatchSample[];
    errors: { product_id: string | null; sku?: string; name?: string; field?: string; value?: any; error: string }[];
  } | null>(null);
  const cancelRef = useRef(false);
  const [showErrors, setShowErrors] = useState(false);
  const [lastErrors, setLastErrors] = useState<{ product_id: string | null; sku?: string; name?: string; field?: string; value?: any; error: string }[]>([]);
  const [errorFilter, setErrorFilter] = useState<string>('all');
  const [cancelSummary, setCancelSummary] = useState<{ updated: number; remaining: number; total: number; remainingIds: string[] } | null>(null);

  const debouncedSearch = useDebouncedValue(search, 300);
  const reqIdRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  // ===== Persistência da seleção em localStorage =====
  const userId = profile?.auth_user_id || profile?.id || 'anon';
  const storageKey = storeId ? `bulkEditSelection:${storeId}:${userId}` : null;
  const restoredRef = useRef(false);

  // Restaurar ao abrir
  useEffect(() => {
    if (!open || !storageKey || restoredRef.current) return;
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const s = JSON.parse(raw);
        if (typeof s.selectAllMode === 'boolean') setSelectAllMode(s.selectAllMode);
        if (Array.isArray(s.excluded)) setExcluded(new Set(s.excluded));
        if (Array.isArray(s.selected)) setSelected(new Set(s.selected));
        if (typeof s.search === 'string') setSearch(s.search);
        if (typeof s.filterCat === 'string') setFilterCat(s.filterCat);
        if (typeof s.filterBrand === 'string') setFilterBrand(s.filterBrand);
        if (typeof s.filterKey === 'string') setFilterKey(s.filterKey as FilterKey);
      }
    } catch { /* ignore */ }
    restoredRef.current = true;
  }, [open, storageKey]);

  // Persistir mudanças
  useEffect(() => {
    if (!open || !storageKey || !restoredRef.current) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        selectAllMode,
        excluded: Array.from(excluded),
        selected: Array.from(selected),
        search, filterCat, filterBrand, filterKey,
      }));
    } catch { /* ignore */ }
  }, [open, storageKey, selectAllMode, excluded, selected, search, filterCat, filterBrand, filterKey]);

  const clearSelection = useCallback(() => {
    setSelectAllMode(false);
    setExcluded(new Set());
    setSelected(new Set());
    if (storageKey) { try { localStorage.removeItem(storageKey); } catch { /* ignore */ } }
    toast.success('Seleção limpa');
  }, [storageKey]);

  const buildQuery = useCallback((from: number, to: number, countMode: 'exact' | null = null) => {
    let q = supabase.from('products')
      .select(
        'id, sku, name, brand, model, category_id, sale_price, on_hand, minimum_stock, is_active',
        countMode ? { count: countMode } : undefined,
      )
      .eq('store_id', storeId!);

    const term = debouncedSearch.trim();
    if (term) {
      const safe = term.replace(/[%,]/g, ' ').trim();
      q = q.or(`name.ilike.%${safe}%,sku.ilike.%${safe}%,brand.ilike.%${safe}%,model.ilike.%${safe}%`);
    }
    if (filterCat !== 'all') q = q.eq('category_id', filterCat);
    if (filterBrand !== 'all') q = q.eq('brand', filterBrand);
    if (filterKey === 'no_price') q = q.lte('sale_price', 0);
    else if (filterKey === 'no_stock') q = q.lte('on_hand', 0);
    else if (filterKey === 'zero_stock') q = q.eq('on_hand', 0);
    else if (filterKey === 'no_min') q = q.lte('minimum_stock', 0);

    return q.order('on_hand', { ascending: false }).order('name', { ascending: true }).range(from, to);
  }, [storeId, debouncedSearch, filterCat, filterBrand, filterKey]);

  const fetchMeta = useCallback(async () => {
    if (!storeId) return;
    const [cRes, bRes] = await Promise.all([
      supabase.from('categories').select('id,name').eq('store_id', storeId).eq('is_active', true).order('name'),
      supabase.from('products').select('brand').eq('store_id', storeId).not('brand', 'is', null).limit(5000),
    ]);
    setCats(cRes.data || []);
    const set = new Set<string>();
    (bRes.data || []).forEach((p: any) => { if (p.brand?.trim()) set.add(p.brand.trim()); });
    setBrands(Array.from(set).sort());
  }, [storeId]);

  // Refetch ao mudar filtro/busca (debounced)
  useEffect(() => {
    if (!open || !storeId) return;
    const myReq = ++reqIdRef.current;
    const isInitial = !debouncedSearch && filterCat === 'all' && filterBrand === 'all' && filterKey === 'all' && rows.length === 0;
    if (isInitial) setLoading(true); else setSearching(true);

    (async () => {
      const { data, count, error } = await buildQuery(0, PAGE_SIZE - 1, 'exact');
      if (myReq !== reqIdRef.current) return;
      if (error) {
        toast.error('Erro ao buscar produtos');
        setLoading(false); setSearching(false);
        return;
      }
      const list = ((data as any[]) || []) as ProductRow[];
      setRows(list);
      setTotalCount(count || 0);
      setHasMore(list.length === PAGE_SIZE && (count || 0) > PAGE_SIZE);
      setSelected(new Set());
      setSelectAllMode(false);
      setExcluded(new Set());
      setLoading(false); setSearching(false);
      // volta scroll ao topo ao trocar filtro
      scrollRef.current?.scrollTo({ top: 0 });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, storeId, debouncedSearch, filterCat, filterBrand, filterKey]);

  useEffect(() => { if (open) fetchMeta(); }, [open, fetchMeta]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMore || loading) return;
    setLoadingMore(true);
    const from = rows.length;
    const { data, error } = await buildQuery(from, from + PAGE_SIZE - 1);
    if (!error) {
      const list = ((data as any[]) || []) as ProductRow[];
      setRows(prev => [...prev, ...list]);
      setHasMore(list.length === PAGE_SIZE && rows.length + list.length < totalCount);
    }
    setLoadingMore(false);
  }, [hasMore, loadingMore, loading, rows.length, totalCount, buildQuery]);

  // ===== Handlers estáveis (referência mantida) =====
  const handleChange = useCallback((id: string, patch: RowChanges) => {
    setChanges(prev => {
      const cur = prev[id] || {};
      const next = { ...cur, ...patch };
      return { ...prev, [id]: next };
    });
  }, []);

  const selectAllModeRef = useRef(false);
  useEffect(() => { selectAllModeRef.current = selectAllMode; }, [selectAllMode]);

  const handleToggleSelect = useCallback((id: string) => {
    if (selectAllModeRef.current) {
      setExcluded(prev => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
      });
      return;
    }
    setSelected(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }, []);

  const effectiveSelectedCount = selectAllMode
    ? Math.max(0, totalCount - excluded.size)
    : selected.size;

  const buildServerFilter = useCallback(() => ({
    store_id: storeId,
    search: debouncedSearch.trim() || null,
    category_id: filterCat === 'all' ? null : filterCat,
    brand: filterBrand === 'all' ? null : filterBrand,
    filter_key: filterKey,
    status: 'all',
  }), [storeId, debouncedSearch, filterCat, filterBrand, filterKey]);

  const isRowSelected = useCallback((id: string) => {
    return selectAllMode ? !excluded.has(id) : selected.has(id);
  }, [selectAllMode, selected, excluded]);

  const toggleSelectAll = useCallback(() => {
    if (selectAllMode || effectiveSelectedCount > 0) {
      // Limpa tudo
      setSelectAllMode(false);
      setExcluded(new Set());
      setSelected(new Set());
    } else {
      // Seleciona TODOS os que correspondem ao filtro (incluindo não carregados)
      setSelectAllMode(true);
      setExcluded(new Set());
      setSelected(new Set());
    }
  }, [selectAllMode, effectiveSelectedCount]);

  // Resolve IDs apenas para seleção manual. Em selectAllMode, o backend aplica pelo filtro real.
  const resolveSelectedIds = useCallback(async (): Promise<string[]> => {
    if (!selectAllMode) return Array.from(selected);
    if (!storeId) return [];
    const { data, error } = await supabase.rpc('resolve_product_ids_by_filter', {
      p_store_id: storeId,
      p_search: debouncedSearch.trim() || null,
      p_category_id: filterCat === 'all' ? null : filterCat,
      p_brand: filterBrand === 'all' ? null : filterBrand,
      p_filter_key: filterKey,
      p_status: 'all',
    } as any);
    if (error) throw error;
    return (((data as { id: string }[]) || []).map(r => r.id)).filter(id => !excluded.has(id));
  }, [selectAllMode, selected, excluded, storeId, debouncedSearch, filterCat, filterBrand, filterKey]);

  const dirtyIds = useMemo(() => Object.keys(changes).filter(id => Object.keys(changes[id] || {}).length > 0), [changes]);
  const dirtyCount = dirtyIds.length;

  const applyToSelected = async (
    field: 'sale_price' | 'on_hand' | 'minimum_stock' | 'category_id' | 'brand' | 'is_active',
    value: any,
  ) => {
    if (effectiveSelectedCount === 0) { toast.error('Selecione pelo menos um produto'); return; }
    if (!storeId) return;

    // Validação básica
    if (field === 'sale_price' && (typeof value !== 'number' || isNaN(value) || value < 0)) {
      toast.error('Preço inválido'); return;
    }
    if ((field === 'on_hand' || field === 'minimum_stock') && (typeof value !== 'number' || isNaN(value) || value < 0)) {
      toast.error('Quantidade inválida'); return;
    }

    const labelMap: Record<string, string> = {
      sale_price: 'preço', on_hand: 'estoque', minimum_stock: 'estoque mínimo',
      category_id: 'categoria', brand: 'marca', is_active: value ? 'ativar' : 'desativar',
    };
    const total = effectiveSelectedCount;
    if (!confirm(`Aplicar ${labelMap[field]} em ${total.toLocaleString('pt-BR')} produto(s) e salvar agora?`)) return;

    setSaving(true);
    cancelRef.current = false;
    const operationId = crypto.randomUUID();
    const startedAt = performance.now();
    const allErrors: { product_id: string | null; sku?: string; name?: string; field?: string; value?: any; error: string }[] = [];
    const successIds: string[] = [];
    const batches: BatchSample[] = [];
    let processed = 0, updated = 0, failed = 0, cancelledFlag = false;

    setSaveProgress({
      total, processed: 0, updated: 0, failed: 0, etaSec: 0, elapsedSec: 0,
      cancelling: false, cancelled: false, batches: [], errors: [],
    });

    const applyBatch = async (ids: string[]) => {
      const patch: any = {};
      if (field === 'category_id') patch.category_id = value || null;
      else if (field === 'brand') patch.brand = (value ?? '').toString();
      else patch[field] = value;
      return supabase.rpc('apply_bulk_product_updates', {
        p_items: null,
        p_product_ids: ids,
        p_filter: null,
        p_patch: patch,
        p_excluded_ids: [],
        p_batch_size: BULK_SERVER_BATCH_SIZE,
        p_operation_id: operationId,
      } as any);
    };

    try {
      if (selectAllMode) {
        let afterId: string | null = null;
        // Itera por TODAS as páginas até a RPC não retornar mais IDs.
        // NÃO depende de `total` (que pode estar defasado / capado em 1000 pelo PostgREST).
        while (true) {
          if (cancelRef.current) { cancelledFlag = true; break; }
          const { data: pageData, error: pageError } = await supabase.rpc('resolve_product_ids_by_filter_page', {
            p_store_id: storeId,
            p_search: debouncedSearch.trim() || null,
            p_category_id: filterCat === 'all' ? null : filterCat,
            p_brand: filterBrand === 'all' ? null : filterBrand,
            p_filter_key: filterKey,
            p_status: 'all',
            p_after_id: afterId,
            p_limit: BULK_SERVER_BATCH_SIZE,
          } as any);
          if (pageError) throw pageError;
          const pageIds = (((pageData as { id: string }[]) || []).map(r => r.id));
          if (pageIds.length === 0) break;
          afterId = pageIds[pageIds.length - 1];
          const slice = pageIds.filter(id => !excluded.has(id));
          if (slice.length === 0) continue;

          const batchStart = performance.now();
          const { data, error } = await applyBatch(slice);

          if (error) {
            slice.forEach(id => allErrors.push({ product_id: id, error: error.message }));
            failed += slice.length;
          } else {
            const res = (data as any) || {};
            const updIds: string[] = res.updated_ids || [];
            updated += Number(res.success_count ?? res.updated_count ?? updIds.length ?? 0);
            successIds.push(...updIds);
            const errs: { product_id: string | null; sku?: string; name?: string; error: string }[] = res.errors || [];
            failed += errs.length;
            errs.forEach(e => {
              const desc = describeError(e.error);
              allErrors.push({ product_id: e.product_id, sku: e.sku, name: e.name, field: desc.field, value, error: desc.label });
            });
          }
          processed += slice.length;

          const batchMs = performance.now() - batchStart;
          batches.push({
            batchIndex: batches.length + 1, size: slice.length, ms: Math.round(batchMs),
            itemsPerSec: +(slice.length / Math.max(batchMs / 1000, 0.001)).toFixed(2),
          });
          const recent = batches.slice(-5);
          const avgRate = recent.reduce((s, b) => s + b.itemsPerSec, 0) / recent.length;
          // total real pode ser maior que o estimado; usa max(total, processed)
          const liveTotal = Math.max(total, processed);
          const etaSec = avgRate > 0 ? Math.ceil(Math.max(liveTotal - processed, 0) / avgRate) : 0;
          setSaveProgress({
            total: liveTotal, processed, updated, failed, etaSec,
            elapsedSec: +((performance.now() - startedAt) / 1000).toFixed(1),
            cancelling: cancelRef.current, cancelled: false,
            batches: [...batches], errors: allErrors,
          });
        }
      } else {
          const ids = await resolveSelectedIds();
        if (ids.length === 0) { toast.error('Nenhum produto selecionado'); setSaving(false); setSaveProgress(null); return; }
        for (let i = 0; i < ids.length; i += BULK_SERVER_BATCH_SIZE) {
          if (cancelRef.current) { cancelledFlag = true; break; }
        const batchStart = performance.now();
          const slice = ids.slice(i, i + BULK_SERVER_BATCH_SIZE);
          const { data, error } = await applyBatch(slice);

        if (error) {
          slice.forEach(id => allErrors.push({ product_id: id, error: error.message }));
          failed += slice.length;
        } else {
          const res = (data as any) || {};
          const updIds: string[] = res.updated_ids || [];
            updated += Number(res.success_count ?? res.updated_count ?? updIds.length ?? 0);
          successIds.push(...updIds);
          const errs: { product_id: string | null; error: string }[] = res.errors || [];
          failed += errs.length;
          errs.forEach(e => {
            const desc = describeError(e.error);
            allErrors.push({ product_id: e.product_id, field: desc.field, value, error: desc.label });
          });
        }
        processed += slice.length;

        const batchMs = performance.now() - batchStart;
        batches.push({
          batchIndex: batches.length + 1, size: slice.length, ms: Math.round(batchMs),
          itemsPerSec: +(slice.length / Math.max(batchMs / 1000, 0.001)).toFixed(2),
        });
        const recent = batches.slice(-5);
        const avgRate = recent.reduce((s, b) => s + b.itemsPerSec, 0) / recent.length;
        const etaSec = avgRate > 0 ? Math.ceil(Math.max(total - processed, 0) / avgRate) : 0;
        setSaveProgress({
          total, processed, updated, failed, etaSec,
          elapsedSec: +((performance.now() - startedAt) / 1000).toFixed(1),
          cancelling: cancelRef.current, cancelled: false,
          batches: [...batches], errors: allErrors,
        });
        }
      }
    } catch (e: any) {
      toast.error('Erro ao aplicar: ' + (e?.message || e));
    }

    const durationMs = Math.round(performance.now() - startedAt);

    // O total real pode diferir do estimado inicial (ex.: contagem do filtro estava
    // defasada/capada). Usa o maior entre o estimado e o efetivamente processado.
    const realTotal = Math.max(total, processed);

    // Log de auditoria
    try {
      await supabase.from('bulk_operations_log').insert({
        store_id: storeId,
        actor_profile_id: profile?.id || null,
        operation: 'bulk_product_update',
        status: cancelledFlag ? 'cancelled' : (failed > 0 ? 'completed_with_errors' : 'completed'),
        cancelled_at: cancelledFlag ? new Date().toISOString() : null,
        cancelled_by: cancelledFlag ? (profile?.id || null) : null,
        total_count: realTotal,
        total_items: realTotal,
        processed_count: processed,
        processed_items: processed,
        remaining_count: Math.max(realTotal - processed, 0),
        total_requested: realTotal,
        total_updated: updated,
        success_items: updated,
        total_failed: failed,
        error_items: failed,
        started_at: new Date(performance.timeOrigin + startedAt).toISOString(),
        finished_at: new Date().toISOString(),
        fields_changed: [field],
        duration_ms: durationMs,
        errors_json: allErrors.length ? allErrors.slice(0, 500) : null,
        filter_json: {
          search: debouncedSearch,
          category_id: filterCat === 'all' ? null : filterCat,
          brand: filterBrand === 'all' ? null : filterBrand,
          filter_key: filterKey,
          select_all_mode: selectAllMode,
          excluded_count: excluded.size,
          quick_apply_field: field,
          applied_value: value,
        },
      });
    } catch { /* ignore */ }

    // Atualização otimista das linhas carregadas
    const successSet = new Set(successIds);
    setRows(prev => prev.map(r => {
      if (!successSet.has(r.id)) return r;
      const patch: any = {};
      if (field === 'category_id') patch.category_id = value || null;
      else if (field === 'brand') patch.brand = (value ?? '').toString().trim() || null;
      else patch[field] = value;
      return { ...r, ...patch };
    }));
    // Limpa qualquer alteração local pendente neste campo para os IDs salvos
    setChanges(prev => {
      const n = { ...prev };
      successIds.forEach(id => {
        if (n[id]) {
          const c = { ...n[id] };
          delete (c as any)[field];
          if (Object.keys(c).length === 0) delete n[id]; else n[id] = c;
        }
      });
      return n;
    });

    setSaving(false);
    setSaveProgress(null);
    setLastErrors(allErrors);
    setErrorFilter('all');

    if (cancelledFlag) {
      toast.warning(`Interrompido. ${updated.toLocaleString('pt-BR')} salvos • ${Math.max(total - processed, 0).toLocaleString('pt-BR')} pendentes`);
    } else if (failed > 0) {
      toast.error(`${updated.toLocaleString('pt-BR')} salvos • ${failed.toLocaleString('pt-BR')} falha(s)`, {
        action: { label: 'Ver erros', onClick: () => setShowErrors(true) },
      });
    } else {
      toast.success(`${updated.toLocaleString('pt-BR')} produto(s) atualizado(s) em ${(durationMs / 1000).toFixed(1)}s`);
    }
    onSaved?.();
  };

  // ===== Build & save =====
  const buildUpdates = async () => {
    const updates: { product: ProductRow; changes: any; stockDelta: number; before: any; after: any }[] = [];
    const errors: string[] = [];
    const byId = new Map<string, ProductRow>(rows.map(r => [r.id, r]));

    // Busca do banco os produtos dirty que não estão carregados localmente
    const missing = dirtyIds.filter(id => !byId.has(id));
    if (missing.length > 0) {
      const CHUNK = 200;
      for (let i = 0; i < missing.length; i += CHUNK) {
        const slice = missing.slice(i, i + CHUNK);
        const { data, error } = await supabase
          .from('products')
          .select('id, sku, name, brand, model, category_id, sale_price, on_hand, minimum_stock, is_active')
          .in('id', slice);
        if (error) { errors.push('Falha ao carregar produtos selecionados do banco'); break; }
        ((data as any[]) || []).forEach(p => byId.set(p.id, p as ProductRow));
      }
    }

    for (const id of dirtyIds) {
      const r = byId.get(id);
      if (!r) continue;
      const c = changes[id]!;
      const ch: any = {}; const before: any = {}; const after: any = {};
      let stockDelta = 0;

      if (c.sale_price !== undefined) {
        const v = parseFloat(String(c.sale_price).replace(',', '.'));
        if (isNaN(v) || v < 0) { errors.push(`${r.sku}: preço inválido`); continue; }
        if (v !== Number(r.sale_price)) { ch.sale_price = v; before.sale_price = r.sale_price; after.sale_price = v; }
      }
      if (c.minimum_stock !== undefined) {
        const v = parseInt(String(c.minimum_stock));
        if (isNaN(v) || v < 0) { errors.push(`${r.sku}: estoque mínimo inválido`); continue; }
        if (v !== Number(r.minimum_stock)) { ch.minimum_stock = v; before.minimum_stock = r.minimum_stock; after.minimum_stock = v; }
      }
      if (c.on_hand !== undefined) {
        const v = parseInt(String(c.on_hand));
        if (isNaN(v) || v < 0) { errors.push(`${r.sku}: estoque inválido`); continue; }
        if (v !== Number(r.on_hand)) { ch.on_hand = v; before.on_hand = r.on_hand; after.on_hand = v; stockDelta = v - Number(r.on_hand); }
      }
      if (c.category_id !== undefined && (c.category_id || null) !== (r.category_id || null)) {
        ch.category_id = c.category_id || null; before.category_id = r.category_id; after.category_id = c.category_id || null;
      }
      if (c.brand !== undefined && (c.brand.trim() || null) !== (r.brand || null)) {
        ch.brand = c.brand.trim() || null; before.brand = r.brand; after.brand = ch.brand;
      }
      if (c.is_active !== undefined && c.is_active !== r.is_active) {
        ch.is_active = c.is_active; before.is_active = r.is_active; after.is_active = c.is_active;
      }
      if (Object.keys(ch).length > 0) updates.push({ product: r, changes: ch, stockDelta, before, after });
    }
    return { updates, errors };
  };

  const handleSave = async () => {
    if (!storeId) return;

    // ===== Validação no frontend ANTES de chamar a RPC =====
    const { updates, errors } = await buildUpdates();
    if (errors.length > 0) {
      const enriched = errors.map(e => ({ product_id: null, error: e }));
      setLastErrors(enriched);
      toast.error(`${errors.length} erro(s) de validação. Corrija antes de salvar.`, {
        action: { label: 'Ver erros', onClick: () => setShowErrors(true) },
      });
      return;
    }
    if (updates.length === 0) { toast.info('Nenhuma alteração para salvar'); return; }
    if (!confirm(`Tem certeza que deseja atualizar ${updates.length.toLocaleString('pt-BR')} produto(s)?`)) return;

    // Coleta campos alterados (para o log)
    const fieldsSet = new Set<string>();
    updates.forEach(u => Object.keys(u.changes).forEach(k => fieldsSet.add(k)));
    const fieldsChanged = Array.from(fieldsSet);

    // Index por id pra enriquecer erros
    const productById = new Map<string, ProductRow>(updates.map(u => [u.product.id, u.product]));
    const sentChanges = new Map<string, any>(updates.map(u => [u.product.id, u.changes]));

    setSaving(true);
    setCancelSummary(null);
    cancelRef.current = false;
    const total = updates.length;
    const startedAt = performance.now();
    const allErrors: { product_id: string | null; sku?: string; name?: string; field?: string; value?: any; error: string }[] = [];
    const successIds: string[] = [];
    const batches: BatchSample[] = [];
    let processed = 0;
    let updated = 0;
    let failed = 0;
    let cancelledFlag = false;

    setSaveProgress({
      total, processed: 0, updated: 0, failed: 0, etaSec: 0, elapsedSec: 0,
      cancelling: false, cancelled: false, batches: [], errors: [],
    });

    const enrichErr = (e: { product_id: string | null; error: string }) => {
      const prod = e.product_id ? productById.get(e.product_id) : undefined;
      const desc = describeError(e.error);
      const sent = e.product_id ? sentChanges.get(e.product_id) : null;
      const value = desc.field && sent ? sent[desc.field] : undefined;
      return {
        product_id: e.product_id,
        sku: prod?.sku,
        name: prod?.name,
        field: desc.field,
        value,
        error: desc.label,
      };
    };

    const BATCH = 100;
    try {
      for (let i = 0; i < updates.length; i += BATCH) {
        // ===== Cancelamento real ENTRE lotes =====
        if (cancelRef.current) { cancelledFlag = true; break; }

        const batchStart = performance.now();
        const slice = updates.slice(i, i + BATCH);
        const items = slice.map(u => ({ product_id: u.product.id, ...u.changes }));
        const { data, error } = await supabase.rpc('apply_bulk_product_updates', { p_items: items });

        if (error) {
          slice.forEach(u => allErrors.push(enrichErr({ product_id: u.product.id, error: error.message })));
          failed += slice.length;
        } else {
          const res = (data as any) || {};
          const updIds: string[] = res.updated_ids || [];
          updated += updIds.length;
          successIds.push(...updIds);
          const errs: { product_id: string | null; error: string }[] = res.errors || [];
          failed += errs.length;
          errs.forEach(e => allErrors.push(enrichErr(e)));
        }
        processed += slice.length;

        const batchMs = performance.now() - batchStart;
        const sample: BatchSample = {
          batchIndex: batches.length + 1,
          size: slice.length,
          ms: Math.round(batchMs),
          itemsPerSec: +(slice.length / Math.max(batchMs / 1000, 0.001)).toFixed(2),
        };
        batches.push(sample);

        // ETA baseada nos últimos lotes (média móvel)
        const recent = batches.slice(-5);
        const avgRate = recent.reduce((s, b) => s + b.itemsPerSec, 0) / recent.length;
        const remaining = Math.max(total - processed, 0);
        const etaSec = avgRate > 0 ? Math.ceil(remaining / avgRate) : 0;
        const elapsedSec = +((performance.now() - startedAt) / 1000).toFixed(1);

        setSaveProgress({
          total, processed, updated, failed, etaSec, elapsedSec,
          cancelling: cancelRef.current, cancelled: false,
          batches: [...batches], errors: allErrors,
        });
      }
    } catch (e: any) {
      toast.error('Erro ao salvar: ' + (e?.message || e));
    }

    const durationMs = Math.round(performance.now() - startedAt);
    const remainingCount = Math.max(total - processed, 0);

    // IDs restantes (não processados) — usado em cancelamento
    const remainingIds = cancelledFlag ? updates.slice(processed).map(u => u.product.id) : [];

    // Log de auditoria
    try {
      await supabase.from('bulk_operations_log').insert({
        store_id: storeId,
        actor_profile_id: profile?.id || null,
        operation: 'bulk_product_update',
        status: cancelledFlag ? 'cancelled' : (failed > 0 ? 'completed_with_errors' : 'completed'),
        cancelled_at: cancelledFlag ? new Date().toISOString() : null,
        cancelled_by: cancelledFlag ? (profile?.id || null) : null,
        total_count: total,
        processed_count: processed,
        remaining_count: remainingCount,
        total_requested: total,
        total_updated: updated,
        total_failed: failed,
        fields_changed: fieldsChanged,
        duration_ms: durationMs,
        errors_json: allErrors.length ? allErrors.slice(0, 500) : null,
        filter_json: {
          search: debouncedSearch,
          category_id: filterCat === 'all' ? null : filterCat,
          brand: filterBrand === 'all' ? null : filterBrand,
          filter_key: filterKey,
          select_all_mode: selectAllMode,
          excluded_count: excluded.size,
          remaining_ids: remainingIds.slice(0, 1000),
        },
      });
    } catch { /* ignore */ }

    // Atualização otimista
    const successSet = new Set(successIds);
    setRows(prev => prev.map(r => {
      if (!successSet.has(r.id)) return r;
      const u = updates.find(x => x.product.id === r.id);
      return u ? ({ ...r, ...u.changes } as ProductRow) : r;
    }));
    setChanges(prev => {
      const n = { ...prev };
      successIds.forEach(id => delete n[id]);
      return n;
    });

    setSaving(false);
    setSaveProgress(null);
    setLastErrors(allErrors);
    setErrorFilter('all');

    if (cancelledFlag) {
      setCancelSummary({ updated, remaining: remainingCount, total, remainingIds });
      toast.warning(`Operação interrompida. ${updated.toLocaleString('pt-BR')} atualizados • ${remainingCount.toLocaleString('pt-BR')} não processados`);
    } else if (failed > 0) {
      toast.error(`${updated.toLocaleString('pt-BR')} salvos • ${failed.toLocaleString('pt-BR')} falha(s)`, {
        action: { label: 'Ver erros', onClick: () => setShowErrors(true) },
      });
    } else {
      toast.success(`${updated.toLocaleString('pt-BR')} produto(s) atualizado(s) em ${(durationMs / 1000).toFixed(1)}s`);
    }
    onSaved?.();
  };

  // ===== Excel/CSV =====
  const downloadTemplate = () => {
    const data = rows.map(r => ({
      SKU: r.sku, Nome: r.name, Marca: r.brand || '', Modelo: r.model || '',
      Categoria: cats.find(c => c.id === r.category_id)?.name || '',
      'Preço Venda': r.sale_price, 'Estoque Atual': r.on_hand, 'Estoque Mínimo': r.minimum_stock,
      Ativo: r.is_active ? 'sim' : 'não',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
    XLSX.writeFile(wb, `produtos-edicao-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !storeId) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      const skuMap = new Map(rows.map(r => [r.sku.toLowerCase(), r]));
      const catMap = new Map(cats.map(c => [c.name.toLowerCase(), c.id]));
      let updated = 0, notFound = 0, errs = 0;
      const next: Record<string, RowChanges> = { ...changes };

      data.forEach((line, idx) => {
        const sku = String(line['SKU'] || line['sku'] || '').trim();
        if (!sku) return;
        const existing = skuMap.get(sku.toLowerCase());
        if (!existing) { notFound++; return; }

        const price = line['Preço Venda'] ?? line['Preco Venda'] ?? line['preco_venda'];
        const onHand = line['Estoque Atual'] ?? line['estoque'];
        const minStock = line['Estoque Mínimo'] ?? line['Estoque Minimo'];
        const brand = line['Marca'];
        const catName = String(line['Categoria'] || '').trim();
        const ativo = String(line['Ativo'] || '').toLowerCase().trim();

        const patch: RowChanges = { ...(next[existing.id] || {}) };
        if (price !== '' && price !== undefined) {
          const v = typeof price === 'number' ? price : parseFloat(String(price).replace(',', '.'));
          if (isNaN(v) || v < 0) errs++; else patch.sale_price = String(v);
        }
        if (onHand !== '' && onHand !== undefined) {
          const v = typeof onHand === 'number' ? onHand : parseInt(String(onHand));
          if (isNaN(v) || v < 0) errs++; else patch.on_hand = String(v);
        }
        if (minStock !== '' && minStock !== undefined) {
          const v = typeof minStock === 'number' ? minStock : parseInt(String(minStock));
          if (isNaN(v) || v < 0) errs++; else patch.minimum_stock = String(v);
        }
        if (brand !== undefined && brand !== '') patch.brand = String(brand);
        if (catName) {
          const cid = catMap.get(catName.toLowerCase());
          if (cid) patch.category_id = cid;
        }
        if (ativo === 'sim' || ativo === 'não' || ativo === 'nao') patch.is_active = ativo === 'sim';

        next[existing.id] = patch;
        updated++;
      });
      setChanges(next);
      toast.success(`${updated} produto(s) carregado(s) • ${notFound} SKU(s) não encontrado(s)${errs ? ` • ${errs} erro(s)` : ''}`);
    } catch (err: any) {
      toast.error('Erro ao importar arquivo: ' + (err.message || err));
    }
  };

  // ===== Virtualização =====
  const rowHeight = isMobile ? 180 : 52;
  const virt = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: 8,
  });

  // Infinite scroll: dispara quando próximo do fim
  useEffect(() => {
    const items = virt.getVirtualItems();
    if (items.length === 0) return;
    const last = items[items.length - 1];
    if (last.index >= rows.length - 5) loadMore();
  }, [virt.getVirtualItems(), rows.length, loadMore]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[95vw] w-[95vw] h-[92vh] max-h-[92vh] flex flex-col p-0 gap-0">
        <DialogHeader className="p-4 border-b">
          <DialogTitle className="flex items-center gap-2">
            Edição em massa de produtos
            {dirtyCount > 0 && <Badge variant="secondary">{dirtyCount} alteração(ões) pendente(s)</Badge>}
          </DialogTitle>
        </DialogHeader>

        <Tabs defaultValue="table" className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <TabsList className="mx-4 mt-2 self-start shrink-0">
            <TabsTrigger value="table">Tabela editável</TabsTrigger>
            <TabsTrigger value="bulk">Aplicar em massa</TabsTrigger>
            <TabsTrigger value="import">Importar Excel/CSV</TabsTrigger>
          </TabsList>

          {/* ===== Filtros ===== */}
          <div className="px-4 py-2 border-b flex flex-wrap gap-2 items-center shrink-0">
            <div className="relative flex-1 min-w-[200px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input placeholder="Buscar por SKU, nome, marca, modelo..." value={search} onChange={e => setSearch(e.target.value)} className="pl-9 pr-9 h-9" />
              {searching && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 animate-spin text-muted-foreground" />}
            </div>
            <Select value={filterCat} onValueChange={setFilterCat}>
              <SelectTrigger className="w-44 h-9"><SelectValue placeholder="Categoria" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas categorias</SelectItem>
                {cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterBrand} onValueChange={setFilterBrand}>
              <SelectTrigger className="w-40 h-9"><SelectValue placeholder="Marca" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todas marcas</SelectItem>
                {brands.map(b => <SelectItem key={b} value={b}>{b}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={filterKey} onValueChange={(v) => setFilterKey(v as FilterKey)}>
              <SelectTrigger className="w-48 h-9"><Filter className="h-3 w-3 mr-1" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos</SelectItem>
                <SelectItem value="no_price">Sem preço</SelectItem>
                <SelectItem value="zero_stock">Estoque zerado</SelectItem>
                <SelectItem value="no_stock">Sem estoque (≤0)</SelectItem>
                <SelectItem value="no_min">Sem estoque mínimo</SelectItem>
              </SelectContent>
            </Select>
            <div className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
              {searching ? 'Buscando…' : <>{totalCount.toLocaleString('pt-BR')} produtos encontrados • <b>{effectiveSelectedCount.toLocaleString('pt-BR')}</b> sel.{selectAllMode && excluded.size > 0 ? ` (−${excluded.size})` : ''}</>}
            </div>
          </div>

          {/* Banner de seleção global */}
          {effectiveSelectedCount > 0 && (
            <div className="px-4 py-2 bg-primary/5 border-b text-xs flex items-center justify-between gap-2 shrink-0">
              <span>
                {selectAllMode
                  ? <><b>{effectiveSelectedCount.toLocaleString('pt-BR')}</b> produto(s) selecionado(s) — todos os que correspondem ao filtro atual.</>
                  : <><b>{effectiveSelectedCount.toLocaleString('pt-BR')}</b> produto(s) selecionado(s) manualmente.</>
                }
              </span>
              <div className="flex gap-2">
                {!selectAllMode && totalCount > rows.length && (
                  <Button size="sm" variant="link" className="h-auto p-0 text-xs" onClick={() => { setSelectAllMode(true); setExcluded(new Set()); setSelected(new Set()); }}>
                    Selecionar todos os {totalCount.toLocaleString('pt-BR')}
                  </Button>
                )}
                <Button size="sm" variant="link" className="h-auto p-0 text-xs gap-1" onClick={clearSelection}>
                  <Trash2 className="h-3 w-3" /> Limpar seleção
                </Button>
              </div>
            </div>
          )}

          <TabsContent value="table" className="flex-1 overflow-hidden m-0 flex flex-col data-[state=inactive]:hidden">
            {/* Header (apenas desktop) */}
            {!isMobile && (
              <div
                className="grid items-center gap-2 px-3 py-2 border-b bg-muted/40 text-xs font-semibold text-muted-foreground sticky top-0 z-10"
                style={{ gridTemplateColumns: '32px minmax(180px,1.6fr) 110px 170px 130px 110px 90px 90px 60px' }}
              >
                <Checkbox
                  checked={effectiveSelectedCount > 0 && (selectAllMode ? excluded.size === 0 : selected.size === totalCount)}
                  onCheckedChange={toggleSelectAll}
                />
                <div>Produto</div>
                <div>SKU</div>
                <div>Categoria</div>
                <div>Marca</div>
                <div className="text-right">Preço (R$)</div>
                <div className="text-right">Estoque</div>
                <div className="text-right">Mínimo</div>
                <div className="text-center">Ativo</div>
              </div>
            )}

            <div ref={scrollRef} className="flex-1 overflow-auto" style={{ contain: 'strict' }}>
              {loading ? (
                <div className="p-4 space-y-2">
                  {Array.from({ length: 10 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </div>
              ) : rows.length === 0 ? (
                <div className="text-center text-muted-foreground py-12 text-sm">Nenhum produto encontrado</div>
              ) : (
                <div style={{ height: virt.getTotalSize(), position: 'relative', width: '100%' }}>
                  {virt.getVirtualItems().map(vi => {
                    const product = rows[vi.index];
                    if (!product) return null;
                    return (
                      <div
                        key={product.id}
                        style={{
                          position: 'absolute',
                          top: 0, left: 0, width: '100%',
                          transform: `translateY(${vi.start}px)`,
                        }}
                      >
                        <ProductRowItem
                          product={product}
                          changes={changes[product.id]}
                          selected={isRowSelected(product.id)}
                          cats={cats}
                          isMobile={isMobile}
                          onToggleSelect={handleToggleSelect}
                          onChange={handleChange}
                        />
                      </div>
                    );
                  })}
                </div>
              )}
              {!loading && loadingMore && (
                <div className="flex items-center justify-center py-3 text-xs text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin mr-2" /> Carregando mais…
                </div>
              )}
              {!loading && !hasMore && rows.length > 0 && (
                <div className="text-center text-xs text-muted-foreground py-3">Fim dos resultados</div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="bulk" className="m-0 flex-1 min-h-0 overflow-hidden flex flex-col data-[state=inactive]:hidden">
            {/* Área de ações em massa — compacta, alinhada ao topo */}
            <div className="px-4 py-3 border-b bg-muted/20 space-y-3 shrink-0">
              {effectiveSelectedCount === 0 ? (
                <div className="flex items-center gap-2 text-xs text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md px-3 py-2">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  Selecione os produtos que deseja alterar na lista abaixo.
                </div>
              ) : (
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Aplica o valor informado em <b>{effectiveSelectedCount.toLocaleString('pt-BR')}</b> produto(s) selecionado(s).
                </div>
              )}
              <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-3">
                <div className="flex gap-2 items-end min-w-0">
                  <div className="flex-1 min-w-0"><label className="text-[11px] text-muted-foreground leading-none">Preço de venda (R$)</label><Input type="number" step="0.01" value={bulkPrice} onChange={e => setBulkPrice(e.target.value)} className="h-10 mt-1" /></div>
                  <Button size="sm" className="h-10 px-4" onClick={() => { applyToSelected('sale_price', parseFloat(bulkPrice)); setBulkPrice(''); }} disabled={!bulkPrice || effectiveSelectedCount === 0}>Aplicar</Button>
                </div>
                <div className="flex gap-2 items-end min-w-0">
                  <div className="flex-1 min-w-0"><label className="text-[11px] text-muted-foreground leading-none">Estoque atual</label><Input type="number" value={bulkStock} onChange={e => setBulkStock(e.target.value)} className="h-10 mt-1" /></div>
                  <Button size="sm" className="h-10 px-4" onClick={() => { applyToSelected('on_hand', parseInt(bulkStock)); setBulkStock(''); }} disabled={!bulkStock || effectiveSelectedCount === 0}>Aplicar</Button>
                </div>
                <div className="flex gap-2 items-end min-w-0">
                  <div className="flex-1 min-w-0"><label className="text-[11px] text-muted-foreground leading-none">Estoque mínimo</label><Input type="number" value={bulkMin} onChange={e => setBulkMin(e.target.value)} className="h-10 mt-1" /></div>
                  <Button size="sm" className="h-10 px-4" onClick={() => { applyToSelected('minimum_stock', parseInt(bulkMin)); setBulkMin(''); }} disabled={!bulkMin || effectiveSelectedCount === 0}>Aplicar</Button>
                </div>
                <div className="flex gap-2 items-end min-w-0">
                  <div className="flex-1 min-w-0"><label className="text-[11px] text-muted-foreground leading-none">Categoria</label>
                    <Select value={bulkCat} onValueChange={setBulkCat}>
                      <SelectTrigger className="h-10 mt-1"><SelectValue placeholder="Selecione" /></SelectTrigger>
                      <SelectContent>{cats.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" className="h-10 px-4" onClick={() => { applyToSelected('category_id', bulkCat); setBulkCat(''); }} disabled={!bulkCat || effectiveSelectedCount === 0}>Aplicar</Button>
                </div>
                <div className="flex gap-2 items-end min-w-0">
                  <div className="flex-1 min-w-0"><label className="text-[11px] text-muted-foreground leading-none">Marca</label><Input value={bulkBrand} onChange={e => setBulkBrand(e.target.value)} className="h-10 mt-1" /></div>
                  <Button size="sm" className="h-10 px-4" onClick={() => { applyToSelected('brand', bulkBrand); setBulkBrand(''); }} disabled={!bulkBrand || effectiveSelectedCount === 0}>Aplicar</Button>
                </div>
                <div className="flex gap-2 items-end min-w-0 pt-4">
                  <Button size="sm" variant="outline" className="flex-1 h-10" onClick={() => applyToSelected('is_active', true)} disabled={effectiveSelectedCount === 0}>Ativar</Button>
                  <Button size="sm" variant="outline" className="flex-1 h-10" onClick={() => applyToSelected('is_active', false)} disabled={effectiveSelectedCount === 0}>Desativar</Button>
                </div>
              </div>
            </div>

            {/* Lista de produtos (compacta, mesma seleção/filtros) */}
            <BulkSelectionList
              rows={rows}
              cats={cats}
              loading={loading}
              loadingMore={loadingMore}
              hasMore={hasMore}
              totalCount={totalCount}
              effectiveSelectedCount={effectiveSelectedCount}
              selectAllMode={selectAllMode}
              excluded={excluded}
              selected={selected}
              isRowSelected={isRowSelected}
              onToggleSelect={handleToggleSelect}
              onToggleAll={toggleSelectAll}
              onLoadMore={loadMore}
              changes={changes}
            />
          </TabsContent>

          <TabsContent value="import" className="m-0 p-4 overflow-auto data-[state=inactive]:hidden">
            <div className="max-w-2xl space-y-4">
              <div className="text-sm text-muted-foreground">
                Baixe a planilha com seus produtos, edite os campos (preço, estoque, mínimo, marca, categoria, ativo) e reenvie.
                A identificação é feita pelo <b>SKU</b>. SKUs não encontrados são ignorados.
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" onClick={downloadTemplate} className="gap-2">
                  <Download className="h-4 w-4" /> Baixar planilha atual
                </Button>
                <label className="inline-flex">
                  <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleImport} />
                  <Button asChild variant="premium" className="gap-2"><span><Upload className="h-4 w-4" /> Importar arquivo</span></Button>
                </label>
              </div>
              <div className="text-xs text-muted-foreground border rounded-md p-3 bg-muted/30">
                <b>Colunas esperadas:</b> SKU, Nome, Marca, Modelo, Categoria, Preço Venda, Estoque Atual, Estoque Mínimo, Ativo (sim/não).
              </div>
            </div>
          </TabsContent>
        </Tabs>

        {/* Footer */}
        <div className="border-t p-3 flex items-center justify-between gap-2 bg-muted/30">
          <div className="text-sm text-muted-foreground flex items-center gap-3">
            {dirtyCount > 0 ? <><b>{dirtyCount.toLocaleString('pt-BR')}</b> produto(s) com alterações pendentes</> : 'Sem alterações pendentes'}
            {lastErrors.length > 0 && (
              <Button variant="link" size="sm" className="h-auto p-0 text-destructive" onClick={() => setShowErrors(true)}>
                Ver {lastErrors.length} erro(s) da última operação
              </Button>
            )}
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Fechar</Button>
            <Button variant="premium" onClick={handleSave} disabled={saving || dirtyCount === 0} className="gap-2">
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Salvar alterações
            </Button>
          </div>
        </div>

        {/* Overlay de progresso */}
        {saving && saveProgress && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6">
            <div className="bg-card border rounded-xl shadow-xl p-6 w-full max-w-lg space-y-4">
              <div className="flex items-center gap-2">
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
                <h3 className="text-lg font-semibold">
                  {saveProgress.cancelling ? 'Cancelando após o lote atual…' : 'Aplicando alterações…'}
                </h3>
              </div>
              <Progress value={saveProgress.total > 0 ? (saveProgress.processed / saveProgress.total) * 100 : 0} />
              <div className="text-xs text-muted-foreground text-right">
                {saveProgress.total > 0 ? Math.round((saveProgress.processed / saveProgress.total) * 100) : 0}% concluído
              </div>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Total</span><b>{saveProgress.total.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Processados</span><b>{saveProgress.processed.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Restantes</span><b>{Math.max(saveProgress.total - saveProgress.processed, 0).toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Atualizados</span><b className="text-emerald-600">{saveProgress.updated.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Falhas</span><b className={saveProgress.failed ? 'text-destructive' : ''}>{saveProgress.failed.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Decorrido</span><b>{saveProgress.elapsedSec}s</b></div>
                <div className="flex justify-between col-span-2"><span className="text-muted-foreground">Tempo estimado restante</span><b>{saveProgress.etaSec > 0 ? `~${saveProgress.etaSec}s` : '—'}</b></div>
              </div>

              {/* Gráfico simples de velocidade (itens/s por lote) */}
              {saveProgress.batches.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-1 flex justify-between">
                    <span>Velocidade por lote (itens/s)</span>
                    <span>Última: <b>{saveProgress.batches[saveProgress.batches.length - 1].itemsPerSec}</b> itens/s</span>
                  </div>
                  <div className="flex items-end gap-0.5 h-16 bg-muted/30 rounded p-1">
                    {(() => {
                      const data = saveProgress.batches.slice(-30);
                      const max = Math.max(...data.map(b => b.itemsPerSec), 1);
                      return data.map((b, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-gradient-to-t from-primary to-accent rounded-sm min-w-[2px]"
                          style={{ height: `${(b.itemsPerSec / max) * 100}%` }}
                          title={`Lote ${b.batchIndex}: ${b.size} itens em ${b.ms}ms (${b.itemsPerSec} itens/s)`}
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}

              <Button
                variant="outline" size="sm" className="w-full gap-2"
                onClick={() => { cancelRef.current = true; setSaveProgress(p => p ? { ...p, cancelling: true } : p); }}
                disabled={saveProgress.cancelling}
              >
                <X className="h-4 w-4" /> {saveProgress.cancelling ? 'Aguardando lote terminar…' : 'Cancelar operação'}
              </Button>
            </div>
          </div>
        )}

        {/* Resumo de cancelamento */}
        {cancelSummary && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setCancelSummary(null)}>
            <div className="bg-card border rounded-xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
                <h3 className="text-lg font-semibold">Operação interrompida</h3>
              </div>
              <div className="text-sm space-y-1">
                <div className="flex justify-between"><span className="text-muted-foreground">Total selecionado</span><b>{cancelSummary.total.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Atualizados</span><b className="text-emerald-600">{cancelSummary.updated.toLocaleString('pt-BR')}</b></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Não processados</span><b className="text-amber-600">{cancelSummary.remaining.toLocaleString('pt-BR')}</b></div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline" size="sm" className="flex-1 gap-2"
                  disabled={cancelSummary.remainingIds.length === 0}
                  onClick={() => {
                    const csv = 'product_id\n' + cancelSummary.remainingIds.join('\n');
                    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url; a.download = `produtos-nao-processados-${new Date().toISOString().slice(0,10)}.csv`;
                    a.click(); URL.revokeObjectURL(url);
                  }}
                >
                  <FileDown className="h-4 w-4" /> Exportar IDs restantes
                </Button>
                <Button size="sm" className="flex-1" onClick={() => setCancelSummary(null)}>Fechar</Button>
              </div>
            </div>
          </div>
        )}

        {/* Diálogo de erros */}
        {showErrors && (
          <div className="absolute inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center p-6" onClick={() => setShowErrors(false)}>
            <div className="bg-card border rounded-xl shadow-xl w-full max-w-3xl max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
              <div className="p-4 border-b flex items-center justify-between gap-2 flex-wrap">
                <h3 className="text-lg font-semibold flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                  {lastErrors.length} erro(s) na última operação
                </h3>
                <div className="flex gap-2 items-center">
                  <Select value={errorFilter} onValueChange={setErrorFilter}>
                    <SelectTrigger className="w-52 h-8"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {ERROR_FILTER_GROUPS.map(g => (
                        <SelectItem key={g.value} value={g.value}>{g.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Button
                    variant="outline" size="sm" className="gap-1"
                    onClick={() => {
                      const filtered = errorFilter === 'all' ? lastErrors : lastErrors.filter(e => describeError(e.error in ERROR_LABELS ? e.error : 'unknown').group === errorFilter || (e.field && ERROR_LABELS[Object.keys(ERROR_LABELS).find(k => ERROR_LABELS[k].label === e.error) || '']?.group === errorFilter));
                      const rows = [['SKU','Produto','Campo','Valor','Erro'], ...filtered.map(e => [e.sku || '', e.name || '', e.field || '', String(e.value ?? ''), e.error])];
                      const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
                      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url; a.download = `erros-edicao-massa-${new Date().toISOString().slice(0,10)}.csv`;
                      a.click(); URL.revokeObjectURL(url);
                    }}
                  >
                    <FileDown className="h-3 w-3" /> Exportar
                  </Button>
                  <Button variant="ghost" size="icon" onClick={() => setShowErrors(false)}><X className="h-4 w-4" /></Button>
                </div>
              </div>
              <div className="overflow-auto p-4 text-sm">
                {(() => {
                  const filtered = errorFilter === 'all'
                    ? lastErrors
                    : lastErrors.filter(e => {
                        // Map label back to group
                        const code = Object.keys(ERROR_LABELS).find(k => ERROR_LABELS[k].label === e.error);
                        const group = code ? ERROR_LABELS[code].group : 'unknown';
                        return group === errorFilter;
                      });
                  if (filtered.length === 0) {
                    return <div className="text-muted-foreground text-center py-6">Nenhum erro nesta categoria.</div>;
                  }
                  return (
                    <table className="w-full text-xs">
                      <thead className="text-muted-foreground sticky top-0 bg-card">
                        <tr>
                          <th className="text-left p-1.5">Produto</th>
                          <th className="text-left p-1.5">SKU</th>
                          <th className="text-left p-1.5">Campo</th>
                          <th className="text-left p-1.5">Valor</th>
                          <th className="text-left p-1.5">Erro</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.slice(0, 500).map((e, i) => (
                          <tr key={i} className="border-t">
                            <td className="p-1.5 truncate max-w-[180px]">{e.name || <span className="text-muted-foreground font-mono">{e.product_id?.slice(0,8) || '—'}</span>}</td>
                            <td className="p-1.5 font-mono">{e.sku || '—'}</td>
                            <td className="p-1.5">{e.field || '—'}</td>
                            <td className="p-1.5 font-mono">{e.value !== undefined && e.value !== null && e.value !== '' ? String(e.value) : '—'}</td>
                            <td className="p-1.5 text-destructive">{e.error}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                })()}
                {lastErrors.length > 500 && (
                  <div className="text-xs text-muted-foreground pt-2">Exibindo primeiros 500 de {lastErrors.length}.</div>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
