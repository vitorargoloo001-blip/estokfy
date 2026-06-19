import { Fragment, useMemo, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  Loader2, Download, Upload, Sparkles, FileSpreadsheet, Trash2,
  ChevronLeft, ChevronRight, AlertTriangle, CheckCircle2, Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import * as XLSX from 'xlsx';

interface Category { id: string; name: string }
interface Supplier { id: string; name: string }
interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  storeId: string;
  userId?: string | null;
  categories: Category[];
  suppliers?: Supplier[];
  onSuccess: () => void;
}

interface Row {
  id: string;
  suffix: string;
  name: string;
  sku: string;
  cost_price: string;
  sale_price: string;
  on_hand: string;
  minimum_stock: string;
  category_id: string;
  brand: string;
  supplier_id: string;
  notes: string;
  barcode: string;
  // computed
  errors: string[];
  exists?: boolean; // SKU already in DB
}

const fmtBRL = (v: number) =>
  v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

// Expand "[01-20]" patterns and "G01,G02" or newline lists
function expandVariations(input: string): string[] {
  if (!input.trim()) return [];
  const tokens = input.split(/[\n,]+/).map((t) => t.trim()).filter(Boolean);
  const out: string[] = [];
  const rangeRe = /^(.*?)\[(\d+)-(\d+)\](.*)$/;
  for (const tok of tokens) {
    const m = tok.match(rangeRe);
    if (m) {
      const [, prefix, startS, endS, suffix] = m;
      const start = parseInt(startS, 10);
      const end = parseInt(endS, 10);
      const pad = startS.length;
      if (!isNaN(start) && !isNaN(end) && end >= start && end - start <= 500) {
        for (let i = start; i <= end; i++) {
          out.push(`${prefix}${String(i).padStart(pad, '0')}${suffix}`);
        }
        continue;
      }
    }
    out.push(tok);
  }
  return out;
}

export default function BulkProductDialog({
  open, onOpenChange, storeId, userId, categories, suppliers = [], onSuccess,
}: Props) {
  const [tab, setTab] = useState<'lote' | 'excel'>('lote');
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [saving, setSaving] = useState(false);
  const [validating, setValidating] = useState(false);

  // Step 1: base
  const [baseName, setBaseName] = useState('');
  const [skuPrefix, setSkuPrefix] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [brand, setBrand] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [onHand, setOnHand] = useState('0');
  const [minimumStock, setMinimumStock] = useState('0');
  const [variationsText, setVariationsText] = useState('');

  // Step 2: rows
  const [rows, setRows] = useState<Row[]>([]);

  // Mass apply state
  const [massField, setMassField] = useState<'cost_price' | 'sale_price' | 'on_hand' | 'minimum_stock' | 'category_id' | 'brand' | 'supplier_id'>('sale_price');
  const [massValue, setMassValue] = useState('');

  const expanded = useMemo(() => expandVariations(variationsText), [variationsText]);

  const reset = () => {
    setStep(1); setTab('lote');
    setBaseName(''); setSkuPrefix(''); setCategoryId(''); setSupplierId(''); setBrand('');
    setCostPrice(''); setSalePrice(''); setOnHand('0'); setMinimumStock('0');
    setVariationsText(''); setRows([]); setMassValue('');
  };

  // ===== Generate from variations =====
  const generateFromVariations = () => {
    if (!baseName.trim()) { toast.error('Informe o nome base'); return; }
    if (expanded.length === 0) { toast.error('Informe ao menos uma variação'); return; }
    const next: Row[] = expanded.map((suffix, i) => ({
      id: `v-${i}-${suffix}`,
      suffix,
      name: `${baseName.trim()} ${suffix}`.trim(),
      sku: skuPrefix.trim() ? `${skuPrefix.trim()}-${suffix}` : suffix,
      cost_price: costPrice,
      sale_price: salePrice,
      on_hand: onHand,
      minimum_stock: minimumStock,
      category_id: categoryId,
      brand,
      supplier_id: supplierId,
      notes: '',
      barcode: '',
      errors: [],
    }));
    setRows(next);
    setStep(2);
  };

  // ===== Excel template =====
  const downloadTemplate = () => {
    const ws = XLSX.utils.aoa_to_sheet([
      ['name', 'model', 'sku', 'barcode', 'category', 'brand', 'supplier', 'cost_price', 'sale_price', 'on_hand', 'minimum_stock', 'notes'],
      ['Tela Android G01', 'G01', 'TELA-G01', '7891234567890', categories[0]?.name || 'Telas', 'Samsung', '', 50, 120, 10, 2, ''],
      ['Tela Android G02', 'G02', 'TELA-G02', '', categories[0]?.name || 'Telas', 'Samsung', '', 50, 120, 5, 2, ''],
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Produtos');
    XLSX.writeFile(wb, 'modelo-importacao-produtos.xlsx');
  };

  const handleExcelUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf);
      const ws = wb.Sheets[wb.SheetNames[0]];
      const data: any[] = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (data.length === 0) { toast.error('Planilha vazia'); return; }

      const catByName = new Map(categories.map((c) => [c.name.toLowerCase().trim(), c.id]));
      const supByName = new Map(suppliers.map((s) => [s.name.toLowerCase().trim(), s.id]));

      const newRows: Row[] = data.map((d, i) => {
        const catKey = String(d.category || '').toLowerCase().trim();
        const supKey = String(d.supplier || '').toLowerCase().trim();
        return {
          id: `xls-${i}`,
          suffix: String(d.model || ''),
          name: String(d.name || '').trim(),
          sku: String(d.sku || '').trim(),
          cost_price: String(d.cost_price ?? 0),
          sale_price: String(d.sale_price ?? 0),
          on_hand: String(d.on_hand ?? 0),
          minimum_stock: String(d.minimum_stock ?? 0),
          category_id: catByName.get(catKey) || '',
          brand: String(d.brand || ''),
          supplier_id: supByName.get(supKey) || '',
          notes: String(d.notes || ''),
          barcode: String(d.barcode || d['código de barras'] || d['codigo de barras'] || '').trim(),
          errors: [],
        };
      });
      setRows(newRows);
      setStep(2);
      toast.success(`${newRows.length} linha(s) carregada(s) — revise antes de salvar`);
    } catch (err: any) {
      toast.error('Erro ao ler planilha: ' + (err.message || ''));
    }
  };

  // ===== Row helpers =====
  const updateRow = (id: string, field: keyof Row, value: string) => {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: value, errors: [] } : row)));
  };
  const removeRow = (id: string) => setRows((r) => r.filter((row) => row.id !== id));

  // ===== Mass apply =====
  const applyMass = () => {
    if (!massValue.trim() && massField !== 'category_id' && massField !== 'supplier_id') {
      toast.error('Informe um valor para aplicar');
      return;
    }
    setRows((r) => r.map((row) => ({ ...row, [massField]: massValue, errors: [] })));
    toast.success(`Valor aplicado em ${rows.length} linha(s)`);
  };

  // ===== Validation (line-level) =====
  const validateRows = async (): Promise<Row[]> => {
    setValidating(true);
    try {
      const skuCount = new Map<string, number>();
      rows.forEach((r) => {
        const k = r.sku.trim();
        if (k) skuCount.set(k, (skuCount.get(k) || 0) + 1);
      });

      // Check existing SKUs in DB
      const skus = Array.from(skuCount.keys()).filter(Boolean);
      let existingSet = new Set<string>();
      if (skus.length > 0) {
        const { data: existing } = await supabase
          .from('products')
          .select('sku')
          .eq('store_id', storeId)
          .in('sku', skus);
        existingSet = new Set((existing || []).map((e: any) => e.sku));
      }

      const validated: Row[] = rows.map((r) => {
        const errors: string[] = [];
        const sku = r.sku.trim();
        const name = r.name.trim();
        if (!name) errors.push('Nome obrigatório');
        if (!sku) errors.push('SKU obrigatório');
        if (sku && (skuCount.get(sku) || 0) > 1) errors.push('SKU duplicado na lista');

        const cp = parseFloat(r.cost_price);
        const sp = parseFloat(r.sale_price);
        if (r.cost_price !== '' && (isNaN(cp) || cp < 0)) errors.push('Custo inválido');
        if (r.sale_price !== '' && (isNaN(sp) || sp < 0)) errors.push('Preço inválido');

        const oh = parseInt(r.on_hand);
        const ms = parseInt(r.minimum_stock);
        if (r.on_hand !== '' && (isNaN(oh) || oh < 0)) errors.push('Estoque inválido');
        if (r.minimum_stock !== '' && (isNaN(ms) || ms < 0)) errors.push('Estoque mínimo inválido');

        const exists = !!sku && existingSet.has(sku);
        return { ...r, errors, exists };
      });

      setRows(validated);
      return validated;
    } finally {
      setValidating(false);
    }
  };

  const goSummary = async () => {
    if (rows.length === 0) { toast.error('Sem linhas para validar'); return; }
    await validateRows();
    setStep(3);
  };

  // ===== Summary metrics =====
  const summary = useMemo(() => {
    const valid = rows.filter((r) => r.errors.length === 0 && !r.exists);
    const duplicatesInList = rows.filter((r) => r.errors.includes('SKU duplicado na lista')).length;
    const existing = rows.filter((r) => r.exists && r.errors.length === 0).length; // SKU already in DB (will be skipped, not updated)
    const withErrors = rows.filter((r) => r.errors.length > 0).length;
    const totalCost = valid.reduce((acc, r) => acc + (parseFloat(r.cost_price) || 0) * (parseInt(r.on_hand) || 0), 0);
    const totalSale = valid.reduce((acc, r) => acc + (parseFloat(r.sale_price) || 0) * (parseInt(r.on_hand) || 0), 0);
    return {
      toCreate: valid.length,
      duplicatesInList,
      existingInDb: existing,
      withErrors,
      totalCost,
      totalSale,
    };
  }, [rows]);

  // ===== Save (only valid lines) =====
  const saveAll = async () => {
    const valid = rows.filter((r) => r.errors.length === 0 && !r.exists);
    if (valid.length === 0) {
      toast.error('Nenhuma linha válida para salvar');
      return;
    }
    if (!userId) {
      toast.error('Sessão expirada. Faça login novamente.');
      return;
    }
    setSaving(true);
    try {
      let created = 0;
      for (const r of valid) {
        const productId = crypto.randomUUID();
        const onHand = parseInt(r.on_hand) || 0;
        const costPrice = parseFloat(r.cost_price) || 0;
        const productPayload = {
          id: productId,
          store_id: storeId,
          sku: r.sku.trim(),
          name: r.name.trim(),
          brand: r.brand.trim() || null,
          model: r.suffix || null,
          category_id: r.category_id || null,
          cost_price: costPrice,
          sale_price: parseFloat(r.sale_price) || 0,
          on_hand: onHand,
          minimum_stock: parseInt(r.minimum_stock) || 0,
          barcode: r.barcode?.trim() || null,
        };
        const stockPayload = onHand > 0 ? {
          store_id: storeId,
          product_id: productId,
          quantity: onHand,
          movement_type: 'initial_stock',
          reason: 'Estoque inicial (cadastro em lote)',
          created_by: userId,
          previous_stock: 0,
          new_stock: onHand,
          unit_cost: costPrice,
        } : null;
        const { error } = await supabase.rpc('create_or_update_product_with_stock', {
          p_product: productPayload,
          p_stock: stockPayload,
        });
        if (error) throw error;
        created++;
      }

      toast.success(`${created} produto(s) cadastrado(s) com sucesso!`);
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      console.error('[BulkProductDialog] Falha técnica ao salvar produtos/estoque:', err);
      toast.error('Produto não foi salvo porque o estoque não pôde ser atualizado. Verifique sua permissão ou tente novamente.');
    } finally {
      setSaving(false);
    }
  };

  const StepIndicator = () => (
    <div className="flex items-center gap-2 mb-2">
      {[
        { n: 1, label: 'Dados base' },
        { n: 2, label: 'Prévia editável' },
        { n: 3, label: 'Resumo' },
      ].map((s, idx) => (
        <div key={s.n} className="flex items-center gap-2">
          <div className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-semibold ${step === s.n ? 'bg-primary text-primary-foreground' : step > s.n ? 'bg-emerald-500 text-white' : 'bg-muted text-muted-foreground'}`}>
            {step > s.n ? '✓' : s.n}
          </div>
          <span className={`text-xs ${step === s.n ? 'font-semibold' : 'text-muted-foreground'}`}>{s.label}</span>
          {idx < 2 && <ChevronRight className="h-3 w-3 text-muted-foreground" />}
        </div>
      ))}
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!saving) { onOpenChange(o); if (!o) reset(); } }}>
      <DialogContent className="max-w-6xl max-h-[94vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 text-primary" /> Cadastro em Lote
          </DialogTitle>
          <DialogDescription>
            Crie dezenas de produtos rapidamente a partir de variações, ranges numéricos ou planilha Excel.
          </DialogDescription>
        </DialogHeader>

        <StepIndicator />

        {/* ===== STEP 1 ===== */}
        {step === 1 && (
          <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="lote"><Sparkles className="h-4 w-4 mr-2" /> Variações</TabsTrigger>
              <TabsTrigger value="excel"><FileSpreadsheet className="h-4 w-4 mr-2" /> Importar Excel</TabsTrigger>
            </TabsList>

            <TabsContent value="lote" className="space-y-4 pt-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1">
                  <Label>Nome base *</Label>
                  <Input value={baseName} onChange={(e) => setBaseName(e.target.value)} placeholder="Tela Android" />
                </div>
                <div className="space-y-1">
                  <Label>Prefixo SKU</Label>
                  <Input value={skuPrefix} onChange={(e) => setSkuPrefix(e.target.value)} placeholder="TEL-AND" />
                </div>
                <div className="space-y-1">
                  <Label>Categoria</Label>
                  <Select value={categoryId} onValueChange={setCategoryId}>
                    <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                    <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label>Marca</Label>
                  <Input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="Samsung" />
                </div>
                {suppliers.length > 0 && (
                  <div className="space-y-1 md:col-span-2">
                    <Label>Fornecedor</Label>
                    <Select value={supplierId} onValueChange={setSupplierId}>
                      <SelectTrigger><SelectValue placeholder="Selecione (opcional)" /></SelectTrigger>
                      <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                )}
                <div className="space-y-1"><Label>Custo padrão (R$)</Label><Input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)} /></div>
                <div className="space-y-1"><Label>Preço padrão (R$)</Label><Input type="number" step="0.01" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} /></div>
                <div className="space-y-1"><Label>Estoque inicial</Label><Input type="number" min="0" value={onHand} onChange={(e) => setOnHand(e.target.value)} /></div>
                <div className="space-y-1"><Label>Estoque mínimo</Label><Input type="number" min="0" value={minimumStock} onChange={(e) => setMinimumStock(e.target.value)} /></div>
              </div>

              <div className="space-y-1">
                <Label>Variações / Modelos *</Label>
                <Textarea
                  rows={5}
                  value={variationsText}
                  onChange={(e) => setVariationsText(e.target.value)}
                  placeholder={`Aceita: vírgula, linha por linha ou range numérico\n\nExemplos:\nG01, G02, G03\nou\nG[01-20]\nou\nIP[11-15]`}
                />
                <p className="text-xs text-muted-foreground">
                  {expanded.length > 0
                    ? `${expanded.length} variação(ões) detectada(s) — primeiras: ${expanded.slice(0, 6).join(', ')}${expanded.length > 6 ? '…' : ''}`
                    : 'Use [01-20] para gerar sequências numéricas com zero-padding'}
                </p>
              </div>

              <Button onClick={generateFromVariations} variant="default" className="w-full">
                <Sparkles className="h-4 w-4 mr-2" /> Gerar prévia ({expanded.length})
              </Button>
            </TabsContent>

            <TabsContent value="excel" className="space-y-4 pt-4">
              <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
                <p className="text-sm">
                  Baixe o modelo, preencha e envie de volta. Categorias e fornecedores são vinculados pelo nome.
                </p>
                <p className="text-xs text-muted-foreground">
                  Colunas: <code>name, model, sku, category, brand, supplier, cost_price, sale_price, on_hand, minimum_stock, notes</code>
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button onClick={downloadTemplate} variant="outline">
                    <Download className="h-4 w-4 mr-2" /> Baixar modelo Excel
                  </Button>
                  <input type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelUpload} className="hidden" id="bulk-xls" />
                  <Button type="button" variant="default" onClick={() => document.getElementById('bulk-xls')?.click()}>
                    <Upload className="h-4 w-4 mr-2" /> Enviar planilha
                  </Button>
                </div>
              </div>
            </TabsContent>
          </Tabs>
        )}

        {/* ===== STEP 2 ===== */}
        {step === 2 && rows.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-sm">Prévia editável</h3>
                <Badge variant="secondary">{rows.length} linha(s)</Badge>
              </div>
              <Button variant="ghost" size="sm" onClick={() => setStep(1)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Voltar
              </Button>
            </div>

            {/* Mass apply */}
            <div className="rounded-lg border bg-muted/20 p-3 flex flex-col sm:flex-row gap-2 items-stretch sm:items-end">
              <div className="flex-1 min-w-0">
                <Label className="text-xs flex items-center gap-1"><Wand2 className="h-3 w-3" /> Aplicar valor em massa</Label>
                <div className="flex gap-2 mt-1">
                  <Select value={massField} onValueChange={(v) => { setMassField(v as any); setMassValue(''); }}>
                    <SelectTrigger className="w-44 h-9"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="cost_price">Custo</SelectItem>
                      <SelectItem value="sale_price">Preço de venda</SelectItem>
                      <SelectItem value="on_hand">Estoque inicial</SelectItem>
                      <SelectItem value="minimum_stock">Estoque mínimo</SelectItem>
                      <SelectItem value="category_id">Categoria</SelectItem>
                      <SelectItem value="brand">Marca</SelectItem>
                      <SelectItem value="supplier_id">Fornecedor</SelectItem>
                    </SelectContent>
                  </Select>
                  {massField === 'category_id' ? (
                    <Select value={massValue} onValueChange={setMassValue}>
                      <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Categoria" /></SelectTrigger>
                      <SelectContent>{categories.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : massField === 'supplier_id' ? (
                    <Select value={massValue} onValueChange={setMassValue}>
                      <SelectTrigger className="h-9 flex-1"><SelectValue placeholder="Fornecedor" /></SelectTrigger>
                      <SelectContent>{suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}</SelectContent>
                    </Select>
                  ) : (
                    <Input
                      className="h-9 flex-1"
                      type={['cost_price','sale_price','on_hand','minimum_stock'].includes(massField) ? 'number' : 'text'}
                      step="0.01"
                      value={massValue}
                      onChange={(e) => setMassValue(e.target.value)}
                      placeholder="Valor"
                    />
                  )}
                </div>
              </div>
              <Button variant="outline" onClick={applyMass} className="h-9">Aplicar a todos</Button>
            </div>

            <div className="border rounded-lg overflow-x-auto max-h-[50vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead className="w-40">SKU</TableHead>
                    <TableHead className="min-w-[180px]">Nome</TableHead>
                    <TableHead className="w-24">Modelo</TableHead>
                    <TableHead className="w-24">Custo</TableHead>
                    <TableHead className="w-24">Preço</TableHead>
                    <TableHead className="w-20">Estoque</TableHead>
                    <TableHead className="w-20">Mín.</TableHead>
                    <TableHead className="w-10"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r, i) => {
                    const hasErr = r.errors.length > 0;
                    const isExisting = r.exists;
                    const rowCls = hasErr
                      ? 'bg-destructive/5'
                      : isExisting
                      ? 'bg-amber-50 dark:bg-amber-950/20'
                      : '';
                    return (
                      <Fragment key={r.id}>
                        <TableRow className={rowCls}>
                          <TableCell className="text-xs text-muted-foreground">{i + 1}</TableCell>
                          <TableCell><Input value={r.sku} onChange={(e) => updateRow(r.id, 'sku', e.target.value)} className="h-8 text-xs font-mono" /></TableCell>
                          <TableCell><Input value={r.name} onChange={(e) => updateRow(r.id, 'name', e.target.value)} className="h-8 text-sm" /></TableCell>
                          <TableCell><Input value={r.suffix} onChange={(e) => updateRow(r.id, 'suffix', e.target.value)} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={r.cost_price} onChange={(e) => updateRow(r.id, 'cost_price', e.target.value)} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input type="number" step="0.01" value={r.sale_price} onChange={(e) => updateRow(r.id, 'sale_price', e.target.value)} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input type="number" min="0" value={r.on_hand} onChange={(e) => updateRow(r.id, 'on_hand', e.target.value)} className="h-8 text-xs" /></TableCell>
                          <TableCell><Input type="number" min="0" value={r.minimum_stock} onChange={(e) => updateRow(r.id, 'minimum_stock', e.target.value)} className="h-8 text-xs" /></TableCell>
                          <TableCell>
                            <Button variant="ghost" size="icon" onClick={() => removeRow(r.id)} className="h-8 w-8">
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </TableCell>
                        </TableRow>
                        {(hasErr || isExisting) && (
                          <TableRow className={rowCls}>
                            <TableCell colSpan={9} className="py-1">
                              <div className="flex flex-wrap gap-1 text-xs">
                                {hasErr && r.errors.map((er, idx) => (
                                  <span key={idx} className="inline-flex items-center gap-1 rounded-full bg-destructive/10 text-destructive px-2 py-0.5">
                                    <AlertTriangle className="h-3 w-3" /> Linha {i + 1}: {er}
                                  </span>
                                ))}
                                {isExisting && !hasErr && (
                                  <span className="inline-flex items-center gap-1 rounded-full bg-amber-200/50 text-amber-900 dark:text-amber-200 px-2 py-0.5">
                                    <AlertTriangle className="h-3 w-3" /> SKU já existe — será ignorado
                                  </span>
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            </div>

            <div className="flex gap-2">
              <Button onClick={goSummary} disabled={validating} className="flex-1">
                {validating ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Validando…</> : <>Validar e ver resumo <ChevronRight className="h-4 w-4 ml-1" /></>}
              </Button>
              <Button variant="outline" onClick={() => setRows([])}>Limpar tudo</Button>
            </div>
          </div>
        )}

        {/* ===== STEP 3 (summary) ===== */}
        {step === 3 && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-sm">Resumo antes de salvar</h3>
              <Button variant="ghost" size="sm" onClick={() => setStep(2)}>
                <ChevronLeft className="h-4 w-4 mr-1" /> Editar prévia
              </Button>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="rounded-xl border p-4 bg-emerald-50 dark:bg-emerald-950/20">
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400">
                  <CheckCircle2 className="h-4 w-4" /><span className="text-xs font-medium">Serão criados</span>
                </div>
                <p className="text-2xl font-bold mt-1">{summary.toCreate}</p>
              </div>
              <div className="rounded-xl border p-4 bg-amber-50 dark:bg-amber-950/20">
                <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400">
                  <AlertTriangle className="h-4 w-4" /><span className="text-xs font-medium">SKU já existe</span>
                </div>
                <p className="text-2xl font-bold mt-1">{summary.existingInDb}</p>
                <p className="text-xs text-muted-foreground">serão ignorados</p>
              </div>
              <div className="rounded-xl border p-4 bg-destructive/5">
                <div className="flex items-center gap-2 text-destructive">
                  <AlertTriangle className="h-4 w-4" /><span className="text-xs font-medium">Com erros</span>
                </div>
                <p className="text-2xl font-bold mt-1">{summary.withErrors}</p>
                <p className="text-xs text-muted-foreground">{summary.duplicatesInList} duplicados na lista</p>
              </div>
              <div className="rounded-xl border p-4">
                <div className="text-xs font-medium text-muted-foreground">Total de linhas</div>
                <p className="text-2xl font-bold mt-1">{rows.length}</p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div className="rounded-xl border p-4">
                <p className="text-xs text-muted-foreground">Custo total inicial</p>
                <p className="text-xl font-semibold mt-1">{fmtBRL(summary.totalCost)}</p>
              </div>
              <div className="rounded-xl border p-4">
                <p className="text-xs text-muted-foreground">Valor potencial em estoque (preço de venda)</p>
                <p className="text-xl font-semibold mt-1 text-emerald-600">{fmtBRL(summary.totalSale)}</p>
              </div>
            </div>

            {summary.withErrors > 0 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Existem {summary.withErrors} linha(s) com erros</AlertTitle>
                <AlertDescription>
                  Apenas as linhas válidas serão criadas. Volte para corrigir ou prossiga para salvar somente as válidas.
                </AlertDescription>
              </Alert>
            )}

            <div className="flex gap-2 pt-2">
              <Button onClick={saveAll} disabled={saving || summary.toCreate === 0} className="flex-1" variant="premium">
                {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Salvando {summary.toCreate} produto(s)…</> : `Confirmar e salvar ${summary.toCreate} produto(s)`}
              </Button>
              <Button variant="outline" onClick={() => setStep(2)} disabled={saving}>Voltar</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
