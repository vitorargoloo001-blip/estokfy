import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export function useLogConnectAudit() {
  const { profile } = useAuth();

  const logAudit = async (
    action: string,
    actionType: "login" | "sync" | "reconciliation" | "update" | "delete" | "reprocess",
    entityType: string,
    entityId?: string,
    details?: Record<string, any>
  ) => {
    if (!profile?.id || !profile?.store_id) return;

    try {
      await supabase.functions.invoke("log-connect-audit", {
        body: {
          store_id: profile.store_id,
          user_id: profile.id,
          action,
          action_type: actionType,
          entity_type: entityType,
          entity_id: entityId,
          details,
          ip_address: await getClientIP(),
          user_agent: navigator.userAgent,
        },
      });
    } catch (error) {
      console.error("Error logging audit:", error);
    }
  };

  const logSync = (bankConnectionId: string, transactionCount: number) => {
    return logAudit(
      `Sincronizou ${transactionCount} transação(ões)`,
      "sync",
      "bank_connection",
      bankConnectionId,
      { transaction_count: transactionCount }
    );
  };

  const logReconciliation = (transactionId: string, saleId: string, confidence: number) => {
    return logAudit(
      "Conciliou transação com venda",
      "reconciliation",
      "bank_transaction",
      transactionId,
      { sale_id: saleId, confidence_score: confidence }
    );
  };

  const logUpdate = (entityType: string, entityId: string, changes: Record<string, any>) => {
    return logAudit(
      `Atualizou ${entityType}`,
      "update",
      entityType,
      entityId,
      { changes }
    );
  };

  const logDelete = (entityType: string, entityId: string, details?: Record<string, any>) => {
    return logAudit(
      `Deletou ${entityType}`,
      "delete",
      entityType,
      entityId,
      details
    );
  };

  const logReprocess = (transactionId: string, reason: string) => {
    return logAudit(
      `Reprocessou transação: ${reason}`,
      "reprocess",
      "bank_transaction",
      transactionId,
      { reason }
    );
  };

  const logLogin = () => {
    return logAudit(
      "Fez login no Estokfy Connect",
      "login",
      "user",
      profile?.id,
      { timestamp: new Date().toISOString() }
    );
  };

  return {
    logAudit,
    logSync,
    logReconciliation,
    logUpdate,
    logDelete,
    logReprocess,
    logLogin,
  };
}

async function getClientIP(): Promise<string | null> {
  try {
    const response = await fetch("https://api.ipify.org?format=json");
    const data = await response.json();
    return data.ip;
  } catch {
    return null;
  }
}
