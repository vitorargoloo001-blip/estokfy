import { useState, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  FileText, Download, RefreshCw, TrendingUp, CheckCircle2,
  AlertCircle, Clock, XCircle,
} from "lucide-react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface ReportSummary {
  period_start: string;
  period_end: string;
  total_transactions: number;
  total_amount: number;
  reconciled_count: number;
  reconciled_amount: number;
  divergent_count: number;
  divergent_amount: number;
  pending_count: number;
  pending_amount: number;
  ignored_count: number;
  reconciliation_rate: number;
}

interface ReportTransaction {
  id: string;
  transaction_date: string;
  amount: number;
  method: string;
  description: string;
  bank_name: string;
  status: string;
  transaction_type: string;
  sale_id: string | null;
  customer_name: string;
  match_type: string;
  confidence_score: number | null;
  confirmed_at: string | null;
  confirmed_by_email: string | null;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_CONFIG: Record<
  string,
  { label: string; className: string }
> = {
  reconciled: { label: "Conciliada",  className: "bg-green-100 text-green-800" },
  divergent:  { label: "Divergente",  className: "bg-red-100 text-red-800" },
  pending:    { label: "Pendente",    className: "bg-yellow-100 text-yellow-800" },
  ignored:    { label: "Ignorada",    className: "bg-gray-100 text-gray-700" },
};

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão Crédito", debit_card: "Cartão Débito", other: "Outro",
};

function getPeriod(preset: string): { start: Date; end: Date } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();

  switch (preset) {
    case "current_month":
      return { start: new Date(y, m, 1), end: new Date(y, m + 1, 0) };
    case "last_month": {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      return { start: new Date(py, pm, 1), end: new Date(py, pm + 1, 0) };
    }
    case "quarter": {
      const qStart = new Date(y, Math.floor(m / 3) * 3, 1);
      const qEnd = new Date(y, Math.floor(m / 3) * 3 + 3, 0);
      return { start: qStart, end: qEnd };
    }
    case "last_30":
    default: {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      return { start, end };
    }
  }
}

function toISO(d: Date) {
  return d.toISOString().split("T")[0];
}

export default function ConnectReports() {
  const { profile } = useAuth();
  const [preset, setPreset] = useState("current_month");
  const [loading, setLoading] = useState(false);
  const [summary, setSummary] = useState<ReportSummary | null>(null);
  const [transactions, setTransactions] = useState<ReportTransaction[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    const { start, end } = getPeriod(preset);
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("get_reconciliation_report", {
        p_store_id: profile.store_id,
        p_start_date: toISO(start),
        p_end_date: toISO(end),
      });
      if (error) throw error;
      const d = data as { summary: ReportSummary; transactions: ReportTransaction[] };
      setSummary(d.summary);
      setTransactions(d.transactions || []);
    } catch (e) {
      toast.error("Erro ao carregar relatório: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id, preset]);

  const filtered = transactions.filter(
    (t) => statusFilter === "all" || t.status === statusFilter
  );

  // ── CSV Export ────────────────────────────────────────────────────────

  const exportCSV = () => {
    const headers = ["Data", "Valor", "Tipo", "Método", "Descrição", "Banco", "Status", "Cliente", "Tipo Match", "Confirmado em", "Confirmado por"];
    const rows = filtered.map((t) => [
      fmtDate(t.transaction_date),
      t.amount.toFixed(2).replace(".", ","),
      t.transaction_type === "credit" ? "Entrada" : "Saída",
      METHOD_LABELS[t.method] ?? t.method,
      t.description,
      t.bank_name,
      STATUS_CONFIG[t.status]?.label ?? t.status,
      t.customer_name,
      t.match_type,
      fmtDateTime(t.confirmed_at),
      t.confirmed_by_email ?? "",
    ]);
    const BOM = "﻿";
    const csv = BOM + [
      headers.join(";"),
      ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `relatorio-connect-${toISO(new Date())}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV exportado!");
  };

  // ── Excel Export ──────────────────────────────────────────────────────

  const exportExcel = async () => {
    if (!summary) return;
    try {
      const XLSX = await import("xlsx");
      const wb = XLSX.utils.book_new();

      // Sheet 1: Resumo
      const resumoData = [
        ["Relatório de Conciliação — Estokfy Connect"],
        ["Período:", `${fmtDate(summary.period_start)} a ${fmtDate(summary.period_end)}`],
        [],
        ["Indicador", "Qtd", "Valor"],
        ["Total de transações", summary.total_transactions, fmtBRL(summary.total_amount)],
        ["Conciliadas", summary.reconciled_count, fmtBRL(summary.reconciled_amount)],
        ["Divergentes", summary.divergent_count, fmtBRL(summary.divergent_amount)],
        ["Pendentes", summary.pending_count, fmtBRL(summary.pending_amount)],
        ["Ignoradas", summary.ignored_count, "—"],
        ["Taxa de conciliação", `${summary.reconciliation_rate}%`, ""],
      ];
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(resumoData), "Resumo");

      // Sheet 2: Todas as transações
      const txHeader = ["Data", "Valor", "Método", "Descrição", "Banco", "Status", "Cliente", "Tipo Match", "Conf %", "Confirmado em"];
      const txRows = transactions.map((t) => [
        fmtDate(t.transaction_date),
        t.amount,
        METHOD_LABELS[t.method] ?? t.method,
        t.description,
        t.bank_name,
        STATUS_CONFIG[t.status]?.label ?? t.status,
        t.customer_name,
        t.match_type,
        t.confidence_score ?? "",
        fmtDateTime(t.confirmed_at),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txHeader, ...txRows]), "Transações");

      // Sheet 3: Divergentes
      const divRows = transactions
        .filter((t) => t.status === "divergent")
        .map((t) => [
          fmtDate(t.transaction_date),
          t.amount,
          METHOD_LABELS[t.method] ?? t.method,
          t.description,
          t.bank_name,
        ]);
      XLSX.utils.book_append_sheet(
        wb,
        XLSX.utils.aoa_to_sheet([["Data", "Valor", "Método", "Descrição", "Banco"], ...divRows]),
        "Divergentes"
      );

      XLSX.writeFile(wb, `relatorio-connect-${toISO(new Date())}.xlsx`);
      toast.success("Excel exportado!");
    } catch (e) {
      toast.error("Erro ao exportar Excel");
    }
  };

  // ── PDF Export ────────────────────────────────────────────────────────

  const exportPDF = async () => {
    if (!summary) return;
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF();
      const pw = doc.internal.pageSize.getWidth();

      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      doc.text("Relatório de Conciliação", pw / 2, 18, { align: "center" });
      doc.setFontSize(10);
      doc.setFont("helvetica", "normal");
      doc.text("Estokfy Connect", pw / 2, 25, { align: "center" });
      doc.text(
        `Período: ${fmtDate(summary.period_start)} a ${fmtDate(summary.period_end)}`,
        pw / 2, 31, { align: "center" }
      );
      doc.text(`Gerado em: ${fmtDateTime(new Date().toISOString())}`, pw / 2, 37, { align: "center" });

      // KPIs
      autoTable(doc, {
        startY: 44,
        head: [["Indicador", "Quantidade", "Valor"]],
        body: [
          ["Total de transações", String(summary.total_transactions), fmtBRL(summary.total_amount)],
          ["✅ Conciliadas", String(summary.reconciled_count), fmtBRL(summary.reconciled_amount)],
          ["⚠️ Divergentes", String(summary.divergent_count), fmtBRL(summary.divergent_amount)],
          ["⏳ Pendentes", String(summary.pending_count), fmtBRL(summary.pending_amount)],
          ["—  Ignoradas", String(summary.ignored_count), "—"],
          ["Taxa de conciliação", `${summary.reconciliation_rate}%`, ""],
        ],
        headStyles: { fillColor: [37, 99, 235], textColor: 255 },
        columnStyles: { 2: { halign: "right" } },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 10 },
      });

      const lastY = (doc as any).lastAutoTable?.finalY ?? 110;

      // Tabela de transações
      autoTable(doc, {
        startY: lastY + 8,
        head: [["Data", "Valor", "Método", "Descrição", "Status", "Cliente"]],
        body: filtered.map((t) => [
          fmtDate(t.transaction_date),
          fmtBRL(t.amount),
          METHOD_LABELS[t.method] ?? t.method,
          (t.description ?? "—").slice(0, 30),
          STATUS_CONFIG[t.status]?.label ?? t.status,
          (t.customer_name ?? "—").slice(0, 20),
        ]),
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 8, cellPadding: 2 },
      });

      doc.save(`relatorio-connect-${toISO(new Date())}.pdf`);
      toast.success("PDF exportado!");
    } catch (e) {
      toast.error("Erro ao exportar PDF");
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Relatórios de Conciliação</h2>
        <p className="text-muted-foreground mt-1">
          Gere relatórios por período e exporte em PDF, Excel ou CSV
        </p>
      </div>

      {/* Controles */}
      <Card>
        <CardContent className="pt-4 pb-4">
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="text-sm font-medium block mb-1.5">Período</label>
              <Select value={preset} onValueChange={setPreset}>
                <SelectTrigger className="w-52">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current_month">Mês atual</SelectItem>
                  <SelectItem value="last_month">Mês anterior</SelectItem>
                  <SelectItem value="quarter">Trimestre atual</SelectItem>
                  <SelectItem value="last_30">Últimos 30 dias</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button onClick={load} disabled={loading}>
              {loading
                ? <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Carregando...</>
                : <><FileText className="h-4 w-4 mr-2" />Gerar relatório</>}
            </Button>
            {summary && (
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <Download className="h-4 w-4 mr-1" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportExcel}>
                  <Download className="h-4 w-4 mr-1" />
                  Excel
                </Button>
                <Button variant="outline" size="sm" onClick={exportPDF}>
                  <Download className="h-4 w-4 mr-1" />
                  PDF
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {!summary && !loading && (
        <Card className="border-dashed">
          <CardContent className="pt-12 pb-12 text-center">
            <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-3 opacity-30" />
            <p className="text-sm text-muted-foreground">
              Selecione o período e clique em "Gerar relatório"
            </p>
          </CardContent>
        </Card>
      )}

      {loading && (
        <div className="flex justify-center py-12">
          <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
        </div>
      )}

      {summary && !loading && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />
                  Total recebido
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold">{fmtBRL(summary.total_amount)}</p>
                <p className="text-xs text-muted-foreground">{summary.total_transactions} transações</p>
              </CardContent>
            </Card>

            <Card className="border-green-200">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  Conciliadas
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-xl font-bold text-green-600">{fmtBRL(summary.reconciled_amount)}</p>
                <p className="text-xs text-muted-foreground">{summary.reconciled_count} transações</p>
              </CardContent>
            </Card>

            <Card className={summary.divergent_count > 0 ? "border-red-200" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertCircle className="h-4 w-4 text-red-600" />
                  Divergentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${summary.divergent_count > 0 ? "text-red-600" : ""}`}>
                  {fmtBRL(summary.divergent_amount)}
                </p>
                <p className="text-xs text-muted-foreground">{summary.divergent_count} transações</p>
              </CardContent>
            </Card>

            <Card className={summary.pending_count > 0 ? "border-yellow-200" : ""}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Clock className="h-4 w-4 text-yellow-600" />
                  Pendentes
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${summary.pending_count > 0 ? "text-yellow-600" : ""}`}>
                  {fmtBRL(summary.pending_amount)}
                </p>
                <p className="text-xs text-muted-foreground">{summary.pending_count} transações</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Taxa</CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${
                  summary.reconciliation_rate >= 80 ? "text-green-600"
                  : summary.reconciliation_rate >= 50 ? "text-yellow-600"
                  : "text-red-600"
                }`}>
                  {summary.reconciliation_rate}%
                </p>
                <p className="text-xs text-muted-foreground">conciliação</p>
              </CardContent>
            </Card>
          </div>

          {/* Tabela */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center justify-between">
                <span>Transações do período</span>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="w-44 h-8 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Todos os status</SelectItem>
                    <SelectItem value="reconciled">Conciliadas</SelectItem>
                    <SelectItem value="divergent">Divergentes</SelectItem>
                    <SelectItem value="pending">Pendentes</SelectItem>
                    <SelectItem value="ignored">Ignoradas</SelectItem>
                  </SelectContent>
                </Select>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {filtered.length === 0 ? (
                <p className="text-center text-sm text-muted-foreground py-8">
                  Nenhuma transação encontrada para o filtro selecionado.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        <th className="text-left py-3 px-3">Data</th>
                        <th className="text-left py-3 px-3">Valor</th>
                        <th className="text-left py-3 px-3">Método</th>
                        <th className="text-left py-3 px-3">Descrição</th>
                        <th className="text-left py-3 px-3">Status</th>
                        <th className="text-left py-3 px-3">Cliente</th>
                        <th className="text-left py-3 px-3">Confirmado em</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((t) => (
                        <tr key={t.id} className="border-b hover:bg-muted/20 transition-colors">
                          <td className="py-2.5 px-3 text-xs">{fmtDate(t.transaction_date)}</td>
                          <td className="py-2.5 px-3 font-medium">{fmtBRL(t.amount)}</td>
                          <td className="py-2.5 px-3 text-xs">
                            {METHOD_LABELS[t.method] ?? t.method}
                          </td>
                          <td className="py-2.5 px-3 text-xs max-w-[200px] truncate">
                            {t.description || "—"}
                          </td>
                          <td className="py-2.5 px-3">
                            <Badge
                              variant="secondary"
                              className={`text-xs ${STATUS_CONFIG[t.status]?.className ?? ""}`}
                            >
                              {STATUS_CONFIG[t.status]?.label ?? t.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-xs">{t.customer_name || "—"}</td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground">
                            {fmtDateTime(t.confirmed_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">
                {filtered.length} transação(ões) exibida(s)
              </p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
