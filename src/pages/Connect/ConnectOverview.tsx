import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  BarChart3, CheckCircle2, AlertCircle, Clock,
  Plug2, ArrowRight, Play, Trash2, Database, RefreshCw,
  TrendingUp, Banknote, Activity, Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface DashboardKPIs {
  received_today: number;
  received_month: number;
  auto_reconciled: number;
  pending_reconciliation: number;
  divergent: number;
  banks_connected: number;
  last_sync: string | null;
  total_transactions: number;
  reconciled_count: number;
  reconciliation_rate: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

export default function ConnectOverview() {
  const { profile } = useAuth();
  const { isSuperAdmin } = useSuperAdmin();

  const [kpis, setKpis] = useState<DashboardKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [hasDemoData, setHasDemoData] = useState(false);

  const [seeding, setSeeding] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [matching, setMatching] = useState(false);

  const loadKPIs = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("connect_get_dashboard_kpis", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      setKpis(data as DashboardKPIs);
    } catch (e) {
      console.error("Connect KPI error:", e);
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

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
        `${d.matches_created} sugestões de conciliação` +
        (d.sales_linked > 0 ? `, ${d.sales_linked} vinculadas a vendas reais` : "") + "."
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
          `Conciliação executada! ${d.matches_created} correspondência(s) criada(s)` +
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

  return (
    <div className="space-y-6">
      {/* Super Admin: Painel Sandbox */}
      {isSuperAdmin && (
        <Card className="border-purple-200 bg-purple-50">
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-2">
                <Database className="h-5 w-5 text-purple-600" />
                <span className="font-semibold text-purple-900 text-sm">
                  Modo Demonstração
                </span>
                {hasDemoData && (
                  <Badge className="bg-purple-100 text-purple-700 border-purple-300 border">
                    Dados ativos
                  </Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {!hasDemoData ? (
                  <Button
                    size="sm"
                    onClick={seedDemo}
                    disabled={seeding}
                    className="bg-purple-600 hover:bg-purple-700 text-white"
                  >
                    {seeding
                      ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Gerando...</>
                      : <><Play className="h-4 w-4 mr-1" />Gerar dados de demonstração</>
                    }
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
                        : <><Activity className="h-4 w-4 mr-1" />Executar conciliação automática</>
                      }
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
                        : <><Trash2 className="h-4 w-4 mr-1" />Limpar demo</>
                      }
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
                Conecte sua conta bancária para começar a conciliar automaticamente suas transações com as vendas do sistema.
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
                <p className="text-xs text-muted-foreground">
                  Sync: {fmtDate(kpis.last_sync)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Linha 2: Status de conciliação */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-sm font-medium">Conciliado automaticamente</CardTitle>
                <Zap className="h-4 w-4 text-green-600" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-green-600">
                  {kpis.auto_reconciled}
                </div>
                <p className="text-xs text-muted-foreground">
                  Matches confirmados pelo motor 3-pass
                </p>
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
                  <Link
                    to="/connect/conciliacao"
                    className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                  >
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
                  <Link
                    to="/connect/divergencias"
                    className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
                  >
                    Ver divergências <ArrowRight className="h-3 w-3" />
                  </Link>
                ) : (
                  <p className="text-xs text-muted-foreground">Nenhuma divergência</p>
                )}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Grade de navegação */}
      {!loading && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {[
            { to: "/connect/bancos",         icon: "🏦", label: "Bancos",        desc: "Gerenciar conexões" },
            { to: "/connect/transacoes",      icon: "💳", label: "Transações",    desc: "Histórico completo" },
            { to: "/connect/conciliacao",     icon: "⚡", label: "Conciliação",   desc: "Revisar pendências" },
            { to: "/connect/divergencias",    icon: "⚠️", label: "Divergências",  desc: "Analisar problemas" },
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
