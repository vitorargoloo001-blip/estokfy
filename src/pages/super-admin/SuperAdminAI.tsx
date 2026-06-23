import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { BrainCircuit, RefreshCw, Loader2, AlertTriangle, TrendingUp, Users, Shield } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

interface Overview {
  total_lojas: number;
  lojas_com_risco: number;
  insights_criticos: number;
  insights_atencao: number;
  top_lojas: { nome: string; receita_mes: number; insights_ativos: number }[];
  lojas_sem_acesso_7d: { nome: string; ultimo_acesso: string | null }[] | null;
}

const fmtBRL = (v: number) => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

export default function SuperAdminAI() {
  const { toast } = useToast();
  const { profile } = useAuth();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { data: d, error } = await supabase.rpc("super_admin_ai_overview");
    setLoading(false);
    if (error) {
      toast({ title: "Acesso negado ou erro", description: error.message, variant: "destructive" });
      return;
    }
    setData(d as Overview);
  }

  useEffect(() => { load(); }, []);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <BrainCircuit className="h-6 w-6 text-violet-600" />
            Super Admin — Visão IA
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Análise de saúde de todas as lojas</p>
        </div>
        <div className="flex gap-2 items-center">
          <Badge variant="outline" className="text-violet-700 border-violet-300">
            <Shield className="h-3 w-3 mr-1" /> Super Admin
          </Badge>
          <Button variant="outline" size="sm" onClick={load}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : !data ? (
        <Card className="p-8 text-center text-muted-foreground">
          <p>Sem dados disponíveis ou acesso negado.</p>
        </Card>
      ) : (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: "Total de lojas", value: data.total_lojas, color: "text-blue-700", icon: Users },
              { label: "Lojas com risco", value: data.lojas_com_risco, color: data.lojas_com_risco > 0 ? "text-red-700" : "text-emerald-700", icon: AlertTriangle },
              { label: "Insights críticos", value: data.insights_criticos, color: data.insights_criticos > 0 ? "text-red-700" : "text-emerald-700", icon: AlertTriangle },
              { label: "Insights atenção", value: data.insights_atencao, color: data.insights_atencao > 0 ? "text-amber-700" : "text-emerald-700", icon: TrendingUp },
            ].map(({ label, value, color, icon: Icon }) => (
              <Card key={label}>
                <CardContent className="pt-4 pb-3">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Icon className={`h-3.5 w-3.5 ${color}`} />
                    <span className="text-xs text-muted-foreground">{label}</span>
                  </div>
                  <p className={`text-3xl font-bold ${color}`}>{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          {/* Top Lojas */}
          {data.top_lojas && data.top_lojas.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-emerald-600" />
                  Lojas por Receita (30 dias)
                </CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2 text-left">#</th>
                      <th className="px-4 py-2 text-left">Loja</th>
                      <th className="px-4 py-2 text-right">Receita (30d)</th>
                      <th className="px-4 py-2 text-right">Insights ativos</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_lojas.map((loja, i) => (
                      <tr key={loja.nome} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-2 text-muted-foreground">{i + 1}</td>
                        <td className="px-4 py-2 font-medium">{loja.nome}</td>
                        <td className="px-4 py-2 text-right text-emerald-700 font-medium">{fmtBRL(loja.receita_mes)}</td>
                        <td className="px-4 py-2 text-right">
                          {loja.insights_ativos > 0 ? (
                            <Badge variant="secondary" className="text-amber-700">{loja.insights_ativos}</Badge>
                          ) : (
                            <span className="text-emerald-600 text-xs">✓</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>
          )}

          {/* Lojas sem acesso */}
          {data.lojas_sem_acesso_7d && data.lojas_sem_acesso_7d.length > 0 && (
            <Card className="border-amber-200">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-amber-700">
                  <AlertTriangle className="h-4 w-4" />
                  Lojas sem atividade recente (7+ dias)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {data.lojas_sem_acesso_7d.map((loja) => (
                    <div key={loja.nome} className="flex items-center justify-between py-1.5 border-b last:border-0">
                      <span className="text-sm font-medium">{loja.nome}</span>
                      <span className="text-xs text-muted-foreground">
                        {loja.ultimo_acesso
                          ? `Último acesso: ${new Date(loja.ultimo_acesso).toLocaleDateString("pt-BR")}`
                          : "Nunca acessou IA"}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
