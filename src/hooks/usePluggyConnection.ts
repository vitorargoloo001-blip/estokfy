// Hook stub para integração Pluggy V2
// Prepare-only: estrutura pronta, não ativa Pluggy ainda
// Ativar em Connect V2 após sbp/credenciais Pluggy configuradas

import { useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface PluggyConnectionStatus {
  id: string;
  pluggy_item_id: string;
  institution_name: string | null;
  connector_name: string | null;
  status: "pending" | "updating" | "updated" | "login_error" | "waiting_user_input" | "outdated" | "error";
  last_updated_at: string | null;
  next_update_at: string | null;
  account_name: string | null;
  bank_name: string | null;
  is_active: boolean;
}

export function usePluggyConnection() {
  const { profile } = useAuth();
  const [connections, setConnections] = useState<PluggyConnectionStatus[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega conexões Pluggy da view pluggy_connection_status
  const load = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase
        .from("pluggy_connection_status")
        .select("*")
        .eq("store_id", profile.store_id);
      if (err) throw err;
      setConnections((data as PluggyConnectionStatus[]) || []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

  // Stub: iniciar conexão OAuth com Pluggy (Connect Widget)
  // Ativar quando PLUGGY_CLIENT_ID estiver configurado
  const startConnect = async (_bankConnId: string): Promise<{ widgetUrl: string } | null> => {
    console.warn("[Pluggy] startConnect: aguardando ativação em Connect V2");
    return null;
  };

  // Stub: registrar item conectado após callback do widget
  const registerItem = async (_pluggyItemId: string, _bankConnId: string): Promise<boolean> => {
    console.warn("[Pluggy] registerItem: aguardando ativação em Connect V2");
    return false;
  };

  return {
    connections,
    loading,
    error,
    load,
    startConnect,
    registerItem,
    isReady: false, // Ativar em V2 quando Pluggy estiver configurado
  };
}
