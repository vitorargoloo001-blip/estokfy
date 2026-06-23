import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Target, TrendingUp, TrendingDown, RefreshCw, Loader2, BrainCircuit, AlertTriangle, Package, Users, Landmark, ArrowUpRight, ArrowDownRight, Lightbulb } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { useNavigate } from "react-router-dom";

interface HealthData {
  score: number;
  grade: string;
  breakdown: {
    vendas: number; recebimentos: number; inadimplencia: number;
    ruptura: number; parados: number; margem: number; connect: number;
  };
  strengths: string[];
  weaknesses: string[];
  recommendation: string;
}

interface FinData {
  receita_total: number; receita_hoje: number; receita_semana: number;
  a_receber: number; a_pagar: number; saldo_caixa: number;
  inadimplencia: number; maior_devedor: string; maior_devedor_valor: number;
}

interface SalData {
  total_vendas: number; valor_total: number; ticket_medio: number;
  vendas_hoje: number; top_produto: string; top_vendedor: string;
}

interface InvData {
  total_produtos: number; sem_estoque: number; estoque_baixo: number;
  parados_30d: number; valor_parado: number;
}

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const color =
    score >= 85 ? "text-emerald-600" :
    score >= 70 ? "text-blue-600" :
    score >= 55 ? "text-amber-600" :
    score >= 40 ? "text-orange-600" : "text-red-600";

  const ringColor =
    score >= 85 ? "#10b981" :
    score >= 70 ? "#3b82f6" :
    score >= 55 ? "#f59e0b" :
    score >= 40 ? "#f97316" : "#ef4444";

  const radius = 44;
  const circ = 2 * Math.PI * radius;
  const dash = circ * (score / 100);

  return (
    <div className="flex flex-col items-center gap-2">
      <svg width="120" height="120" className="-rotate-90">
        <circle cx="60" cy="60" r={radius} stroke="currentColor" strokeWidth="10" fill="none" className="text-muted/30" />
        <circle cx="60" cy="60" r={radius} stroke={ringColor} strokeWidth="10" fill="none"
          strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <div className="text-center -mt-2">
        <p className={`text-4xl font-black ${color}`} style={{ marginTop: "-90px", position: "relative", zIndex: 10 }}>{score}</p>
      </div>
      <div className="text-center mt-16">
        <p className={`text-lg font-bold ${color}`}>{grade}</p>
        <p className="text-xs text-muted-foreground">Saúde da empresa</p>
      </div>
    </div>
  );
}

export default function CEODashboard() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const navigate = useNavigate();
  const storeId = profile?.store_id;
  const role = profile?.role ?? "";

  const [health, setHealth] = useState<HealthData | null>(null);
  const [fin, setFin] = useState<FinData | null>(null);
  const [sal, setSal] = useState<SalData | null>(null);
  const [inv, setInv] = useState<InvData | null>(null);
  const [loading, setLoading] = useState(true);

  if (!["owner", "admin", "manager"].includes(role)) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-sm p-6 text-center">
          <Target className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Acesso restrito</p>
          <p className="text-sm text-muted-foreground mt-1">Dashboard CEO disponível para proprietários, administradores e gerentes.</p>
        </Card>
      </div>
    );
  }

  async function load() {
    if (!storeId) return;
    setLoading(true);
    const [h, f, s, i] = await Promise.all([
      supabase.rpc("ai_get_business_health_score", { p_store_id: storeId }),
      supabase.rpc("ai_get_financial_summary", { p_store_id: storeId, p_period_days: 30 }),
      supabase.rpc("ai_get_sales_summary", { p_store_id: storeId, p_period_days: 30 }),
      supabase.rpc("ai_get_inventory_summary", { p_store_id: storeId }),
    ]);
    setLoading(false);
    if (h.error || f.error || s.error || i.error) {
      toast({ title: "Erro ao carregar dados", variant: "destructive" }); return;
    }
    setHealth(h.data as HealthData);
    setFin(f.data as FinData);
    setSal(s.data as SalData);
    setInv(i.data as InvData);
  }

  useEffect(() => { load(); }, [storeId]);

  const KPIS = fin && sal && inv ? [
    { label: "Saúde da empresa", value: `${health?.score ?? 0}/100`, sub: health?.grade, color: "text-violet-700", icon: BrainCircuit },
    { label: "Receita do mês", value: fmtBRL(fin.receita_total), sub: `Hoje: ${fmtBRL(fin.receita_hoje)}`, color: "text-emerald-700", icon: TrendingUp },
    { label: "A receber", value: fmtBRL(fin.a_receber), sub: fin.inadimplencia > 0 ? `Vencido: ${fmtBRL(fin.inadimplencia)}` : "Tudo em dia", color: fin.inadimplencia > 0 ? "text-amber-700" : "text-emerald-700", icon: TrendingDown },
    { label: "Saldo em caixa", value: fmtBRL(fin.saldo_caixa), sub: `A pagar: ${fmtBRL(fin.a_pagar)}`, color: fin.saldo_caixa >= 0 ? "text-blue-700" : "text-red-700", icon: Target },
    { label: "Vendas (30 dias)", value: `${sal.total_vendas}`, sub: `Ticket médio: ${fmtBRL(sal.ticket_medio)}`, color: "text-indigo-700", icon: TrendingUp },
    { label: "Ticket médio", value: fmtBRL(sal.ticket_medio), sub: `${sal.vendas_hoje} vendas hoje`, color: "text-slate-700", icon: TrendingUp },
    { label: "Sem estoque", value: `${inv.sem_estoque} produtos`, sub: `${inv.estoque_baixo} com estoque crítico`, color: inv.sem_estoque > 10 ? "text-red-700" : "text-amber-700", icon: Package },
    { label: "Melhor vendedor", value: sal.top_vendedor !== "—" ? sal.top_vendedor : "—", sub: `Produto: ${sal.top_produto}`, color: "text-teal-700", icon: Users },
    { label: "Estoque parado", value: `${inv.parados_30d} itens`, sub: `Valor: ${fmtBRL(inv.valor_parado)}`, color: inv.valor_parado > 5000 ? "text-orange-700" : "text-slate-600", icon: Package },
  ] : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Target className="h-6 w-6 text-violet-600" />
            Dashboard CEO
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Visão executiva completa da empresa — últimos 30 dias</p>
        </div>
        <div className="flex gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate("/ai/insights")}>
            <Lightbulb className="h-4 w-4 mr-1" /> Ver Insights
          </Button>
          <Button variant="ghost" size="sm" onClick={() => navigate("/ai")}>
            <BrainCircuit className="h-4 w-4 mr-1" /> Copiloto
          </Button>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <div className="grid md:grid-cols-3 gap-6">
            {/* Health Score Gauge */}
            {health && (
              <Card className="md:col-span-1 flex flex-col items-center justify-center py-6">
                <ScoreGauge score={health.score} grade={health.grade} />

                {/* Breakdown mini */}
                <div className="w-full px-6 mt-2 space-y-1.5">
                  {Object.entries(health.breakdown).map(([key, val]) => {
                    const max: Record<string,number> = { vendas:20, recebimentos:15, inadimplencia:15, ruptura:10, parados:10, margem:15, connect:10 };
                    const pct = (val / (max[key] ?? 10)) * 100;
                    return (
                      <div key={key}>
                        <div className="flex justify-between text-[10px] text-muted-foreground mb-0.5">
                          <span className="capitalize">{key}</span>
                          <span>{val}/{max[key]}</span>
                        </div>
                        <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full rounded-full ${pct >= 70 ? "bg-emerald-500" : pct >= 40 ? "bg-amber-500" : "bg-red-500"}`}
                            style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Card>
            )}

            {/* KPI Grid */}
            <div className="md:col-span-2 grid grid-cols-2 gap-3">
              {KPIS.slice(1).map(({ label, value, sub, color, icon: Icon }) => (
                <Card key={label}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-1.5 mb-1">
                      <Icon className={`h-3.5 w-3.5 ${color}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className={`text-lg font-bold truncate ${color}`}>{value}</p>
                    {sub && <p className="text-[11px] text-muted-foreground truncate">{sub}</p>}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>

          {/* Strengths & Weaknesses */}
          {health && (
            <div className="grid md:grid-cols-2 gap-4">
              {health.strengths.length > 0 && (
                <Card className="border-emerald-200 bg-emerald-50">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm text-emerald-700 flex items-center gap-1.5">
                      <TrendingUp className="h-4 w-4" /> Pontos Fortes
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {health.strengths.map((s, i) => (
                        <li key={i} className="text-sm text-emerald-800 flex items-start gap-1.5">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                          {s}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}

              {health.weaknesses.length > 0 && (
                <Card className="border-amber-200 bg-amber-50">
                  <CardHeader className="pb-2 pt-4">
                    <CardTitle className="text-sm text-amber-700 flex items-center gap-1.5">
                      <AlertTriangle className="h-4 w-4" /> Pontos de Atenção
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ul className="space-y-1">
                      {health.weaknesses.map((w, i) => (
                        <li key={i} className="text-sm text-amber-800 flex items-start gap-1.5">
                          <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-amber-500 shrink-0" />
                          {w}
                        </li>
                      ))}
                    </ul>
                  </CardContent>
                </Card>
              )}
            </div>
          )}

          {/* Recommendation */}
          {health?.recommendation && (
            <Card className="border-violet-200 bg-violet-50">
              <CardContent className="pt-4 pb-4">
                <div className="flex items-start gap-3">
                  <BrainCircuit className="h-5 w-5 text-violet-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm font-semibold text-violet-800 mb-0.5">Recomendação da IA</p>
                    <p className="text-sm text-violet-700">{health.recommendation}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Quick nav */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              { to: "/ai", label: "Copiloto IA", icon: BrainCircuit, color: "text-violet-600" },
              { to: "/ai/insights", label: "Insights Automáticos", icon: Lightbulb, color: "text-amber-500" },
              { to: "/finance/fluxo-caixa", label: "Fluxo de Caixa", icon: TrendingUp, color: "text-blue-600" },
              { to: "/finance/dre", label: "DRE Gerencial", icon: Target, color: "text-indigo-600" },
            ].map(({ to, label, icon: Icon, color }) => (
              <button key={to} onClick={() => navigate(to)}
                className="flex items-center gap-2 p-3 rounded-xl border hover:bg-muted/60 hover:border-primary/30 transition-all text-left text-sm font-medium">
                <Icon className={`h-4 w-4 ${color}`} />
                {label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
