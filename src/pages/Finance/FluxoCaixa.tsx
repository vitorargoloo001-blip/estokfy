import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { TrendingUp, TrendingDown, DollarSign, RefreshCw, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface CashflowPoint {
  day: string;
  confirmed_in: number;
  projected_in: number;
  total_out: number;
  daily_balance: number;
  running_balance: number;
}

type Period = "today" | "week" | "month" | "custom";

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDay = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

export default function FluxoCaixa() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const storeId = profile?.store_id;

  const [period, setPeriod] = useState<Period>("month");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [data, setData] = useState<CashflowPoint[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!storeId) return;
    if (period === "custom" && (!customStart || !customEnd)) return;
    setLoading(true);
    const { data: d, error } = await supabase.rpc("get_professional_cashflow", {
      p_store_id: storeId,
      p_period: period,
      p_start: customStart || null,
      p_end: customEnd || null,
    });
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar fluxo", variant: "destructive" }); return; }
    setData((d as CashflowPoint[]) ?? []);
  }, [storeId, period, customStart, customEnd]);

  useEffect(() => { load(); }, [load]);

  const totals = data.reduce(
    (acc, row) => ({
      confirmedIn: acc.confirmedIn + row.confirmed_in,
      projectedIn: acc.projectedIn + row.projected_in,
      out: acc.out + row.total_out,
    }),
    { confirmedIn: 0, projectedIn: 0, out: 0 }
  );
  const netBalance = totals.confirmedIn - totals.out;
  const lastBalance = data.length > 0 ? data[data.length - 1].running_balance : 0;

  const PERIODS: { key: Period; label: string }[] = [
    { key: "today", label: "Hoje" },
    { key: "week", label: "Semana" },
    { key: "month", label: "Mês" },
    { key: "custom", label: "Personalizado" },
  ];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <DollarSign className="h-6 w-6 text-blue-600" />
            Fluxo de Caixa
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Entradas confirmadas, previstas e saídas por período
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map(({ key, label }) => (
            <Button
              key={key}
              size="sm"
              variant={period === key ? "default" : "outline"}
              onClick={() => setPeriod(key)}
            >
              {label}
            </Button>
          ))}
          <Button variant="ghost" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Filtro personalizado */}
      {period === "custom" && (
        <Card className="p-4">
          <div className="flex gap-3 items-end flex-wrap">
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Data início</label>
              <Input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} className="w-40" />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1">Data fim</label>
              <Input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} className="w-40" />
            </div>
            <Button size="sm" onClick={load} disabled={!customStart || !customEnd}>
              Aplicar
            </Button>
          </div>
        </Card>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Entradas Confirmadas", value: fmtBRL(totals.confirmedIn), color: "text-emerald-600", icon: TrendingUp },
          { label: "Entradas Previstas", value: fmtBRL(totals.projectedIn), color: "text-blue-500", icon: TrendingUp },
          { label: "Saídas", value: fmtBRL(totals.out), color: "text-red-600", icon: TrendingDown },
          { label: "Saldo Líquido", value: fmtBRL(netBalance), color: netBalance >= 0 ? "text-emerald-700" : "text-red-700", icon: DollarSign },
        ].map(({ label, value, color, icon: Icon }) => (
          <Card key={label}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center gap-1.5 mb-1">
                <Icon className={`h-3.5 w-3.5 ${color}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className={`text-xl font-bold ${color}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Saldo acumulado */}
      <Card className={`border-l-4 ${lastBalance >= 0 ? "border-l-emerald-500" : "border-l-red-500"}`}>
        <CardContent className="pt-4 pb-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Saldo acumulado no período</span>
            <span className={`text-2xl font-bold ${lastBalance >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {fmtBRL(lastBalance)}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Gráfico */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : data.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p>Nenhum dado para o período selecionado.</p>
        </Card>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Entradas × Saídas por dia</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={260}>
                <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="cin" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="cout" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="proj" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.2} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={fmtDay} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip
                    labelFormatter={fmtDay}
                    formatter={(v: number, n: string) => [
                      fmtBRL(v),
                      n === "confirmed_in" ? "Confirmado" : n === "projected_in" ? "Previsto" : "Saída",
                    ]}
                  />
                  <Legend formatter={(v) => v === "confirmed_in" ? "Entrada Confirmada" : v === "projected_in" ? "Entrada Prevista" : "Saída"} />
                  <Area type="monotone" dataKey="confirmed_in" stroke="#10b981" fill="url(#cin)" strokeWidth={2} />
                  <Area type="monotone" dataKey="projected_in" stroke="#3b82f6" fill="url(#proj)" strokeWidth={1.5} strokeDasharray="4 2" />
                  <Area type="monotone" dataKey="total_out" stroke="#ef4444" fill="url(#cout)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Saldo acumulado</CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="bal" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#6366f1" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis dataKey="day" tick={{ fontSize: 11 }} tickFormatter={fmtDay} interval="preserveStartEnd" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
                  <Tooltip labelFormatter={fmtDay} formatter={(v: number) => [fmtBRL(v), "Saldo"]} />
                  <Area type="monotone" dataKey="running_balance" stroke="#6366f1" fill="url(#bal)" strokeWidth={2} name="running_balance" />
                </AreaChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          {/* Tabela diária (compacta) */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Detalhamento diário</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Data</th>
                      <th className="px-4 py-2 text-right">Confirmado</th>
                      <th className="px-4 py-2 text-right">Previsto</th>
                      <th className="px-4 py-2 text-right">Saída</th>
                      <th className="px-4 py-2 text-right">Saldo dia</th>
                      <th className="px-4 py-2 text-right">Acumulado</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.map((row) => (
                      <tr key={row.day} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2">{fmtDay(row.day)}</td>
                        <td className="px-4 py-2 text-right text-emerald-700">{row.confirmed_in > 0 ? fmtBRL(row.confirmed_in) : "—"}</td>
                        <td className="px-4 py-2 text-right text-blue-600">{row.projected_in > 0 ? fmtBRL(row.projected_in) : "—"}</td>
                        <td className="px-4 py-2 text-right text-red-600">{row.total_out > 0 ? fmtBRL(row.total_out) : "—"}</td>
                        <td className={`px-4 py-2 text-right font-medium ${row.daily_balance >= 0 ? "text-emerald-700" : "text-red-600"}`}>
                          {fmtBRL(row.daily_balance)}
                        </td>
                        <td className={`px-4 py-2 text-right font-semibold ${row.running_balance >= 0 ? "" : "text-red-600"}`}>
                          {fmtBRL(row.running_balance)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
