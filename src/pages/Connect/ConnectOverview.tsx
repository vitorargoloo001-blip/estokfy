import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  BarChart3, CheckCircle2, AlertCircle, Clock,
  Plug2, ArrowRight, Play, Trash2, Database, RefreshCw,
  TrendingUp, Banknote, Activity, Zap, Bell,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DashboardKPIs {
  received_today: number;
  received_month: number;
  auto_reconciled: number;
  manual_reconciled: number;
  pending_reconciliation: number;
  divergent: number;
  banks_connected: number;
  last_sync: string | null;
  total_transactions: number;
  reconciled_count: number;
  reconciliation_rate: number;
}

interface TrendPoint {
  date: string;
  reconciled: number;
  divergent: number;
  pending: number;
}

interface MethodPoint {
  method: string;
  total_count: number;
  reconciled_count: number;
  total_amount: number;
  reconciled_amount: number;
  divergent_count: number;
  pending_count: number;
  reconciliation_rate: number;
}

interface MonthComparison {
  current_month_reconciled: number;
  current_month_total: number;
  current_month_divergent: number;
  prev_month_reconciled: number;
  prev_month_total: number;
  prev_month_divergent: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const METHOD_LABEL: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão", debit_card: "Débito", other: "Outro",
};

export default function ConnectOverview() {
  const { profile } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  const [methods, setMethods] = useState<MethodPoint[]>([]);
  const [monthComp, setMonthComp] = useState<MonthComparison | null>(null);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [loading, setLoading] = useState(true);
  const [hasDemoData, setHasDemoData] = useState(false);

  const [seeding, setSeeding]       = useState(false);
  const [clearing, setClearing]     = useState(false);
  const [matching, setMatching]     = useState(false);
  const [scenario, setScenario]     = useState(false);
  const [trendPeriod, setTrendPeriod] = useState<"week" | "month" | "quarter">("month");

  const loadKPIs = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      // start_date = início do mês atual para breakdown
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split("T")[0];

      const [kpiRes, trendRes, methodRes, compRes, alertRes] = await Promise.all([
        supabase.rpc("connect_get_dashboard_kpis", { p_store_id: profile.store_id }),
        supabase.rpc("get_reconciliation_trend_by_period", { p_store_id: profile.store_id, p_period: trendPeriod }),
        supabase.rpc("get_reconciliation_by_method", { p_store_id: profile.store_id, p_start_date: monthStart }),
        supabase.rpc("get_monthly_comparison", { p_store_id: profile.store_id }),
        supabase.rpc("get_unread_alert_count", { p_store_id: profile.store_id }),
      ]);
      if (kpiRes.error) throw kpiRes.error;
      setKpis(kpiRes.data as DashboardKPIs);
      setTrend((trendRes.data as TrendPoint[]) || []);
      setMethods((methodRes.data as MethodPoint[]) || []);
      setMonthComp(compRes.data as MonthComparison | null);
      setUnreadAlerts((alertRes.data as number) || 0);
    } catch (e) {
      console.error("Connect KPI error:", e);
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id, trendPeriod]);

  const checkDemoData = useCallback(async () => {
    if (!profile?.store_id || !isSuperAdmin) return;
    const { data } = await supabase
      .from("bank_connections")
      .select("id")
      .eq("store_id", profile.store_id)
      .eq("bank_name", "Banco Sandbox Demo")
      .maybeSingle();
    setHasDemoData(!!data);
  }, [profile?.store_id, isSuperAdmin]);

  useEffect(() => { loadKPIs(); }, [loadKPIs]);
  useEffect(() => { checkDemoData(); }, [checkDemoData]);

  const seedDemo = async () => {
    if (!profile?.store_id) return;
    setSeeding(true);
    try {
      const { data, error } = await supabase.rpc("connect_seed_demo_data", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      const d = data as any;
      toast.success(
        `Demonstração criada! ${d.transactions_created} transações, ` +
        `${d.matches_created} sugestões` +
        (d.sales_linked > 0 ? `, ${d.sales_linked} vinculadas a vendas reais` : "") +
        (d.alerts_active > 0 ? `, ${d.alerts_active} alertas.` : ".")
      );
      await Promise.all([loadKPIs(), checkDemoData()]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar dados de demonstração");
    } finally {
      setSeeding(false);
    }
  };

  const clearDemo = async () => {
    if (!profile?.store_id) return;
    setClearing(true);
    try {
      const { error } = await supabase.rpc("connect_clear_demo_data", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      toast.success("Dados de demonstração removidos.");
      await Promise.all([loadKPIs(), checkDemoData()]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao limpar demonstração");
    } finally {
      setClearing(false);
    }
  };

  const seedScenario = async () => {
    if (!profile?.store_id) return;
    setScenario(true);
    try {
      const { data, error } = await supabase.rpc("connect_seed_scenario_completo", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      const d = data as any;
      toast.success(
        `Cenário completo gerado! ${d.transactions_created} transações, ` +
        `${d.matches_created} conciliações, ${d.alerts_created} alertas.`
      );
      await Promise.all([loadKPIs(), checkDemoData()]);
    } catch (e: any) {
      toast.error(e.message || "Erro ao gerar cenário completo");
    } finally {
      setScenario(false);
    }
  };

  const runMatching = async () => {
    if (!profile?.store_id) return;
    setMatching(true);
    try {
      const { data, error } = await supabase.rpc("connect_run_matching", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      const d = data as any;
      if (d.total_processed === 0) {
        toast.info("Nenhuma transação pendente sem correspondência.");
      } else {
        toast.success(
          `Conciliação executada! ${d.matches_created} correspondência(s)` +
          (d.no_match > 0 ? `, ${d.no_match} sem correspondência.` : ".")
        );
      }
      await loadKPIs();
    } catch (e: any) {
      toast.error(e.message || "Erro ao executar conciliação");
    } finally {
      setMatching(false);
    }
  };

  const isEmpty = !loading && kpis?.banks_connected === 0;
  const hasTrend = trend.some((d) => d.reconciled + d.divergent + d.pending > 0);

  return (
    <div className="space-y-6">
      {/* Super Admin: Painel Sandbox */}
      {isSuperAdmin && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-600" />
                <span className="font-semibold text-purple-900 text-sm">Modo Demonstração</span>
                {hasDemoData && (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-300 border">
                    Dados ativos
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {/* Cenário completo — sempre disponível para super admin */}
                <Button
                  size="sm"
                  onClick={seedScenario}
                  disabled={scenario}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white"
                >
                  {scenario
                    ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Gerando cenário...</>
                    : <><Zap className="h-4 w-4 mr-1" />Gerar cenário completo</>}
                </Button>
                {!hasDemoData ? (
                  <Button
                    size="sm"
                    onClick={seedDemo}
                    disabled={seeding}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {seeding
                      ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Gerando...</>
                      : <><Play className="h-4 w-4 mr-1" />Demo básico</>}
                  </Button>
                ) : (
                  <>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={runMatching}
                      disabled={matching}
                      className="border-purple-300 text-purple-700 hover:bg-purple-100"
                    >
                      {matching
                        ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Executando...</>
                        : <><Activity className="h-4 w-4 mr-1" />Conciliação automática</>}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={clearDemo}
                      disabled={clearing}
                      className="border-red-300 text-red-700 hover:bg-red-50"
                    >
                      {clearing
                        ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Limpando...</>
                        : <><Trash2 className="h-4 w-4 mr-1" />Limpar demo</>}
                    </Button>
                  </>
                )}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Empty state */}
      {isEmpty && !loading && (
        <Card className="border-dashed">
          <CardContent className="pt-14 pb-14 text-center space-y-4">
            <Plug2 className="h-16 w-16 text-muted-foreground mx-auto opacity-30" />
            <div>
              <h3 className="text-lg font-semibold">Nenhum banco conectado</h3>
              <p className="text-sm text-muted-foreground mt-2 max-w-sm mx-auto">
                Conecte sua conta bancária para começar a conciliar automaticamente.
              </p>
            </div>
            <Button asChild>
              <Link to="/connect/bancos">Conectar banco</Link>
            </Button>
          </CardContent>
        </Card>
      )}

      {/* KPI Grid */}
      {!loading && kpis && !isEmpty && (
        <>
          {/* Alertas badge */}
          {unreadAlerts > 0 && (
            <Link to="/connect/alertas">
              <Card className="border-orange-200 bg-orange-50 hover:bg-orange-100 transition-colors cursor-pointer">
                <CardContent className="pt-3 pb-3">
                  <div className="flex items-center gap-2">
                    <Bell className="h-4 w-4 text-orange-600" />
                    <span className="text-sm font-medium text-orange-800">
                      {unreadAlerts} alerta(s) não lido(s)
                    </span>
                    <ArrowRight className="h-4 w-4 text-orange-600 ml-auto" />
                  </div>
                </CardContent>
              </Card>
            </Link>
          )}

          {/* Linha 1: Financeiro */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Recebido hoje</CardTitle>
                <Banknote className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {fmtBRL(kpis.received_today)}
                </div>
                <p className="text-xs text-muted-foreground">Transações conciliadas</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Recebido no mês</CardTitle>
                <TrendingUp className="h-4 w-4 text-blue-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{fmtBRL(kpis.received_month)}</div>
                <p className="text-xs text-muted-foreground">Entradas bancárias</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Taxa de conciliação</CardTitle>
                <BarChart3 className="h-4 w-4 text-indigo-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-indigo-600">
                  {kpis.reconciliation_rate}%
                </div>
                <p className="text-xs text-muted-foreground">
                  {kpis.reconciled_count} de {kpis.total_transactions} transações
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Bancos conectados</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{kpis.banks_connected}</div>
                <p className="text-xs text-muted-foreground">Sync: {fmtDate(kpis.last_sync)}</p>
              </CardContent>
            </Card>
          </div>

          {/* Linha 2: Status de conciliação */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Conciliado automaticamente</CardTitle>
                <Zap className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">{kpis.auto_reconciled}</div>
                <p className="text-xs text-muted-foreground">Motor 3-pass</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Conciliado manualmente</CardTitle>
                <CheckCircle2 className="h-4 w-4 text-teal-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-teal-600">{kpis.manual_reconciled ?? 0}</div>
                <p className="text-xs text-muted-foreground">Vinculação humana</p>
              </CardContent>
            </Card>

            <Card className={kpis.pending_reconciliation > 0 ? "border-yellow-300" : ""}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Pendente de conciliação</CardTitle>
                <Clock className={`h-4 w-4 ${kpis.pending_reconciliation > 0 ? "text-yellow-600" : "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${kpis.pending_reconciliation > 0 ? "text-yellow-600" : ""}`}>
                  {kpis.pending_reconciliation}
                </div>
                {kpis.pending_reconciliation > 0 ? (
                  <Link to="/connect/conciliacao" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
                    Revisar agora <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">Tudo em dia!</p>
                )}
              </CardContent>
            </Card>

            <Card className={kpis.divergent > 0 ? "border-red-300" : ""}>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Divergências</CardTitle>
                <AlertCircle className={`h-4 w-4 ${kpis.divergent > 0 ? "text-red-600" : "text-muted-foreground"}`} />
              </CardHeader>
              <CardContent>
                <div className={`text-2xl font-bold ${kpis.divergent > 0 ? "text-red-600" : ""}`}>
                  {kpis.divergent}
                </div>
                {kpis.divergent > 0 ? (
                  <Link to="/connect/divergencias" className="text-xs text-primary hover:underline flex items-center gap-1 mt-1">
                    Ver divergências <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhuma divergência</p>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Comparativo mensal */}
          {monthComp && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  label: "Conciliado (mês atual)",
                  current: monthComp.current_month_reconciled,
                  prev:    monthComp.prev_month_reconciled,
                  fmt: (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v),
                  color: "text-green-600",
                },
                {
                  label: "Total recebido (mês atual)",
                  current: monthComp.current_month_total,
                  prev:    monthComp.prev_month_total,
                  fmt: (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v),
                  color: "text-blue-600",
                },
                {
                  label: "Divergências (mês atual)",
                  current: monthComp.current_month_divergent,
                  prev:    monthComp.prev_month_divergent,
                  fmt: (v: number) => String(v),
                  color: "text-red-600",
                },
              ].map(({ label, current, prev, fmt, color }) => {
                const pct = prev > 0 ? ((current - prev) / prev) * 100 : 0;
                const up = pct >= 0;
                return (
                  <Card key={label}>
                    <CardContent className="pt-4">
                      <p className="text-xs text-muted-foreground mb-1">{label}</p>
                      <p className={`text-2xl font-bold ${color}`}>{fmt(current)}</p>
                      <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
                        <span>vs anterior: {fmt(prev)}</span>
                        {prev > 0 && (
                          <span className={`font-medium ${up ? "text-green-600" : "text-red-600"}`}>
                            {up ? "+" : ""}{pct.toFixed(1)}%
                          </span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          {/* Trend chart */}
          {hasTrend && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardTitle className="text-base">
                  Tendência —{" "}
                  {trendPeriod === "week" ? "Últimos 7 dias" : trendPeriod === "month" ? "Últimos 30 dias" : "Último trimestre"}
                </CardTitle>
                <div className="flex gap-1">
                  {(["week", "month", "quarter"] as const).map((p) => (
                    <Button
                      key={p}
                      size="sm"
                      variant={trendPeriod === p ? "default" : "outline"}
                      className="h-7 text-xs"
                      onClick={() => setTrendPeriod(p)}
                    >
                      {p === "week" ? "7d" : p === "month" ? "30d" : "90d"}
                    </Button>
                  ))}
                </div>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <AreaChart data={trend} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <defs>
                      <linearGradient id="colorRec" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="colorDiv" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d) =>
                        new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })
                      }
                      interval="preserveStartEnd"
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      labelFormatter={(l) => new Date(l).toLocaleDateString("pt-BR")}
                      formatter={(v, n) => [v, n === "reconciled" ? "Conciliadas" : n === "divergent" ? "Divergentes" : "Pendentes"]}
                    />
                    <Legend formatter={(v) => v === "reconciled" ? "Conciliadas" : v === "divergent" ? "Divergentes" : "Pendentes"} />
                    <Area type="monotone" dataKey="reconciled" stroke="#10b981" fill="url(#colorRec)" strokeWidth={2} />
                    <Area type="monotone" dataKey="divergent" stroke="#ef4444" fill="url(#colorDiv)" strokeWidth={2} />
                    <Area type="monotone" dataKey="pending" stroke="#f59e0b" fill="none" strokeDasharray="4 2" strokeWidth={1.5} />
                  </AreaChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Method breakdown */}
          {methods.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breakdown por método de pagamento (30 dias)</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={methods} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="method"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(m) => METHOD_LABEL[m] ?? m}
                    />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      formatter={(v, n) => [v, n === "total_count" ? "Total" : "Conciliadas"]}
                      labelFormatter={(l) => METHOD_LABEL[l] ?? l}
                    />
                    <Legend formatter={(v) => v === "total_count" ? "Total" : "Conciliadas"} />
                    <Bar dataKey="total_count" fill="#6366f1" name="total_count" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="reconciled_count" fill="#10b981" name="reconciled_count" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Grade de navegação */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: "/connect/bancos",         icon: "🏦", label: "Bancos",        desc: "Gerenciar conexões" },
            { to: "/connect/transacoes",      icon: "💳", label: "Transações",    desc: "Histórico completo" },
            { to: "/connect/conciliacao",     icon: "⚡", label: "Conciliação",   desc: "Revisar pendências" },
            { to: "/connect/divergencias",    icon: "⚠️", label: "Divergências",  desc: "Analisar problemas" },
            { to: "/connect/relatorios",      icon: "📊", label: "Relatórios",    desc: "PDF / Excel / CSV" },
            { to: "/connect/alertas",         icon: "🔔", label: "Alertas",       desc: unreadAlerts > 0 ? `${unreadAlerts} não lido(s)` : "Notificações" },
            { to: "/connect/auditoria",       icon: "📋", label: "Auditoria",     desc: "Histórico de ações" },
            { to: "/connect/configuracoes",   icon: "⚙️", label: "Configurações", desc: "Ajustar parâmetros" },
          ].map(({ to, icon, label, desc }) => (
            <Link key={to} to={to}>
              <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer h-full">
                <CardContent className="pt-4 pb-4 flex items-center gap-3">
                  <span className="text-xl">{icon}</span>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground truncate">{desc}</div>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto shrink-0" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
