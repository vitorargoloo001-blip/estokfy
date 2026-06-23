import { useState, useEffect, useCallback } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Lightbulb, RefreshCw, Loader2, CheckCircle, XCircle, AlertTriangle, TrendingUp, Info, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";

interface Insight {
  id: string;
  type: string;
  severity: "critico" | "atencao" | "oportunidade" | "informativo";
  title: string;
  description: string;
  recommendation: string | null;
  status: string;
  created_at: string;
}

const SEVERITY_CONFIG: Record<string, { label: string; color: string; border: string; bg: string; icon: React.ElementType }> = {
  critico:      { label: "Crítico",     color: "text-red-700",    border: "border-l-red-500",    bg: "bg-red-50",    icon: XCircle },
  atencao:      { label: "Atenção",     color: "text-amber-700",  border: "border-l-amber-500",  bg: "bg-amber-50",  icon: AlertTriangle },
  oportunidade: { label: "Oportunidade",color: "text-emerald-700",border: "border-l-emerald-500",bg: "bg-emerald-50",icon: TrendingUp },
  informativo:  { label: "Informativo", color: "text-blue-700",   border: "border-l-blue-500",   bg: "bg-blue-50",   icon: Info },
};

export default function AIInsights() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const storeId = profile?.store_id;
  const role = profile?.role ?? "";

  const [insights, setInsights] = useState<Insight[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [filter, setFilter] = useState<string>("active");

  if (!["owner", "admin", "manager"].includes(role)) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <Card className="max-w-sm p-6 text-center">
          <Lightbulb className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
          <p className="font-medium">Acesso restrito</p>
          <p className="text-sm text-muted-foreground mt-1">Insights disponíveis para proprietários, administradores e gerentes.</p>
        </Card>
      </div>
    );
  }

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    const { data, error } = await supabase.rpc("get_ai_insights", {
      p_store_id: storeId,
      p_status: filter === "all" ? null : filter,
      p_limit: 30,
    });
    setLoading(false);
    if (error) { toast({ title: "Erro ao carregar insights", variant: "destructive" }); return; }
    setInsights((data as Insight[]) ?? []);
  }, [storeId, filter]);

  useEffect(() => { load(); }, [load]);

  async function generate() {
    if (!storeId) return;
    setGenerating(true);
    const { data, error } = await supabase.rpc("generate_ai_insights", { p_store_id: storeId });
    setGenerating(false);
    if (error) { toast({ title: "Erro ao gerar insights", variant: "destructive" }); return; }
    const result = data as { insights_gerados: number } | null;
    toast({ title: result?.insights_gerados ? `${result.insights_gerados} novo(s) insight(s) gerado(s)` : "Nenhum novo insight detectado" });
    load();
  }

  async function resolve(id: string, action: "resolved" | "dismissed") {
    if (!storeId) return;
    await supabase.rpc("resolve_ai_insight", { p_insight_id: id, p_store_id: storeId, p_action: action });
    toast({ title: action === "resolved" ? "Marcado como resolvido" : "Descartado" });
    load();
  }

  const critCount    = insights.filter((i) => i.severity === "critico").length;
  const atencaoCount = insights.filter((i) => i.severity === "atencao").length;
  const opCount      = insights.filter((i) => i.severity === "oportunidade").length;

  return (
    <div className="space-y-6 p-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <Lightbulb className="h-6 w-6 text-amber-500" />
            Insights da IA
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Análise automática dos dados da sua loja</p>
        </div>
        <div className="flex gap-2 items-center flex-wrap">
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-32"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="active">Ativos</SelectItem>
              <SelectItem value="resolved">Resolvidos</SelectItem>
              <SelectItem value="dismissed">Descartados</SelectItem>
              <SelectItem value="all">Todos</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="h-4 w-4" /></Button>
          <Button size="sm" onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Sparkles className="h-4 w-4 mr-1" />}
            {generating ? "Analisando..." : "Gerar Insights"}
          </Button>
        </div>
      </div>

      {/* Summary */}
      {filter === "active" && insights.length > 0 && (
        <div className="flex gap-3 flex-wrap">
          {critCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-red-700 bg-red-50 px-3 py-1.5 rounded-lg border border-red-200">
              <XCircle className="h-4 w-4" /> {critCount} crítico{critCount > 1 ? "s" : ""}
            </div>
          )}
          {atencaoCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-amber-700 bg-amber-50 px-3 py-1.5 rounded-lg border border-amber-200">
              <AlertTriangle className="h-4 w-4" /> {atencaoCount} atenção
            </div>
          )}
          {opCount > 0 && (
            <div className="flex items-center gap-1.5 text-sm font-medium text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-lg border border-emerald-200">
              <TrendingUp className="h-4 w-4" /> {opCount} oportunidade{opCount > 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}

      {/* List */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : insights.length === 0 ? (
        <Card className="p-10 text-center text-muted-foreground">
          <Lightbulb className="h-12 w-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium">Nenhum insight encontrado</p>
          <p className="text-sm mt-1">Clique em "Gerar Insights" para analisar sua loja agora.</p>
          <Button className="mt-4" size="sm" onClick={generate} disabled={generating}>
            <Sparkles className="h-4 w-4 mr-1" /> Analisar agora
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {insights.map((insight) => {
            const cfg = SEVERITY_CONFIG[insight.severity] ?? SEVERITY_CONFIG.informativo;
            const Icon = cfg.icon;
            return (
              <Card key={insight.id} className={`border-l-4 ${cfg.border} ${filter === "active" ? cfg.bg : ""}`}>
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 flex-1 min-w-0">
                      <Icon className={`h-5 w-5 mt-0.5 shrink-0 ${cfg.color}`} />
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <Badge variant="outline" className={`text-[10px] ${cfg.color}`}>
                            {cfg.label}
                          </Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(insight.created_at).toLocaleDateString("pt-BR", { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" })}
                          </span>
                        </div>
                        <p className="font-semibold text-sm">{insight.title}</p>
                        <p className="text-sm text-muted-foreground mt-0.5">{insight.description}</p>
                        {insight.recommendation && (
                          <p className={`text-sm mt-2 font-medium ${cfg.color}`}>
                            → {insight.recommendation}
                          </p>
                        )}
                      </div>
                    </div>
                    {insight.status === "active" && (
                      <div className="flex gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-100"
                          onClick={() => resolve(insight.id, "resolved")}>
                          <CheckCircle className="h-3.5 w-3.5 mr-1" /> Resolvido
                        </Button>
                        <Button variant="ghost" size="sm" className="h-8 text-xs text-muted-foreground"
                          onClick={() => resolve(insight.id, "dismissed")}>
                          Descartar
                        </Button>
                      </div>
                    )}
                    {insight.status !== "active" && (
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {insight.status === "resolved" ? "Resolvido" : "Descartado"}
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
