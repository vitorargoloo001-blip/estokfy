import { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/api';
import { toast } from 'sonner';
import { useAuth } from '@/contexts/AuthContext';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuLabel, DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  DollarSign, TrendingUp, TrendingDown, AlertTriangle, RotateCcw,
  Download, Activity, RefreshCw, ShoppingCart, Package, Wallet,
  Sparkles, Clock, ArrowUpRight, ArrowDownRight, Receipt, CreditCard,
  Banknote, Smartphone, ArrowLeftRight, PackageX, CheckCircle2, Hourglass,
  ChevronDown, Lightbulb, AlertCircle, GitCompareArrows, FileText,
  Boxes, Trophy, History, FileDown, FileSearch,
} from 'lucide-react';
import EmployeeFilter from '@/components/EmployeeFilter';
import AuditPeriodDialog from '@/components/AuditPeriodDialog';
import { usePermissions } from '@/hooks/usePermissions';
import { logger } from '@/lib/logger';
import { todayStrBR, daysAgoStrBR, firstOfMonthStrBR } from '@/lib/dateBR';
import { getMovementMeta, movementBadgeClass } from '@/lib/stockMovementLabels';
// jsPDF (~166KB) é carregado apenas quando o usuário clica em "Baixar PDF"

// ============= Types =============
interface Summary {
  gross_revenue: number; net_revenue: number; discounts_total: number; shipping_total: number;
  cost_total: number; gross_profit: number; expense_total: number; income_total: number;
  purchase_total: number; sales_count: number; returns_count: number; refund_total: number;
  balance: number;
  amount_sold?: number; amount_received?: number; amount_pending?: number;
  amount_received_from_period_sales?: number;
  amount_received_from_old_sales?: number;
  amount_received_from_other?: number;
  pending_sales_count?: number; overdue_sales_count?: number; overdue_amount?: number;
  net_real_total?: number;
}
interface SalesData {
  count: number; ticket_avg: number; gross: number; net: number; discounts: number; shipping: number;
  amount_received?: number; amount_pending?: number;
  payment_methods: Record<string, { amount: number; count: number }>;
  payment_methods_realized?: Record<string, { amount: number; count: number }>;
  top_products: { sku: string; name: string; qty: number; revenue: number; methods?: string[] }[];
  by_category?: { category: string; qty: number; revenue: number }[];
  list: { id: string; time: string; customer: string; gross: number; discount: number; shipping: number; net: number; profit: number; payment_method: string | null; payment_status?: string; amount_paid?: number; amount_pending?: number; due_date?: string | null; notes?: string | null }[];
}

interface ReturnsData {
  count: number; refund_total: number; reasons: Record<string, number>;
  top_products: { sku: string; name: string; qty: number; refund: number }[];
  list: { id: string; time: string; reason: string; notes: string | null; items_count: number; refund: number }[];
}
interface StockData {
  by_type: Record<string, { count: number; qty: number; value: number }>;
  top_moved: { sku: string; name: string; in: number; out: number }[];
  low_stock: { sku: string; name: string; on_hand: number; minimum_stock: number }[];
  purchases: { id: string; time: string; product: string; sku: string; qty: number; unit_cost: number; total: number; supplier: string; payment_method: string }[];
}
interface FinanceData {
  income_total: number; expense_total: number; balance: number;
  income_by_category: Record<string, number>;
  expense_by_category: Record<string, number>;
  expense_by_payment_method?: Record<string, number>;
  entries: { id: string; time: string; type: string; category: string; amount: number; description: string | null; reference_type: string | null; payment_method?: string | null }[];
}
interface TimelineEvent {
  time: string; type: string; label: string; description: string; amount?: number;
}
interface DailyPoint { day: string; sales: number; profit: number; expense: number; pending: number; }
interface PreviousSummary {
  gross_revenue: number; net_revenue: number; gross_profit: number;
  expense_total: number; income_total: number; balance: number;
  sales_count: number; amount_sold: number; amount_received: number;
  amount_pending: number; refund_total: number;
}
interface ReportDetailed {
  period: { from: string; to: string };
  compare_period?: { from: string; to: string } | null;
  previous?: PreviousSummary | null;
  daily_series?: DailyPoint[];
  summary: Summary;
  sales: SalesData;
  returns: ReturnsData;
  stock: StockData;
  finance: FinanceData;
  timeline: TimelineEvent[];
}
interface AIStructured { summary: string; alerts: string[]; suggestions: string[]; }
interface SavedAnalysis {
  id: string;
  analysis_text: string;
  created_at: string;
  period_start: string;
  period_end: string;
  structured?: AIStructured | null;
}

// ============= Constants =============
const POLL_MS = 30_000;
const DEBOUNCE_MS = 1500;
type PeriodPreset = 'today' | 'week' | 'month' | 'custom';

const PAYMENT_METHOD_LABELS: Record<string, string> = {
  pix: 'PIX',
  card: 'Cartão',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  cash: 'Dinheiro',
  transfer: 'Transferência',
  boleto: 'Boleto',
  pending: 'A prazo',
  a_prazo: 'A prazo',
  other: 'Outro',
  outro: 'Outro',
  nao_informado: 'Não informado',
};

const PAYMENT_METHOD_ICONS: Record<string, typeof CreditCard> = {
  pix: Smartphone,
  card: CreditCard,
  credit_card: CreditCard,
  debit_card: CreditCard,
  cash: Banknote,
  transfer: ArrowLeftRight,
  pending: Hourglass,
};

// ============= Helpers =============
const fmt = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const labelPM = (m: string) => PAYMENT_METHOD_LABELS[m] || m;

const PM_BADGE_CLASSES: Record<string, string> = {
  pix: 'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  cash: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  a_prazo: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  pending: 'bg-orange-500/15 text-orange-700 dark:text-orange-300 border-orange-500/30',
  card: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  credit_card: 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border-purple-500/30',
  debit_card: 'bg-fuchsia-500/15 text-fuchsia-700 dark:text-fuchsia-300 border-fuchsia-500/30',
  transfer: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
};
const pmBadgeClass = (m: string) => PM_BADGE_CLASSES[m] || 'bg-muted text-muted-foreground border-border';

function summarizeMethods(methods?: string[]): { text: string; items: string[] } {
  if (!methods || methods.length === 0) return { text: '—', items: [] };
  if (methods.length === 1) return { text: labelPM(methods[0]), items: [methods[0]] };
  if (methods.length === 2) return { text: `${labelPM(methods[0])} + ${labelPM(methods[1])}`, items: methods };
  return { text: 'Múltiplos', items: methods };
}

function getPresetRange(preset: PeriodPreset): { from: string; to: string } {
  const todayStr = todayStrBR();
  if (preset === 'today') return { from: todayStr, to: todayStr };
  if (preset === 'week') return { from: daysAgoStrBR(6), to: todayStr };
  if (preset === 'month') return { from: firstOfMonthStrBR(), to: todayStr };
  return { from: todayStr, to: todayStr };
}

const TIMELINE_COLORS: Record<string, string> = {
  sale: 'bg-emerald-500',
  return: 'bg-amber-500',
  income: 'bg-emerald-500',
  expense: 'bg-rose-500',
  stock_purchase_in: 'bg-blue-500',
  stock_adjustment: 'bg-slate-500',
  stock_loss: 'bg-rose-500',
  stock_sale_out: 'bg-emerald-400',
  stock_return_in: 'bg-amber-400',
};

// Parse AI text into 3 sections: Resumo, Pontos de atenção, Sugestões
function parseAIText(text: string): { summary: string; alerts: string[]; suggestions: string[] } {
  const result = { summary: '', alerts: [] as string[], suggestions: [] as string[] };
  if (!text) return result;

  const lower = text.toLowerCase();
  // Heuristic split by common headings
  const alertKeywords = ['ponto', 'atenção', 'atencao', 'alerta', 'risco', 'problema'];
  const suggestKeywords = ['sugest', 'recomend', 'ação', 'acao', 'oportunidade', 'próximos passos', 'proximos passos'];

  const lines = text.split(/\n+/).map(l => l.trim()).filter(Boolean);
  let mode: 'summary' | 'alerts' | 'suggestions' = 'summary';
  const summaryParts: string[] = [];

  for (const line of lines) {
    const ll = line.toLowerCase();
    const isHeading = /^(#+|\*\*|##)/.test(line) || line.endsWith(':');
    if (isHeading) {
      if (alertKeywords.some(k => ll.includes(k))) { mode = 'alerts'; continue; }
      if (suggestKeywords.some(k => ll.includes(k))) { mode = 'suggestions'; continue; }
      mode = 'summary';
      continue;
    }
    const cleaned = line.replace(/^[-*•·\d.\s]+/, '').trim();
    if (!cleaned) continue;
    if (mode === 'alerts') result.alerts.push(cleaned);
    else if (mode === 'suggestions') result.suggestions.push(cleaned);
    else summaryParts.push(cleaned);
  }
  result.summary = summaryParts.slice(0, 3).join(' ');
  // Fallback: if nothing parsed into alerts/suggestions, use first paragraphs as summary
  if (!result.summary && lines.length > 0) result.summary = lines.slice(0, 2).join(' ');
  return result;
}

// Compute previous-period range with same length as [from, to], ending the day before `from`.
function getPreviousRange(from: string, to: string): { from: string; to: string } {
  const d0 = new Date(from + 'T00:00:00Z');
  const d1 = new Date(to + 'T00:00:00Z');
  const days = Math.max(1, Math.round((d1.getTime() - d0.getTime()) / 86_400_000) + 1);
  const prevTo = new Date(d0);
  prevTo.setUTCDate(prevTo.getUTCDate() - 1);
  const prevFrom = new Date(prevTo);
  prevFrom.setUTCDate(prevFrom.getUTCDate() - (days - 1));
  return { from: prevFrom.toISOString().slice(0, 10), to: prevTo.toISOString().slice(0, 10) };
}

// Variation% helper. Returns null when previous is 0 (avoid division by zero).
function delta(current: number, previous: number | undefined | null): { pct: number; positive: boolean } | null {
  if (previous == null || previous === 0) return null;
  const pct = ((current - previous) / Math.abs(previous)) * 100;
  return { pct, positive: pct >= 0 };
}

// Inline SVG sparkline. `series` is an array of numbers.
function Sparkline({ series, color = 'currentColor', width = 90, height = 28 }: { series?: number[] | null; color?: string; width?: number; height?: number; }) {
  const safe = Array.isArray(series)
    ? series.map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0))
    : [];
  if (safe.length < 2) {
    return <span className="text-[10px] text-muted-foreground">—</span>;
  }
  const min = Math.min(...safe);
  const max = Math.max(...safe);
  const range = max - min || 1;
  const stepX = width / (safe.length - 1);
  const points = safe.map((v, i) => {
    const x = i * stepX;
    const y = height - ((v - min) / range) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const path = `M${points.join(' L')}`;
  const area = `${path} L${width.toFixed(1)},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
      <path d={area} fill={color} fillOpacity="0.12" />
      <path d={path} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// Small inline delta badge: green when positive, red when negative.
// `invert` flips colors (used for expense/pending where decreasing is good).
function DeltaBadge({ d, invert = false }: { d: { pct: number; positive: boolean } | null; invert?: boolean }) {
  if (!d) return <span className="text-[10px] text-muted-foreground">—</span>;
  const good = invert ? !d.positive : d.positive;
  const Icon = d.positive ? ArrowUpRight : ArrowDownRight;
  return (
    <span className={`inline-flex items-center gap-0.5 text-[11px] font-semibold tabular-nums ${good ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(d.pct).toFixed(1)}%
    </span>
  );
}

// ============= Component =============
export default function Reports() {
  const { profile } = useAuth();
  const { canManageEmployees } = usePermissions();
  const storeId = profile?.store_id;
  const [data, setData] = useState<ReportDetailed | null>(null);
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [pulse, setPulse] = useState(false);
  const [preset, setPreset] = useState<PeriodPreset>('month');
  const initial = getPresetRange('month');
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const [savedAnalysis, setSavedAnalysis] = useState<SavedAnalysis | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [compareEnabled, setCompareEnabled] = useState(false);
  const [sellerId, setSellerId] = useState<string | null>(null);
  const [auditOpen, setAuditOpen] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fromRef = useRef(from); fromRef.current = from;
  const toRef = useRef(to); toRef.current = to;
  const compareRef = useRef(compareEnabled); compareRef.current = compareEnabled;
  const sellerRef = useRef(sellerId); sellerRef.current = sellerId;

  const fetchReport = useCallback(async (silent = false) => {
    if (!profile) return;
    if (!silent) setLoading(true);
    try {
      const params: Record<string, string> = { from: fromRef.current, to: toRef.current };
      if (compareRef.current) {
        const prev = getPreviousRange(fromRef.current, toRef.current);
        params.compare_from = prev.from;
        params.compare_to = prev.to;
      }
      if (sellerRef.current) params.seller = sellerRef.current;
      const result = await invokeEdgeFunction<ReportDetailed>('reports-detailed', {
        method: 'GET',
        params,
        timeout: 30_000,
      });
      setData(result);
      setLastUpdate(new Date());
      if (silent) {
        setPulse(true);
        setTimeout(() => setPulse(false), 1200);
      }
    } catch (err: any) {
      console.error('Erro ao carregar relatório:', err);
      if (!silent) toast.error(err.message || 'Erro ao carregar relatório.');
    } finally {
      if (!silent) setLoading(false);
    }
  }, [profile]);

  const loadSavedAnalysis = useCallback(async () => {
    if (!storeId) return;
    const { data: rows, error } = await supabase
      .from('report_ai_analyses')
      .select('id, analysis_text, created_at, period_start, period_end, metadata')
      .eq('store_id', storeId)
      .eq('period_start', from)
      .eq('period_end', to)
      .order('created_at', { ascending: false })
      .limit(1);
    if (error) {
      logger.error('loadSavedAnalysis', error);
      return;
    }
    const row = rows?.[0];
    if (!row) { setSavedAnalysis(null); return; }
    const meta = (row as any).metadata || {};
    setSavedAnalysis({
      id: row.id,
      analysis_text: row.analysis_text,
      created_at: row.created_at,
      period_start: row.period_start,
      period_end: row.period_end,
      structured: meta?.structured && typeof meta.structured === 'object' ? meta.structured : null,
    });
  }, [storeId, from, to]);

  useEffect(() => {
    if (preset === 'custom') return;
    const r = getPresetRange(preset);
    setFrom(r.from);
    setTo(r.to);
  }, [preset]);

  useEffect(() => { fetchReport(false); }, [profile, from, to, compareEnabled, sellerId, fetchReport]);
  useEffect(() => { loadSavedAnalysis(); }, [loadSavedAnalysis]);

  // Realtime
  useEffect(() => {
    if (!storeId || !liveMode) return;
    const trigger = () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        logger.info('[Reports] Realtime refresh');
        fetchReport(true);
      }, DEBOUNCE_MS);
    };
    const channel = supabase.channel(`reports-detailed-${storeId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales', filter: `store_id=eq.${storeId}` }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments', filter: `store_id=eq.${storeId}` }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'returns', filter: `store_id=eq.${storeId}` }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'cash_entries', filter: `store_id=eq.${storeId}` }, trigger)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_movements', filter: `store_id=eq.${storeId}` }, trigger)
      .subscribe();
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [storeId, liveMode, fetchReport]);

  useEffect(() => {
    if (!liveMode) return;
    pollRef.current = setInterval(() => {
      if (document.visibilityState === 'visible') fetchReport(true);
    }, POLL_MS);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [liveMode, fetchReport]);

  const generateAI = async () => {
    if (!data) return;
    setAiLoading(true);
    try {
      const res = await invokeEdgeFunction<{ analysis: string; structured?: AIStructured; id: string; created_at: string }>('reports-ai-analysis', {
        method: 'POST',
        body: { ...data },
        timeout: 30_000,
      });
      setSavedAnalysis({
        id: res.id || crypto.randomUUID(),
        analysis_text: res.analysis,
        created_at: res.created_at || new Date().toISOString(),
        period_start: from,
        period_end: to,
        structured: res.structured || null,
      });
      toast.success('Análise gerada e salva.');
    } catch (err: any) {
      toast.error(err.message || 'Não foi possível gerar análise com IA.');
    } finally {
      setAiLoading(false);
    }
  };

  // Helper: load jsPDF + autotable on demand and prepare a doc with executive header.
  const buildDoc = async (title: string) => {
    const [{ default: jsPDF }, autoTableMod] = await Promise.all([
      import('jspdf'),
      import('jspdf-autotable'),
    ]);
    const autoTable = (autoTableMod as any).default;
    const doc = new jsPDF({ unit: 'pt', format: 'a4' });
    const pageW = doc.internal.pageSize.getWidth();

    let storeName = 'Estokfy';
    let headerLine = '';
    if (storeId) {
      const { data: s } = await supabase.from('stores')
        .select('name, trade_name, cnpj, city, state, phone')
        .eq('id', storeId).maybeSingle();
      storeName = s?.trade_name || s?.name || 'Estokfy';
      headerLine = [
        s?.cnpj && `CNPJ: ${s.cnpj}`,
        s?.city && s?.state && `${s.city}/${s.state}`,
        s?.phone,
      ].filter(Boolean).join('  •  ');
    }

    // Faixa azul superior (header executivo)
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, pageW, 70, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(storeName, 40, 32);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9);
    doc.setTextColor(220, 230, 255);
    if (headerLine) doc.text(headerLine, 40, 50);
    doc.setFontSize(8);
    doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, pageW - 40, 32, { align: 'right' });

    // Título do relatório
    doc.setTextColor(15, 23, 42);
    doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
    doc.text(title, 40, 105);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(100, 116, 139);
    if (data) doc.text(`Período: ${data.period.from}  →  ${data.period.to}`, 40, 122);
    // Linha separadora elegante
    doc.setDrawColor(226, 232, 240);
    doc.setLineWidth(0.5);
    doc.line(40, 132, pageW - 40, 132);
    doc.setTextColor(0);

    return { doc, autoTable, pageW };
  };

  // ===== 1. Relatório Geral do Período (completo) =====
  const downloadPDF = async () => {
    if (!data) return;
    const { doc, autoTable, pageW } = await buildDoc('Relatório Geral');
    let y = 148;

    const section = (label: string) => {
      if (y > 740) { doc.addPage(); y = 60; }
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(15, 23, 42);
      doc.text(label.toUpperCase(), 40, y);
      doc.setDrawColor(37, 99, 235); doc.setLineWidth(1.5);
      doc.line(40, y + 4, 40 + doc.getTextWidth(label.toUpperCase()), y + 4);
      doc.setLineWidth(0.5);
      y += 12;
    };
    const afterTable = () => { y = (doc as any).lastAutoTable.finalY + 22; };

    doc.setTextColor(0);

    // === 1. VENDAS REALIZADAS ===
    if (data.sales.list.length) {
      section('Vendas realizadas');

      // Agrupa por dia em America/Sao_Paulo
      const tz = 'America/Sao_Paulo';
      const dayKey = (iso: string) => {
        // pt-BR returns dd/MM/yyyy → invert para yyyy-MM-dd ordenável
        const [d, m, y] = new Date(iso).toLocaleDateString('pt-BR', { timeZone: tz }).split('/');
        return `${y}-${m}-${d}`;
      };
      const dayLabel = (key: string) => {
        const [y, m, d] = key.split('-');
        return `${d}/${m}/${y}`;
      };
      const hourFmt = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', {
        timeZone: tz, hour: '2-digit', minute: '2-digit',
      });

      const groups = new Map<string, typeof data.sales.list>();
      for (const s of data.sales.list) {
        const k = dayKey(s.time);
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(s);
      }
      // dia DESC, hora ASC dentro do dia
      const orderedKeys = Array.from(groups.keys()).sort((a, b) => b.localeCompare(a));

      let printed = 0;
      const MAX = 200;
      for (const key of orderedKeys) {
        if (printed >= MAX) break;
        const dayRows = (groups.get(key) || [])
          .slice()
          .sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime());

        if (y > 720) { doc.addPage(); y = 60; }
        doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(37, 99, 235);
        doc.text(`Data: ${dayLabel(key)}`, 40, y);
        doc.setTextColor(0); y += 4;

        autoTable(doc, {
          startY: y + 2, theme: 'striped',
          head: [['Hora', 'Cliente', 'Pgto', 'Status', 'Líquido', 'Pendente', 'Obs.']],
          body: dayRows.slice(0, MAX - printed).map(s => [
            hourFmt(s.time),
            s.customer,
            s.payment_method ? labelPM(s.payment_method) : '—',
            s.payment_status === 'paid' ? 'Pago' : s.payment_status === 'partial' ? 'Parcial' : s.payment_status === 'pending' ? 'Pendente' : '—',
            fmt(s.net),
            fmt(s.amount_pending || 0),
            (s.notes || '').replace(/\s+/g, ' ').slice(0, 80),
          ]),
          headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9, overflow: 'linebreak' },
          columnStyles: {
            4: { halign: 'right' },
            5: { halign: 'right' },
            6: { cellWidth: 130, fontStyle: 'italic', textColor: [90, 90, 90] },
          },
        });
        printed += dayRows.length;
        afterTable();
      }
    }

    // === 2. RESUMO POR TIPO DE PRODUTO VENDIDO ===
    const byCat = data.sales.by_category || [];
    if (byCat.length) {
      section('Resumo por tipo de produto vendido');
      const totalCatQty = byCat.reduce((s, c) => s + (c.qty || 0), 0) || 1;
      autoTable(doc, {
        startY: y + 4, theme: 'striped',
        head: [['Tipo/Categoria', 'Quantidade', '% do total', 'Receita']],
        body: byCat.map(c => [
          c.category,
          `${c.qty} un`,
          `${((c.qty / totalCatQty) * 100).toFixed(1)}%`,
          fmt(c.revenue),
        ]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
      });
      afterTable();
    }

    // === 3. FORMAS DE PAGAMENTO DAS VENDAS DO PERÍODO (espelho da página Vendas) ===
    const pmsRealized = Object.entries(data.sales.payment_methods_realized || {});
    if (pmsRealized.length) {
      section('Formas de pagamento das vendas do período');
      autoTable(doc, {
        startY: y + 4, theme: 'striped',
        head: [['Método', 'Vendas', 'Total']],
        body: pmsRealized
          .sort((a, b) => b[1].amount - a[1].amount)
          .map(([m, v]) => [labelPM(m), String(v.count), fmt(v.amount)]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
      afterTable();
    }

    // 3B removido: "Fechamento de caixa real (recebimentos no período)" — não exibir no PDF


    // === 4. PRODUTOS MAIS VENDIDOS ===
    if (data.sales.top_products.length) {
      section('Produtos mais vendidos');
      autoTable(doc, {
        startY: y + 4, theme: 'striped',
        head: [['#', 'Produto', 'Qtd', 'Pgto', 'Receita']],
        body: data.sales.top_products.map((p, i) => [
          String(i + 1),
          p.name || 'Produto não identificado',
          String(p.qty),
          summarizeMethods(p.methods).text,
          fmt(p.revenue),
        ]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
        columnStyles: {
          0: { halign: 'center', cellWidth: 28 },
          1: { halign: 'left', cellWidth: 'auto', overflow: 'linebreak' },
          2: { halign: 'center', cellWidth: 40 },
          3: { halign: 'center', cellWidth: 75 },
          4: { halign: 'right', cellWidth: 75 },
        },
      });
      afterTable();
    }

    if (data.returns.list.length) {
      section('Trocas e devoluções');
      autoTable(doc, {
        startY: y + 4, theme: 'striped',
        head: [['Data', 'Motivo', 'Itens', 'Reembolso']],
        body: data.returns.list.map(r => [fmtTime(r.time), r.reason, String(r.items_count), fmt(r.refund)]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      });
      afterTable();
    }

    const moveTypes = Object.entries(data.stock.by_type);
    if (moveTypes.length) {
      section('Movimentações de estoque');
      autoTable(doc, {
        startY: y + 4, theme: 'grid',
        head: [['Tipo da movimentação', 'Movimentações', 'Quantidade', 'Valor movimentado']],
        body: moveTypes.map(([t, v]) => [getMovementMeta(t).label, String(v.count), String(v.qty), fmt(v.value)]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      });
      afterTable();
    }

    if (data.stock.low_stock.length) {
      section('Produtos com estoque baixo / sem estoque');
      autoTable(doc, {
        startY: y + 4, theme: 'striped',
        head: [['Produto', 'Estoque', 'Mínimo']],
        body: data.stock.low_stock.map(p => [p.name, String(p.on_hand), String(p.minimum_stock)]),
        headStyles: { fillColor: [220, 38, 38] }, styles: { fontSize: 9 },
      });
      afterTable();
    }

    const expCats = Object.entries(data.finance.expense_by_category);
    const incCats = Object.entries(data.finance.income_by_category);
    if (expCats.length || incCats.length) {
      section('Financeiro por categoria');
      autoTable(doc, {
        startY: y + 4, theme: 'grid',
        head: [['Tipo', 'Categoria', 'Valor']],
        body: [
          ...incCats.map(([c, v]) => ['Receita', c, fmt(v)]),
          ...expCats.map(([c, v]) => ['Despesa', c, fmt(v)]),
        ],
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      });
      afterTable();
    }



    doc.save(`relatorio-geral_${data.period.from}_${data.period.to}.pdf`);
  };

  // ===== 2. Relatório Financeiro =====
  const exportFinancePdf = async () => {
    if (!data) return;
    const { doc, autoTable } = await buildDoc('Relatório Financeiro');
    autoTable(doc, {
      startY: 130, theme: 'grid',
      head: [['Indicador', 'Valor']],
      body: [
        ['Receitas (caixa)', fmt(data.finance.income_total)],
        ['Despesas (caixa)', fmt(data.finance.expense_total)],
        ['Saldo', fmt(data.finance.balance)],
        ['Recebido de vendas', fmt(data.summary.amount_received ?? 0)],
        ['A receber', fmt(data.summary.amount_pending ?? 0)],
        ['Vencido', fmt(data.summary.overdue_amount ?? 0)],
      ],
      headStyles: { fillColor: [37, 99, 235] },
    });
    let y = (doc as any).lastAutoTable.finalY + 18;
    if (data.finance.entries.length) {
      doc.setFont('helvetica', 'bold'); doc.text('Lançamentos', 40, y);
      autoTable(doc, {
        startY: y + 6, theme: 'striped',
        head: [['Data', 'Tipo', 'Categoria', 'Descrição', 'Pgto', 'Valor']],
        body: data.finance.entries.map(e => [
          fmtTime(e.time), e.type === 'income' ? 'Receita' : 'Despesa',
          e.category, e.description || '—', e.payment_method ? labelPM(e.payment_method) : '—', fmt(e.amount),
        ]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      });
    }
    doc.save(`relatorio-financeiro_${data.period.from}_${data.period.to}.pdf`);
  };

  // ===== 3. Relatório de Vendas =====
  const exportSalesPdf = async () => {
    if (!data) return;
    const { doc, autoTable } = await buildDoc('Relatório de Vendas');
    autoTable(doc, {
      startY: 130, theme: 'grid',
      head: [['Indicador', 'Valor']],
      body: [
        ['Vendas', String(data.sales.count)],
        ['Ticket médio', fmt(data.sales.ticket_avg)],
        ['Bruto', fmt(data.sales.gross)],
        ['Descontos', fmt(data.sales.discounts)],
        ['Frete', fmt(data.sales.shipping)],
        ['Líquido', fmt(data.sales.net)],
        ['Recebido', fmt(data.sales.amount_received ?? 0)],
        ['Pendente', fmt(data.sales.amount_pending ?? 0)],
      ],
      headStyles: { fillColor: [37, 99, 235] },
    });
    let y = (doc as any).lastAutoTable.finalY + 18;
    if (data.sales.list.length) {
      doc.setFont('helvetica', 'bold'); doc.text('Vendas do período', 40, y);
      autoTable(doc, {
        startY: y + 6, theme: 'striped',
        head: [['Data', 'Cliente', 'Pgto', 'Status', 'Líquido', 'Lucro', 'Obs.']],
        body: data.sales.list.map(s => [
          fmtTime(s.time), s.customer, s.payment_method ? labelPM(s.payment_method) : '—',
          s.payment_status === 'paid' ? 'Pago' : s.payment_status === 'partial' ? 'Parcial' : s.payment_status === 'pending' ? 'Pendente' : '—',
          fmt(s.net), fmt(s.profit),
          (s.notes || '').replace(/\s+/g, ' ').slice(0, 80),
        ]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9, overflow: 'linebreak' },
        columnStyles: { 6: { cellWidth: 110, fontStyle: 'italic', textColor: [90, 90, 90] } },
      });
    }
    doc.save(`relatorio-vendas_${data.period.from}_${data.period.to}.pdf`);
  };

  // ===== 7. Top produtos vendidos =====
  const exportTopProductsPdf = async () => {
    if (!data) return;
    const { doc, autoTable } = await buildDoc('Produtos Mais Vendidos');
    autoTable(doc, {
      startY: 130, theme: 'striped',
      head: [['#', 'Produto', 'Qtd', 'Pgto', 'Receita']],
      body: data.sales.top_products.map((p, i) => [String(i + 1), p.name, String(p.qty), summarizeMethods(p.methods).text, fmt(p.revenue)]),
      headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      columnStyles: { 2: { halign: 'center' }, 3: { halign: 'center' }, 4: { halign: 'right' } },
    });
    doc.save(`top-produtos_${data.period.from}_${data.period.to}.pdf`);
  };

  // ===== 8. Movimentações de estoque =====
  const exportMovementsPdf = async () => {
    if (!data) return;
    const { doc, autoTable } = await buildDoc('Movimentações de Estoque');
    autoTable(doc, {
      startY: 130, theme: 'grid',
      head: [['Tipo da movimentação', 'Movimentações', 'Quantidade', 'Valor movimentado']],
      body: Object.entries(data.stock.by_type).map(([t, v]) => [getMovementMeta(t).label, String(v.count), String(v.qty), fmt(v.value)]),
      headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
    });
    let y = (doc as any).lastAutoTable.finalY + 18;
    if (data.stock.purchases.length) {
      doc.setFont('helvetica', 'bold'); doc.text('Compras de estoque', 40, y);
      autoTable(doc, {
        startY: y + 6, theme: 'striped',
        head: [['Data', 'Produto', 'Qtd', 'Custo', 'Total', 'Fornecedor']],
        body: data.stock.purchases.map(p => [
          fmtTime(p.time), p.product, String(p.qty), fmt(p.unit_cost), fmt(p.total), p.supplier || '—',
        ]),
        headStyles: { fillColor: [37, 99, 235] }, styles: { fontSize: 9 },
      });
    }
    doc.save(`movimentacoes-estoque_${data.period.from}_${data.period.to}.pdf`);
  };

  // ============= Derived data =============
  const lowStockCount = data?.stock.low_stock.length || 0;
  const outOfStockCount = data?.stock.low_stock.filter(p => p.on_hand === 0).length || 0;

  const groupedTimeline = useMemo(() => {
    if (!data) return [] as { day: string; events: TimelineEvent[] }[];
    const groups: Record<string, TimelineEvent[]> = {};
    for (const ev of data.timeline) {
      const day = ev.time.slice(0, 10);
      (groups[day] ||= []).push(ev);
    }
    return Object.entries(groups)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([day, events]) => ({ day, events }));
  }, [data]);

  // BLOCO B: Recebimentos no caixa (por paid_at)
  const paymentMethodsBar = useMemo(() => {
    if (!data) return [];
    const entries = Object.entries(data.sales.payment_methods)
      .map(([m, v]) => ({ method: m, ...v }))
      .sort((a, b) => b.amount - a.amount);
    const total = entries.reduce((s, e) => s + e.amount, 0) || 1;
    return entries.map(e => ({ ...e, pct: (e.amount / total) * 100 }));
  }, [data]);

  // BLOCO A: Formas de pagamento das vendas realizadas (por sale_date)
  const paymentMethodsRealizedBar = useMemo(() => {
    if (!data) return [];
    const src = data.sales.payment_methods_realized || {};
    const entries = Object.entries(src)
      .map(([m, v]) => ({ method: m, ...v }))
      .sort((a, b) => b.amount - a.amount);
    const total = entries.reduce((s, e) => s + e.amount, 0) || 1;
    return entries.map(e => ({ ...e, pct: (e.amount / total) * 100 }));
  }, [data]);


  const aiParsed = useMemo(() => {
    // Prefer structured JSON returned by the edge function
    if (savedAnalysis?.structured && (savedAnalysis.structured.summary || savedAnalysis.structured.alerts?.length || savedAnalysis.structured.suggestions?.length)) {
      return {
        summary: savedAnalysis.structured.summary || '',
        alerts: savedAnalysis.structured.alerts || [],
        suggestions: savedAnalysis.structured.suggestions || [],
      };
    }
    return parseAIText(savedAnalysis?.analysis_text || '');
  }, [savedAnalysis]);

  // Sparkline series (last 7 days inside the period). Robust to null/undefined/missing keys.
  const sparkSeries = useMemo(() => {
    const points = Array.isArray(data?.daily_series) ? data!.daily_series! : [];
    const last = points.slice(-7);
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
    return {
      sales: last.map((p) => num(p?.sales)),
      profit: last.map((p) => num(p?.profit)),
      expense: last.map((p) => num(p?.expense)),
      pending: last.map((p) => num(p?.pending)),
    };
  }, [data]);

  // Comparison deltas (only when previous period is loaded)
  const cmp = data?.previous;

  const lastUpdateLabel = lastUpdate
    ? lastUpdate.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : '—';

  const statusBadge = (s?: string) => {
    if (s === 'paid') return <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 hover:bg-emerald-500/15">Pago</Badge>;
    if (s === 'partial') return <Badge className="bg-blue-500/15 text-blue-700 dark:text-blue-400 border-blue-500/30 hover:bg-blue-500/15">Parcial</Badge>;
    if (s === 'pending') return <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 hover:bg-amber-500/15">Pendente</Badge>;
    return <Badge variant="outline" className="text-xs">—</Badge>;
  };

  // ============ Derived for new layout ============
  const stockBuckets = useMemo(() => {
    const buckets = { in: 0, out: 0, adj: 0, ret: 0 };
    if (!data) return buckets;
    for (const [type, v] of Object.entries(data.stock.by_type)) {
      const t = type.toLowerCase();
      const qty = Number(v.qty || 0);
      if (t.includes('return') || t === 'devolucao' || t === 'devolução') buckets.ret += qty;
      else if (t.includes('adjust') || t.includes('ajuste')) buckets.adj += qty;
      else if (t.includes('out') || t.includes('sale_out') || t.includes('saida') || t.includes('saída') || t.includes('loss') || t.includes('perda')) buckets.out += qty;
      else if (t.includes('in') || t.includes('purchase') || t.includes('entrada')) buckets.in += qty;
    }
    return buckets;
  }, [data]);

  const salesByShift = useMemo(() => {
    if (!data) return [] as { shift: string; list: typeof data.sales.list }[];
    const tz = 'America/Sao_Paulo';
    const groups: Record<string, typeof data.sales.list> = { 'Manhã': [], 'Tarde': [], 'Noite': [] };
    for (const s of data.sales.list) {
      const hourStr = new Date(s.time).toLocaleTimeString('pt-BR', { timeZone: tz, hour: '2-digit', hour12: false });
      const h = parseInt(hourStr, 10);
      const shift = h < 12 ? 'Manhã' : h < 18 ? 'Tarde' : 'Noite';
      groups[shift].push(s);
    }
    return Object.entries(groups)
      .filter(([, list]) => list.length > 0)
      .map(([shift, list]) => ({ shift, list: list.slice().sort((a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()) }));
  }, [data]);

  const uniqueCustomers = useMemo(() => {
    if (!data) return 0;
    return new Set(data.sales.list.map(s => s.customer).filter(c => c && c !== '—')).size;
  }, [data]);

  const totalUnitsSold = useMemo(() => {
    if (!data) return 0;
    return (data.sales.by_category || []).reduce((s, c) => s + (c.qty || 0), 0);
  }, [data]);

  return (
    <div className="space-y-8 w-full min-w-0">
      {/* ============= HEADER ============= */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Relatórios</h1>
              {liveMode && (
                <Badge className={`bg-accent text-accent-foreground hover:bg-accent gap-1 ${pulse ? 'animate-pulse' : ''}`}>
                  <Activity className="h-3 w-3" />Tempo real
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground mt-1">
              Última atualização: <span className="font-medium text-foreground">{lastUpdateLabel}</span>
            </p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Switch id="live-mode" checked={liveMode} onCheckedChange={setLiveMode} />
              <Label htmlFor="live-mode" className="text-xs cursor-pointer">Ao vivo</Label>
            </div>
            <Button
              variant={compareEnabled ? 'default' : 'outline'}
              size="sm"
              onClick={() => setCompareEnabled(v => !v)}
              title="Comparar com período anterior"
            >
              <GitCompareArrows className="h-4 w-4 mr-1" />
              {compareEnabled ? 'Comparando' : 'Comparar'}
            </Button>
            <Button variant="outline" size="sm" onClick={() => fetchReport(false)} disabled={loading}>
              <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />Atualizar
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-1.5" disabled={!data}>
                  <FileDown className="h-4 w-4" />
                  Relatórios
                  <ChevronDown className="h-3.5 w-3.5 opacity-70" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-64">
                <DropdownMenuLabel className="text-xs">Exportar PDF</DropdownMenuLabel>
                <DropdownMenuItem onClick={downloadPDF} disabled={!data} className="gap-2">
                  <FileText className="h-4 w-4 text-primary" />
                  <div className="flex-1">
                    <div className="text-sm font-medium">Relatório geral do período</div>
                    <div className="text-[10px] text-muted-foreground">Tudo que aconteceu no período</div>
                  </div>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={exportFinancePdf} disabled={!data} className="gap-2">
                  <Wallet className="h-4 w-4" /> Relatório financeiro
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportSalesPdf} disabled={!data} className="gap-2">
                  <ShoppingCart className="h-4 w-4" /> Relatório de vendas
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportTopProductsPdf} disabled={!data} className="gap-2">
                  <Trophy className="h-4 w-4" /> Produtos mais vendidos
                </DropdownMenuItem>
                <DropdownMenuItem onClick={exportMovementsPdf} disabled={!data} className="gap-2">
                  <History className="h-4 w-4" /> Movimentações de estoque
                </DropdownMenuItem>
                {storeId && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel className="text-xs">Alertas (loja toda)</DropdownMenuLabel>
                    <DropdownMenuItem
                      onClick={async () => { const { exportLowStockPdf } = await import('@/lib/reportPdf'); await exportLowStockPdf(storeId); }}
                      className="gap-2">
                      <Boxes className="h-4 w-4 text-amber-600" /> Estoque baixo
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => { const { exportLowMarginPdf } = await import('@/lib/reportPdf'); await exportLowMarginPdf(storeId); }}
                      className="gap-2">
                      <TrendingDown className="h-4 w-4 text-amber-600" /> Margem baixa
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={async () => { const { exportOverduePdf } = await import('@/lib/reportPdf'); await exportOverduePdf(storeId); }}
                      className="gap-2">
                      <AlertCircle className="h-4 w-4 text-rose-600" /> Contas vencidas
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <Tabs value={preset} onValueChange={(v) => setPreset(v as PeriodPreset)}>
            <TabsList>
              <TabsTrigger value="today">Hoje</TabsTrigger>
              <TabsTrigger value="week">7 dias</TabsTrigger>
              <TabsTrigger value="month">Mês</TabsTrigger>
              <TabsTrigger value="custom">Personalizado</TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="space-y-1">
            <Label className="text-xs">De</Label>
            <Input type="date" value={from} onChange={e => { setPreset('custom'); setFrom(e.target.value); }} className="min-w-[140px]" />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Até</Label>
            <Input type="date" value={to} onChange={e => { setPreset('custom'); setTo(e.target.value); }} className="min-w-[140px]" />
          </div>
          {canManageEmployees && (
            <div className="space-y-1">
              <Label className="text-xs">Vendedor</Label>
              <EmployeeFilter value={sellerId} onChange={setSellerId} className="min-w-[200px]" />
            </div>
          )}
          {storeId && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="gap-2"
              onClick={() => setAuditOpen(true)}
              title="Mostra exatamente quais pagamentos e vendas foram usados no cálculo do período"
            >
              <FileSearch className="h-4 w-4" />
              Auditar período
            </Button>
          )}
        </div>
      </div>

      {storeId && (
        <AuditPeriodDialog
          open={auditOpen}
          onOpenChange={setAuditOpen}
          storeId={storeId}
          from={from}
          to={to}
          employeeId={sellerId}
        />
      )}

      {loading && !data && <p className="text-muted-foreground">Carregando relatório...</p>}

      {data && (

        <>
          {/* ============= 1. KPIs ============= */}
          <section className="space-y-3" data-report-screen-only>
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Indicadores</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-6">
              {[
                { label: 'Vendido no período', value: fmt(data.summary.amount_sold ?? data.sales.net), sub: `${data.summary.sales_count || 0} venda(s) (sale_date)`, icon: ShoppingCart, tone: 'text-primary', bg: 'bg-primary/10' },
                { label: 'Recebido no caixa', value: fmt(data.summary.amount_received ?? 0), sub: 'por paid_at', icon: DollarSign, tone: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
                { label: 'Pendente', value: fmt(data.summary.amount_pending ?? 0), sub: `${data.summary.pending_sales_count ?? 0} venda(s) em aberto`, icon: Hourglass, tone: 'text-amber-600 dark:text-amber-400', bg: 'bg-amber-500/10' },
                { label: 'Lucro bruto', value: fmt(data.summary.gross_profit ?? 0), sub: 'sobre vendas do período', icon: TrendingUp, tone: 'text-emerald-600 dark:text-emerald-400', bg: 'bg-emerald-500/10' },
                { label: 'Devoluções', value: fmt(data.summary.refund_total ?? 0), sub: `${data.summary.returns_count ?? 0} item(ns)`, icon: RotateCcw, tone: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
                { label: 'Vencidas', value: fmt(data.summary.overdue_amount ?? 0), sub: `${data.summary.overdue_sales_count ?? 0} em atraso`, icon: AlertTriangle, tone: 'text-rose-600 dark:text-rose-400', bg: 'bg-rose-500/10' },
              ].map(k => {
                const Icon = k.icon;
                return (
                  <Card key={k.label} className="hover:border-primary/40 transition-colors">
                    <CardContent className="p-4">
                      <div className="flex items-center gap-2 mb-2">
                        <div className={`h-8 w-8 rounded-lg ${k.bg} flex items-center justify-center`}>
                          <Icon className={`h-4 w-4 ${k.tone}`} />
                        </div>
                        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{k.label}</span>
                      </div>
                      <div className="text-lg md:text-xl font-bold tabular-nums truncate">{k.value}</div>
                      <div className="text-[11px] text-muted-foreground truncate">{k.sub}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Breakdown do Recebido — origem do dinheiro que entrou */}
            {(() => {
              const vendido = Number(data.summary.amount_sold ?? 0);
              const recebido = Number(data.summary.amount_received ?? 0);
              const recPeriodo = Number(data.summary.amount_received_from_period_sales ?? 0);
              const recAntigas = Number(data.summary.amount_received_from_old_sales ?? 0);
              const recOutros = Number(data.summary.amount_received_from_other ?? 0);
              const aviso = recebido > vendido + 0.01;
              return (
                <Card className="border-emerald-500/20" data-report-screen-only>
                  <CardContent className="p-4 md:p-5">
                    <div className="flex flex-wrap items-center gap-2 mb-3">
                      <DollarSign className="h-4 w-4 text-emerald-600" />
                      <h3 className="text-sm font-semibold">Origem dos recebimentos no período</h3>
                      <span className="text-[11px] text-muted-foreground">total {fmt(recebido)}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Vendas do período</div>
                        <div className="text-lg font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{fmt(recPeriodo)}</div>
                        <div className="text-[10px] text-muted-foreground">vendas com sale_date dentro do filtro</div>
                      </div>
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Contas antigas quitadas</div>
                        <div className="text-lg font-bold tabular-nums text-amber-700 dark:text-amber-400">{fmt(recAntigas)}</div>
                        <div className="text-[10px] text-muted-foreground">quitação de vendas anteriores</div>
                      </div>
                      <div className="rounded-lg border border-border bg-card/50 p-3">
                        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Outros recebimentos</div>
                        <div className="text-lg font-bold tabular-nums">{fmt(recOutros)}</div>
                        <div className="text-[10px] text-muted-foreground">sem venda vinculada</div>
                      </div>
                    </div>
                    {aviso && (
                      <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                        <span>
                          Este valor inclui recebimentos de vendas feitas em outros dias. Recebido ({fmt(recebido)}) é maior que Vendido no período ({fmt(vendido)}) porque há contas antigas quitadas dentro deste filtro.
                        </span>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })()}
          </section>


          {/* ============= 2. CAIXA LÍQUIDO REAL (apenas tela — não vai para o PDF) ============= */}
          {(() => {
            const recebido = Number(data.summary.amount_received ?? 0);
            const despesas = Number(data.summary.expense_total ?? 0);
            const devolucoes = Number(data.summary.refund_total ?? 0);
            const compras = Number(data.summary.purchase_total ?? 0);
            const liquido = Number(data.summary.net_real_total ?? (recebido - despesas - devolucoes - compras));
            const positive = liquido >= 0;
            return (
              <section className="space-y-3" data-report-screen-only>
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Caixa líquido real</h2>
                <Card className="overflow-hidden border-primary/20">
                  <CardContent className="p-5 md:p-6">
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                      <div>
                        <div className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">Saldo real do período</div>
                        <div className={`text-3xl md:text-4xl font-bold tabular-nums ${positive ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                          {fmt(liquido)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm flex-1 md:max-w-2xl">
                        <div className="rounded-lg border border-border bg-card/50 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Recebido</div>
                          <div className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{fmt(recebido)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card/50 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Despesas</div>
                          <div className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">− {fmt(despesas)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card/50 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Devoluções</div>
                          <div className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">− {fmt(devolucoes)}</div>
                        </div>
                        <div className="rounded-lg border border-border bg-card/50 p-3">
                          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Compras</div>
                          <div className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">− {fmt(compras)}</div>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>
            );
          })()}

          {/* ============= 3. VENDAS REALIZADAS (por turno) ============= */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Vendas realizadas</h2>
            <Card>
              <CardContent className="p-5 md:p-6">
                {data.sales.list.length === 0 ? (
                  <p className="text-sm text-muted-foreground py-4">Nenhuma venda registrada no período.</p>
                ) : (
                  <div className="space-y-5">
                    {salesByShift.map(({ shift, list }) => (
                      <div key={shift}>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-bold uppercase tracking-widest text-primary">{shift}</span>
                          <span className="text-[11px] text-muted-foreground">· {list.length} venda{list.length !== 1 ? 's' : ''}</span>
                          <div className="flex-1 h-px bg-border" />
                        </div>
                        <div className="md:hidden space-y-2">
                          {list.slice(0, 30).map(s => (
                            <div key={s.id} className="rounded-lg border border-border bg-card p-3 space-y-2">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <div className="text-sm font-medium truncate">{s.customer}</div>
                                  <div className="text-xs text-muted-foreground tabular-nums">{fmtTime(s.time)}</div>
                                </div>
                                <div className="text-sm font-bold tabular-nums shrink-0">{fmt(s.net)}</div>
                              </div>
                              <div className="flex items-center justify-between gap-2">
                                {s.payment_method ? <span className="text-xs text-muted-foreground">{labelPM(s.payment_method)}</span> : <span />}
                                {statusBadge(s.payment_status)}
                              </div>
                              {s.notes && (
                                <p className="text-xs italic text-muted-foreground border-l-2 border-amber-400/60 pl-2 break-words">{s.notes}</p>
                              )}
                            </div>
                          ))}
                        </div>
                        <div className="hidden md:block overflow-x-auto">
                          <Table>
                            <TableHeader>
                              <TableRow className="border-b border-border hover:bg-transparent">
                                <TableHead className="h-9 w-20 text-[11px] uppercase tracking-wider">Hora</TableHead>
                                <TableHead className="h-9 text-[11px] uppercase tracking-wider">Cliente</TableHead>
                                <TableHead className="h-9 text-[11px] uppercase tracking-wider">Pagamento</TableHead>
                                <TableHead className="h-9 text-[11px] uppercase tracking-wider">Status</TableHead>
                                <TableHead className="h-9 text-[11px] uppercase tracking-wider text-right">Valor</TableHead>
                                <TableHead className="h-9 text-[11px] uppercase tracking-wider">Obs.</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {list.slice(0, 30).map(s => (
                                <TableRow key={s.id} className="border-b-0 odd:bg-muted/20 hover:bg-muted/40">
                                  <TableCell className="text-xs tabular-nums text-muted-foreground py-3">
                                    {new Date(s.time).toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit' })}
                                  </TableCell>
                                  <TableCell className="text-sm py-3 max-w-[220px] truncate" title={s.customer}>{s.customer}</TableCell>
                                  <TableCell className="py-3">
                                    {s.payment_method ? <span className="text-xs text-muted-foreground">{labelPM(s.payment_method)}</span> : <span className="text-xs text-muted-foreground">—</span>}
                                  </TableCell>
                                  <TableCell className="py-3">{statusBadge(s.payment_status)}</TableCell>
                                  <TableCell className="text-right text-sm font-semibold tabular-nums py-3">{fmt(s.net)}</TableCell>
                                  <TableCell className="py-3 max-w-[260px]">
                                    {s.notes ? (
                                      <span className="text-xs italic text-muted-foreground line-clamp-2 break-words" title={s.notes}>{s.notes}</span>
                                    ) : (
                                      <span className="text-xs text-muted-foreground/60">—</span>
                                    )}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ============= 4. RESUMO POR TIPO DE PRODUTO VENDIDO ============= */}
          {(data.sales.by_category || []).length > 0 && (() => {
            const cats = data.sales.by_category || [];
            const totalQty = cats.reduce((s, c) => s + (c.qty || 0), 0) || 1;
            const maxQty = Math.max(...cats.map(c => c.qty || 0), 1);
            return (
              <section className="space-y-3">
                <div className="flex items-center justify-between px-1">
                  <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Resumo por tipo de produto vendido</h2>
                  <span className="text-[11px] text-muted-foreground">{totalUnitsSold} unidade(s) no total</span>
                </div>
                <Card>
                  <CardContent className="p-5 md:p-6">
                    <div className="space-y-3">
                      {cats.slice(0, 10).map(c => {
                        const pct = (c.qty / totalQty) * 100;
                        const barPct = (c.qty / maxQty) * 100;
                        return (
                          <div key={c.category} className="space-y-1.5">
                            <div className="flex items-center justify-between gap-3 text-sm">
                              <span className="font-medium capitalize truncate">{c.category}</span>
                              <div className="flex items-center gap-3 shrink-0 tabular-nums">
                                <span className="text-muted-foreground text-xs">{pct.toFixed(1)}%</span>
                                <span className="font-semibold">{c.qty} un</span>
                                <span className="text-xs text-muted-foreground hidden sm:inline">{fmt(c.revenue)}</span>
                              </div>
                            </div>
                            <div className="h-2 rounded-full bg-muted overflow-hidden">
                              <div className="h-full bg-gradient-to-r from-primary to-accent rounded-full" style={{ width: `${Math.max(barPct, 2)}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              </section>
            );
          })()}

          {/* ============= 5A. FORMAS DE PAGAMENTO — VENDAS REALIZADAS (sale_date) ============= */}
          {paymentMethodsRealizedBar.length > 0 && (
            <section className="space-y-3">
              <div className="px-1">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Formas de pagamento das vendas do período</h2>
                <p className="text-[11px] text-muted-foreground mt-0.5">Base: mesmas vendas exibidas na página Vendas. Parte pendente entra como “A prazo”.</p>
              </div>
              <div className="grid gap-3 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
                {paymentMethodsRealizedBar.map(p => {
                  const Icon = PAYMENT_METHOD_ICONS[p.method] || CreditCard;
                  const isPending = p.method === 'pending' || p.method === 'a_prazo' || p.method === 'prazo';
                  return (
                    <Card key={`a-${p.method}`} className="hover:border-primary/40 transition-colors">
                      <CardContent className="p-4">
                        <div className="flex items-center gap-2 mb-2">
                          <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                            <Icon className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-sm font-semibold truncate">{labelPM(p.method)}</div>
                            <div className="text-[11px] text-muted-foreground">{p.count} venda{p.count !== 1 ? 's' : ''}</div>
                          </div>
                        </div>
                        <div className={`text-lg font-bold tabular-nums ${isPending ? 'text-amber-600 dark:text-amber-400' : ''}`}>{fmt(p.amount)}</div>
                        <div className="mt-2 h-1.5 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-primary to-accent" style={{ width: `${Math.max(p.pct, 2)}%` }} />
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-1 tabular-nums">
                          {p.pct.toFixed(1)}% das vendas{isPending ? ' · pendente' : ''}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            </section>
          )}

          {/* 5B removido: "Fechamento de caixa real" — informação duplicada em outras áreas */}




          {/* ============= 6. PRODUTOS MAIS VENDIDOS ============= */}
          {data.sales.top_products.length > 0 && (
            <section className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Produtos mais vendidos</h2>
                <span className="text-[11px] text-muted-foreground">Top {Math.min(data.sales.top_products.length, 10)}</span>
              </div>
              <Card>
                <CardContent className="p-0 overflow-hidden">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow className="border-b border-border hover:bg-transparent bg-muted/30">
                          <TableHead className="w-12 h-9 text-[11px] uppercase tracking-wider">#</TableHead>
                          <TableHead className="h-9 text-[11px] uppercase tracking-wider">Produto</TableHead>
                          
                          <TableHead className="h-9 text-[11px] uppercase tracking-wider text-right">Qtd</TableHead>
                          <TableHead className="h-9 text-[11px] uppercase tracking-wider text-center hidden md:table-cell">Pgto</TableHead>
                          <TableHead className="h-9 text-[11px] uppercase tracking-wider text-right">Receita</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {data.sales.top_products.slice(0, 10).map((p, i) => (
                          <TableRow key={`${p.name}-${i}`} className="border-b-0 odd:bg-muted/20 hover:bg-muted/40">
                            <TableCell className="py-2.5">
                              {i < 3 ? (
                                <span className={`inline-flex items-center justify-center h-6 w-6 rounded-full text-[11px] font-bold ${
                                  i === 0 ? 'bg-amber-500/20 text-amber-700 dark:text-amber-400' :
                                  i === 1 ? 'bg-slate-400/20 text-slate-700 dark:text-slate-300' :
                                  'bg-orange-700/20 text-orange-700 dark:text-orange-400'
                                }`}>{i + 1}</span>
                              ) : (
                                <span className="text-xs text-muted-foreground tabular-nums pl-1">#{i + 1}</span>
                              )}
                            </TableCell>
                            <TableCell className="text-sm font-medium py-2.5 max-w-[280px] truncate" title={p.name}>{p.name || 'Produto não identificado'}</TableCell>
                            <TableCell className="text-sm font-semibold tabular-nums text-right py-2.5">{p.qty} un</TableCell>
                            <TableCell className="py-2.5 hidden md:table-cell text-center">
                              {(() => {
                                const s = summarizeMethods(p.methods);
                                if (s.items.length === 0) return <span className="text-xs text-muted-foreground">—</span>;
                                if (s.items.length <= 2) {
                                  return (
                                    <div className="flex flex-wrap gap-1 justify-center">
                                      {s.items.map(m => (
                                        <span key={m} className={`inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-medium ${pmBadgeClass(m)}`}>
                                          {labelPM(m)}
                                        </span>
                                      ))}
                                    </div>
                                  );
                                }
                                return (
                                  <span title={s.items.map(labelPM).join(', ')} className="inline-flex items-center px-1.5 py-0.5 rounded-full border text-[10px] font-medium bg-muted text-muted-foreground border-border">
                                    Múltiplos
                                  </span>
                                );
                              })()}
                            </TableCell>
                            <TableCell className="text-sm font-semibold tabular-nums text-right py-2.5">{fmt(p.revenue)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ============= 7. RESUMO OPERACIONAL ============= */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Resumo operacional</h2>
            <Card>
              <CardContent className="p-5 md:p-6">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-4">
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Produtos vendidos</span>
                    <span className="text-sm font-semibold tabular-nums">{totalUnitsSold} un</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Entradas estoque</span>
                    <span className="text-sm font-semibold tabular-nums">{stockBuckets.in}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Trocas/devoluções</span>
                    <span className="text-sm font-semibold tabular-nums">{data.summary.returns_count}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Clientes atendidos</span>
                    <span className="text-sm font-semibold tabular-nums">{uniqueCustomers}</span>
                  </div>
                  <div className="flex items-center justify-between border-b border-border/50 pb-2">
                    <span className="text-sm text-muted-foreground">Ticket médio</span>
                    <span className="text-sm font-semibold tabular-nums">{fmt(data.sales.ticket_avg)}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ============= 7. TROCAS / DEVOLUÇÕES ============= */}
          {data.returns.list.length > 0 && (
            <section className="space-y-3">
              <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Trocas e devoluções</h2>
              <Card className="border-amber-500/30 bg-amber-500/5">
                <CardContent className="p-5 md:p-6 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-amber-800 dark:text-amber-300">
                        {data.returns.count} devolução{data.returns.count !== 1 ? 'ões' : ''} registrada{data.returns.count !== 1 ? 's' : ''}
                      </div>
                      <div className="text-xs text-muted-foreground">Impacto total: <span className="font-semibold text-rose-600 dark:text-rose-400">− {fmt(data.returns.refund_total)}</span></div>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {data.returns.list.slice(0, 5).map(r => (
                      <div key={r.id} className="flex items-center justify-between text-sm py-2 px-3 rounded-md bg-background/60 border border-border/50">
                        <div className="min-w-0 flex-1">
                          <div className="font-medium truncate">{r.reason || 'Sem motivo'}</div>
                          <div className="text-xs text-muted-foreground tabular-nums">{fmtTime(r.time)} · {r.items_count} item(ns)</div>
                        </div>
                        <div className="text-sm font-semibold tabular-nums text-rose-600 dark:text-rose-400 shrink-0 ml-3">− {fmt(r.refund)}</div>
                      </div>
                    ))}
                    {data.returns.list.length > 5 && (
                      <div className="text-xs text-muted-foreground text-center pt-1">+ {data.returns.list.length - 5} outra(s)</div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </section>
          )}

          {/* ============= 8. ESTOQUE ============= */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Estoque</h2>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
              {[
                { label: 'Entradas', value: stockBuckets.in, color: 'text-emerald-600 dark:text-emerald-400', icon: ArrowDownRight },
                { label: 'Saídas', value: stockBuckets.out, color: 'text-blue-600 dark:text-blue-400', icon: ArrowUpRight },
                { label: 'Ajustes', value: stockBuckets.adj, color: 'text-slate-600 dark:text-slate-400', icon: History },
                { label: 'Devoluções', value: stockBuckets.ret, color: 'text-amber-600 dark:text-amber-400', icon: RotateCcw },
              ].map(b => {
                const Icon = b.icon;
                return (
                  <Card key={b.label}>
                    <CardContent className="p-4">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground uppercase tracking-wide">{b.label}</span>
                        <Icon className={`h-4 w-4 ${b.color}`} />
                      </div>
                      <div className={`text-2xl font-bold tabular-nums ${b.color}`}>{b.value}</div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {Object.keys(data.stock.by_type).length > 0 && (
              <Card>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <History className="h-4 w-4 text-muted-foreground" />
                    Movimentações de estoque
                  </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="overflow-x-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Tipo da movimentação</TableHead>
                          <TableHead className="text-right">Movimentações</TableHead>
                          <TableHead className="text-right">Quantidade</TableHead>
                          <TableHead className="text-right">Valor movimentado</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.entries(data.stock.by_type)
                          .sort((a, b) => b[1].qty - a[1].qty)
                          .map(([rawType, v]) => {
                            const meta = getMovementMeta(rawType);
                            return (
                              <TableRow key={rawType}>
                                <TableCell>
                                  <Badge variant="outline" className={`${movementBadgeClass(meta.category)} font-medium`}>
                                    {meta.label}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-right tabular-nums">{v.count}</TableCell>
                                <TableCell className="text-right tabular-nums font-semibold">{v.qty}</TableCell>
                                <TableCell className="text-right tabular-nums">{fmt(v.value)}</TableCell>
                              </TableRow>
                            );
                          })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            )}
            {lowStockCount > 0 && (
              <Card className="border-rose-500/30 bg-rose-500/5">
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-center gap-3">
                    <div className="h-9 w-9 rounded-full bg-rose-500/15 flex items-center justify-center shrink-0">
                      <AlertTriangle className="h-4 w-4 text-rose-600 dark:text-rose-400" />
                    </div>
                    <div>
                      <div className="font-semibold text-rose-700 dark:text-rose-300">{lowStockCount} produto(s) crítico(s)</div>
                      <div className="text-xs text-muted-foreground">{outOfStockCount > 0 && <>{outOfStockCount} sem estoque · </>}Reponha o quanto antes.</div>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    {data.stock.low_stock.slice(0, 5).map(p => {
                      const isOut = p.on_hand === 0;
                      return (
                        <div key={p.name + '-' + p.on_hand} className="flex items-center justify-between text-sm py-1.5 px-2 rounded bg-background/60">
                          <div className="flex items-center gap-2 min-w-0">
                            {isOut ? <PackageX className="h-4 w-4 text-rose-500 shrink-0" /> : <AlertTriangle className="h-4 w-4 text-amber-500 shrink-0" />}
                            <span className="truncate">{p.name}</span>
                          </div>
                          <span className={`font-semibold tabular-nums shrink-0 ml-2 ${isOut ? 'text-rose-600' : 'text-amber-600'}`}>{p.on_hand}/{p.minimum_stock}</span>
                        </div>
                      );
                    })}
                    {lowStockCount > 5 && <div className="text-xs text-muted-foreground text-center pt-1">+ {lowStockCount - 5} outro(s)</div>}
                  </div>
                </CardContent>
              </Card>
            )}
          </section>

          {/* ============= 9. FINANCEIRO ============= */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Financeiro</h2>
            <Card>
              <CardContent className="p-5 md:p-6">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Receitas</div>
                    <div className="text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400 mt-1">{fmt(data.finance.income_total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Despesas</div>
                    <div className="text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-1">{fmt(data.finance.expense_total)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Estornos</div>
                    <div className="text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400 mt-1">{fmt(data.summary.refund_total)}</div>
                  </div>
                  <div className="md:border-l md:pl-4">
                    <div className="text-xs text-muted-foreground uppercase tracking-wide">Saldo</div>
                    <div className={`text-xl font-bold tabular-nums mt-1 ${data.finance.balance >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
                      {fmt(data.finance.balance)}
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </section>

          {/* ============= 10. LINHA DO TEMPO (colapsável) ============= */}
          <section className="space-y-3">
            <Collapsible open={timelineOpen} onOpenChange={setTimelineOpen}>
              <Card>
                <CollapsibleTrigger asChild>
                  <button className="w-full flex items-center justify-between p-5 hover:bg-muted/30 rounded-2xl transition-colors text-left">
                    <div className="flex items-center gap-3">
                      <Clock className="h-5 w-5 text-primary" />
                      <div>
                        <div className="font-semibold">Linha do tempo</div>
                        <div className="text-xs text-muted-foreground">{data.timeline.length} evento(s)</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <span>{timelineOpen ? 'Ocultar' : 'Ver detalhes'}</span>
                      <ChevronDown className={`h-4 w-4 transition-transform ${timelineOpen ? 'rotate-180' : ''}`} />
                    </div>
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent>
                  <div className="px-5 pb-5">
                    {data.timeline.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">Nenhuma movimentação no período.</p>
                    ) : (
                      <div className="space-y-5 max-h-[500px] overflow-y-auto pr-2">
                        {groupedTimeline.map(g => (
                          <div key={g.day}>
                            <div className="text-xs font-semibold text-muted-foreground uppercase mb-2 sticky top-0 bg-background py-1">
                              {new Date(g.day + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long' })}
                            </div>
                            <div className="space-y-2">
                              {g.events.map((ev, i) => (
                                <div key={i} className="flex items-start gap-3 text-sm border-l-2 border-border pl-3 pb-1 hover:bg-muted/30 rounded-r transition-colors">
                                  <div className={`w-2 h-2 rounded-full ${TIMELINE_COLORS[ev.type] || 'bg-slate-400'} mt-1.5 -ml-[17px] ring-2 ring-background shrink-0`} />
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center justify-between gap-2 flex-wrap">
                                      <span className="font-medium">{ev.label}</span>
                                      <span className="text-xs text-muted-foreground tabular-nums">
                                        {new Date(ev.time).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                      </span>
                                    </div>
                                    <div className="text-xs text-muted-foreground truncate">{ev.description}</div>
                                  </div>
                                  {ev.amount !== undefined && (
                                    <span className={`text-sm font-semibold tabular-nums ${
                                      ev.type === 'sale' || ev.type === 'income' ? 'text-emerald-600' :
                                      ev.type === 'return' || ev.type === 'expense' || ev.type === 'stock_loss' ? 'text-rose-600' :
                                      'text-foreground'
                                    }`}>
                                      {fmt(ev.amount)}
                                    </span>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Card>
            </Collapsible>
          </section>

          {/* ============= 11. ANÁLISE IA ============= */}
          <section className="space-y-3">
            <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-1">Análise inteligente</h2>
            <Card className="border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
              <CardContent className="p-5 md:p-6 space-y-4">
                {!savedAnalysis && (
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                        <Sparkles className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <div className="font-semibold">Gerar análise com IA</div>
                        <p className="text-sm text-muted-foreground">Resumo, alertas e sugestões em segundos.</p>
                      </div>
                    </div>
                    <Button onClick={generateAI} disabled={aiLoading} variant="premium">
                      <Sparkles className={`h-4 w-4 mr-2 ${aiLoading ? 'animate-pulse' : ''}`} />
                      {aiLoading ? 'Analisando...' : 'Gerar análise'}
                    </Button>
                  </div>
                )}

                {savedAnalysis && (
                  <>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Sparkles className="h-4 w-4 text-primary" />
                        Gerada em <span className="font-medium text-foreground">{fmtDateTime(savedAnalysis.created_at)}</span>
                      </div>
                      <Button onClick={generateAI} disabled={aiLoading} variant="ghost" size="sm">
                        <RefreshCw className={`h-3 w-3 mr-1 ${aiLoading ? 'animate-spin' : ''}`} />
                        Gerar nova
                      </Button>
                    </div>

                    {aiParsed.summary && (
                      <div className="rounded-lg bg-background/60 border border-border p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-muted-foreground uppercase mb-2">
                          <Receipt className="h-3.5 w-3.5" /> Resumo executivo
                        </div>
                        <p className="text-sm leading-relaxed">{aiParsed.summary}</p>
                      </div>
                    )}

                    {aiParsed.alerts.length > 0 && (
                      <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-amber-700 dark:text-amber-400 uppercase mb-2">
                          <AlertCircle className="h-3.5 w-3.5" /> Pontos de atenção
                        </div>
                        <ul className="space-y-1.5">
                          {aiParsed.alerts.map((a, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <span className="text-amber-500 mt-0.5">•</span>
                              <span>{a}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {aiParsed.suggestions.length > 0 && (
                      <div className="rounded-lg bg-emerald-500/5 border border-emerald-500/20 p-4">
                        <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700 dark:text-emerald-400 uppercase mb-2">
                          <Lightbulb className="h-3.5 w-3.5" /> Sugestões
                        </div>
                        <ul className="space-y-1.5">
                          {aiParsed.suggestions.map((s, i) => (
                            <li key={i} className="text-sm flex items-start gap-2">
                              <span className="text-emerald-500 mt-0.5">→</span>
                              <span>{s}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!aiParsed.summary && aiParsed.alerts.length === 0 && aiParsed.suggestions.length === 0 && (
                      <div className="prose prose-sm max-w-none whitespace-pre-wrap text-sm leading-relaxed">
                        {savedAnalysis.analysis_text}
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </section>

          {/* ============= 12. RODAPÉ ============= */}
          <div className="text-center text-[11px] text-muted-foreground py-4 border-t border-border/50">
            Estokfy · Relatório gerado em {new Date().toLocaleString('pt-BR')}
          </div>
        </>
      )}
    </div>
  );
}
