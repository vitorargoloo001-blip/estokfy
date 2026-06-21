import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Brain, AlertCircle, XCircle, CheckCircle2, RefreshCw,
  TrendingDown, CreditCard, Users, Activity, Lightbulb, X, Zap,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────

interface AIInsight {
  id:           string;
  insight_type: string;
  severity:     string;
  title:        string;
  description:  string;
  suggestion:   string | null;
  data:         Record<string, unknown>;
  entity_type:  string | null;
  entity_id:    string | null;
  is_dismissed: boolean;
  created_at:   string;
}

// ── Config ────────────────────────────────────────────────────────────

const INSIGHT_CONFIG: Record<string, {
  icon: typeof Brain; label: string; color: string;
}> = {
  suspicious_receipt:   { icon: AlertCircle,   label: "Recebimento suspeito",     color: "text-orange-600" },
  duplicate_payment:    { icon: CreditCard,     label: "Pagamento duplicado",      color: "text-red-600"    },
  sales_drop:           { icon: TrendingDown,   label: "Queda nas vendas",         color: "text-yellow-600" },
  delinquency_increase: { icon: Users,          label: "Inadimplência",            color: "text-red-600"    },
  frequent_divergence:  { icon: Activity,       label: "Divergências frequentes",  color: "text-orange-600" },
  webhook_stale:        { icon: AlertCircle,    label: "Webhook parado",           color: "text-yellow-600" },
  bank_disconnected:    { icon: XCircle,        label: "Banco desconectado",       color: "text-red-600"    },
  high_pending_volume:  { icon: AlertCircle,    label: "Alto volume pendente",     color: "text-yellow-600" },
};

const SEVERITY_CONFIG: Record<string, { label: string; badgeCls: string; border: string }> = {
  critical: { label: "Crítico",  badgeCls: "bg-red-100 text-red-800 border-red-200",    border: "border-l-4 border-l-red-500"    },
  warning:  { label: "Atenção",  badgeCls: "bg-yellow-100 text-yellow-800 border-yellow-200", border: "border-l-4 border-l-yellow-500" },
  info:     { label: "Info",     badgeCls: "bg-blue-100 text-blue-800 border-blue-200", border: "border-l-4 border-l-blue-400"   },
};

const fmtDT = (d: string) =>
  new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });

// ── Componente principal ──────────────────────────────────────────────

export default function AIInsightsPage() {
  const { profile } = useAuth();
  const [insights, setInsights]   = useState<AIInsight[]>([]);
  const [loading, setLoading]     = useState(true);
  const [detecting, setDetecting] = useState(false);
  const [filterSev, setFilterSev] = useState<string>("all");
  const [showDismissed, setShowDismissed] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_ai_insights", {
        p_store_id:          profile.store_id,
        p_include_dismissed: showDismissed,
        p_severity:          filterSev === "all" ? null : filterSev,
        p_limit:             100,
      });
      if (error) throw error;
      setInsights((data as AIInsight[]) ?? []);
    } catch (e) {
      toast.error("Erro ao carregar insights: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id, filterSev, showDismissed]);

  useEffect(() => { load(); }, [load]);

  const detect = async () => {
    if (!profile?.store_id) return;
    setDetecting(true);
    try {
      const { data, error } = await supabase.rpc("detect_ai_insights", {
        p_store_id: profile.store_id,
      });
      if (error) throw error;
      const rows = data as Array<{ insights_created: number; insights_types: string[] }>;
      const ct   = rows?.[0]?.insights_created ?? 0;
      if (ct > 0) {
        toast.success(`${ct} novo(s) insight(s) detectado(s)!`);
      } else {
        toast.info("Nenhum novo insight detectado.");
      }
      await load();
    } catch (e) {
      toast.error("Erro na detecção: " + String(e));
    } finally {
      setDetecting(false);
    }
  };

  const dismiss = async (id: string) => {
    try {
      const { data, error } = await supabase.rpc("dismiss_ai_insight", { p_insight_id: id });
      const rows = data as Array<{ success: boolean; message: string }>;
      if (error || !rows?.[0]?.success) throw new Error(rows?.[0]?.message);
      setInsights((prev) => prev.filter((i) => i.id !== id));
    } catch (e) {
      toast.error("Erro ao dispensar: " + String(e));
    }
  };

  const dismissAll = async (severity?: string) => {
    if (!profile?.store_id) return;
    try {
      const { data, error } = await supabase.rpc("dismiss_all_ai_insights", {
        p_store_id: profile.store_id,
        p_severity: severity ?? null,
      });
      if (error) throw error;
      toast.success(`${data} insight(s) dispensado(s)`);
      await load();
    } catch (e) {
      toast.error("Erro ao dispensar todos: " + String(e));
    }
  };

  const criticalCount = insights.filter((i) => i.severity === "critical").length;
  const warningCount  = insights.filter((i) => i.severity === "warning").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-4">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Brain className="h-6 w-6 text-purple-600" />
            IA Financeira
          </h2>
          <p className="text-muted-foreground mt-1">
            Detecção automática de anomalias, riscos e oportunidades financeiras.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button variant="outline" size="sm" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? "animate-spin" : ""}`} />
            Atualizar
          </Button>
          <Button size="sm" onClick={detect} disabled={detecting}
            className="bg-purple-600 hover:bg-purple-700 text-white">
            {detecting
              ? <><RefreshCw className="h-4 w-4 mr-1 animate-spin" />Analisando...</>
              : <><Zap className="h-4 w-4 mr-1" />Detectar agora</>}
          </Button>
        </div>
      </div>

      {/* Resumo */}
      {(criticalCount > 0 || warningCount > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <XCircle className="h-8 w-8 text-red-600" />
              <div>
                <p className="text-2xl font-bold text-red-700">{criticalCount}</p>
                <p className="text-xs text-red-600">Crítico(s)</p>
              </div>
              {criticalCount > 0 && (
                <Button size="sm" variant="ghost" className="ml-auto text-xs text-red-600"
                  onClick={() => dismissAll("critical")}>
                  Dispensar todos
                </Button>
              )}
            </CardContent>
          </Card>
          <Card className="border-yellow-200 bg-yellow-50">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <AlertCircle className="h-8 w-8 text-yellow-600" />
              <div>
                <p className="text-2xl font-bold text-yellow-700">{warningCount}</p>
                <p className="text-xs text-yellow-600">Atenção</p>
              </div>
            </CardContent>
          </Card>
          <Card className="bg-muted/30">
            <CardContent className="pt-4 pb-4 flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold">{insights.length}</p>
                <p className="text-xs text-muted-foreground">Insights ativos</p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Filtros */}
      <div className="flex items-center gap-2 flex-wrap">
        {["all", "critical", "warning", "info"].map((f) => (
          <Button key={f} size="sm"
            variant={filterSev === f ? "default" : "outline"}
            className="h-7 text-xs"
            onClick={() => setFilterSev(f)}>
            {f === "all" ? "Todos" : f === "critical" ? "Críticos" : f === "warning" ? "Atenção" : "Info"}
          </Button>
        ))}
        <div className="ml-auto">
          <Button size="sm" variant="ghost" className="h-7 text-xs"
            onClick={() => setShowDismissed(!showDismissed)}>
            {showDismissed ? "Ocultar dispensados" : "Ver dispensados"}
          </Button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex justify-center py-10">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Estado vazio */}
      {!loading && insights.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 text-center space-y-3">
            <Brain className="h-12 w-12 mx-auto text-muted-foreground opacity-30" />
            <p className="font-semibold">Nenhum insight ativo</p>
            <p className="text-sm text-muted-foreground">
              Clique em <strong>Detectar agora</strong> para que a IA analise seus dados financeiros.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Insights */}
      {!loading && insights.map((insight) => {
        const cfg    = INSIGHT_CONFIG[insight.insight_type];
        const sevCfg = SEVERITY_CONFIG[insight.severity] ?? SEVERITY_CONFIG.info;
        const Icon   = cfg?.icon ?? Lightbulb;
        return (
          <Card key={insight.id}
            className={`${sevCfg.border} ${insight.is_dismissed ? "opacity-50" : ""}`}>
            <CardContent className="pt-4 pb-4">
              <div className="flex items-start gap-3">
                <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg?.color ?? "text-muted-foreground"}`} />
                <div className="flex-1 min-w-0 space-y-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-semibold text-sm">{insight.title}</p>
                    <Badge className={`text-xs border ${sevCfg.badgeCls}`}>
                      {sevCfg.label}
                    </Badge>
                    {cfg && (
                      <span className="text-xs text-muted-foreground">{cfg.label}</span>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {fmtDT(insight.created_at)}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground">{insight.description}</p>
                  {insight.suggestion && (
                    <div className="flex items-start gap-2 mt-2 p-2.5 bg-blue-50 border border-blue-200 rounded-md">
                      <Lightbulb className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
                      <p className="text-xs text-blue-800">{insight.suggestion}</p>
                    </div>
                  )}
                </div>
                {!insight.is_dismissed && (
                  <Button variant="ghost" size="sm"
                    className="h-7 w-7 p-0 shrink-0 text-muted-foreground hover:text-destructive"
                    onClick={() => dismiss(insight.id)}>
                    <X className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
