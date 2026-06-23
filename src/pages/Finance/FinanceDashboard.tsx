import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  TrendingUp, TrendingDown, DollarSign, Target, AlertTriangle,
  ArrowRight, Wallet, BarChart2, FileText, ArrowUpRight, ArrowDownRight,
  RefreshCw, Loader2,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Dashboard {
  receita_mes: number;
  receita_semana: number;
  receita_hoje: number;
  receita_growth_pct: number | null;
  despesas_mes: number;
  lucro_mes: number;
  lucro_growth_pct: number | null;
  margem_pct: number;
  recebido_mes: number;
  a_receber: number;
  a_pagar: number;
  delinquency_rate: number;
  saldo_caixa: number;
  goals_total: number;
  goals_on_track: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const GrowthBadge = ({ pct }: { pct: number | null }) => {
  if (pct == null) return null;
  const up = pct >= 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs font-medium ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

export default function FinanceDashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const storeId = profile?.store_id;

  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data: d, error } = await supabase.rpc("get_executive_finance_dashboard", { p_store_id: storeId });
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar dashboard", variant: "destructive" }); return; }
    setData(d as Dashboard);
  }, [storeId]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!data) return null;

  const kpis = [
    {
      label: "Receita do Mês",
      value: fmtBRL(data.receita_mes),
      sub: `Hoje: ${fmtBRL(data.receita_hoje)}`,
      growth: data.receita_growth_pct,
      icon: TrendingUp,
      color: "text-emerald-600",
    },
    {
      label: "Lucro Líquido",
      value: fmtBRL(data.lucro_mes),
      sub: `Margem: ${data.margem_pct.toFixed(1)}%`,
      growth: data.lucro_growth_pct,
      icon: DollarSign,
      color: data.lucro_mes >= 0 ? "text-blue-600" : "text-red-600",
    },
    {
      label: "Recebido no Mês",
      value: fmtBRL(data.recebido_mes),
      sub: `A receber: ${fmtBRL(data.a_receber)}`,
      growth: null,
      icon: Wallet,
      color: "text-indigo-600",
    },
    {
      label: "A Pagar",
      value: fmtBRL(data.a_pagar),
      sub: data.a_pagar > data.saldo_caixa ? "⚠️ Acima do saldo" : "Dentro do saldo",
      growth: null,
      icon: AlertTriangle,
      color: data.a_pagar > data.saldo_caixa ? "text-red-600" : "text-amber-600",
    },
    {
      label: "Inadimplência",
      value: `${data.delinquency_rate.toFixed(1)}%`,
      sub: data.delinquency_rate > 10 ? "Alta — revisar" : "Dentro do normal",
      growth: null,
      icon: TrendingDown,
      color: data.delinquency_rate > 10 ? "text-red-600" : "text-muted-foreground",
    },
    {
      label: "Saldo em Caixa",
      value: fmtBRL(data.saldo_caixa),
      sub: `Semana: ${fmtBRL(data.receita_semana)}`,
      growth: null,
      icon: BarChart2,
      color: data.saldo_caixa >= 0 ? "text-slate-700" : "text-red-600",
    },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BarChart2 className="h-6 w-6 text-blue-600" />
            Dashboard Financeiro Executivo
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Visão consolidada de receita, lucro, caixa e inadimplência
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Atualizar
        </Button>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        {kpis.map(({ label, value, sub, growth, icon: Icon, color }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-center gap-2 mb-1">
                <Icon className={`h-4 w-4 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <div className="flex items-end gap-2">
                <span className={`text-xl font-bold ${color}`}>{value}</span>
                <GrowthBadge pct={growth} />
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Metas resumo */}
      {data.goals_total > 0 && (
        <Card className={data.goals_on_track === data.goals_total ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}>
          <CardContent className="pt-4 pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Target className={`h-5 w-5 ${data.goals_on_track === data.goals_total ? "text-emerald-600" : "text-amber-600"}`} />
                <span className="font-medium text-sm">
                  Metas do mês: {data.goals_on_track}/{data.goals_total} no ritmo
                </span>
                <Badge variant={data.goals_on_track === data.goals_total ? "default" : "secondary"}>
                  {Math.round(data.goals_on_track / data.goals_total * 100)}%
                </Badge>
              </div>
              <Link to="/finance/metas">
                <Button variant="ghost" size="sm">
                  Ver metas <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Grade de navegação */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">Módulos</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { to: "/finance/fluxo-caixa", icon: "💧", label: "Fluxo de Caixa", desc: "Entradas e saídas" },
            { to: "/finance/dre", icon: "📊", label: "DRE", desc: "Resultado gerencial" },
            { to: "/finance/metas", icon: "🎯", label: "Metas", desc: "Acompanhar objetivos" },
            { to: "/contas-a-receber", icon: "📥", label: "A Receber", desc: "Score de risco" },
            { to: "/contas-a-pagar", icon: "📤", label: "A Pagar", desc: "Alertas de vencimento" },
            { to: "/financeiro", icon: "💰", label: "Caixa", desc: "Lançamentos" },
            { to: "/relatorios", icon: "📋", label: "Relatórios", desc: "Exportar dados" },
          ].map(({ to, icon, label, desc }) => (
            <Link key={to} to={to}>
              <Card className="hover:border-primary/50 hover:shadow-sm transition-all cursor-pointer h-full">
                <CardContent className="pt-3 pb-3 flex items-center gap-3">
                  <span className="text-xl">{icon}</span>
                  <div className="min-w-0">
                    <div className="font-medium text-sm">{label}</div>
                    <div className="text-xs text-muted-foreground truncate">{desc}</div>
                  </div>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
