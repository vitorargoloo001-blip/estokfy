import { useCallback } from "react";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import { useToast } from "@/components/ui/use-toast";

interface ExportData {
  title: string;
  filename: string;
  columns: string[];
  data: any[][];
}

export function useConnectExport() {
  const { toast } = useToast();

  const exportToPDF = useCallback((exportData: ExportData) => {
    try {
      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Cabeçalho
      doc.setFontSize(16);
      doc.text(exportData.title, pageWidth / 2, 15, { align: "center" });

      // Data/Hora
      doc.setFontSize(10);
      doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, 14, 25);

      // Tabela
      autoTable(doc, {
        head: [exportData.columns],
        body: exportData.data,
        startY: 35,
        theme: "grid",
        styles: {
          fontSize: 9,
          cellPadding: 3,
        },
        headStyles: {
          fillColor: [59, 130, 246], // primary blue
          textColor: 255,
          fontStyle: "bold",
        },
        alternateRowStyles: {
          fillColor: [242, 242, 242],
        },
        margin: { top: 35, right: 14, bottom: 14, left: 14 },
      });

      // Rodapé
      const totalPages = (doc as any).internal.getNumberOfPages();
      for (let i = 1; i <= totalPages; i++) {
        doc.setPage(i);
        doc.setFontSize(8);
        doc.text(
          `Página ${i} de ${totalPages}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: "center" }
        );
      }

      doc.save(`${exportData.filename}.pdf`);

      toast({
        title: "PDF exportado",
        description: `Arquivo ${exportData.filename}.pdf foi baixado.`,
      });
    } catch (error) {
      console.error("Erro ao exportar PDF:", error);
      toast({
        title: "Erro",
        description: "Não foi possível exportar para PDF.",
        variant: "destructive",
      });
    }
  }, []);

  const exportToCSV = useCallback((exportData: ExportData) => {
    try {
      // Criar workbook
      const ws = XLSX.utils.aoa_to_sheet([exportData.columns, ...exportData.data]);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Dados");

      // Estilo para CSV (Excel)
      ws["!cols"] = exportData.columns.map(() => ({ wch: 15 }));

      // Salvar
      XLSX.writeFile(wb, `${exportData.filename}.csv`);

      toast({
        title: "CSV exportado",
        description: `Arquivo ${exportData.filename}.csv foi baixado.`,
      });
    } catch (error) {
      console.error("Erro ao exportar CSV:", error);
      toast({
        title: "Erro",
        description: "Não foi possível exportar para CSV.",
        variant: "destructive",
      });
    }
  }, []);

  return { exportToPDF, exportToCSV };
}

// Exportadores específicos

export function useExportReconciliationLogs() {
  const { exportToPDF, exportToCSV } = useConnectExport();

  const exportLogs = useCallback(
    (logs: any[], format: "pdf" | "csv") => {
      const data = logs.map((log) => [
        new Date(log.started_at).toLocaleString("pt-BR"),
        log.trigger_source === "webhook" ? "Webhook" : log.trigger_source,
        log.status,
        log.stats?.txs || 0,
        log.stats?.auto_matched || 0,
        log.stats?.suggested || 0,
        log.error ? "Sim" : "Não",
      ]);

      const exportData = {
        title: "Logs de Conciliação",
        filename: `estokfy_connect_logs_${Date.now()}`,
        columns: ["Data/Hora", "Origem", "Status", "Transações", "Auto-Conciliadas", "Sugestões", "Erro"],
        data,
      };

      if (format === "pdf") {
        exportToPDF(exportData);
      } else {
        exportToCSV(exportData);
      }
    },
    [exportToPDF, exportToCSV]
  );

  return { exportLogs };
}

export function useExportTransactions() {
  const { exportToPDF, exportToCSV } = useConnectExport();

  const exportTransactions = useCallback(
    (transactions: any[], format: "pdf" | "csv") => {
      const data = transactions.map((tx) => [
        tx.external_tx_id,
        tx.method === "pix" ? "PIX" : tx.method,
        `R$ ${tx.net_amount.toFixed(2)}`,
        new Date(tx.occurred_at).toLocaleString("pt-BR"),
        tx.status,
        tx.reconciliation_status,
      ]);

      const exportData = {
        title: "Transações Bancárias",
        filename: `estokfy_connect_transactions_${Date.now()}`,
        columns: ["ID Transação", "Método", "Valor", "Data/Hora", "Status", "Reconciliação"],
        data,
      };

      if (format === "pdf") {
        exportToPDF(exportData);
      } else {
        exportToCSV(exportData);
      }
    },
    [exportToPDF, exportToCSV]
  );

  return { exportTransactions };
}
