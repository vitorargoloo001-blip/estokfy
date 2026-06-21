import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import {
  TrendingUp, RefreshCw, CheckCircle2, Clock, AlertCircle, Banknote,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────

interface ForecastResult {
  confirmed_today: number;
  probable_today:  number;
  at_risk_today:   number;
  confirmed_7d:    number;
  probable_7d:     number;
  at_risk_7d:      number;
  confirmed_30d:   number;
  probable_30d:    number;
  at_risk_30d:     number;
  daily_forecast:  DailyPoint[];
}

interface DailyPoint {
  date:      string;
  confirmed: number;
  probable:  number;
  at_risk:   number;
  source:    "historical" | "forecast";
}

// ── Helpers ───────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

// ── Componente principal ──────────────────────────────────────────────

export default function CashFlowForecastPage() {
  const { profile }  = useAuth();
  const [data, setData]     = useState<ForecastResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod]   = useState<"today" | "7d" | "30d">("7d");

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const { data: rows, error } = await supabase.rpc("get_cashflow_forecast", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      const row = Array.isArray(rows) ? rows[0] : rows;
      if (row) {
        setData({
          ...row,
          daily_forecast: typeof row.daily_forecast === "string"
            ? JSON.parse(row.daily_forecast)
            : (row.daily_forecast ?? []),
        } as ForecastResult);
      }
    } catch (e) {
      toast.error("Erro ao carregar previsão: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

  useEffect(() => { load(); }, [load]);

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  const p   = period;
  const cfg = {
    today: { confirmed: data?.confirmed_today ?? 0, probable: data?.probable_today ?? 0, at_risk: data?.at_risk_today ?? 0, label: "Hoje" },
    "7d":  { confirmed: data?.confirmed_7d   ?? 0, probable: data?.probable_7d   ?? 0, at_risk: data?.at_risk_7d   ?? 0, label: "7 dias" },
    "30d": { confirmed: data?.confirmed_30d  ?? 0, probable: data?.probable_30d  ?? 0, at_risk: data?.at_risk_30d  ?? 0, label: "30 dias" },
  }[p];

  const total = cfg.confirmed + cfg.probable;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <TrendingUp className="h-6 w-6 text-blue-600" />
            Previsão de Fluxo de Caixa
          </h2>
          <p className="text-muted-foreground mt-1">
            Projeção baseada em transações conciliadas e vendas pendentes.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
        </div>
      </div>

      {/* Seletor de período */}
      <div className="flex gap-2">
        {(["today", "7d", "30d"] as const).map((per) => (
          <Button key={per} size="sm"
            variant={period === per ? "default" : "outline"}
            className="h-8"
            onClick={() => setPeriod(per)}>
            {per === "today" ? "Hoje" : per === "7d" ? "7 dias" : "30 dias"}
          </Button>
        ))}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="border-green-200">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <CheckCircle2 className="h-8 w-8 text-green-600 mt-1" />
              <div>
                <p className="text-xs text-muted-foreground">Confirmado — {cfg.label}</p>
                <p className="text-2xl font-bold text-green-700">{fmtBRL(cfg.confirmed)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Transações bancárias conciliadas</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-blue-200">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <Clock className="h-8 w-8 text-blue-600 mt-1" />
              <div>
                <p className="text-xs text-muted-foreground">Provável — {cfg.label}</p>
                <p className="text-2xl font-bold text-blue-700">{fmtBRL(cfg.probable)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Vendas pendentes + projeção</p>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-red-200">
          <CardContent className="pt-5 pb-5">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-8 w-8 text-red-500 mt-1" />
              <div>
                <p className="text-xs text-muted-foreground">Em risco — {cfg.label}</p>
                <p className="text-2xl font-bold text-red-600">{fmtBRL(cfg.at_risk)}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Vendas vencidas sem pagamento</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Total estimado */}
      <Card className="bg-gradient-to-r from-blue-50 to-green-50 border-blue-200">
        <CardContent className="pt-5 pb-5">
          <div className="flex items-center gap-4">
            <Banknote className="h-10 w-10 text-blue-600" />
            <div>
              <p className="text-xs text-muted-foreground">Total estimado ({cfg.label})</p>
              <p className="text-3xl font-bold text-blue-800">{fmtBRL(total)}</p>
            </div>
            {cfg.at_risk > 0 && (
              <div className="ml-auto text-right">
                <p className="text-xs text-red-600 font-medium">⚠ {fmtBRL(cfg.at_risk)} em risco</p>
                <p className="text-xs text-muted-foreground">
                  {total > 0 ? ((cfg.at_risk / total) * 100).toFixed(1) : 0}% do total
                </p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Gráfico */}
      {data && data.daily_forecast.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Série temporal — histórico e projeção</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={data.daily_forecast} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                <defs>
                  <linearGradient id="cfConfirmed" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#10b981" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="cfProbable" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#3b82f6" stopOpacity={0.35} />
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  tickFormatter={fmtDate}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`}
                />
                <Tooltip
                  labelFormatter={(l) => new Date(l).toLocaleDateString("pt-BR")}
                  formatter={(v: number, n: string) => [
                    fmtBRL(v),
                    n === "confirmed" ? "Confirmado" : n === "probable" ? "Provável" : "Em risco",
                  ]}
                />
                <Legend
                  formatter={(v) =>
                    v === "confirmed" ? "Confirmado" : v === "probable" ? "Provável" : "Em risco"
                  }
                />
                <Area type="monotone" dataKey="confirmed" stroke="#10b981"
                  fill="url(#cfConfirmed)" strokeWidth={2} />
                <Area type="monotone" dataKey="probable" stroke="#3b82f6"
                  fill="url(#cfProbable)" strokeWidth={2} strokeDasharray="4 2" />
                <Area type="monotone" dataKey="at_risk" stroke="#ef4444"
                  fill="none" strokeWidth={1.5} strokeDasharray="4 2" />
              </AreaChart>
            </ResponsiveContainer>
            <p className="text-xs text-muted-foreground text-center mt-2">
              Linha sólida = dados reais · Linha tracejada = projeção baseada em vendas pendentes
            </p>
          </CardContent>
        </Card>
      )}

      {/* Nota */}
      <Card className="bg-muted/30">
        <CardContent className="pt-4 pb-4">
          <p className="text-xs text-muted-foreground">
            <strong>Como é calculado:</strong>{" "}
            <em>Confirmado</em> = transações bancárias conciliadas no período.{" "}
            <em>Provável</em> = vendas com pagamento pendente + projeção baseada na média diária dos últimos 30 dias.{" "}
            <em>Em risco</em> = vendas com pagamento pendente vencidas (data passada, não recebidas).
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
