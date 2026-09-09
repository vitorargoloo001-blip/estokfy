import { useEffect, useRef, useState } from 'react';
import { format } from 'date-fns';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import { CalendarIcon, FileUp, Paperclip, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { parseFiscalXml } from '@/lib/nfeXml';
import {
  createFiscalDocument,
  updateFiscalDocument,
  uploadFiscalFile,
  resolveFiscalError,
  FISCAL_TYPE_LABEL,
  FISCAL_DIRECTION_LABEL,
  type FiscalDocumentRow,
  type FiscalDocumentType,
  type FiscalDirection,
} from '@/lib/fiscalApi';

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  initial?: FiscalDocumentRow | null;
  onSaved?: () => void;
}

const TYPES: FiscalDocumentType[] = ['nfe', 'nfce', 'nfse', 'entrada', 'saida', 'outro'];
const DIRECTIONS: FiscalDirection[] = ['outgoing', 'incoming'];
const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

export default function FiscalDocumentFormDialog({ open, onOpenChange, initial, onSaved }: Props) {
  const { profile } = useAuth();
  const xmlInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const [documentType, setDocumentType] = useState<FiscalDocumentType>('nfe');
  const [direction, setDirection] = useState<FiscalDirection>('outgoing');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [series, setSeries] = useState('');
  const [accessKey, setAccessKey] = useState('');
  const [issueDate, setIssueDate] = useState<Date>(new Date());
  const [competenceMonth, setCompetenceMonth] = useState<number>(new Date().getMonth() + 1);
  const [competenceYear, setCompetenceYear] = useState<number>(new Date().getFullYear());
  const [totalAmount, setTotalAmount] = useState<number>(0);
  const [customerId, setCustomerId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [saleId, setSaleId] = useState('');
  const [counterpartName, setCounterpartName] = useState('');
  const [counterpartDoc, setCounterpartDoc] = useState('');
  const [notes, setNotes] = useState('');
  const [xmlPath, setXmlPath] = useState<string | null>(null);
  const [pdfPath, setPdfPath] = useState<string | null>(null);

  const [customers, setCustomers] = useState<{ id: string; name: string }[]>([]);
  const [suppliers, setSuppliers] = useState<{ id: string; name: string }[]>([]);
  const [sales, setSales] = useState<{ id: string; sale_date: string; net_total: number }[]>([]);
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    const storeId = profile.store_id;
    supabase.from('customers').select('id, name').eq('store_id', storeId).order('name').limit(500)
      .then(({ data }) => setCustomers(data || []));
    supabase.from('suppliers').select('id, name').eq('store_id', storeId).order('name').limit(500)
      .then(({ data }) => setSuppliers(data || []));
    supabase.from('sales').select('id, sale_date, net_total').eq('store_id', storeId)
      .is('deleted_at', null).order('sale_date', { ascending: false }).limit(100)
      .then(({ data }) => setSales((data as typeof sales) || []));

    if (initial) {
      setDocumentType(initial.document_type);
      setDirection(initial.direction);
      setInvoiceNumber(initial.invoice_number);
      setSeries(initial.series || '');
      setAccessKey(initial.access_key || '');
      setIssueDate(new Date(initial.issue_date + 'T00:00:00'));
      setCompetenceMonth(initial.competence_month);
      setCompetenceYear(initial.competence_year);
      setTotalAmount(Number(initial.total_amount));
      setCustomerId(initial.customer_id || '');
      setSupplierId(initial.supplier_id || '');
      setSaleId(initial.sale_id || '');
      setCounterpartName(initial.counterpart_name || '');
      setCounterpartDoc(initial.counterpart_doc || '');
      setNotes(initial.notes || '');
      setXmlPath(initial.xml_path);
      setPdfPath(initial.pdf_path);
    } else {
      const now = new Date();
      setDocumentType('nfe'); setDirection('outgoing'); setInvoiceNumber(''); setSeries('');
      setAccessKey(''); setIssueDate(now);
      setCompetenceMonth(now.getMonth() + 1); setCompetenceYear(now.getFullYear());
      setTotalAmount(0); setCustomerId(''); setSupplierId(''); setSaleId('');
      setCounterpartName(''); setCounterpartDoc(''); setNotes('');
      setXmlPath(null); setPdfPath(null);
    }
  }, [open, profile, initial]);

  // Emissão define a competência sugerida enquanto o usuário não mexer nela.
  const handleIssueDate = (d: Date) => {
    setIssueDate(d);
    if (!initial) {
      setCompetenceMonth(d.getMonth() + 1);
      setCompetenceYear(d.getFullYear());
    }
  };

  const handleXmlFile = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    try {
      const text = await file.text();
      const parsed = parseFiscalXml(text);
      const path = await uploadFiscalFile(profile.store_id, file);
      setXmlPath(path);

      if (parsed) {
        if (parsed.documentType) setDocumentType(parsed.documentType);
        if (parsed.direction) setDirection(parsed.direction);
        if (parsed.invoiceNumber) setInvoiceNumber(parsed.invoiceNumber);
        if (parsed.series) setSeries(parsed.series);
        if (parsed.accessKey) setAccessKey(parsed.accessKey);
        if (parsed.counterpartName) setCounterpartName(parsed.counterpartName);
        if (parsed.counterpartDoc) setCounterpartDoc(parsed.counterpartDoc);
        if (typeof parsed.totalAmount === 'number') setTotalAmount(parsed.totalAmount);
        if (parsed.issueDate) {
          const d = new Date(parsed.issueDate + 'T00:00:00');
          if (!Number.isNaN(d.getTime())) handleIssueDate(d);
        }
        toast.success('XML lido — confira os dados antes de salvar.');
      } else {
        toast.info('XML anexado, mas não foi possível ler os campos. Preencha manualmente.');
      }
    } catch (e) {
      toast.error(resolveFiscalError(e));
    } finally {
      setUploading(false);
    }
  };

  const handlePdfFile = async (file: File) => {
    if (!profile) return;
    setUploading(true);
    try {
      setPdfPath(await uploadFiscalFile(profile.store_id, file));
      toast.success('Documento anexado.');
    } catch (e) {
      toast.error(resolveFiscalError(e));
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!profile) return;
    if (!invoiceNumber.trim()) { toast.error('Informe o número da nota'); return; }
    if (!Number.isFinite(totalAmount) || totalAmount < 0) { toast.error('Valor inválido'); return; }
    const key = accessKey.replace(/\D/g, '');
    if (key && key.length !== 44) { toast.error('A chave de acesso precisa ter 44 dígitos'); return; }

    setSubmitting(true);
    try {
      const input = {
        document_type: documentType,
        direction,
        invoice_number: invoiceNumber.trim(),
        issue_date: format(issueDate, 'yyyy-MM-dd'),
        competence_month: competenceMonth,
        competence_year: competenceYear,
        total_amount: totalAmount,
        series: series.trim() || null,
        access_key: key || null,
        sale_id: saleId || null,
        customer_id: customerId || null,
        supplier_id: supplierId || null,
        counterpart_name: counterpartName.trim() || null,
        counterpart_doc: counterpartDoc.trim() || null,
        xml_path: xmlPath,
        pdf_path: pdfPath,
        notes: notes.trim() || null,
      };

      if (initial) await updateFiscalDocument(initial.id, input);
      else await createFiscalDocument(profile.store_id, input);

      toast.success(initial ? 'Nota atualizada' : 'Nota lançada');
      onOpenChange(false);
      onSaved?.();
    } catch (e) {
      toast.error(resolveFiscalError(e));
    } finally {
      setSubmitting(false);
    }
  };

  const years = Array.from({ length: 6 }, (_, i) => new Date().getFullYear() - 3 + i);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{initial ? 'Editar nota fiscal' : 'Lançar nota fiscal'}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {/* Anexos primeiro: o XML preenche o resto do formulário */}
          <div className="rounded-lg border border-dashed p-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <input
                ref={xmlInputRef} type="file" accept=".xml,text/xml,application/xml" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handleXmlFile(f); e.target.value = ''; }}
              />
              <input
                ref={pdfInputRef} type="file" accept=".pdf,image/png,image/jpeg" className="hidden"
                onChange={e => { const f = e.target.files?.[0]; if (f) handlePdfFile(f); e.target.value = ''; }}
              />
              <Button type="button" variant="outline" size="sm" disabled={uploading}
                onClick={() => xmlInputRef.current?.click()}>
                <FileUp className="mr-2 h-4 w-4" /> Anexar XML
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={uploading}
                onClick={() => pdfInputRef.current?.click()}>
                <Paperclip className="mr-2 h-4 w-4" /> Anexar PDF / DANFE
              </Button>
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
              {xmlPath && (
                <span className="inline-flex items-center gap-1">
                  XML anexado
                  <button type="button" onClick={() => setXmlPath(null)} aria-label="Remover XML">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {pdfPath && (
                <span className="inline-flex items-center gap-1">
                  Documento anexado
                  <button type="button" onClick={() => setPdfPath(null)} aria-label="Remover documento">
                    <X className="h-3 w-3" />
                  </button>
                </span>
              )}
              {!xmlPath && !pdfPath && <span>Anexar o XML preenche os campos automaticamente.</span>}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Tipo</Label>
              <Select value={documentType} onValueChange={v => setDocumentType(v as FiscalDocumentType)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TYPES.map(t => <SelectItem key={t} value={t}>{FISCAL_TYPE_LABEL[t]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Operação</Label>
              <Select value={direction} onValueChange={v => setDirection(v as FiscalDirection)}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {DIRECTIONS.map(d => <SelectItem key={d} value={d}>{FISCAL_DIRECTION_LABEL[d]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Valor total</Label>
              <Input type="number" step="0.01" min="0" className="h-11"
                value={totalAmount || ''} onChange={e => setTotalAmount(parseFloat(e.target.value) || 0)} />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label>Número</Label>
              <Input className="h-11" value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Série</Label>
              <Input className="h-11" value={series} onChange={e => setSeries(e.target.value)} placeholder="Opcional" />
            </div>
            <div className="space-y-2">
              <Label>Emissão</Label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button variant="outline" className={cn('w-full h-11 justify-start text-left font-normal')}>
                    <CalendarIcon className="mr-2 h-4 w-4" />
                    {format(issueDate, 'dd/MM/yyyy')}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar mode="single" selected={issueDate} onSelect={d => d && handleIssueDate(d)}
                    initialFocus className="p-3 pointer-events-auto" />
                </PopoverContent>
              </Popover>
            </div>
          </div>

          <div className="space-y-2">
            <Label>Chave de acesso</Label>
            <Input className="h-11 font-mono text-xs" value={accessKey} placeholder="44 dígitos (opcional)"
              onChange={e => setAccessKey(e.target.value)} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Competência — mês</Label>
              <Select value={String(competenceMonth)} onValueChange={v => setCompetenceMonth(Number(v))}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={m} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Competência — ano</Label>
              <Select value={String(competenceYear)} onValueChange={v => setCompetenceYear(Number(v))}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map(y => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Cliente</Label>
              <Select value={customerId || 'none'} onValueChange={v => setCustomerId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— nenhum —</SelectItem>
                  {customers.map(c => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Fornecedor</Label>
              <Select value={supplierId || 'none'} onValueChange={v => setSupplierId(v === 'none' ? '' : v)}>
                <SelectTrigger className="h-11"><SelectValue placeholder="Opcional" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">— nenhum —</SelectItem>
                  {suppliers.map(s => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Nome do cliente/fornecedor (livre)</Label>
              <Input className="h-11" value={counterpartName} onChange={e => setCounterpartName(e.target.value)}
                placeholder="Quando não estiver cadastrado" />
            </div>
            <div className="space-y-2">
              <Label>CPF / CNPJ</Label>
              <Input className="h-11" value={counterpartDoc} onChange={e => setCounterpartDoc(e.target.value)} />
            </div>
          </div>

          <div className="space-y-2">
            <Label>Venda vinculada</Label>
            <Select value={saleId || 'none'} onValueChange={v => setSaleId(v === 'none' ? '' : v)}>
              <SelectTrigger className="h-11"><SelectValue placeholder="Opcional" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">— nenhuma —</SelectItem>
                {sales.map(s => (
                  <SelectItem key={s.id} value={s.id}>
                    {format(new Date(s.sale_date + 'T00:00:00'), 'dd/MM/yyyy')} — R$ {Number(s.net_total).toFixed(2)} — {s.id.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vincular é só documental: não altera a venda, o estoque, o caixa nem o financeiro.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Observação</Label>
            <Textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} />
          </div>

          <div className="flex gap-2 pt-2">
            <Button variant="outline" className="flex-1 h-11" onClick={() => onOpenChange(false)}>Cancelar</Button>
            <Button className="flex-1 h-11" disabled={submitting || uploading} onClick={handleSubmit}>
              {submitting ? 'Salvando...' : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
