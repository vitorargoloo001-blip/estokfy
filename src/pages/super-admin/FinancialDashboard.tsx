import { useEffect, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2, DollarSign, Users, Store, Plug, AlertTriangle, Wrench } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import RequireMasterUser from "@/components/RequireMasterUser";

interface KPIs {
  total_revenue: number;
  total_received: number;
  total_pending: number;
  active_clients: number;
  active_stores: number;
  active_modules: number;
  overdue_payments: number;
  ongoing_implementations: number;
}

export default function FinancialDashboard() {
  const [kpis, setKpis] = useState<KPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadKPIs = async () => {
      try {
        const { data, error: err } = await supabase.rpc("get_financial_dashboard_kpis");
        if (err) {
          throw err;
        }
        if (data && data.length > 0) {
          setKpis(data[0]);
          setError(null);
        } else {
          setError("Sem dados disponíveis");
        }
      } catch (err) {
        console.error("Error loading KPIs:", err);
        setError(String(err));
      } finally {
        setLoading(false);
      }
    };

    loadKPIs();
  }, []);

  return (
    <RequireMasterUser>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Financeiro Impetus</h1>
          <p className="text-muted-foreground mt-2">
            Gestão comercial interna do Estokfy
          </p>
        </div>

        {loading ? (
          <div className="flex justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : kpis ? (
          <>
            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* Revenue */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Receita Total</CardTitle>
                  <DollarSign className="h-4 w-4 text-green-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    R$ {(kpis.total_revenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Valor total contratado
                  </p>
                </CardContent>
              </Card>

              {/* Received */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Receita Recebida</CardTitle>
                  <DollarSign className="h-4 w-4 text-blue-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    R$ {(kpis.total_received || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Valor já recebido
                  </p>
                </CardContent>
              </Card>

              {/* Pending */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Receita Pendente</CardTitle>
                  <DollarSign className="h-4 w-4 text-orange-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    R$ {(kpis.total_pending || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    A receber
                  </p>
                </CardContent>
              </Card>

              {/* Clients */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Clientes Ativos</CardTitle>
                  <Users className="h-4 w-4 text-purple-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpis.active_clients}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Clientes com contrato ativo
                  </p>
                </CardContent>
              </Card>

              {/* Stores */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Lojas Ativas</CardTitle>
                  <Store className="h-4 w-4 text-cyan-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpis.active_stores}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Lojas em operação
                  </p>
                </CardContent>
              </Card>

              {/* Modules */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Módulos Ativos</CardTitle>
                  <Plug className="h-4 w-4 text-indigo-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpis.active_modules}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Módulos implantados
                  </p>
                </CardContent>
              </Card>

              {/* Overdue */}
              <Card className="border-red-200 bg-red-50">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Parcelas Vencidas</CardTitle>
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold text-red-600">{kpis.overdue_payments}</div>
                  <p className="text-xs text-red-600 mt-1">
                    Requer atenção
                  </p>
                </CardContent>
              </Card>

              {/* Implementations */}
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">Implementações</CardTitle>
                  <Wrench className="h-4 w-4 text-amber-600" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">{kpis.ongoing_implementations}</div>
                  <p className="text-xs text-muted-foreground mt-1">
                    Em andamento
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Quick Actions — sub-páginas ainda não implementadas (sem links quebrados) */}
            <Card>
              <CardHeader>
                <CardTitle>Gestão comercial</CardTitle>
                <CardDescription>
                  Módulos de gestão detalhada (em breve)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {[
                    { title: 'Clientes', desc: 'Gerenciar clientes e lojas' },
                    { title: 'Contratos', desc: 'Contratos e módulos' },
                    { title: 'Pagamentos', desc: 'Parcelas e recebimentos' },
                  ].map((item) => (
                    <div key={item.title} className="p-4 rounded-lg border opacity-60 cursor-not-allowed">
                      <div className="flex items-center justify-between">
                        <div className="font-semibold text-sm">{item.title}</div>
                        <span className="text-[10px] rounded-full bg-muted px-2 py-0.5 text-muted-foreground">em breve</span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">{item.desc}</p>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </>
        ) : error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="pt-8">
              <div className="text-center space-y-3">
                <p className="text-red-900 font-semibold">Erro ao carregar KPIs</p>
                <p className="text-sm text-red-700">{error}</p>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-amber-200 bg-amber-50">
            <CardContent className="pt-8 text-center">
              <p className="text-amber-900">Nenhum dado disponível</p>
            </CardContent>
          </Card>
        )}
      </div>
    </RequireMasterUser>
  );
}
