import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  RefreshCw, Filter, CheckCircle2, Link2, XCircle,
  Search, Tag, ChevronDown, ChevronRight,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────────

interface Divergence {
  id: string;
  transaction_date: string;
  amount: number;
  description: string | null;
  method: string;
  bank_name: string | null;
  divergence_type: string | null;
  divergence_reason: string | null;
  status: string;
  created_at: string;
}

interface SaleOption {
  id: string;
  sale_date: string;
  net_total: number;
  customer_name: string;
  amount_diff: number | null;
  compatibility_score: number;
}

// ── Constantes ───────────────────────────────────────────────────────────

const DIVERGENCE_TYPES: Record<string, { label: string; color: string; icon: string }> = {
  amount_different:     { label: "Valor diferente",          color: "bg-orange-100 text-orange-800 border-orange-300", icon: "💰" },
  date_different:       { label: "Data diferente",           color: "bg-blue-100 text-blue-800 border-blue-300",       icon: "📅" },
  customer_not_found:   { label: "Cliente não identificado", color: "bg-purple-100 text-purple-800 border-purple-300", icon: "👤" },
  duplicate_payment:    { label: "Pagamento duplicado",      color: "bg-red-100 text-red-800 border-red-300",          icon: "⚠️" },
  receipt_without_sale: { label: "Recebimento sem venda",    color: "bg-yellow-100 text-yellow-800 border-yellow-300", icon: "📥" },
  sale_without_receipt: { label: "Venda sem recebimento",    color: "bg-gray-100 text-gray-800 border-gray-300",       icon: "📤" },
};

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão Crédito", debit_card: "Cartão Débito", money: "Dinheiro", other: "Outro",
};

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

// ── Componente principal ──────────────────────────────────────────────────

export default function Discrepancies() {
  const { profile } = useAuth();
  const storeId = profile?.store_id;

  const [items, setItems]     = useState<Divergence[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState<string | null>(null);

  // Filtros
  const [filterType, setFilterType]           = useState("all");
  const [filterDateStart, setFilterDateStart] = useState("");
  const [filterDateEnd, setFilterDateEnd]     = useState("");
  const [filterAmountMin, setFilterAmountMin] = useState("");
  const [filterAmountMax, setFilterAmountMax] = useState("");
  const [filterCustomer, setFilterCustomer]   = useState("");

  // Expandir linhas
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  // Dialog: Classificar
  const [classifyOpen, setClassifyOpen]       = useState(false);
  const [classifyTarget, setClassifyTarget]   = useState<Divergence | null>(null);
  const [classifyType, setClassifyType]       = useState("");
  const [classifyReason, setClassifyReason]   = useState("");
  const [classifying, setClassifying]         = useState(false);

  // Dialog: Vincular
  const [linkOpen, setLinkOpen]         = useState(false);
  const [linkTarget, setLinkTarget]     = useState<Divergence | null>(null);
  const [saleSearch, setSaleSearch]     = useState("");
  const [saleResults, setSaleResults]   = useState<SaleOption[]>([]);
  const [searchingSales, setSearchingSales] = useState(false);
  const [linking, setLinking]           = useState(false);

  // Dialog: Ignorar
  const [ignoreOpen, setIgnoreOpen]     = useState(false);
  const [ignoreTarget, setIgnoreTarget] = useState<Divergence | null>(null);
  const [ignoreReason, setIgnoreReason] = useState("");
  const [ignoring, setIgnoring]         = useState(false);

  // ── Carregar divergências ─────────────────────────────────────────
  const load = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    setError(null);
    try {
      const params: Record<string, unknown> = {
        p_store_id: storeId,
        p_limit: 200,
        p_offset: 0,
      };
      if (filterType !== "all")  params.p_type_filter = filterType;
      if (filterDateStart)       params.p_date_start  = filterDateStart;
      if (filterDateEnd)         params.p_date_end    = filterDateEnd;
      if (filterAmountMin)       params.p_amount_min  = parseFloat(filterAmountMin);
      if (filterAmountMax)       params.p_amount_max  = parseFloat(filterAmountMax);
      if (filterCustomer.trim()) params.p_customer    = filterCustomer.trim();

      const { data, error: err } = await supabase.rpc("get_divergences_detailed", params);
      if (err) throw err;
      setItems((data as Divergence[]) || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [storeId, filterType, filterDateStart, filterDateEnd, filterAmountMin, filterAmountMax, filterCustomer]);

  useEffect(() => { load(); }, [load]);

  // Contadores por tipo para os cards
  const typeCounts = items.reduce<Record<string, number>>((acc, item) => {
    const t = item.divergence_type || "receipt_without_sale";
    acc[t] = (acc[t] || 0) + 1;
    return acc;
  }, {});

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedIds(next);
  };

  // ── Ação: Classificar ─────────────────────────────────────────────
  const openClassify = (item: Divergence) => {
    setClassifyTarget(item);
    setClassifyType(item.divergence_type || "");
    setClassifyReason(item.divergence_reason || "");
    setClassifyOpen(true);
  };

  const saveClassify = async () => {
    if (!classifyTarget || !classifyType) return;
    setClassifying(true);
    try {
      const { data, error: err } = await supabase.rpc("classify_divergence", {
        p_tx_id:  classifyTarget.id,
        p_type:   classifyType,
        p_reason: classifyReason || null,
      });
      const rows = data as Array<{ success: boolean; message: string }> | null;
      if (err || !rows?.[0]?.success) throw new Error(rows?.[0]?.message || "Erro");
      toast.success("Divergência classificada com sucesso");
      setClassifyOpen(false);
      await load();
    } catch (e) {
      toast.error("Erro: " + String(e));
    } finally {
      setClassifying(false);
    }
  };

  // ── Ação: Vincular manualmente ────────────────────────────────────
  const openLink = (item: Divergence) => {
    setLinkTarget(item);
    setSaleSearch("");
    setSaleResults([]);
    setLinkOpen(true);
  };

  const searchSales = useCallback(async () => {
    if (!storeId || !linkTarget) return;
    setSearchingSales(true);
    try {
      const { data, error: err } = await supabase.rpc("search_sales_for_match_v2", {
        p_store_id: storeId,
        p_amount:   linkTarget.amount,
        p_date:     linkTarget.transaction_date,
        p_name:     saleSearch || null,
        p_limit:    15,
      });
      if (err) throw err;
      setSaleResults((data as SaleOption[]) || []);
    } catch (e) {
      toast.error("Erro na busca: " + String(e));
    } finally {
      setSearchingSales(false);
    }
  }, [storeId, linkTarget, saleSearch]);

  useEffect(() => {
    if (linkOpen && linkTarget) searchSales();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkOpen]);

  const doLink = async (saleId: string) => {
    if (!linkTarget) return;
    setLinking(true);
    try {
      const { data, error: err } = await supabase.rpc("resolve_divergence_link", {
        p_tx_id:   linkTarget.id,
        p_sale_id: saleId,
      });
      const rows = data as Array<{ success: boolean; message: string }> | null;
      if (err || !rows?.[0]?.success) throw new Error(rows?.[0]?.message || "Erro");
      toast.success("Divergência resolvida! Transação vinculada à venda.");
      setLinkOpen(false);
      await load();
    } catch (e) {
      toast.error("Erro: " + String(e));
    } finally {
      setLinking(false);
    }
  };

  // ── Ação: Ignorar ─────────────────────────────────────────────────
  const openIgnore = (item: Divergence) => {
    setIgnoreTarget(item);
    setIgnoreReason("");
    setIgnoreOpen(true);
  };

  const doIgnore = async () => {
    if (!ignoreTarget) return;
    setIgnoring(true);
    try {
      const { data, error: err } = await supabase.rpc("ignore_divergence", {
        p_tx_id:  ignoreTarget.id,
        p_reason: ignoreReason || null,
      });
      const rows = data as Array<{ success: boolean; message: string }> | null;
      if (err || !rows?.[0]?.success) throw new Error(rows?.[0]?.message || "Erro");
      toast.success("Divergência ignorada com sucesso");
      setIgnoreOpen(false);
      await load();
    } catch (e) {
      toast.error("Erro: " + String(e));
    } finally {
      setIgnoring(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">Central de Divergências</h1>
        <p className="text-muted-foreground mt-1">
          Classifique, resolva ou ignore inconsistências entre transações bancárias e vendas
        </p>
      </div>

      {/* Cards de contagem por tipo */}
      {items.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {Object.entries(DIVERGENCE_TYPES).map(([type, meta]) => (
            <Card
              key={type}
              className={`cursor-pointer transition-all ${
                filterType === type ? "ring-2 ring-primary" : "hover:border-primary/40"
              }`}
              onClick={() => setFilterType(filterType === type ? "all" : type)}
            >
              <CardContent className="pt-3 pb-3">
                <div className="text-xl mb-1">{meta.icon}</div>
                <p className="text-xl font-bold">{typeCounts[type] || 0}</p>
                <p className="text-xs text-muted-foreground leading-tight">{meta.label}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Filtros */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Filter className="h-4 w-4" />
            Filtros
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-3">
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger>
                <SelectValue placeholder="Tipo de divergência" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Todos os tipos</SelectItem>
                {Object.entries(DIVERGENCE_TYPES).map(([type, meta]) => (
                  <SelectItem key={type} value={type}>
                    {meta.icon} {meta.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input type="date" value={filterDateStart} onChange={(e) => setFilterDateStart(e.target.value)} />
            <Input type="date" value={filterDateEnd}   onChange={(e) => setFilterDateEnd(e.target.value)} />
            <Input
              type="number"
              value={filterAmountMin}
              onChange={(e) => setFilterAmountMin(e.target.value)}
              placeholder="Valor mínimo"
            />
            <Input
              type="number"
              value={filterAmountMax}
              onChange={(e) => setFilterAmountMax(e.target.value)}
              placeholder="Valor máximo"
            />
          </div>
          <div className="flex gap-2">
            <Input
              value={filterCustomer}
              onChange={(e) => setFilterCustomer(e.target.value)}
              placeholder="Buscar na descrição..."
              className="max-w-xs"
              onKeyDown={(e) => e.key === "Enter" && load()}
            />
            <Button onClick={load} size="sm" disabled={loading}>
              {loading ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setFilterType("all");
                setFilterDateStart("");
                setFilterDateEnd("");
                setFilterAmountMin("");
                setFilterAmountMax("");
                setFilterCustomer("");
              }}
            >
              Limpar
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {items.length} divergência(s) · total:{" "}
            <strong>{fmtBRL(items.reduce((s, i) => s + (i.amount || 0), 0))}</strong>
          </p>
        </CardContent>
      </Card>

      {/* Carregando */}
      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {/* Erro */}
      {!loading && error && (
        <Card className="border-red-200 bg-red-50">
          <CardContent className="py-8 text-center space-y-3">
            <p className="text-sm text-red-700 break-words">{error}</p>
            <Button variant="outline" onClick={load}>Tentar novamente</Button>
          </CardContent>
        </Card>
      )}

      {/* Vazio */}
      {!loading && !error && items.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-14 text-center">
            <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
            <h3 className="font-semibold text-lg">Nenhuma divergência encontrada</h3>
            <p className="text-sm text-muted-foreground mt-1">
              {filterType !== "all" || filterDateStart || filterCustomer
                ? "Tente limpar os filtros para ver todas as divergências."
                : "Todas as transações estão conciliadas corretamente."}
            </p>
          </CardContent>
        </Card>
      )}

      {/* Tabela */}
      {!loading && !error && items.length > 0 && (
        <Card>
          <CardContent className="pt-4">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-muted/40">
                    <th className="w-8 py-3 px-3"></th>
                    <th className="text-left py-3 px-3">Transação</th>
                    <th className="text-left py-3 px-3">Método</th>
                    <th className="text-left py-3 px-3">Classificação</th>
                    <th className="text-left py-3 px-3">Data</th>
                    <th className="text-right py-3 px-3">Valor</th>
                    <th className="text-right py-3 px-3">Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => {
                    const meta     = item.divergence_type ? DIVERGENCE_TYPES[item.divergence_type] : null;
                    const expanded = expandedIds.has(item.id);
                    return (
                      <React.Fragment key={item.id}>
                        <tr className="border-b hover:bg-muted/20 transition-colors">
                          <td className="py-3 px-3">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-6 w-6 p-0"
                              onClick={() => toggleExpand(item.id)}
                            >
                              {expanded
                                ? <ChevronDown className="h-3 w-3" />
                                : <ChevronRight className="h-3 w-3" />}
                            </Button>
                          </td>
                          <td className="py-3 px-3">
                            <p className="font-medium truncate max-w-[200px]">
                              {item.description || "Sem descrição"}
                            </p>
                            <p className="text-xs text-muted-foreground">{item.bank_name || "—"}</p>
                          </td>
                          <td className="py-3 px-3">
                            <Badge variant="outline" className="text-xs">
                              {METHOD_LABELS[item.method] ?? item.method}
                            </Badge>
                          </td>
                          <td className="py-3 px-3">
                            {meta ? (
                              <Badge variant="outline" className={`text-xs border ${meta.color}`}>
                                {meta.icon} {meta.label}
                              </Badge>
                            ) : (
                              <span className="text-xs text-muted-foreground italic">Sem classificação</span>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <p className="text-xs">{fmtDate(item.transaction_date)}</p>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <p className="font-semibold text-sm">{fmtBRL(item.amount)}</p>
                          </td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs"
                                onClick={() => openClassify(item)}
                              >
                                <Tag className="h-3 w-3 mr-1" />
                                Classificar
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                className="h-7 text-xs text-green-700 border-green-300 hover:bg-green-50"
                                onClick={() => openLink(item)}
                              >
                                <Link2 className="h-3 w-3 mr-1" />
                                Vincular
                              </Button>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0 text-red-500 hover:bg-red-50"
                                onClick={() => openIgnore(item)}
                              >
                                <XCircle className="h-3 w-3" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                        {expanded && (
                          <tr className="border-b bg-muted/10">
                            <td colSpan={7} className="px-6 py-2">
                              <div className="space-y-1 text-xs text-muted-foreground">
                                {item.divergence_reason && (
                                  <p><strong>Motivo:</strong> {item.divergence_reason}</p>
                                )}
                                <p>
                                  <strong>ID:</strong>{" "}
                                  <span className="font-mono">{item.id}</span>
                                </p>
                                <p>
                                  <strong>Criada em:</strong>{" "}
                                  {new Date(item.created_at).toLocaleString("pt-BR")}
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Legenda */}
      {!loading && (
        <Card className="bg-muted/30">
          <CardContent className="pt-4 pb-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs text-muted-foreground">
              <div className="flex items-start gap-2">
                <Tag className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <strong className="text-foreground">Classificar</strong>
                  <p>Identifica o tipo da divergência para análise e relatórios.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Link2 className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <strong className="text-foreground">Vincular</strong>
                  <p>Conecta manualmente a transação a uma venda, resolvendo a divergência.</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                <div>
                  <strong className="text-foreground">Ignorar</strong>
                  <p>Remove da lista ativa. Ação registrada em auditoria.</p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────── */}

      {/* Classificar */}
      <Dialog open={classifyOpen} onOpenChange={setClassifyOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Tag className="h-4 w-4" />
              Classificar divergência
            </DialogTitle>
            <DialogDescription>
              {classifyTarget && `${fmtBRL(classifyTarget.amount)} · ${fmtDate(classifyTarget.transaction_date)}`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Tipo de divergência</label>
              <Select value={classifyType} onValueChange={setClassifyType}>
                <SelectTrigger>
                  <SelectValue placeholder="Selecione o tipo..." />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(DIVERGENCE_TYPES).map(([type, meta]) => (
                    <SelectItem key={type} value={type}>
                      {meta.icon} {meta.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm font-medium block mb-1.5">Motivo (opcional)</label>
              <Input
                value={classifyReason}
                onChange={(e) => setClassifyReason(e.target.value)}
                placeholder="Ex: Valor enviado incorretamente pelo cliente..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClassifyOpen(false)}>Cancelar</Button>
            <Button onClick={saveClassify} disabled={classifying || !classifyType}>
              {classifying && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              Salvar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Vincular */}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Link2 className="h-4 w-4" />
              Vincular manualmente a uma venda
            </DialogTitle>
            <DialogDescription>
              {linkTarget && (
                <>Transação de <strong>{fmtBRL(linkTarget.amount)}</strong> em <strong>{fmtDate(linkTarget.transaction_date)}</strong></>
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input
              placeholder="Buscar por nome do cliente..."
              value={saleSearch}
              onChange={(e) => setSaleSearch(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && searchSales()}
            />
            <Button onClick={searchSales} disabled={searchingSales}>
              {searchingSales ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            </Button>
          </div>
          <div className="max-h-72 overflow-y-auto space-y-2">
            {saleResults.length === 0 && !searchingSales && (
              <p className="text-center text-sm text-muted-foreground py-6">
                Nenhuma venda encontrada. Busque por nome do cliente.
              </p>
            )}
            {saleResults.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 cursor-pointer"
                onClick={() => !linking && doLink(sale.id)}
              >
                <div>
                  <p className="font-medium text-sm">{fmtBRL(sale.net_total)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(sale.sale_date)} · {sale.customer_name}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant="outline"
                    className={`text-xs border ${
                      sale.compatibility_score >= 80
                        ? "text-green-700 border-green-300 bg-green-50"
                        : sale.compatibility_score >= 60
                        ? "text-yellow-700 border-yellow-300 bg-yellow-50"
                        : "text-orange-700 border-orange-300"
                    }`}
                  >
                    {sale.compatibility_score}% compat.
                  </Badge>
                  {sale.amount_diff !== null && (
                    <Badge variant="outline" className="text-xs">
                      {sale.amount_diff < 0.01 ? "Valor exato" : `Δ ${fmtBRL(sale.amount_diff)}`}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      {/* Ignorar */}
      <Dialog open={ignoreOpen} onOpenChange={setIgnoreOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <XCircle className="h-4 w-4 text-red-500" />
              Ignorar divergência
            </DialogTitle>
            <DialogDescription>
              {ignoreTarget && `${fmtBRL(ignoreTarget.amount)} · ${ignoreTarget.description || "Sem descrição"}`}
            </DialogDescription>
          </DialogHeader>
          <div>
            <label className="text-sm font-medium block mb-1.5">Motivo (opcional)</label>
            <Input
              value={ignoreReason}
              onChange={(e) => setIgnoreReason(e.target.value)}
              placeholder="Ex: Depósito interno, transferência entre contas próprias..."
            />
            <p className="text-xs text-muted-foreground mt-2">
              A transação será removida da lista de divergências. A ação fica registrada em auditoria.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoreOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={doIgnore} disabled={ignoring}>
              {ignoring && <RefreshCw className="h-4 w-4 animate-spin mr-1" />}
              Confirmar ignorar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
