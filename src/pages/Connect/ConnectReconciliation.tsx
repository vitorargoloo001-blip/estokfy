import React, { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  CheckCircle2, XCircle, Search, RefreshCw, AlertCircle, Clock,
  ChevronDown, ChevronRight, RotateCcw, MessageSquare, Undo2,
  Phone, Package, FileText, User,
} from "lucide-react";
import { useReconciliation } from "@/hooks/useReconciliation";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface HistoryMatch {
  id: string;
  bank_transaction_id: string;
  transaction_date: string;
  transaction_amount: number;
  transaction_description: string | null;
  bank_name: string;
  method: string;
  sale_id: string | null;
  sale_date: string | null;
  sale_amount: number | null;
  customer_name: string | null;
  confidence_score: number;
  match_type: string;
  amount_difference: number | null;
  date_difference_days: number | null;
  match_reason: string | null;
  match_status: string;
  confirmed_at: string | null;
  confirmed_by_email: string | null;
  notes: string | null;
  updated_at: string;
}

interface SaleSearchResultV2 {
  id: string;
  sale_number: string;
  sale_date: string;
  net_total: number;
  customer_name: string;
  customer_phone: string;
  payment_status: string;
  amount_diff: number | null;
  compatibility_score: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão Crédito", debit_card: "Cartão Débito", money: "Dinheiro", other: "Outro",
};

const confidenceColor = (score: number) => {
  if (score >= 90) return "bg-green-100 text-green-800 border-green-300";
  if (score >= 70) return "bg-yellow-100 text-yellow-800 border-yellow-300";
  return "bg-orange-100 text-orange-800 border-orange-300";
};

const compatibilityColor = (score: number) => {
  if (score >= 80) return "text-green-700 border-green-300 bg-green-50";
  if (score >= 60) return "text-yellow-700 border-yellow-300 bg-yellow-50";
  return "text-orange-700 border-orange-300 bg-orange-50";
};

const MATCH_TYPE_LABEL: Record<string, string> = {
  deterministic: "Determinístico",
  heuristic: "Heurístico",
  fuzzy: "Fuzzy",
  manual: "Manual",
};

// ── Tab Pendentes ─────────────────────────────────────────────────────────

function PendentesTab() {
  const { profile } = useAuth();
  const {
    pendingMatches, loading, error,
    selectedIds, confirmMatch, ignoreMatch, bulkAction,
    toggleSelected, toggleSelectAll, clearSelection, loadPendingMatches,
  } = useReconciliation();

  const [confidenceFilter, setConfidenceFilter] = useState<"all" | "high" | "medium" | "low">("all");

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchTarget, setSearchTarget] = useState<{
    reconciliationId: string; amount: number; date: string;
  } | null>(null);
  const [searchMode, setSearchMode] = useState<"name" | "phone" | "product" | "obs">("name");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SaleSearchResultV2[]>([]);
  const [searching, setSearching] = useState(false);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const openSearch = (id: string, amount: number, date: string) => {
    setSearchTarget({ reconciliationId: id, amount, date });
    setSearchQuery("");
    setSearchResults([]);
    setSearchMode("name");
    setSearchOpen(true);
  };

  const runSearch = useCallback(async () => {
    if (!profile?.store_id || !searchTarget) return;
    setSearching(true);
    try {
      const params: Record<string, unknown> = {
        p_store_id: profile.store_id,
        p_amount: searchTarget.amount,
        p_date: searchTarget.date,
        p_limit: 15,
      };
      if (searchMode === "name")    params.p_name    = searchQuery || null;
      if (searchMode === "phone")   params.p_phone   = searchQuery || null;
      if (searchMode === "product") params.p_product = searchQuery || null;
      if (searchMode === "obs")     params.p_obs     = searchQuery || null;

      const { data, error: err } = await supabase.rpc("search_sales_for_match_v2", params);
      if (err) throw err;
      setSearchResults((data as SaleSearchResultV2[]) || []);
    } catch (e) {
      toast.error("Erro ao buscar vendas: " + String(e));
    } finally {
      setSearching(false);
    }
  }, [profile?.store_id, searchTarget, searchQuery, searchMode]);

  useEffect(() => {
    if (searchOpen && searchTarget) runSearch();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchOpen]);

  const confirmWithSale = async (saleId: string) => {
    if (!searchTarget) return;
    const ok = await confirmMatch(searchTarget.reconciliationId, saleId);
    if (ok) {
      toast.success("Conciliação manual confirmada!");
      setSearchOpen(false);
    } else {
      toast.error("Erro ao confirmar conciliação");
    }
  };

  const toggleExpand = (id: string) => {
    const next = new Set(expandedIds);
    next.has(id) ? next.delete(id) : next.add(id);
    setExpandedIds(next);
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <p className="text-red-700 text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={loadPendingMatches}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (pendingMatches.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-14 pb-14 text-center">
          <CheckCircle2 className="h-12 w-12 text-green-500 mx-auto mb-3" />
          <h3 className="font-semibold text-lg">Tudo conciliado!</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Nenhuma transação aguarda revisão no momento.
          </p>
        </CardContent>
      </Card>
    );
  }

  const filtered = pendingMatches.filter((m) => {
    if (confidenceFilter === "all")    return true;
    if (confidenceFilter === "high")   return m.confidence_score >= 85;
    if (confidenceFilter === "medium") return m.confidence_score >= 60 && m.confidence_score < 85;
    return m.confidence_score < 60;
  });

  const highCount   = pendingMatches.filter((m) => m.confidence_score >= 85).length;
  const mediumCount = pendingMatches.filter((m) => m.confidence_score >= 60 && m.confidence_score < 85).length;
  const lowCount    = pendingMatches.filter((m) => m.confidence_score < 60).length;

  const allSelected = selectedIds.size === filtered.length && filtered.length > 0;
  const someSelected = selectedIds.size > 0;

  return (
    <>
      {/* Filtro por confiança */}
      <div className="flex gap-1 flex-wrap">
        {([
          { key: "all",    label: `Todos (${pendingMatches.length})`,    cls: "" },
          { key: "high",   label: `Alta ≥85% (${highCount})`,            cls: "text-green-700 border-green-300" },
          { key: "medium", label: `Média 60–84% (${mediumCount})`,       cls: "text-yellow-700 border-yellow-300" },
          { key: "low",    label: `Baixa <60% (${lowCount})`,            cls: "text-orange-700 border-orange-300" },
        ] as const).map(({ key, label, cls }) => (
          <Button key={key} size="sm"
            variant={confidenceFilter === key ? "default" : "outline"}
            className={`h-7 text-xs ${confidenceFilter !== key ? cls : ""}`}
            onClick={() => { setConfidenceFilter(key); clearSelection(); }}>
            {label}
          </Button>
        ))}
      </div>

      {someSelected && (
        <div className="flex items-center gap-3 p-3 bg-primary/5 border border-primary/20 rounded-lg">
          <span className="text-sm font-medium">{selectedIds.size} selecionado(s)</span>
          <div className="flex gap-2 ml-auto flex-wrap">
            <Button
              size="sm"
              onClick={async () => {
                const ok = await bulkAction("confirm");
                if (ok) toast.success(`${selectedIds.size} conciliação(ões) confirmada(s)!`);
                else toast.error("Erro ao confirmar em lote");
              }}
            >
              <CheckCircle2 className="h-4 w-4 mr-1" />
              Confirmar selecionadas
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                const ok = await bulkAction("ignore");
                if (ok) toast.success("Transações ignoradas com sucesso");
                else toast.error("Erro ao ignorar em lote");
              }}
            >
              <XCircle className="h-4 w-4 mr-1" />
              Ignorar selecionadas
            </Button>
            <Button size="sm" variant="ghost" onClick={clearSelection}>Limpar</Button>
          </div>
        </div>
      )}

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center justify-between">
            <span>{filtered.length} transação(ões) aguardando revisão
              {confidenceFilter !== "all" && ` (filtro: ${confidenceFilter})`}
            </span>
            <Button variant="ghost" size="sm" onClick={loadPendingMatches}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="py-3 px-3 w-10">
                    <Checkbox checked={allSelected} onCheckedChange={toggleSelectAll} />
                  </th>
                  <th className="text-left py-3 px-3">Transação Bancária</th>
                  <th className="text-left py-3 px-3">Sugestão de Venda</th>
                  <th className="text-left py-3 px-3">Confiança</th>
                  <th className="text-right py-3 px-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const expanded = expandedIds.has(m.id);
                  return (
                    <React.Fragment key={m.id}>
                      <tr className="border-b hover:bg-muted/20 transition-colors">
                        <td className="py-3 px-3">
                          <Checkbox
                            checked={selectedIds.has(m.id)}
                            onCheckedChange={() => toggleSelected(m.id)}
                          />
                        </td>
                        <td className="py-3 px-3">
                          <div className="space-y-0.5">
                            <p className="font-medium">{fmtBRL(m.transaction_amount)}</p>
                            <p className="text-xs text-muted-foreground">
                              {fmtDate(m.transaction_date)} · {METHOD_LABELS[m.method] ?? m.method}
                            </p>
                            <p className="text-xs text-muted-foreground truncate max-w-[200px]">
                              {m.transaction_description || "Sem descrição"}
                            </p>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          {m.suggested_sale_id ? (
                            <div className="space-y-0.5">
                              <p className="font-medium">
                                {m.sale_amount != null ? fmtBRL(m.sale_amount) : "—"}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                {fmtDate(m.sale_date)} · {m.customer_name || "Sem cliente"}
                              </p>
                              {m.amount_difference != null && m.amount_difference > 0.01 && (
                                <p className="text-xs text-orange-600">
                                  Δ valor: {fmtBRL(m.amount_difference)}
                                </p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground italic">
                              Sem sugestão automática
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex flex-col gap-1">
                            <Badge
                              variant="outline"
                              className={`text-xs w-fit border ${confidenceColor(m.confidence_score)}`}
                            >
                              {m.confidence_score}%
                            </Badge>
                            <span className="text-xs text-muted-foreground">
                              {MATCH_TYPE_LABEL[m.match_type] ?? m.match_type}
                            </span>
                          </div>
                        </td>
                        <td className="py-3 px-3">
                          <div className="flex items-center justify-end gap-1 flex-wrap">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0"
                              onClick={() => toggleExpand(m.id)}
                            >
                              {expanded
                                ? <ChevronDown className="h-4 w-4" />
                                : <ChevronRight className="h-4 w-4" />}
                            </Button>
                            <Button
                              size="sm"
                              className="h-7 text-xs"
                              onClick={async () => {
                                const ok = await confirmMatch(m.id, m.suggested_sale_id ?? undefined);
                                if (ok) toast.success("Conciliação confirmada!");
                                else toast.error("Erro ao confirmar");
                              }}
                            >
                              <CheckCircle2 className="h-3 w-3 mr-1" />
                              Confirmar
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs"
                              onClick={() => openSearch(m.id, m.transaction_amount, m.transaction_date)}
                            >
                              <Search className="h-3 w-3 mr-1" />
                              Buscar
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 w-7 p-0 text-red-600 hover:bg-red-50"
                              onClick={async () => {
                                const ok = await ignoreMatch(m.id);
                                if (ok) toast.success("Transação ignorada");
                                else toast.error("Erro ao ignorar");
                              }}
                            >
                              <XCircle className="h-3 w-3" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {expanded && (
                        <tr className="border-b bg-muted/10">
                          <td colSpan={5} className="px-6 pb-3 pt-1">
                            <p className="text-xs text-muted-foreground">
                              <strong>Motivo:</strong>{" "}
                              {m.match_reason || "—"} ·{" "}
                              <strong>Banco:</strong> {m.bank_name}
                              {m.date_difference_days != null && (
                                <> · <strong>Δ dias:</strong> {m.date_difference_days}</>
                              )}
                            </p>
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

      {/* Dialog: Busca estendida */}
      <Dialog open={searchOpen} onOpenChange={setSearchOpen}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Buscar venda para conciliação manual</DialogTitle>
            <DialogDescription>
              Transação de{" "}
              <strong>{searchTarget ? fmtBRL(searchTarget.amount) : ""}</strong> em{" "}
              <strong>{searchTarget ? fmtDate(searchTarget.date) : ""}</strong>
            </DialogDescription>
          </DialogHeader>

          {/* Seletor de modo de busca */}
          <div className="flex gap-1 flex-wrap">
            {[
              { mode: "name" as const,    icon: <User className="h-3 w-3 mr-1" />,    label: "Nome" },
              { mode: "phone" as const,   icon: <Phone className="h-3 w-3 mr-1" />,   label: "Telefone" },
              { mode: "product" as const, icon: <Package className="h-3 w-3 mr-1" />, label: "Produto" },
              { mode: "obs" as const,     icon: <FileText className="h-3 w-3 mr-1" />, label: "Observação" },
            ].map(({ mode, icon, label }) => (
              <Button
                key={mode}
                size="sm"
                variant={searchMode === mode ? "default" : "outline"}
                className="h-7 text-xs"
                onClick={() => setSearchMode(mode)}
              >
                {icon}{label}
              </Button>
            ))}
          </div>

          <div className="flex gap-2">
            <Input
              placeholder={
                searchMode === "name"    ? "Nome do cliente..." :
                searchMode === "phone"   ? "Telefone (ex: 11999...)..." :
                searchMode === "product" ? "Nome do produto..." :
                "Observação da venda..."
              }
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
            />
            <Button onClick={runSearch} disabled={searching}>
              {searching
                ? <RefreshCw className="h-4 w-4 animate-spin" />
                : <Search className="h-4 w-4" />}
            </Button>
          </div>

          <div className="max-h-80 overflow-y-auto space-y-2 mt-1">
            {searchResults.length === 0 && !searching && (
              <p className="text-center text-sm text-muted-foreground py-6">
                Nenhuma venda encontrada. Altere os filtros ou pressione Enter.
              </p>
            )}
            {searchResults.map((sale) => (
              <div
                key={sale.id}
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-muted/30 cursor-pointer"
                onClick={() => confirmWithSale(sale.id)}
              >
                <div>
                  <p className="font-medium text-sm">{fmtBRL(sale.net_total)}</p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(sale.sale_date)} · {sale.customer_name}
                    {sale.customer_phone && (
                      <span className="ml-1 text-muted-foreground">· {sale.customer_phone}</span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {/* Score de compatibilidade */}
                  <Badge
                    variant="outline"
                    className={`text-xs border ${compatibilityColor(sale.compatibility_score)}`}
                  >
                    {sale.compatibility_score}% compat.
                  </Badge>
                  {sale.amount_diff != null && (
                    <Badge
                      variant="outline"
                      className={
                        sale.amount_diff < 0.01
                          ? "text-green-700 border-green-300"
                          : "text-orange-700 border-orange-300"
                      }
                    >
                      {sale.amount_diff < 0.01 ? "Valor exato" : `Δ ${fmtBRL(sale.amount_diff)}`}
                    </Badge>
                  )}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Tab Histórico ─────────────────────────────────────────────────────────

function HistoricoTab({ statusFilter }: { statusFilter: "confirmed" | "ignored" }) {
  const { profile } = useAuth();
  const [items, setItems] = useState<HistoryMatch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dialog: adicionar nota
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteTarget, setNoteTarget] = useState<{ id: string; current: string | null } | null>(null);
  const [noteText, setNoteText] = useState("");
  const [savingNote, setSavingNote] = useState(false);

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    try {
      const { data, error: err } = await supabase.rpc("get_reconciliation_history", {
        p_store_id: profile.store_id,
        p_status: statusFilter,
        p_limit: 200,
        p_offset: 0,
      });
      if (err) throw err;
      setItems((data as HistoryMatch[]) || []);
      setError(null);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const reopen = async (id: string) => {
    const { data, error: err } = await supabase.rpc("reopen_reconciliation", {
      p_reconciliation_id: id,
    });
    const rows = data as Array<{ success: boolean; message: string }> | null;
    if (err || !rows?.[0]?.success) {
      toast.error("Erro ao reabrir conciliação");
      return;
    }
    toast.success("Conciliação reaberta — voltou para pendentes");
    await load();
  };

  const undo = async (id: string) => {
    const { data, error: err } = await supabase.rpc("undo_reconciliation", {
      p_match_id: id,
    });
    const rows = data as Array<{ success: boolean; message: string }> | null;
    if (err || !rows?.[0]?.success) {
      toast.error(rows?.[0]?.message || "Erro ao desfazer conciliação");
      return;
    }
    toast.success("Conciliação desfeita — voltou para pendentes");
    await load();
  };

  const openNote = (id: string, current: string | null) => {
    setNoteTarget({ id, current });
    setNoteText(current || "");
    setNoteOpen(true);
  };

  const saveNote = async () => {
    if (!noteTarget) return;
    setSavingNote(true);
    try {
      const { data, error: err } = await supabase.rpc("add_reconciliation_note", {
        p_match_id: noteTarget.id,
        p_note: noteText,
      });
      const rows = data as Array<{ success: boolean; message: string }> | null;
      if (err || !rows?.[0]?.success) throw new Error(rows?.[0]?.message || "Erro");
      toast.success("Observação salva com sucesso");
      setNoteOpen(false);
      await load();
    } catch (e) {
      toast.error("Erro ao salvar observação: " + String(e));
    } finally {
      setSavingNote(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Card className="border-red-200 bg-red-50">
        <CardContent className="pt-6">
          <p className="text-red-700 text-sm">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={load}>
            Tentar novamente
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (items.length === 0) {
    return (
      <Card className="border-dashed">
        <CardContent className="pt-14 pb-14 text-center">
          {statusFilter === "confirmed"
            ? <CheckCircle2 className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />
            : <XCircle className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-40" />}
          <p className="text-sm text-muted-foreground">
            {statusFilter === "confirmed"
              ? "Nenhuma conciliação confirmada ainda."
              : "Nenhuma transação foi ignorada."}
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardContent className="pt-4">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-muted/40">
                  <th className="text-left py-3 px-3">Transação Bancária</th>
                  <th className="text-left py-3 px-3">Venda Vinculada</th>
                  <th className="text-left py-3 px-3">Confiança</th>
                  {statusFilter === "confirmed" && (
                    <th className="text-left py-3 px-3">Confirmado por</th>
                  )}
                  <th className="text-left py-3 px-3">
                    {statusFilter === "confirmed" ? "Confirmado em" : "Ignorado em"}
                  </th>
                  <th className="text-right py-3 px-3">Ações</th>
                </tr>
              </thead>
              <tbody>
                {items.map((m) => (
                  <tr key={m.id} className="border-b hover:bg-muted/20 transition-colors">
                    <td className="py-3 px-3">
                      <p className="font-medium">{fmtBRL(m.transaction_amount)}</p>
                      <p className="text-xs text-muted-foreground">
                        {fmtDate(m.transaction_date)} · {METHOD_LABELS[m.method] ?? m.method}
                      </p>
                      <p className="text-xs text-muted-foreground truncate max-w-[180px]">
                        {m.transaction_description || "—"}
                      </p>
                      {m.notes && (
                        <p className="text-xs text-blue-600 mt-0.5 italic truncate max-w-[180px]">
                          📝 {m.notes}
                        </p>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      {m.sale_id ? (
                        <>
                          <p className="font-medium">
                            {m.sale_amount != null ? fmtBRL(m.sale_amount) : "—"}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(m.sale_date)} · {m.customer_name || "—"}
                          </p>
                        </>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">
                          Sem venda vinculada
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-3">
                      <Badge
                        variant="outline"
                        className={`text-xs border ${confidenceColor(m.confidence_score)}`}
                      >
                        {m.confidence_score}% · {MATCH_TYPE_LABEL[m.match_type] ?? m.match_type}
                      </Badge>
                    </td>
                    {statusFilter === "confirmed" && (
                      <td className="py-3 px-3">
                        <p className="text-xs">{m.confirmed_by_email || "—"}</p>
                      </td>
                    )}
                    <td className="py-3 px-3">
                      <p className="text-xs">{fmtDateTime(m.updated_at)}</p>
                    </td>
                    <td className="py-3 px-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        {/* Adicionar observação */}
                        <Button
                          size="sm"
                          variant="ghost"
                          className="h-7 w-7 p-0 text-blue-600 hover:bg-blue-50"
                          title="Adicionar observação"
                          onClick={() => openNote(m.id, m.notes)}
                        >
                          <MessageSquare className="h-3 w-3" />
                        </Button>
                        {/* Reabrir (ignoradas) / Desfazer (confirmadas) */}
                        {statusFilter === "ignored" ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => reopen(m.id)}
                          >
                            <RotateCcw className="h-3 w-3 mr-1" />
                            Reabrir
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs text-amber-700 border-amber-300 hover:bg-amber-50"
                            onClick={() => undo(m.id)}
                          >
                            <Undo2 className="h-3 w-3 mr-1" />
                            Desfazer
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-3">{items.length} registro(s)</p>
        </CardContent>
      </Card>

      {/* Dialog: Nota */}
      <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageSquare className="h-4 w-4" />
              Observação da conciliação
            </DialogTitle>
            <DialogDescription>
              Esta nota ficará visível na linha da conciliação e na auditoria.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="Ex: Transação referente à venda de balcão, cliente solicitou parcelamento..."
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setNoteOpen(false)}>Cancelar</Button>
            <Button onClick={saveNote} disabled={savingNote}>
              {savingNote ? <RefreshCw className="h-4 w-4 animate-spin mr-1" /> : null}
              Salvar observação
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Componente principal ──────────────────────────────────────────────────

export default function ConnectReconciliationPage() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Conciliação Bancária</h2>
        <p className="text-muted-foreground mt-1">
          Revise, confirme, anote ou desfaça correspondências entre transações bancárias e vendas
        </p>
      </div>

      <Tabs defaultValue="pendentes">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="pendentes" className="flex items-center gap-1.5">
            <Clock className="h-4 w-4" />
            Pendentes
          </TabsTrigger>
          <TabsTrigger value="confirmadas" className="flex items-center gap-1.5">
            <CheckCircle2 className="h-4 w-4" />
            Confirmadas
          </TabsTrigger>
          <TabsTrigger value="ignoradas" className="flex items-center gap-1.5">
            <AlertCircle className="h-4 w-4" />
            Ignoradas
          </TabsTrigger>
        </TabsList>

        <TabsContent value="pendentes" className="space-y-4 mt-4">
          <PendentesTab />
        </TabsContent>

        <TabsContent value="confirmadas" className="mt-4">
          <HistoricoTab statusFilter="confirmed" />
        </TabsContent>

        <TabsContent value="ignoradas" className="mt-4">
          <HistoricoTab statusFilter="ignored" />
        </TabsContent>
      </Tabs>
    </div>
  );
}
