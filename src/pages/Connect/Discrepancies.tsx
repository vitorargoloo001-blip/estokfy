import { useEffect, useState, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertCircle } from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

interface DivergentTx {
  id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  bank_name: string | null;
  status: string;
}

export default function Discrepancies() {
  const { profile } = useAuth();
  const storeId = profile?.store_id;
  const [items, setItems] = useState<DivergentTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fmtCurrency = (v: number) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v || 0);

  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      // Divergências = transações marcadas como "divergent" para a loja (status real, sem mock)
      const { data, error: err } = await supabase
        .from("bank_transactions")
        .select("id, transaction_date, amount, description, bank_name, status")
        .eq("store_id", storeId)
        .eq("status", "divergent")
        .order("transaction_date", { ascending: false })
        .limit(200);
      if (err) throw err;
      setItems((data as any as DivergentTx[]) || []);
    } catch (err: any) {
      setError(err?.message || String(err));
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Divergências</h1>
        <p className="text-muted-foreground mt-2">
          Inconsistências entre seu sistema e o banco (transações marcadas como divergentes)
        </p>
      </div>

      <div className="grid gap-4">
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : error ? (
          <Card className="border-red-200 bg-red-50">
            <CardContent className="py-8 text-center space-y-3">
              <p className="text-sm text-red-700 break-words">{error}</p>
              <Button variant="outline" onClick={load}>Tentar novamente</Button>
            </CardContent>
          </Card>
        ) : items.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <p className="text-muted-foreground">Nenhuma divergência detectada</p>
            </CardContent>
          </Card>
        ) : (
          items.map((item) => (
            <Card key={item.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-amber-500 flex-shrink-0" />
                    <div>
                      <CardTitle className="text-base">{fmtCurrency(item.amount)}</CardTitle>
                      <CardDescription>{item.description || "Sem descrição"}</CardDescription>
                    </div>
                  </div>
                  <Badge variant="destructive">Divergente</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <span className="text-sm text-muted-foreground">
                  {item.bank_name || "—"} • {new Date(item.transaction_date).toLocaleDateString("pt-BR")}
                </span>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sobre Divergências</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p>
            Divergências aparecem quando uma transação bancária não corresponde a nenhuma venda
            (ou os valores não batem). Tipos comuns:
          </p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li><strong>Falta no Banco:</strong> Venda registrada mas não recebida ainda</li>
            <li><strong>Falta no Sistema:</strong> Recebimento que não corresponde a nenhuma venda</li>
            <li><strong>Valor Diferente:</strong> Valores que não batem entre venda e recebimento</li>
            <li><strong>Possível Duplicação:</strong> Múltiplos recebimentos para mesma venda</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
