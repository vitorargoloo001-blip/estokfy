import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from "recharts";
import {
  Building2, RefreshCw, CheckCircle2, AlertCircle, WifiOff, Zap, TrendingUp,
  CreditCard, Clock, Brain,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useSuperAdmin } from "@/hooks/useSuperAdmin";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────

interface StoreRow {
  store_id:             string;
  store_name:           string;
  banks_connected:      number;
  total_transactions:   number;
  total_received:       number;
  divergent_count:      number;
  pending_matches:      number;
  reconciliation_rate:  number;
  last_sync_at:         string | null;
  days_without_sync:    number | null;
  active_connect:       boolean;
  critical_alerts:      number;
  ai_insights_count:    number;
}

interface Summary {
  total_stores:          number;
  stores_with_banks:     number;
  stores_active_connect: number;
  total_banks_connected: number;
  total_transactions:    number;
  total_received:        number;
  total_divergent:       number;
  stores_without_sync:   number;
}

// ── Helpers ───────────────────────────────────────────────────────────

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(v ?? 0);

const fmtDT = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "Nunca";

// ── Componente ────────────────────────────────────────────────────────

export default function MasterDashboardPage() {
  const { isSuperAdmin, loading: saLoading } = useSuperAdmin();
  const [stores, setStores]   = useState<StoreRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [storesRes, summaryRes] = await Promise.all([
        supabase.rpc("get_master_connect_dashboard"),
        supabase.rpc("get_master_connect_summary"),
      ]);
      if (storesRes.error) throw storesRes.error;
      if (summaryRes.error) throw summaryRes.error;
      setStores((storesRes.data as StoreRow[]) ?? []);
      const s = Array.isArray(summaryRes.data) ? summaryRes.data[0] : summaryRes.data;
      setSummary(s as Summary ?? null);
    } catch (e) {
      toast.error("Erro ao carregar master dashboard: " + String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!saLoading && isSuperAdmin) load();
  }, [saLoading, isSuperAdmin, load]);

  if (saLoading) {
    return <div className="flex justify-center py-16"><div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" /></div>;
  }

  if (!isSuperAdmin) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-10 text-center">
          <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-3" />
          <p className="font-semibold text-red-800">Acesso restrito ao Super Admin</p>
        </CardContent>
      </Card>
    );
  }

  const chartData = stores.slice(0, 10).map((s) => ({
    name: s.store_name.length > 14 ? s.store_name.slice(0, 14) + "…" : s.store_name,
    Transações: s.total_transactions,
    Divergências: s.divergent_count,
  }));

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Zap className="h-6 w-6 text-indigo-600" />
            Dashboard Master — Impetus Connect
          </h2>
          <p className="text-muted-foreground mt-1">
            Visão consolidada de todas as lojas com Estokfy Connect ativo.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </Button>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {!loading && summary && (
        <>
          {/* KPIs globais */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Lojas com Connect</p>
                <p className="text-2xl font-bold text-indigo-600">{summary.stores_active_connect}</p>
                <p className="text-xs text-muted-foreground">de {summary.total_stores} lojas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Bancos conectados</p>
                <p className="text-2xl font-bold text-green-600">{summary.total_banks_connected}</p>
                <p className="text-xs text-muted-foreground">{summary.stores_with_banks} lojas ativas</p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Total movimentado</p>
                <p className="text-2xl font-bold text-blue-600">{fmtBRL(summary.total_received)}</p>
                <p className="text-xs text-muted-foreground">{summary.total_transactions} transações</p>
              </CardContent>
            </Card>
            <Card className={summary.stores_without_sync > 0 ? "border-red-200" : ""}>
              <CardContent className="pt-4 pb-4">
                <p className="text-xs text-muted-foreground">Sem sync recente</p>
                <p className={`text-2xl font-bold ${summary.stores_without_sync > 0 ? "text-red-600" : ""}`}>
                  {summary.stores_without_sync}
                </p>
                <p className="text-xs text-muted-foreground">lojas &gt;48h</p>
              </CardContent>
            </Card>
          </div>

          {/* Gráfico */}
          {chartData.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4" />
                  Transações vs Divergências por loja (top 10)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: -20 }}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="Transações" fill="#6366f1" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Divergências" fill="#ef4444" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          {/* Tabela de lojas */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                <Building2 className="h-4 w-4" />
                Lojas — detalhes
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {stores.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma loja com banco conectado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left py-3 px-3">Loja</th>
                        <th className="text-center py-3 px-3">Bancos</th>
                        <th className="text-right py-3 px-3">Movimentado</th>
                        <th className="text-center py-3 px-3">Taxa conc.</th>
                        <th className="text-center py-3 px-3">Diverg.</th>
                        <th className="text-center py-3 px-3">Pendentes</th>
                        <th className="text-center py-3 px-3">Alertas</th>
                        <th className="text-left py-3 px-3">Último sync</th>
                        <th className="text-center py-3 px-3">Connect</th>
                      </tr>
                    </thead>
                    <tbody>
                      {stores.map((s) => (
                        <tr key={s.store_id}
                          className={`border-b hover:bg-muted/20 transition-colors ${
                            s.critical_alerts > 0 ? "bg-red-50/30" :
                            (s.days_without_sync ?? 0) > 3 ? "bg-yellow-50/30" : ""
                          }`}>
                          <td className="py-3 px-3">
                            <p className="font-medium">{s.store_name}</p>
                            {s.ai_insights_count > 0 && (
                              <p className="text-xs flex items-center gap-1 text-purple-600">
                                <Brain className="h-3 w-3" />
                                {s.ai_insights_count} insight(s)
                              </p>
                            )}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <div className="flex items-center justify-center gap-1">
                              <CreditCard className="h-3.5 w-3.5 text-muted-foreground" />
                              {s.banks_connected}
                            </div>
                          </td>
                          <td className="py-3 px-3 text-right font-medium">
                            {fmtBRL(s.total_received)}
                          </td>
                          <td className="py-3 px-3 text-center">
                            <span className={`font-semibold ${
                              s.reconciliation_rate >= 80 ? "text-green-600" :
                              s.reconciliation_rate >= 60 ? "text-yellow-600" : "text-red-600"
                            }`}>
                              {s.reconciliation_rate}%
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">
                            {s.divergent_count > 0
                              ? <span className="text-red-600 font-semibold">{s.divergent_count}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {s.pending_matches > 0
                              ? <span className="text-yellow-600 font-semibold">{s.pending_matches}</span>
                              : <span className="text-muted-foreground">—</span>}
                          </td>
                          <td className="py-3 px-3 text-center">
                            {s.critical_alerts > 0
                              ? <Badge className="bg-red-100 text-red-800 text-xs">{s.critical_alerts}</Badge>
                              : <CheckCircle2 className="h-4 w-4 text-green-500 mx-auto" />}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-1">
                              {(s.days_without_sync ?? 0) > 3
                                ? <WifiOff className="h-3.5 w-3.5 text-red-500 shrink-0" />
                                : <CheckCircle2 className="h-3.5 w-3.5 text-green-500 shrink-0" />}
                              <span className="text-xs truncate max-w-[100px]">
                                {fmtDT(s.last_sync_at)}
                              </span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-center">
                            <Badge variant="outline" className={`text-xs ${
                              s.active_connect
                                ? "border-green-300 text-green-700 bg-green-50"
                                : "border-gray-300 text-gray-500"
                            }`}>
                              {s.active_connect ? "Ativo" : "Inativo"}
                            </Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
