import { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { BarChart, Bar, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer, CartesianGrid } from "recharts";
import { FileText, TrendingUp, TrendingDown, Loader2, RefreshCw, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface DREData {
  period: string;
  period_month: number;
  period_year: number;
  receita_bruta: number;
  cogs: number;
  lucro_bruto: number;
  margem_bruta: number;
  despesas_operacionais: number;
  desp_breakdown: {
    impostos: number;
    pessoal: number;
    aluguel: number;
    marketing: number;
    outros: number;
  };
  lucro_operacional: number;
  lucro_liquido: number;
  margem_liquida: number;
}

interface DREComparison {
  current: DREData;
  previous: DREData;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`;

function Delta({ current, prev }: { current: number; prev: number }) {
  if (!prev) return null;
  const pct = ((current - prev) / Math.abs(prev)) * 100;
  const up = pct >= 0;
  return (
    <span className={`flex items-center gap-0.5 text-xs ${up ? "text-emerald-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function DRE() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const storeId = profile?.store_id;

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [comparison, setComparison] = useState<DREComparison | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_dre_comparison", {
      p_store_id: storeId,
      p_month: month,
      p_year: year,
    });
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar DRE", variant: "destructive" }); return; }
    setComparison(data as DREComparison);
  }, [storeId, month, year]);

  useEffect(() => { load(); }, [load]);

  const d = comparison?.current;
  const p = comparison?.previous;

  const MONTHS = [
    "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
    "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
  ];

  const years = [now.getFullYear(), now.getFullYear() - 1, now.getFullYear() - 2];

  const dreRows = d ? [
    { label: "Receita Bruta de Vendas",  value: d.receita_bruta,         prev: p?.receita_bruta, indent: 0, bold: true,  positive: true },
    { label: "(-) Custo dos Produtos",   value: -d.cogs,                 prev: p ? -p.cogs : 0,  indent: 1, bold: false, positive: false },
    { label: "= Lucro Bruto",            value: d.lucro_bruto,           prev: p?.lucro_bruto,   indent: 0, bold: true,  positive: d.lucro_bruto >= 0, isSub: true },
    { label: "  Margem Bruta",           value: null, pct: d.margem_bruta,                        indent: 1, bold: false, positive: true },
    { label: "(-) Impostos",             value: -d.desp_breakdown.impostos, prev: p ? -p.desp_breakdown.impostos : 0, indent: 2, bold: false, positive: false },
    { label: "(-) Pessoal",              value: -d.desp_breakdown.pessoal,  prev: p ? -p.desp_breakdown.pessoal : 0,  indent: 2, bold: false, positive: false },
    { label: "(-) Aluguel",              value: -d.desp_breakdown.aluguel,  prev: p ? -p.desp_breakdown.aluguel : 0,  indent: 2, bold: false, positive: false },
    { label: "(-) Marketing",            value: -d.desp_breakdown.marketing,prev: p ? -p.desp_breakdown.marketing : 0,indent: 2, bold: false, positive: false },
    { label: "(-) Outros",               value: -d.desp_breakdown.outros,   prev: p ? -p.desp_breakdown.outros : 0,   indent: 2, bold: false, positive: false },
    { label: "(-) Total Despesas Op.",   value: -d.despesas_operacionais, prev: p ? -p.despesas_operacionais : 0, indent: 1, bold: false, positive: false },
    { label: "= Lucro Operacional",      value: d.lucro_operacional,     prev: p?.lucro_operacional, indent: 0, bold: true, positive: d.lucro_operacional >= 0, isSub: true },
    { label: "= Lucro Líquido",          value: d.lucro_liquido,         prev: p?.lucro_liquido,     indent: 0, bold: true, positive: d.lucro_liquido >= 0, isSub: true, isTotal: true },
    { label: "  Margem Líquida",         value: null, pct: d.margem_liquida,                          indent: 1, bold: false, positive: true },
  ] : [];

  const chartData = d && p ? [
    { name: "Receita Bruta",  atual: d.receita_bruta, anterior: p.receita_bruta },
    { name: "Lucro Bruto",    atual: d.lucro_bruto,   anterior: p.lucro_bruto },
    { name: "Lucro Líquido",  atual: d.lucro_liquido, anterior: p.lucro_liquido },
    { name: "Despesas",       atual: d.despesas_operacionais, anterior: p.despesas_operacionais },
  ] : [];

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <FileText className="h-6 w-6 text-indigo-600" />
            DRE Gerencial
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Demonstrativo de Resultado do Exercício
          </p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
            <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
            <SelectContent>
              {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : d ? (
        <>
          {/* KPIs de destaque */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Receita Bruta",   value: d.receita_bruta,    prev: p?.receita_bruta,    color: "text-emerald-700" },
              { label: "Lucro Bruto",     value: d.lucro_bruto,      prev: p?.lucro_bruto,      color: d.lucro_bruto >= 0 ? "text-blue-700" : "text-red-600" },
              { label: "Lucro Líquido",   value: d.lucro_liquido,    prev: p?.lucro_liquido,    color: d.lucro_liquido >= 0 ? "text-indigo-700" : "text-red-600" },
              { label: "Margem Líquida",  value: `${d.margem_liquida}%`, prev: null,             color: d.margem_liquida >= 0 ? "text-slate-700" : "text-red-600" },
            ].map(({ label, value, prev, color }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <p className="text-xs text-muted-foreground mb-1">{label}</p>
                  <div className="flex items-end gap-2">
                    <span className={`text-xl font-bold ${color}`}>
                      {typeof value === "number" ? fmtBRL(value) : value}
                    </span>
                    {typeof value === "number" && prev != null && <Delta current={value} prev={prev} />}
                  </div>
                  {prev != null && typeof value === "number" && (
                    <p className="text-xs text-muted-foreground mt-0.5">Anterior: {fmtBRL(prev)}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* DRE Table */}
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Demonstrativo — {MONTHS[month - 1]}/{year}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">Conta</th>
                      <th className="px-4 py-2 text-right">Atual</th>
                      {p && <th className="px-4 py-2 text-right text-xs">Anterior</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {dreRows.map((row, i) => (
                      <tr
                        key={i}
                        className={`border-t ${row.isTotal ? "bg-slate-50 font-bold text-base" : row.isSub ? "bg-blue-50/40" : ""}`}
                      >
                        <td
                          className={`px-4 py-2 ${row.indent === 1 ? "pl-7" : row.indent === 2 ? "pl-10" : ""} ${row.bold ? "font-semibold" : ""}`}
                        >
                          {row.label}
                        </td>
                        <td className={`px-4 py-2 text-right ${row.value == null ? "text-muted-foreground" : row.value >= 0 && row.positive ? "text-emerald-700" : "text-red-600"} ${row.bold ? "font-semibold" : ""}`}>
                          {row.value != null
                            ? fmtBRL(row.value)
                            : row.pct != null
                            ? `${row.pct.toFixed(1)}%`
                            : "—"}
                        </td>
                        {p && (
                          <td className="px-4 py-2 text-right text-xs text-muted-foreground">
                            {row.prev != null ? fmtBRL(row.prev) : row.pct != null ? `${(row as any).pct?.toFixed(1) ?? "—"}%` : "—"}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            {/* Gráfico comparativo */}
            <Card className="md:col-span-1">
              <CardHeader>
                <CardTitle className="text-base">Atual × Anterior</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={320}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -10 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => `${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(v: number) => fmtBRL(v)} />
                    <Legend />
                    <Bar dataKey="atual" fill="#6366f1" name="Atual" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="anterior" fill="#94a3b8" name="Anterior" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Breakdown de despesas */}
          {d.despesas_operacionais > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Composição das Despesas Operacionais</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {[
                    { label: "Pessoal / Funcionários", value: d.desp_breakdown.pessoal, color: "bg-blue-500" },
                    { label: "Aluguel", value: d.desp_breakdown.aluguel, color: "bg-indigo-500" },
                    { label: "Impostos", value: d.desp_breakdown.impostos, color: "bg-red-500" },
                    { label: "Marketing", value: d.desp_breakdown.marketing, color: "bg-amber-500" },
                    { label: "Outros", value: d.desp_breakdown.outros, color: "bg-slate-400" },
                  ].filter(r => r.value > 0).map(({ label, value, color }) => {
                    const pct = d.despesas_operacionais > 0 ? (value / d.despesas_operacionais) * 100 : 0;
                    return (
                      <div key={label}>
                        <div className="flex justify-between text-sm mb-0.5">
                          <span>{label}</span>
                          <span className="font-medium">{fmtBRL(value)} <span className="text-muted-foreground text-xs">({pct.toFixed(0)}%)</span></span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div className={`h-full ${color} rounded-full`} style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card className="p-8 text-center text-muted-foreground">
          <p>Sem dados para o período selecionado.</p>
        </Card>
      )}
    </div>
  );
}
