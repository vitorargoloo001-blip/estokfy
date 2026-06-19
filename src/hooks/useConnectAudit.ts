import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface AuditLog {
  id: string;
  user_id: string;
  user_email: string;
  action: string;
  action_type: "login" | "sync" | "reconciliation" | "update" | "delete" | "reprocess";
  entity_type: string;
  entity_id: string | null;
  details: Record<string, any> | null;
  ip_address: string | null;
  created_at: string;
  created_at_date: string;
}

export interface AuditSummary {
  action_type: string;
  count: number;
  last_occurrence: string;
}

export interface AuditTimeline {
  date: string;
  login: number;
  sync: number;
  reconciliation: number;
  update_op: number;
  delete_op: number;
  reprocess: number;
}

export function useConnectAudit() {
  const { profile } = useAuth();
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [summary, setSummary] = useState<AuditSummary[]>([]);
  const [timeline, setTimeline] = useState<AuditTimeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadAuditLogs = async (filters?: {
    actionType?: string;
    entityType?: string;
    startDate?: string;
    endDate?: string;
  }) => {
    if (!profile?.store_id) return;

    try {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("list_connect_audit_logs", {
        p_store_id: profile.store_id,
        p_action_type: filters?.actionType || null,
        p_entity_type: filters?.entityType || null,
        p_start_date: filters?.startDate || null,
        p_end_date: filters?.endDate || null,
        p_limit: 1000,
        p_offset: 0,
      });

      if (err) throw err;
      setLogs(data || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadAuditSummary = async () => {
    if (!profile?.store_id) return;

    try {
      const { data, error: err } = await supabase.rpc("get_connect_audit_summary", {
        p_store_id: profile.store_id,
        p_days: 30,
      });

      if (err) throw err;
      setSummary(data || []);
    } catch (err) {
      console.error("Error loading audit summary:", err);
    }
  };

  const loadAuditTimeline = async () => {
    if (!profile?.store_id) return;

    try {
      const { data, error: err } = await supabase.rpc("get_audit_timeline", {
        p_store_id: profile.store_id,
        p_days: 30,
      });

      if (err) throw err;
      setTimeline(data || []);
    } catch (err) {
      console.error("Error loading audit timeline:", err);
    }
  };

  useEffect(() => {
    loadAuditLogs();
    loadAuditSummary();
    loadAuditTimeline();
  }, [profile?.store_id]);

  const exportToCSV = () => {
    const headers = ["Data", "Hora", "Usuário", "Ação", "Tipo", "Entidade", "IP"];
    const rows = logs.map((log) => [
      new Date(log.created_at).toLocaleDateString("pt-BR"),
      new Date(log.created_at).toLocaleTimeString("pt-BR"),
      log.user_email || "—",
      log.action,
      log.action_type,
      log.entity_type,
      log.ip_address || "—",
    ]);

    const csv = [
      headers.join(","),
      ...rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-connect-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportToPDF = async () => {
    try {
      const { default: jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const doc = new jsPDF();
      const pageWidth = doc.internal.pageSize.getWidth();
      const pageHeight = doc.internal.pageSize.getHeight();

      // Title
      doc.setFontSize(16);
      doc.text("Auditoria Financeira - Estokfy Connect", pageWidth / 2, 15, { align: "center" });

      // Date range
      doc.setFontSize(10);
      doc.text(`Gerado em: ${new Date().toLocaleString("pt-BR")}`, pageWidth / 2, 22, {
        align: "center",
      });

      // Table data
      const tableData = logs.map((log) => [
        new Date(log.created_at).toLocaleDateString("pt-BR"),
        new Date(log.created_at).toLocaleTimeString("pt-BR"),
        log.user_email || "—",
        log.action,
        log.action_type,
        log.entity_type,
        log.ip_address || "—",
      ]);

      autoTable(doc, {
        head: [["Data", "Hora", "Usuário", "Ação", "Tipo", "Entidade", "IP"]],
        body: tableData,
        startY: 30,
        margin: { left: 10, right: 10 },
        styles: { fontSize: 9, cellPadding: 3 },
        headStyles: { fillColor: [41, 128, 185], textColor: 255, fontStyle: "bold" },
        alternateRowStyles: { fillColor: [245, 245, 245] },
      });

      doc.save(`auditoria-connect-${new Date().toISOString().split("T")[0]}.pdf`);
    } catch (err) {
      console.error("Error exporting PDF:", err);
    }
  };

  return {
    logs,
    summary,
    timeline,
    loading,
    error,
    loadAuditLogs,
    loadAuditSummary,
    loadAuditTimeline,
    exportToCSV,
    exportToPDF,
  };
}
