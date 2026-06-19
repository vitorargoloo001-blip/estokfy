import { useState, useCallback, useEffect } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { AlertCircle, CheckCircle2, Search, Zap, RefreshCw, Link2 } from "lucide-react";
import { useReconciliation } from "@/hooks/useReconciliation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface SaleResult {
  id: string;
  sale_number: string;
  sale_date: string;
  net_total: number;
  customer_name: string | null;
  payment_status: string;
  amount_diff: number | null;
}

interface SearchCtx {
  matchId: string;
  amount: number;
  date: string;
  description: string;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string) =>
  new Date(d).toLocaleDateString("pt-BR");

function ConfidenceBadge({ score }: { score: number }) {
  if (score >= 90) return <Badge className="bg-green-600 text-white">Muito Alta {score}%</Badge>;
  if (score >= 75) return <Badge className="bg-blue-600 text-white">Alta {score}%</Badge>;
  if (score >= 50) return <Badge variant="outline">Média {score}%</Badge>;
  return <Badge variant="secondary">Baixa {score}%</Badge>;
}

function SaleSearchDialog({
  ctx,
  onClose,
  onLink,
}: {
  ctx: SearchCtx;
  onClose: () => void;
  onLink: (saleId: string) => Promise<void>;
}) {
  const { profile } = useAuth();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SaleResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);

  const search = useCallback(async (q: string) => {
    if (!profile?.store_id) return;
    setSearching(true);
    try {
      const { data, error } = await supabase.rpc("connect_search_sales_for_match", {
        p_store_id: profile.store_id,
        p_amount: ctx.amount,
        p_date: ctx.date.slice(0, 10),
        p_query: q.trim() || null,
        p_limit: 15,
      });
      if (error) throw error;
      setResults((data as SaleResult[]) || []);
    } catch (e: any) {
      toast.error(e.message || "Erro na busca");
    } finally {
      setSearching(false);
    }
  }, [profile?.store_id, ctx.amount, ctx.date]);

  useEffect(() => { search(""); }, [search]);

  const handleQueryChange = (val: string) => {
    setQuery(val);
    search(val);
  };

  const handleLink = async (saleId: string) => {
    setLinking(saleId);
    try {
      await onLink(saleId);
      onClose();
    } finally {
      setLinking(null);
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Search className="h-5 w-5" />
            Procurar venda para conciliar
          </DialogTitle>
          <DialogDescription>
            Transação de {fmtBRL(ctx.amount)} em {fmtDate(ctx.date)}
            {ctx.description && <> — "{ctx.description}"</>}
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Buscar por nome do cliente..."
            value={query}
            onChange={e => handleQueryChange(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {searching ? (
            <div className="flex justify-center py-8">
              <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : results.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              Nenhuma venda encontrada com critérios próximos a este valor e data.
            </div>
          ) : (
            results.map(sale => (
              <div
                key={sale.id}
                className="flex items-center justify-between gap-4 p-3 border rounded-lg hover:bg-muted/40 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-sm">
                      {fmtBRL(sale.net_total)}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {fmtDate(sale.sale_date)}
                    </span>
                    {sale.amount_diff !== null && sale.amount_diff < 50 && (
                      <Badge variant="outline" className="text-xs">
                        {sale.amount_diff === 0 ? "Valor exato" : `Δ ${fmtBRL(sale.amount_diff)}`}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {sale.customer_name || "Cliente não identificado"}
                  </p>
                </div>
                <Button
                  size="sm"
                  onClick={() => handleLink(sale.id)}
                  disabled={linking === sale.id}
                  className="shrink-0"
                >
                  {linking === sale.id ? (
                    <RefreshCw className="h-3 w-3 animate-spin" />
                  ) : (
                    <><Link2 className="h-3 w-3 mr-1" />Vincular</>
                  )}
                </Button>
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function ConnectReconciliation() {
  const {
    pendingMatches,
    loading,
    selectedIds,
    confirmMatch,
    ignoreMatch,
    bulkAction,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
  } = useReconciliation();

  const [processingId, setProcessingId] = useState<string | null>(null);
  const [bulkProcessing, setBulkProcessing] = useState<string | null>(null);
  const [searchCtx, setSearchCtx] = useState<SearchCtx | null>(null);

  const handleConfirm = async (id: string, saleId?: string) => {
    setProcessingId(id);
    await confirmMatch(id, saleId);
    setProcessingId(null);
  };

  const handleIgnore = async (id: string) => {
    setProcessingId(id);
    await ignoreMatch(id);
    setProcessingId(null);
  };

  const handleBulkConfirm = async () => {
    setBulkProcessing("confirm");
    await bulkAction("confirm");
    setBulkProcessing(null);
  };

  const handleBulkIgnore = async () => {
    setBulkProcessing("ignore");
    await bulkAction("ignore");
    setBulkProcessing(null);
  };

  const openSearch = (match: typeof pendingMatches[0]) => {
    setSearchCtx({
      matchId: match.id,
      amount: match.transaction_amount,
      date: match.transaction_date,
      description: match.transaction_description || "",
    });
  };

  const handleLinkSale = async (saleId: string) => {
    if (!searchCtx) return;
    await handleConfirm(searchCtx.matchId, saleId);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Zap className="h-6 w-6" />
          Conciliação
        </h2>
        <p className="text-muted-foreground mt-1">
          {pendingMatches.length} transação(ões) pendente(s) de conciliação
        </p>
      </div>

      {/* Ações em lote */}
      {selectedIds.size > 0 && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 pb-4 flex items-center justify-between flex-wrap gap-3">
            <span className="text-sm">
              <strong>{selectedIds.size}</strong> selecionada(s)
            </span>
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={handleBulkConfirm}
                disabled={bulkProcessing !== null}
              >
                {bulkProcessing === "confirm" ? "Processando..." : "Conciliar lote"}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={handleBulkIgnore}
                disabled={bulkProcessing !== null}
              >
                {bulkProcessing === "ignore" ? "Processando..." : "Ignorar lote"}
              </Button>
              <Button variant="ghost" size="sm" onClick={clearSelection}>
                Limpar
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Selecionar tudo */}
      {pendingMatches.length > 0 && (
        <div className="flex items-center gap-2 p-4 border rounded-lg">
          <Checkbox
            checked={selectedIds.size === pendingMatches.length && pendingMatches.length > 0}
            onCheckedChange={toggleSelectAll}
          />
          <span className="text-sm">Selecionar tudo ({pendingMatches.length})</span>
        </div>
      )}

      {/* Lista de matches */}
      {loading ? (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      ) : pendingMatches.length === 0 ? (
        <Card className="border-green-200 bg-green-50">
          <CardContent className="pt-8 pb-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
            <h3 className="font-semibold text-green-900">Tudo conciliado!</h3>
            <p className="text-sm text-green-700 mt-2">
              Nenhuma transação pendente de conciliação.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pendingMatches.map(match => (
            <Card key={match.id} className="overflow-hidden">
              <CardContent className="pt-6">
                <div className="flex gap-4">
                  <Checkbox
                    checked={selectedIds.has(match.id)}
                    onCheckedChange={() => toggleSelected(match.id)}
                    className="mt-8"
                  />

                  <div className="flex-1 space-y-3 min-w-0">
                    {/* Valor + score */}
                    <div className="flex items-baseline gap-4 flex-wrap">
                      <div>
                        <p className="text-3xl font-bold text-green-600">
                          {match.transaction_amount > 0 ? "+" : ""}
                          {fmtBRL(match.transaction_amount)}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {fmtDate(match.transaction_date)} • {match.bank_name}
                        </p>
                      </div>
                      <div className="flex-1">
                        <div className="mb-1"><ConfidenceBadge score={match.confidence_score} /></div>
                        <p className="text-xs text-muted-foreground">
                          {match.match_type === "deterministic" && "Correspondência exata"}
                          {match.match_type === "heuristic" && "Correspondência por padrão"}
                          {match.match_type === "fuzzy" && "Correspondência aproximada"}
                          {match.match_type === "manual" && "Vinculação manual"}
                        </p>
                      </div>
                    </div>

                    {/* Venda sugerida */}
                    {match.suggested_sale_id ? (
                      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                        <p className="text-sm font-semibold text-blue-900">Venda sugerida</p>
                        <div className="grid grid-cols-3 gap-4 mt-2">
                          <div>
                            <p className="text-xs text-blue-600">Venda</p>
                            <p className="font-semibold text-sm">#{match.sale_number?.slice(0, 8)}</p>
                          </div>
                          <div>
                            <p className="text-xs text-blue-600">Cliente</p>
                            <p className="font-semibold text-sm">{match.customer_name || "—"}</p>
                          </div>
                          <div>
                            <p className="text-xs text-blue-600">Valor</p>
                            <p className="font-semibold text-sm">{fmtBRL(match.sale_amount || 0)}</p>
                          </div>
                        </div>
                        {match.amount_difference !== null && (
                          <p className="text-xs text-blue-600 mt-2">
                            Diferença: {fmtBRL(match.amount_difference)}
                            {match.date_difference_days !== null && (
                              <> • {match.date_difference_days} dia(s)</>
                            )}
                          </p>
                        )}
                      </div>
                    ) : (
                      <div className="bg-orange-50 border border-orange-200 rounded-lg p-3">
                        <p className="text-sm font-semibold text-orange-900 flex items-center gap-2">
                          <AlertCircle className="h-4 w-4 shrink-0" />
                          Nenhuma sugestão automática
                        </p>
                        <p className="text-xs text-orange-700 mt-1">
                          Use "Procurar" para vincular manualmente ou ignore esta transação.
                        </p>
                      </div>
                    )}

                    {/* Descrição da transação */}
                    {match.transaction_description && (
                      <p className="text-sm text-muted-foreground italic truncate">
                        "{match.transaction_description}"
                      </p>
                    )}
                  </div>

                  {/* Ações */}
                  <div className="flex flex-col gap-2 justify-center shrink-0">
                    <Button
                      size="sm"
                      onClick={() => handleConfirm(match.id, match.suggested_sale_id || undefined)}
                      disabled={processingId === match.id || !match.suggested_sale_id}
                    >
                      {processingId === match.id ? "..." : "Conciliar"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleIgnore(match.id)}
                      disabled={processingId === match.id}
                    >
                      {processingId === match.id ? "..." : "Ignorar"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-primary"
                      onClick={() => openSearch(match)}
                      disabled={processingId === match.id}
                    >
                      <Search className="h-4 w-4 mr-1" />
                      Procurar
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Dialog de busca manual */}
      {searchCtx && (
        <SaleSearchDialog
          ctx={searchCtx}
          onClose={() => setSearchCtx(null)}
          onLink={handleLinkSale}
        />
      )}
    </div>
  );
}
