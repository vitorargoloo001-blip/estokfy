import { useEffect, useState, useCallback, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, BarChart, Bar, Legend,
} from "recharts";
import {
  Brain, RefreshCw, TrendingUp, TrendingDown, AlertCircle,
  CheckCircle2, Banknote, Users, CreditCard, Zap, Clock,
  HelpCircle, History, ChevronRight, ArrowUpRight, ArrowDownRight,
  Minus, MessageCircle, Loader2, Activity,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────

interface FinancialSummary {
  week_received: number; week_sales_count: number; week_new_customers: number;
  month_received: number; month_sales_count: number; month_divergences: number;
  month_delinquency_rate: number; month_reconciliation_rate: number;
  prev_month_received: number; prev_month_sales_count: number;
  received_growth_pct: number | null; sales_growth_pct: number | null;
  forecast_30d: number; at_risk_30d: number;
}
interface PaymentBehaviorItem {
  method: string; current_count: number; current_amount: number; current_pct: number;
  prev_count: number; prev_amount: number; prev_pct: number;
  change_pct: number | null; trend: string;
}
interface DebtAnalysis {
  total_pending_sales: number; total_pending_amount: number;
  overdue_count: number; overdue_amount: number;
  overdue_30d_count: number; overdue_30d_amount: number;
  overdue_60d_count: number; overdue_60d_amount: number;
  overdue_90d_plus_count: number; overdue_90d_plus_amount: number;
  delinquency_rate: number;
}
interface HealthAnalysis {
  total_bank_txs: number; reconciled_count: number; divergent_count: number;
  pending_match_count: number; reconciliation_rate: number;
  auto_reconciled_count: number; manual_reconciled_count: number; auto_rate: number;
  banks_connected: number; banks_synced_24h: number;
  last_sync_at: string | null; avg_sync_gap_hours: number;
  open_divergences_7d_plus: number; health_score: number;
}
interface CustomerRankingItem {
  customer_id: string; customer_name: string; customer_phone: string;
  total_sales: number; total_amount: number; total_paid: number;
  total_pending: number; pending_count: number; last_purchase_date: string | null;
  is_debtor: boolean;
}
interface SalesTrendItem {
  sale_date: string; total_count: number; total_amount: number;
  pix_amount: number; card_amount: number; cash_amount: number; other_amount: number;
}
interface AIInsight {
  id: string; insight_type: string; severity: string;
  title: string; description: string; suggestion: string | null;
  is_dismissed: boolean; created_at: string;
}
interface QueryAnswer {
  question_key: string; question_text: string;
  answer_text: string; answer_data: Record<string, unknown>; answered_at: string;
}
interface QueryHistoryItem {
  id: string; question_key: string; question_text: string;
  answer_text: string; created_at: string;
}

// ── Config ────────────────────────────────────────────────────────────

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão Cred.", debit_card: "Cartão Déb.",
  money: "Dinheiro", card: "Cartão", other: "Outro",
};
const METHOD_COLORS: Record<string, string> = {
  pix: "#10b981", ted: "#3b82f6", boleto: "#f59e0b",
  credit_card: "#ec4899", debit_card: "#06b6d4", money: "#84cc16",
  card: "#8b5cf6", other: "#9ca3af",
};
const INSIGHT_SEVERITY: Record<string, { badge: string; border: string }> = {
  critical: { badge: "bg-red-100 text-red-800",    border: "border-l-4 border-red-500" },
  warning:  { badge: "bg-yellow-100 text-yellow-800", border: "border-l-4 border-yellow-500" },
  info:     { badge: "bg-blue-100 text-blue-800",   border: "border-l-4 border-blue-500" },
};

const PREDEFINED_QUESTIONS = [
  { key: "quanto_entrou_hoje",         label: "Quanto entrou hoje?",                 icon: Banknote, color: "text-green-600" },
  { key: "quanto_entrou_mes",          label: "Quanto entrou este mês?",             icon: TrendingUp, color: "text-blue-600" },
  { key: "qual_banco_mais_movimentou", label: "Qual banco movimentou mais?",          icon: Activity, color: "text-indigo-600" },
  { key: "qual_metodo_mais_vende",     label: "Qual método de pagamento lidera?",     icon: CreditCard, color: "text-purple-600" },
  { key: "quanto_conciliado_auto",     label: "Quanto foi conciliado automaticamente?", icon: CheckCircle2, color: "text-emerald-600" },
  { key: "quantas_divergencias",       label: "Quantas divergências existem?",        icon: AlertCircle, color: "text-red-600" },
  { key: "quem_deve_mais",             label: "Quem está me devendo mais?",           icon: Users, color: "text-orange-600" },
  { key: "maior_cliente",              label: "Qual meu maior cliente?",              icon: Zap, color: "text-yellow-600" },
  { key: "previsao_30_dias",           label: "Previsão para 30 dias?",               icon: Clock, color: "text-cyan-600" },
];

// ── Helpers ───────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);
const fmtPct = (v: number | null) =>
  v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(1)}%`;
const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";
const fmtDT = (d: string) =>
  new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// ── Gerador de recomendações (baseado em dados reais) ─────────────────

interface Rec { severity: "critical" | "warning" | "info"; text: string; }
function generateRecommendations(
  summary: FinancialSummary | null,
  payment: PaymentBehaviorItem[],
  debt: DebtAnalysis | null,
  health: HealthAnalysis | null,
): Rec[] {
  const recs: Rec[] = [];
  if (!summary && !debt && !health) return recs;

  if (health) {
    if (health.health_score < 50)
      recs.push({ severity: "critical", text: `Saúde financeira crítica: score ${health.health_score}/100. Atenção imediata necessária.` });
    if (health.open_divergences_7d_plus > 0)
      recs.push({ severity: "warning", text: `${health.open_divergences_7d_plus} divergência(s) abertas há mais de 7 dias sem resolução.` });
    if (health.reconciliation_rate < 70 && health.total_bank_txs > 0)
      recs.push({ severity: "warning", text: `Taxa de conciliação em ${health.reconciliation_rate.toFixed(1)}% — abaixo do esperado (≥70%).` });
    if (health.banks_synced_24h < health.banks_connected && health.banks_connected > 0)
      recs.push({ severity: "warning", text: `${health.banks_connected - health.banks_synced_24h} banco(s) sem sincronização há mais de 24h.` });
  }

  if (debt) {
    if (debt.delinquency_rate > 20)
      recs.push({ severity: "critical", text: `Inadimplência em ${debt.delinquency_rate.toFixed(1)}% — taxa crítica. ${fmtBRL(debt.overdue_amount)} em atraso.` });
    else if (debt.delinquency_rate > 10)
      recs.push({ severity: "warning", text: `Inadimplência em ${debt.delinquency_rate.toFixed(1)}%. ${debt.overdue_count} venda(s) vencida(s) (${fmtBRL(debt.overdue_amount)}).` });
    if (debt.overdue_90d_plus_count > 0)
      recs.push({ severity: "critical", text: `${debt.overdue_90d_plus_count} débito(s) com mais de 90 dias de atraso (${fmtBRL(debt.overdue_90d_plus_amount)}).` });
  }

  if (summary) {
    if (summary.received_growth_pct != null && summary.received_growth_pct < -15)
      recs.push({ severity: "warning", text: `Recebimentos caíram ${Math.abs(summary.received_growth_pct).toFixed(1)}% em relação ao mês anterior.` });
    else if (summary.received_growth_pct != null && summary.received_growth_pct > 20)
      recs.push({ severity: "info", text: `Crescimento de ${summary.received_growth_pct.toFixed(1)}% nos recebimentos este mês.` });
    if (summary.month_divergences > 5)
      recs.push({ severity: "warning", text: `${summary.month_divergences} divergências registradas este mês — monitorar.` });
  }

  const pix = payment.find((m) => m.method === "pix");
  if (pix && pix.change_pct != null && pix.change_pct < -15)
    recs.push({ severity: "warning", text: `PIX caiu ${Math.abs(pix.change_pct).toFixed(1)}% em relação ao período anterior.` });

  const topMethod = payment[0];
  if (topMethod && topMethod.current_pct > 60)
    recs.push({ severity: "info", text: `${METHOD_LABELS[topMethod.method] ?? topMethod.method} representa ${topMethod.current_pct.toFixed(0)}% do faturamento.` });

  if (recs.length === 0)
    recs.push({ severity: "info", text: "Indicadores financeiros dentro do esperado. Continue monitorando." });

  return recs;
}

// ── Gauge de saúde (SVG) ─────────────────────────────────────────────

function HealthGauge({ score }: { score: number }) {
  const color = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#ef4444";
  const label = score >= 75 ? "Saudável" : score >= 50 ? "Regular" : "Crítico";
  const r = 52; const circ = 2 * Math.PI * r;
  const filled = (score / 100) * circ * 0.75; // 3/4 arc
  return (
    <div className="flex flex-col items-center gap-1">
      <svg width="140" height="100" viewBox="0 0 140 100">
        {/* Track */}
        <circle cx="70" cy="80" r={r} fill="none" stroke="#e5e7eb" strokeWidth="12"
          strokeDasharray={`${circ * 0.75} ${circ}`}
          strokeDashoffset={circ * 0.125}
          strokeLinecap="round" transform="rotate(135 70 80)" />
        {/* Value */}
        <circle cx="70" cy="80" r={r} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={`${filled} ${circ}`}
          strokeDashoffset={circ * 0.125}
          strokeLinecap="round" transform="rotate(135 70 80)"
          style={{ transition: "stroke-dasharray 1s ease" }} />
        <text x="70" y="75" textAnchor="middle" fontSize="28" fontWeight="bold" fill={color}>{score}</text>
        <text x="70" y="92" textAnchor="middle" fontSize="11" fill="#6b7280">{label}</text>
      </svg>
      <p className="text-xs text-muted-foreground">Saúde financeira</p>
    </div>
  );
}

// ── Delta badge ───────────────────────────────────────────────────────

function DeltaBadge({ value }: { value: number | null }) {
  if (value == null) return <span className="text-xs text-muted-foreground">—</span>;
  const up = value >= 0;
  return (
    <span className={`text-xs font-semibold flex items-center gap-0.5 ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {fmtPct(value)}
    </span>
  );
}

// ── Componente principal ──────────────────────────────────────────────

export default function ConnectAIPage() {
  const { profile } = useAuth();
  const [loading, setLoading]           = useState(true);
  const [summary, setSummary]           = useState<FinancialSummary | null>(null);
  const [payment, setPayment]           = useState<PaymentBehaviorItem[]>([]);
  const [debt, setDebt]                 = useState<DebtAnalysis | null>(null);
  const [health, setHealth]             = useState<HealthAnalysis | null>(null);
  const [customers, setCustomers]       = useState<CustomerRankingItem[]>([]);
  const [trend, setTrend]               = useState<SalesTrendItem[]>([]);
  const [insights, setInsights]         = useState<AIInsight[]>([]);
  const [detecting, setDetecting]       = useState(false);
  const [queryLoading, setQueryLoading] = useState<string | null>(null);
  const [lastAnswer, setLastAnswer]     = useState<QueryAnswer | null>(null);
  const [history, setHistory]           = useState<QueryHistoryItem[]>([]);

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const sid = profile.store_id;
      const [sumRes, payRes, debtRes, healthRes, custRes, trendRes, insRes, histRes] =
        await Promise.all([
          supabase.rpc("get_store_financial_summary",  { p_store_id: sid }),
          supabase.rpc("get_payment_behavior",         { p_store_id: sid, p_days: 30 }),
          supabase.rpc("get_debt_analysis",            { p_store_id: sid }),
          supabase.rpc("get_connect_health_analysis",  { p_store_id: sid }),
          supabase.rpc("get_customer_ranking",         { p_store_id: sid, p_limit: 8 }),
          supabase.rpc("get_sales_trend",              { p_store_id: sid, p_days: 30 }),
          supabase.rpc("get_ai_insights",              { p_store_id: sid, p_include_dismissed: false, p_limit: 20 }),
          supabase.rpc("get_ai_query_history",         { p_store_id: sid, p_limit: 10 }),
        ]);
      const row = (r: unknown) => Array.isArray(r) ? r[0] : r;
      setSummary(row(sumRes.data) as FinancialSummary ?? null);
      setPayment((payRes.data as PaymentBehaviorItem[]) ?? []);
      setDebt(row(debtRes.data) as DebtAnalysis ?? null);
      setHealth(row(healthRes.data) as HealthAnalysis ?? null);
      setCustomers((custRes.data as CustomerRankingItem[]) ?? []);
      setTrend((trendRes.data as SalesTrendItem[]) ?? []);
      setInsights((insRes.data as AIInsight[]) ?? []);
      setHistory((histRes.data as QueryHistoryItem[]) ?? []);
    } catch (e) {
      toast.error("Erro ao carregar IA: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

  useEffect(() => { load(); }, [load]);

  const detectInsights = async () => {
    if (!profile?.store_id) return;
    setDetecting(true);
    try {
      const { data, error } = await supabase.rpc("detect_ai_insights", { p_store_id: profile.store_id });
      if (error) throw error;
      const result = Array.isArray(data) ? data[0] : data as { insights_created: number };
      toast.success(`${result?.insights_created ?? 0} insight(s) gerado(s).`);
      const { data: fresh } = await supabase.rpc("get_ai_insights",
        { p_store_id: profile.store_id, p_include_dismissed: false, p_limit: 20 });
      setInsights((fresh as AIInsight[]) ?? []);
    } catch (e) {
      toast.error("Erro ao detectar insights: " + String(e));
    } finally {
      setDetecting(false);
    }
  };

  const askQuestion = async (key: string) => {
    if (!profile?.store_id || queryLoading) return;
    setQueryLoading(key);
    try {
      const { data, error } = await supabase.rpc("answer_financial_question", {
        p_store_id: profile.store_id, p_question_key: key,
      });
      if (error) throw error;
      setLastAnswer(data as QueryAnswer);
      // refresh history
      const { data: hist } = await supabase.rpc("get_ai_query_history",
        { p_store_id: profile.store_id, p_limit: 10 });
      setHistory((hist as QueryHistoryItem[]) ?? []);
    } catch (e) {
      toast.error("Erro ao responder: " + String(e));
    } finally {
      setQueryLoading(null);
    }
  };

  const recommendations = useMemo(
    () => generateRecommendations(summary, payment, debt, health),
    [summary, payment, debt, health],
  );

  const criticalInsights = insights.filter((i) => i.severity === "critical");
  const warningInsights  = insights.filter((i) => i.severity === "warning");

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="text-center space-y-3">
          <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mx-auto" />
          <p className="text-sm text-muted-foreground">Analisando dados financeiros...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-600" />
            Central de IA Financeira
          </h2>
          <p className="text-muted-foreground mt-1">
            Análise em tempo real baseada nos dados da sua loja.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {/* Alert bar para críticos */}
      {criticalInsights.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-lg px-4 py-3 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-red-600 shrink-0" />
          <p className="text-sm text-red-800 font-medium">
            {criticalInsights.length} insight(s) crítico(s) detectado(s) — veja a aba Insights.
          </p>
        </div>
      )}

      <Tabs defaultValue="painel">
        <TabsList className="grid w-full grid-cols-4 h-10">
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="perguntas">Perguntas</TabsTrigger>
          <TabsTrigger value="insights" className="relative">
            Insights
            {criticalInsights.length > 0 && (
              <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-red-500 text-white text-[9px] flex items-center justify-center">
                {criticalInsights.length}
              </span>
            )}
          </TabsTrigger>
          <TabsTrigger value="historico">Histórico</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Painel ─────────────────────────────────────── */}
        <TabsContent value="painel" className="space-y-5 mt-4">
          {/* Saúde + KPIs */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="md:col-span-1 flex items-center justify-center py-4">
              <HealthGauge score={health?.health_score ?? 0} />
            </Card>
            <div className="md:col-span-3 grid grid-cols-2 md:grid-cols-3 gap-3">
              {[
                { label: "Recebido este mês",   val: fmtBRL(summary?.month_received ?? 0),   delta: summary?.received_growth_pct ?? null, icon: Banknote, color: "text-green-600" },
                { label: "Vendas este mês",      val: String(summary?.month_sales_count ?? 0), delta: summary?.sales_growth_pct ?? null,    icon: TrendingUp, color: "text-blue-600" },
                { label: "Taxa conciliação",     val: `${health?.reconciliation_rate?.toFixed(1) ?? 0}%`, delta: null, icon: CheckCircle2, color: "text-emerald-600" },
                { label: "Inadimplência",        val: `${debt?.delinquency_rate?.toFixed(1) ?? 0}%`,      delta: null, icon: AlertCircle, color: debt && debt.delinquency_rate > 15 ? "text-red-600" : "text-yellow-600" },
                { label: "Divergências",         val: String(health?.divergent_count ?? 0),   delta: null, icon: Activity, color: "text-orange-600" },
                { label: "Previsão 30 dias",     val: fmtBRL(summary?.forecast_30d ?? 0),     delta: null, icon: Clock, color: "text-cyan-600" },
              ].map(({ label, val, delta, icon: Icon, color }) => (
                <Card key={label}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start gap-2">
                      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${color}`} />
                      <div>
                        <p className="text-xs text-muted-foreground">{label}</p>
                        <p className={`text-xl font-bold ${color}`}>{val}</p>
                        {delta != null && <DeltaBadge value={delta} />}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Resumo executivo semana / mês */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="border-blue-100 bg-blue-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                  <Activity className="h-4 w-4" /> Esta semana
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Recebido (banco)</span>
                  <span className="font-semibold">{fmtBRL(summary?.week_received ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Vendas realizadas</span>
                  <span className="font-semibold">{summary?.week_sales_count ?? 0}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Novos clientes</span>
                  <span className="font-semibold">{summary?.week_new_customers ?? 0}</span>
                </div>
              </CardContent>
            </Card>
            <Card className="border-purple-100 bg-purple-50/40">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" /> Este mês
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Recebido (banco)</span>
                  <span className="font-semibold">{fmtBRL(summary?.month_received ?? 0)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Conciliação automática</span>
                  <span className="font-semibold">{health?.auto_rate?.toFixed(1) ?? 0}%</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Em risco (vencidos)</span>
                  <span className="font-semibold text-red-600">{fmtBRL(summary?.at_risk_30d ?? 0)}</span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Recomendações */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Zap className="h-4 w-4 text-yellow-500" />
                Recomendações automáticas
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {recommendations.map((r, i) => (
                <div key={i} className={`flex items-start gap-3 p-3 rounded-lg ${
                  r.severity === "critical" ? "bg-red-50 border border-red-200" :
                  r.severity === "warning"  ? "bg-yellow-50 border border-yellow-200" :
                  "bg-blue-50 border border-blue-200"
                }`}>
                  {r.severity === "critical" ? <AlertCircle className="h-4 w-4 text-red-600 mt-0.5 shrink-0" /> :
                   r.severity === "warning"  ? <AlertCircle className="h-4 w-4 text-yellow-600 mt-0.5 shrink-0" /> :
                   <CheckCircle2 className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />}
                  <p className="text-sm">{r.text}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Tendência de vendas (gráfico) */}
          {trend.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">Tendência de recebimentos — 30 dias</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <defs>
                      <linearGradient id="aiPix" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="aiCard" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%"  stopColor="#8b5cf6" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="sale_date" tick={{ fontSize: 10 }}
                      tickFormatter={(d) => new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                      interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip
                      labelFormatter={(d) => new Date(d).toLocaleDateString("pt-BR")}
                      formatter={(v: number, n: string) => [fmtBRL(v),
                        n === "pix_amount" ? "PIX" : n === "card_amount" ? "Cartão" : "Dinheiro"]}
                    />
                    <Legend formatter={(v) => v === "pix_amount" ? "PIX" : v === "card_amount" ? "Cartão" : "Dinheiro"} />
                    <Area type="monotone" dataKey="pix_amount"  stroke="#10b981" fill="url(#aiPix)"  strokeWidth={2} />
                    <Area type="monotone" dataKey="card_amount" stroke="#8b5cf6" fill="url(#aiCard)" strokeWidth={2} />
                    <Area type="monotone" dataKey="cash_amount" stroke="#f59e0b" fill="none" strokeWidth={1.5} strokeDasharray="3 2" />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Método de pagamento */}
          {payment.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Métodos de pagamento — 30 dias</CardTitle>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={180}>
                    <BarChart data={payment} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 8 }}>
                      <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}%`} domain={[0, 100]} />
                      <YAxis type="category" dataKey="method"
                        tick={{ fontSize: 10 }}
                        tickFormatter={(m) => METHOD_LABELS[m] ?? m}
                        width={70} />
                      <Tooltip formatter={(v: number) => [`${v}%`, "Participação"]} />
                      <Bar dataKey="current_pct" radius={[0, 3, 3, 0]}
                        fill="#6366f1"
                        label={{ position: "right", fontSize: 9, formatter: (v: number) => `${v}%` }} />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Variação vs período anterior</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {payment.slice(0, 6).map((m) => (
                    <div key={m.method} className="flex items-center justify-between">
                      <span className="text-sm" style={{ color: METHOD_COLORS[m.method] ?? "#9ca3af" }}>
                        {METHOD_LABELS[m.method] ?? m.method}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-muted-foreground">{fmtBRL(m.current_amount)}</span>
                        {m.trend === "up"   ? <ArrowUpRight   className="h-4 w-4 text-green-600" /> :
                         m.trend === "down" ? <ArrowDownRight className="h-4 w-4 text-red-600" /> :
                         m.trend === "new"  ? <Zap            className="h-4 w-4 text-yellow-500" /> :
                                              <Minus          className="h-4 w-4 text-gray-400" />}
                        <span className={`text-xs font-medium w-14 text-right ${
                          m.trend === "up" ? "text-green-600" : m.trend === "down" ? "text-red-600" : "text-gray-500"
                        }`}>
                          {fmtPct(m.change_pct)}
                        </span>
                      </div>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {/* Ranking de clientes */}
          {customers.length > 0 && (
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <Users className="h-4 w-4" /> Top clientes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/30">
                        <th className="text-left py-2 px-3">#</th>
                        <th className="text-left py-2 px-3">Cliente</th>
                        <th className="text-right py-2 px-3">Total compras</th>
                        <th className="text-right py-2 px-3">Em aberto</th>
                        <th className="text-center py-2 px-3">Última compra</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customers.map((c, i) => (
                        <tr key={c.customer_id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="py-2 px-3 text-muted-foreground font-mono text-xs">{i + 1}</td>
                          <td className="py-2 px-3">
                            <p className="font-medium">{c.customer_name || "—"}</p>
                            {c.customer_phone && <p className="text-xs text-muted-foreground">{c.customer_phone}</p>}
                          </td>
                          <td className="py-2 px-3 text-right font-semibold">{fmtBRL(c.total_amount)}</td>
                          <td className="py-2 px-3 text-right">
                            {c.total_pending > 0
                              ? <span className="text-red-600 font-semibold">{fmtBRL(c.total_pending)}</span>
                              : <span className="text-green-600 text-xs">—</span>}
                          </td>
                          <td className="py-2 px-3 text-center text-xs text-muted-foreground">
                            {fmtDate(c.last_purchase_date)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Inadimplência breakdown */}
          {debt && debt.total_pending_amount > 0 && (
            <Card className="border-red-100">
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-500" /> Inadimplência por vencimento
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  {[
                    { label: "1-30 dias",  count: debt.overdue_30d_count, amount: debt.overdue_30d_amount, color: "text-yellow-700 bg-yellow-50" },
                    { label: "31-60 dias", count: debt.overdue_60d_count, amount: debt.overdue_60d_amount, color: "text-orange-700 bg-orange-50" },
                    { label: "+90 dias",   count: debt.overdue_90d_plus_count, amount: debt.overdue_90d_plus_amount, color: "text-red-700 bg-red-50" },
                    { label: "Total vencido", count: debt.overdue_count, amount: debt.overdue_amount, color: "text-red-900 bg-red-100" },
                  ].map(({ label, count, amount, color }) => (
                    <div key={label} className={`rounded-lg p-3 ${color.split(" ")[1]}`}>
                      <p className={`text-xs font-medium ${color.split(" ")[0]}`}>{label}</p>
                      <p className={`text-lg font-bold ${color.split(" ")[0]}`}>{fmtBRL(amount)}</p>
                      <p className={`text-xs ${color.split(" ")[0]} opacity-70`}>{count} venda(s)</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        {/* ── Tab 2: Perguntas ──────────────────────────────────── */}
        <TabsContent value="perguntas" className="space-y-4 mt-4">
          <p className="text-sm text-muted-foreground">
            Clique em uma pergunta para obter a resposta com base nos dados reais da sua loja.
          </p>

          {/* Resposta atual */}
          {lastAnswer && (
            <Card className="bg-gradient-to-r from-purple-50 to-blue-50 border-purple-200">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <div className="h-8 w-8 rounded-full bg-purple-100 flex items-center justify-center shrink-0">
                    <Brain className="h-4 w-4 text-purple-600" />
                  </div>
                  <div>
                    <p className="text-xs text-purple-600 font-medium mb-1">{lastAnswer.question_text}</p>
                    <p className="text-sm font-medium text-gray-800">{lastAnswer.answer_text}</p>
                    <p className="text-xs text-muted-foreground mt-1">{fmtDT(lastAnswer.answered_at)}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Grade de perguntas */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {PREDEFINED_QUESTIONS.map(({ key, label, icon: Icon, color }) => (
              <button
                key={key}
                onClick={() => askQuestion(key)}
                disabled={queryLoading !== null}
                className={`flex items-center gap-3 p-4 rounded-xl border text-left transition-all
                  ${queryLoading === key
                    ? "bg-purple-50 border-purple-300 scale-95"
                    : "bg-white hover:bg-purple-50 hover:border-purple-300 hover:shadow-sm"
                  } disabled:opacity-60`}
              >
                {queryLoading === key
                  ? <Loader2 className={`h-5 w-5 ${color} animate-spin shrink-0`} />
                  : <Icon className={`h-5 w-5 ${color} shrink-0`} />}
                <span className="text-sm font-medium">{label}</span>
                <ChevronRight className="h-4 w-4 text-muted-foreground ml-auto" />
              </button>
            ))}
          </div>
        </TabsContent>

        {/* ── Tab 3: Insights ───────────────────────────────────── */}
        <TabsContent value="insights" className="space-y-4 mt-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              <Badge className="bg-red-100 text-red-800">{criticalInsights.length} críticos</Badge>
              <Badge className="bg-yellow-100 text-yellow-800">{warningInsights.length} avisos</Badge>
              <Badge variant="outline">{insights.length} total</Badge>
            </div>
            <Button size="sm" onClick={detectInsights} disabled={detecting}>
              {detecting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Brain className="h-4 w-4 mr-1" />}
              Detectar agora
            </Button>
          </div>

          {insights.length === 0 ? (
            <Card>
              <CardContent className="pt-10 pb-10 text-center">
                <CheckCircle2 className="h-10 w-10 text-green-500 mx-auto mb-3" />
                <p className="font-medium">Nenhum insight ativo</p>
                <p className="text-sm text-muted-foreground mt-1">Clique em "Detectar agora" para analisar os dados.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-3">
              {insights.map((ins) => {
                const sev = INSIGHT_SEVERITY[ins.severity] ?? INSIGHT_SEVERITY.info;
                return (
                  <div key={ins.id} className={`bg-white rounded-xl border p-4 ${sev.border}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1">
                        <div className="flex items-center gap-2 mb-1">
                          <Badge className={`text-xs ${sev.badge}`}>{ins.severity.toUpperCase()}</Badge>
                          <span className="text-xs text-muted-foreground">{fmtDT(ins.created_at)}</span>
                        </div>
                        <p className="font-semibold text-sm">{ins.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{ins.description}</p>
                        {ins.suggestion && (
                          <p className="text-xs text-blue-700 bg-blue-50 rounded px-2 py-1 mt-2">
                            💡 {ins.suggestion}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        {/* ── Tab 4: Histórico ──────────────────────────────────── */}
        <TabsContent value="historico" className="space-y-4 mt-4">
          <h3 className="text-sm font-semibold text-muted-foreground">Últimas perguntas realizadas</h3>
          {history.length === 0 ? (
            <Card>
              <CardContent className="pt-10 text-center pb-10">
                <MessageCircle className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Nenhuma pergunta realizada ainda.</p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-2">
              {history.map((q) => (
                <div key={q.id} className="bg-white rounded-xl border p-4">
                  <div className="flex items-start gap-3">
                    <HelpCircle className="h-4 w-4 text-purple-500 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs font-medium text-purple-700">{q.question_text}</p>
                      <p className="text-sm mt-1">{q.answer_text}</p>
                      <p className="text-xs text-muted-foreground mt-1">{fmtDT(q.created_at)}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
