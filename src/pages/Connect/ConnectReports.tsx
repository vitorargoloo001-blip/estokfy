import { useState, useCallback, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import {
  FileText, Download, RefreshCw, TrendingUp, CheckCircle2,
  AlertCircle, Clock, XCircle, ArrowUpRight, ArrowDownRight, Minus,
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

interface MethodBreakdown {
  method: string;
  total_count: number;
  total_amount: number;
  reconciled_count: number;
  reconciled_amount: number;
  divergent_count: number;
  pending_count: number;
  reconciliation_rate: number;
}

interface MonthComparison {
  current_month_reconciled: number;
  current_month_total: number;
  current_month_divergent: number;
  prev_month_reconciled: number;
  prev_month_total: number;
  prev_month_divergent: number;
}

const fmtBRL = (v: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(v ?? 0);

const fmtDate = (d: string | null) =>
  d ? new Date(d).toLocaleDateString("pt-BR") : "—";

const fmtDateTime = (d: string | null) =>
  d ? new Date(d).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "—";

const STATUS_CONFIG: Record<string, { label: string; className: string }> = {
  reconciled: { label: "Conciliada",  className: "bg-green-100 text-green-800" },
  divergent:  { label: "Divergente",  className: "bg-red-100 text-red-800" },
  pending:    { label: "Pendente",    className: "bg-yellow-100 text-yellow-800" },
  ignored:    { label: "Ignorada",    className: "bg-gray-100 text-gray-700" },
};

const METHOD_LABELS: Record<string, string> = {
  pix: "PIX", ted: "TED", doc: "DOC", boleto: "Boleto",
  credit_card: "Cartão Créd.", debit_card: "Cartão Déb.", money: "Dinheiro", other: "Outro",
};

const METHOD_COLORS: Record<string, string> = {
  pix: "#10b981", ted: "#3b82f6", doc: "#8b5cf6", boleto: "#f59e0b",
  credit_card: "#ec4899", debit_card: "#06b6d4", money: "#84cc16", other: "#9ca3af",
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
    default: {
      const end = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      return { start, end };
    }
  }
}

function toISO(d: Date) { return d.toISOString().split("T")[0]; }

function DeltaBadge({ current, prev }: { current: number; prev: number }) {
  if (prev === 0) return <span className="text-xs text-muted-foreground">—</span>;
  const pct = ((current - prev) / prev) * 100;
  const up = pct >= 0;
  return (
    <span className={`text-xs font-medium flex items-center gap-0.5 ${up ? "text-green-600" : "text-red-600"}`}>
      {up ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
}

export default function ConnectReports() {
  const { profile } = useAuth();
  const [preset, setPreset]           = useState("current_month");
  const [loading, setLoading]         = useState(false);
  const [summary, setSummary]         = useState<ReportSummary | null>(null);
  const [transactions, setTransactions] = useState<ReportTransaction[]>([]);
  const [statusFilter, setStatusFilter] = useState("all");
  const [methodBreakdown, setMethodBreakdown] = useState<MethodBreakdown[]>([]);
  const [monthComp, setMonthComp]     = useState<MonthComparison | null>(null);

  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    const { start, end } = getPeriod(preset);
    setLoading(true);
    try {
      const [reportRes, methodRes, compRes] = await Promise.all([
        supabase.rpc("get_reconciliation_report", {
          p_store_id: profile.store_id,
          p_start_date: toISO(start),
          p_end_date: toISO(end),
        }),
        supabase.rpc("get_reconciliation_by_method", {
          p_store_id: profile.store_id,
          p_start_date: toISO(start),
          p_end_date: toISO(end),
        }),
        supabase.rpc("get_monthly_comparison", { p_store_id: profile.store_id }),
      ]);

      if (reportRes.error) throw reportRes.error;
      const d = reportRes.data as { summary: ReportSummary; transactions: ReportTransaction[] };
      setSummary(d.summary);
      setTransactions(d.transactions || []);
      setMethodBreakdown((methodRes.data as MethodBreakdown[]) || []);
      setMonthComp(compRes.data as MonthComparison | null);
    } catch (e) {
      toast.error("Erro ao carregar relatório: " + String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id, preset]);

  // Auto-load ao montar e ao trocar período
  useEffect(() => { load(); }, [load]);

  const filtered = transactions.filter(
    (t) => statusFilter === "all" || t.status === statusFilter
  );

  // ── CSV Export ────────────────────────────────────────────────────────
  const exportCSV = () => {
    const headers = ["Data","Valor","Tipo","Método","Descrição","Banco","Status","Cliente","Tipo Match","Confirmado em","Confirmado por"];
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
      ...rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")),
    ].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `relatorio-connect-${toISO(new Date())}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
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

      // Sheet 2: Breakdown por método
      if (methodBreakdown.length > 0) {
        const methodHeader = ["Método","Total Qtd","Total Valor","Conciliadas","Valor Conciliado","Divergentes","Pendentes","Taxa %"];
        const methodRows = methodBreakdown.map((m) => [
          METHOD_LABELS[m.method] ?? m.method,
          m.total_count, m.total_amount, m.reconciled_count,
          m.reconciled_amount, m.divergent_count, m.pending_count, m.reconciliation_rate,
        ]);
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([methodHeader, ...methodRows]), "Por Método");
      }

      // Sheet 3: Todas as transações
      const txHeader = ["Data","Valor","Método","Descrição","Banco","Status","Cliente","Tipo Match","Conf %","Confirmado em"];
      const txRows = transactions.map((t) => [
        fmtDate(t.transaction_date), t.amount, METHOD_LABELS[t.method] ?? t.method,
        t.description, t.bank_name, STATUS_CONFIG[t.status]?.label ?? t.status,
        t.customer_name, t.match_type, t.confidence_score ?? "", fmtDateTime(t.confirmed_at),
      ]);
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([txHeader, ...txRows]), "Transações");

      // Sheet 4: Divergentes
      const divRows = transactions.filter((t) => t.status === "divergent").map((t) => [
        fmtDate(t.transaction_date), t.amount, METHOD_LABELS[t.method] ?? t.method, t.description, t.bank_name,
      ]);
      XLSX.utils.book_append_sheet(wb,
        XLSX.utils.aoa_to_sheet([["Data","Valor","Método","Descrição","Banco"], ...divRows]), "Divergentes");

      XLSX.writeFile(wb, `relatorio-connect-${toISO(new Date())}.xlsx`);
      toast.success("Excel exportado!");
    } catch (e) { toast.error("Erro ao exportar Excel"); }
  };

  // ── PDF Export ────────────────────────────────────────────────────────
  const exportPDF = async () => {
    if (!summary) return;
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");
      const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
      const pw = doc.internal.pageSize.getWidth();
      const ph = doc.internal.pageSize.getHeight();
      const generatedAt = new Date().toLocaleString("pt-BR", { dateStyle: "long", timeStyle: "short" });

      // ── Capa ──────────────────────────────────────────────────────────
      // Fundo gradiente simulado (retângulo azul)
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, pw, 70, "F");
      doc.setFillColor(30, 64, 175);
      doc.rect(0, 55, pw, 15, "F");

      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(22);
      doc.text("Estokfy Connect", pw / 2, 24, { align: "center" });

      doc.setFontSize(13);
      doc.setFont("helvetica", "normal");
      doc.text("Relatório Executivo de Conciliação Bancária", pw / 2, 34, { align: "center" });

      doc.setFontSize(10);
      doc.text(`Período: ${fmtDate(summary.period_start)} a ${fmtDate(summary.period_end)}`, pw / 2, 45, { align: "center" });
      doc.text(`Gerado em: ${generatedAt}`, pw / 2, 52, { align: "center" });

      // Linha separadora dourada
      doc.setDrawColor(250, 204, 21);
      doc.setLineWidth(1);
      doc.line(14, 70, pw - 14, 70);

      // ── Resumo Executivo ──────────────────────────────────────────────
      doc.setTextColor(17, 24, 39);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("1. Resumo Executivo", 14, 82);

      const rate = summary.reconciliation_rate;
      const rateStatus = rate >= 80 ? "EXCELENTE" : rate >= 60 ? "REGULAR" : "CRÍTICO";
      const summaryLines = [
        `No período de ${fmtDate(summary.period_start)} a ${fmtDate(summary.period_end)}, foram identificadas`,
        `${summary.total_transactions} transações bancárias totalizando ${fmtBRL(summary.total_amount)}.`,
        ``,
        `A taxa de conciliação foi de ${rate}% (${rateStatus}), com ${summary.reconciled_count} transações`,
        `conciliadas (${fmtBRL(summary.reconciled_amount)}). Foram detectadas ${summary.divergent_count}`,
        `divergências (${fmtBRL(summary.divergent_amount)}) e ${summary.pending_count} transações permanecem`,
        `aguardando revisão manual.`,
      ];
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      let curY = 89;
      summaryLines.forEach((line) => {
        if (line === "") { curY += 3; return; }
        doc.text(line, 14, curY);
        curY += 5.5;
      });

      // KPI boxes na capa
      curY += 4;
      const boxW = (pw - 28 - 9) / 4;
      const boxes = [
        { label: "Total TXs",       val: String(summary.total_transactions), color: [37, 99, 235] as [number,number,number] },
        { label: "Conciliadas",      val: String(summary.reconciled_count),  color: [5, 150, 105] as [number,number,number] },
        { label: "Divergências",     val: String(summary.divergent_count),   color: [220, 38, 38] as [number,number,number] },
        { label: "Taxa Conc.",       val: `${rate}%`,                        color: rate >= 80 ? [5,150,105] as [number,number,number] : [202,138,4] as [number,number,number] },
      ];
      boxes.forEach((b, i) => {
        const bx = 14 + i * (boxW + 3);
        doc.setFillColor(...b.color);
        doc.roundedRect(bx, curY, boxW, 18, 2, 2, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.text(b.val, bx + boxW / 2, curY + 9, { align: "center" });
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.text(b.label, bx + boxW / 2, curY + 15, { align: "center" });
      });
      doc.setTextColor(17, 24, 39);
      curY += 24;

      // ── 2. Conciliação automática vs manual ───────────────────────────
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("2. Conciliação — Automática vs Manual", 14, curY + 8);
      curY += 12;

      const autoRec   = filtered.filter((t) => t.status === "reconciled" && t.match_type === "automatic");
      const manualRec = filtered.filter((t) => t.status === "reconciled" && t.match_type === "manual");
      const autoAmt   = autoRec.reduce((s, t) => s + (t.amount ?? 0), 0);
      const manualAmt = manualRec.reduce((s, t) => s + (t.amount ?? 0), 0);

      autoTable(doc, {
        startY: curY,
        head: [["Tipo", "Qtd Transações", "Valor Total", "% do Conciliado"]],
        body: [
          ["Automática (engine 3-pass)",
            String(autoRec.length),
            fmtBRL(autoAmt),
            summary.reconciled_count > 0 ? `${((autoRec.length / summary.reconciled_count) * 100).toFixed(1)}%` : "—"],
          ["Manual (revisão humana)",
            String(manualRec.length),
            fmtBRL(manualAmt),
            summary.reconciled_count > 0 ? `${((manualRec.length / summary.reconciled_count) * 100).toFixed(1)}%` : "—"],
          ["Total Conciliado",
            String(summary.reconciled_count),
            fmtBRL(summary.reconciled_amount),
            "100%"],
        ],
        headStyles: { fillColor: [5, 150, 105], textColor: 255 },
        columnStyles: { 2: { halign: "right" }, 3: { halign: "center" } },
        footStyles: { fillColor: [240, 253, 244], textColor: [5, 150, 105], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 9 },
      });
      curY = (doc as any).lastAutoTable?.finalY ?? curY + 35;

      // ── 3. Divergências ───────────────────────────────────────────────
      curY += 8;
      if (curY > ph - 60) { doc.addPage(); curY = 18; }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(13);
      doc.text("3. Divergências Identificadas", 14, curY);
      curY += 6;

      const divergent = filtered.filter((t) => t.status === "divergent");
      if (divergent.length === 0) {
        doc.setFont("helvetica", "italic");
        doc.setFontSize(10);
        doc.text("Nenhuma divergência no período.", 14, curY + 4);
        curY += 12;
      } else {
        autoTable(doc, {
          startY: curY,
          head: [["Data", "Valor", "Método", "Descrição", "Cliente"]],
          body: divergent.slice(0, 50).map((t) => [
            fmtDate(t.transaction_date),
            fmtBRL(t.amount),
            METHOD_LABELS[t.method] ?? t.method,
            (t.description ?? "—").slice(0, 35),
            (t.customer_name ?? "—").slice(0, 22),
          ]),
          headStyles: { fillColor: [220, 38, 38], textColor: 255 },
          alternateRowStyles: { fillColor: [254, 242, 242] },
          margin: { left: 14, right: 14 },
          styles: { fontSize: 8, cellPadding: 2 },
        });
        curY = (doc as any).lastAutoTable?.finalY ?? curY + 40;
        if (divergent.length > 50) {
          doc.setFontSize(8);
          doc.setFont("helvetica", "italic");
          doc.text(`(mostrando 50 de ${divergent.length} divergências)`, 14, curY + 4);
          curY += 8;
        }
      }

      // ── 4. Evolução mensal ────────────────────────────────────────────
      if (monthComp) {
        curY += 8;
        if (curY > ph - 70) { doc.addPage(); curY = 18; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(17, 24, 39);
        doc.text("4. Evolução Mensal (vs Mês Anterior)", 14, curY);
        curY += 6;
        const prevRate = monthComp.prev_month_total > 0
          ? ((monthComp.prev_month_reconciled / monthComp.prev_month_total) * 100).toFixed(1)
          : "—";
        const currRate = monthComp.current_month_total > 0
          ? ((monthComp.current_month_reconciled / monthComp.current_month_total) * 100).toFixed(1)
          : "—";
        autoTable(doc, {
          startY: curY,
          head: [["Indicador", "Mês Anterior", "Mês Atual", "Variação"]],
          body: [
            ["Total transações",
              String(monthComp.prev_month_total),
              String(monthComp.current_month_total),
              monthComp.prev_month_total > 0
                ? `${(((monthComp.current_month_total - monthComp.prev_month_total) / monthComp.prev_month_total) * 100).toFixed(1)}%`
                : "—"],
            ["Conciliadas",
              String(monthComp.prev_month_reconciled),
              String(monthComp.current_month_reconciled),
              monthComp.prev_month_reconciled > 0
                ? `${(((monthComp.current_month_reconciled - monthComp.prev_month_reconciled) / monthComp.prev_month_reconciled) * 100).toFixed(1)}%`
                : "—"],
            ["Divergências",
              String(monthComp.prev_month_divergent),
              String(monthComp.current_month_divergent),
              "—"],
            ["Taxa conciliação", `${prevRate}%`, `${currRate}%`, "—"],
          ],
          headStyles: { fillColor: [88, 28, 135], textColor: 255 },
          columnStyles: { 2: { halign: "right" }, 3: { halign: "center" } },
          margin: { left: 14, right: 14 },
          styles: { fontSize: 9 },
        });
        curY = (doc as any).lastAutoTable?.finalY ?? curY + 40;
      }

      // ── 5. Breakdown por método ────────────────────────────────────────
      if (methodBreakdown.length > 0) {
        curY += 8;
        if (curY > ph - 70) { doc.addPage(); curY = 18; }
        doc.setFont("helvetica", "bold");
        doc.setFontSize(13);
        doc.setTextColor(17, 24, 39);
        doc.text("5. Breakdown por Método de Pagamento", 14, curY);
        curY += 6;
        autoTable(doc, {
          startY: curY,
          head: [["Método", "Total Txs", "Valor Total", "Conciliadas", "Taxa %"]],
          body: methodBreakdown.map((m) => [
            METHOD_LABELS[m.method] ?? m.method,
            String(m.total_count),
            fmtBRL(m.total_amount),
            `${m.reconciled_count} (${fmtBRL(m.reconciled_amount)})`,
            `${m.reconciliation_rate}%`,
          ]),
          headStyles: { fillColor: [55, 65, 81], textColor: 255 },
          columnStyles: { 2: { halign: "right" }, 3: { halign: "right" }, 4: { halign: "center" } },
          margin: { left: 14, right: 14 },
          styles: { fontSize: 9 },
        });
        curY = (doc as any).lastAutoTable?.finalY ?? curY + 40;
      }

      // ── 6. Todas as transações ────────────────────────────────────────
      doc.addPage();
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, pw, 14, "F");
      doc.setTextColor(255, 255, 255);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.text("6. Listagem Completa de Transações", pw / 2, 9, { align: "center" });
      doc.setTextColor(17, 24, 39);

      autoTable(doc, {
        startY: 18,
        head: [["Data", "Valor", "Método", "Descrição", "Status", "Cliente", "Conf. Score"]],
        body: filtered.map((t) => [
          fmtDate(t.transaction_date),
          fmtBRL(t.amount),
          METHOD_LABELS[t.method] ?? t.method,
          (t.description ?? "—").slice(0, 28),
          STATUS_CONFIG[t.status]?.label ?? t.status,
          (t.customer_name ?? "—").slice(0, 18),
          t.confidence_score != null ? `${t.confidence_score}%` : "—",
        ]),
        headStyles: { fillColor: [55, 65, 81], textColor: 255 },
        alternateRowStyles: { fillColor: [249, 250, 251] },
        margin: { left: 14, right: 14 },
        styles: { fontSize: 7.5, cellPadding: 1.8 },
        didParseCell: (data) => {
          if (data.column.index === 4 && data.section === "body") {
            const status = (data.cell.raw as string) ?? "";
            if (status === "Conciliada") data.cell.styles.textColor = [5, 150, 105];
            else if (status === "Divergente") data.cell.styles.textColor = [220, 38, 38];
            else if (status === "Pendente") data.cell.styles.textColor = [202, 138, 4];
          }
        },
      });

      // ── Rodapé em todas as páginas ────────────────────────────────────
      const pages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= pages; i++) {
        doc.setPage(i);
        doc.setDrawColor(200, 200, 200);
        doc.setLineWidth(0.2);
        doc.line(14, ph - 10, pw - 14, ph - 10);
        doc.setFontSize(7);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text("Estokfy Connect — Relatório Executivo", 14, ph - 6);
        doc.text(`Página ${i} de ${pages}`, pw - 14, ph - 6, { align: "right" });
        doc.text(generatedAt, pw / 2, ph - 6, { align: "center" });
      }

      doc.save(`relatorio-executivo-connect-${toISO(new Date())}.pdf`);
      toast.success("Relatório executivo PDF exportado!");
    } catch (e) {
      console.error(e);
      toast.error("Erro ao exportar PDF: " + String(e));
    }
  };

  // ── Render ────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">Relatórios de Conciliação</h2>
        <p className="text-muted-foreground mt-1">Análise completa por período com exportação PDF, Excel e CSV</p>
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
                : <><RefreshCw className="h-4 w-4 mr-2" />Atualizar</>}
            </Button>
            {summary && (
              <div className="flex gap-2 ml-auto">
                <Button variant="outline" size="sm" onClick={exportCSV}>
                  <Download className="h-4 w-4 mr-1" />CSV
                </Button>
                <Button variant="outline" size="sm" onClick={exportExcel}>
                  <Download className="h-4 w-4 mr-1" />Excel
                </Button>
                <Button variant="outline" size="sm" onClick={exportPDF}>
                  <Download className="h-4 w-4 mr-1" />PDF
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {loading && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          {[...Array(5)].map((_, i) => (
            <Card key={i}><CardContent className="pt-4"><div className="h-16 bg-muted/40 rounded animate-pulse" /></CardContent></Card>
          ))}
        </div>
      )}

      {!loading && summary && (
        <>
          {/* KPI Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-blue-600" />Total recebido
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
                  <CheckCircle2 className="h-4 w-4 text-green-600" />Conciliadas
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
                  <AlertCircle className="h-4 w-4 text-red-600" />Divergentes
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
                  <Clock className="h-4 w-4 text-yellow-600" />Pendentes
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
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-gray-400" />Taxa
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className={`text-xl font-bold ${
                  summary.reconciliation_rate >= 80 ? "text-green-600"
                  : summary.reconciliation_rate >= 50 ? "text-yellow-600"
                  : "text-red-600"
                }`}>{summary.reconciliation_rate}%</p>
                <p className="text-xs text-muted-foreground">conciliação</p>
              </CardContent>
            </Card>
          </div>

          {/* Comparativo mensal */}
          {monthComp && (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  label: "Conciliado (mês atual)",
                  current: monthComp.current_month_reconciled,
                  prev: monthComp.prev_month_reconciled,
                  format: fmtBRL, color: "text-green-600",
                },
                {
                  label: "Recebido (mês atual)",
                  current: monthComp.current_month_total,
                  prev: monthComp.prev_month_total,
                  format: fmtBRL, color: "text-blue-600",
                },
                {
                  label: "Divergências (mês atual)",
                  current: monthComp.current_month_divergent,
                  prev: monthComp.prev_month_divergent,
                  format: (v: number) => String(v), color: "text-red-600",
                },
              ].map(({ label, current, prev, format, color }) => (
                <Card key={label}>
                  <CardContent className="pt-4">
                    <p className="text-xs text-muted-foreground mb-1">{label}</p>
                    <p className={`text-2xl font-bold ${color}`}>{format(current)}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-xs text-muted-foreground">vs mês anterior: {format(prev)}</span>
                      <DeltaBadge current={current} prev={prev} />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Breakdown por método */}
          {methodBreakdown.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Breakdown por Método de Pagamento</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Gráfico */}
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={methodBreakdown} margin={{ top: 4, right: 4, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="method" tickFormatter={(v) => METHOD_LABELS[v] ?? v} tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 11 }} />
                      <Tooltip
                        formatter={(value: number, name: string) => [fmtBRL(value), name === "reconciled_amount" ? "Conciliado" : "Total"]}
                        labelFormatter={(label) => METHOD_LABELS[label] ?? label}
                      />
                      <Bar dataKey="total_amount" name="Total" radius={[3, 3, 0, 0]}>
                        {methodBreakdown.map((m) => (
                          <Cell key={m.method} fill={METHOD_COLORS[m.method] ?? "#9ca3af"} fillOpacity={0.35} />
                        ))}
                      </Bar>
                      <Bar dataKey="reconciled_amount" name="Conciliado" radius={[3, 3, 0, 0]}>
                        {methodBreakdown.map((m) => (
                          <Cell key={m.method} fill={METHOD_COLORS[m.method] ?? "#9ca3af"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>

                  {/* Tabela resumo por método */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b">
                          <th className="text-left py-2 text-xs font-medium text-muted-foreground">Método</th>
                          <th className="text-right py-2 text-xs font-medium text-muted-foreground">Total</th>
                          <th className="text-right py-2 text-xs font-medium text-muted-foreground">Conciliado</th>
                          <th className="text-right py-2 text-xs font-medium text-muted-foreground">Taxa</th>
                        </tr>
                      </thead>
                      <tbody>
                        {methodBreakdown.map((m) => (
                          <tr key={m.method} className="border-b hover:bg-muted/20">
                            <td className="py-2 flex items-center gap-2">
                              <span
                                className="inline-block w-2.5 h-2.5 rounded-full"
                                style={{ background: METHOD_COLORS[m.method] ?? "#9ca3af" }}
                              />
                              {METHOD_LABELS[m.method] ?? m.method}
                            </td>
                            <td className="py-2 text-right text-xs">{fmtBRL(m.total_amount)}</td>
                            <td className="py-2 text-right text-xs text-green-700">{fmtBRL(m.reconciled_amount)}</td>
                            <td className="py-2 text-right">
                              <Badge
                                variant="secondary"
                                className={`text-xs ${
                                  m.reconciliation_rate >= 80 ? "bg-green-100 text-green-800"
                                  : m.reconciliation_rate >= 50 ? "bg-yellow-100 text-yellow-800"
                                  : "bg-red-100 text-red-800"
                                }`}
                              >
                                {m.reconciliation_rate}%
                              </Badge>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Tabela de transações */}
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
                <div className="text-center py-10">
                  <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-2 opacity-30" />
                  <p className="text-sm text-muted-foreground">Nenhuma transação para o filtro selecionado.</p>
                </div>
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
                          <td className="py-2.5 px-3 text-xs">{METHOD_LABELS[t.method] ?? t.method}</td>
                          <td className="py-2.5 px-3 text-xs max-w-[200px] truncate">{t.description || "—"}</td>
                          <td className="py-2.5 px-3">
                            <Badge variant="secondary" className={`text-xs ${STATUS_CONFIG[t.status]?.className ?? ""}`}>
                              {STATUS_CONFIG[t.status]?.label ?? t.status}
                            </Badge>
                          </td>
                          <td className="py-2.5 px-3 text-xs">{t.customer_name || "—"}</td>
                          <td className="py-2.5 px-3 text-xs text-muted-foreground">{fmtDateTime(t.confirmed_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="text-xs text-muted-foreground mt-3">{filtered.length} transação(ões) exibida(s)</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
