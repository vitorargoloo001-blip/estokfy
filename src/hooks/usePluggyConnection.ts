// Hook completo para integração Pluggy V2
// Gerencia conexões bancárias reais via Pluggy Connect Widget.

import { useState, useCallback, useEffect, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ── Tipos ─────────────────────────────────────────────────────────────

export interface BankConnectionPluggy {
  id: string;
  bank_name: string;
  bank_code: string | null;
  agency: string | null;
  account_number: string;
  account_type: string;
  status: string;
  last_sync_at: string | null;
  last_sync_status: string | null;
  total_transactions: number;
  is_active: boolean;
  pluggy_item_id: string | null;
  pluggy_external_item_id: string | null;
  pluggy_account_id: string | null;
  pluggy_status: string | null;
  institution_name: string | null;
  last_synced_at: string | null;
}

export interface PluggyWidgetCallbacks {
  onSuccess: (itemId: string) => void;
  onError:   (error: string) => void;
  onClose:   () => void;
}

// ── Constantes ────────────────────────────────────────────────────────

const PLUGGY_WIDGET_URL = "https://cdn.pluggy.ai/pluggy-connect/v2/pluggy-connect.js";
const SUPABASE_FUNCTIONS_URL = `${import.meta.env.VITE_SUPABASE_URL ?? ""}/functions/v1`;

// ── Helpers ───────────────────────────────────────────────────────────

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src   = src;
    script.async = true;
    script.onload  = () => resolve();
    script.onerror = () => reject(new Error(`Falha ao carregar ${src}`));
    document.head.appendChild(script);
  });
}

async function callEdgeFunction(
  path: string,
  body: Record<string, unknown>,
  authToken: string
): Promise<unknown> {
  const res = await fetch(`${SUPABASE_FUNCTIONS_URL}/${path}`, {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": `Bearer ${authToken}`,
      "apikey":        import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? "",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
  return data;
}

// ── Hook ──────────────────────────────────────────────────────────────

export function usePluggyConnection() {
  const { profile, session } = useAuth();
  const [connections, setConnections]   = useState<BankConnectionPluggy[]>([]);
  const [loading, setLoading]           = useState(false);
  const [syncing, setSyncing]           = useState<Record<string, boolean>>({});
  const [connecting, setConnecting]     = useState(false);
  const [error, setError]               = useState<string | null>(null);
  const widgetRef = useRef<{ destroy?: () => void } | null>(null);

  // ── Carregar conexões ─────────────────────────────────────────────
  const loadConnections = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    setError(null);
    try {
      const { data, error: err } = await supabase.rpc("get_bank_connections_with_pluggy", {
        p_store_id: profile.store_id,
      });
      if (err) throw err;
      setConnections((data as BankConnectionPluggy[]) ?? []);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [profile?.store_id]);

  useEffect(() => { loadConnections(); }, [loadConnections]);

  // ── Abrir widget Pluggy ───────────────────────────────────────────
  const openWidget = useCallback(async () => {
    if (!session?.access_token || !profile?.store_id) {
      toast.error("Sessão inválida. Faça login novamente.");
      return;
    }
    setConnecting(true);
    try {
      // 1. Obter connect token
      const tokenData = await callEdgeFunction(
        "pluggy-connect-token",
        {},
        session.access_token
      ) as { connectToken: string };

      if (!tokenData.connectToken) throw new Error("Connect token não retornado");

      // 2. Carregar SDK Pluggy
      await loadScript(PLUGGY_WIDGET_URL);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PluggyConnect = (window as any).PluggyConnect;
      if (!PluggyConnect) throw new Error("SDK Pluggy não carregou corretamente");

      // 3. Abrir widget
      const widget = new PluggyConnect({
        connectToken: tokenData.connectToken,

        onSuccess: async ({ item }: { item: { id: string } }) => {
          setConnecting(false);
          toast.info("Banco autenticado! Importando transações...");
          try {
            const result = await callEdgeFunction(
              "pluggy-register-item",
              { pluggyItemId: item.id },
              session.access_token
            ) as {
              txImported: number;
              txNew: number;
              matchResult?: { matches_created: number };
            };
            toast.success(
              `Banco conectado! ${result.txNew} transações importadas` +
              (result.matchResult?.matches_created
                ? `, ${result.matchResult.matches_created} conciliadas automaticamente.`
                : ".")
            );
            await loadConnections();
          } catch (e) {
            toast.error("Erro ao registrar banco: " + String(e));
          }
        },

        onError: (err: { message: string }) => {
          setConnecting(false);
          toast.error("Erro no widget Pluggy: " + (err?.message ?? "Erro desconhecido"));
          console.error("[Pluggy widget error]", err);
        },

        onClose: () => {
          setConnecting(false);
        },
      });

      widget.init();
      widgetRef.current = widget;

    } catch (e) {
      setConnecting(false);
      toast.error("Erro ao abrir widget Pluggy: " + String(e));
      console.error("[openWidget]", e);
    }
  }, [session?.access_token, profile?.store_id, loadConnections]);

  // ── Sincronizar agora ─────────────────────────────────────────────
  const syncNow = useCallback(async (pluggyExternalItemId?: string) => {
    if (!session?.access_token || !profile?.store_id) return;
    const key = pluggyExternalItemId ?? "__all__";
    setSyncing((s) => ({ ...s, [key]: true }));
    try {
      const body: Record<string, unknown> = {};
      if (pluggyExternalItemId) body.pluggyItemId = pluggyExternalItemId;

      const result = await callEdgeFunction(
        "pluggy-sync-transactions",
        body,
        session.access_token
      ) as { txImported: number; txNew: number };

      toast.success(
        `Sincronizado! ${result.txNew} nova(s) transação(ões) importada(s).`
      );
      await loadConnections();
    } catch (e) {
      toast.error("Erro na sincronização: " + String(e));
    } finally {
      setSyncing((s) => ({ ...s, [key]: false }));
    }
  }, [session?.access_token, profile?.store_id, loadConnections]);

  // ── Reconectar banco ─────────────────────────────────────────────
  const reconnect = useCallback(async (pluggyExternalItemId: string) => {
    if (!session?.access_token || !profile?.store_id) return;
    setConnecting(true);
    try {
      await loadScript(PLUGGY_WIDGET_URL);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const PluggyConnect = (window as any).PluggyConnect;
      if (!PluggyConnect) throw new Error("SDK Pluggy não carregou");

      const tokenData = await callEdgeFunction(
        "pluggy-connect-token",
        {},
        session.access_token
      ) as { connectToken: string };

      const widget = new PluggyConnect({
        connectToken: tokenData.connectToken,
        updateItem:   pluggyExternalItemId, // reconexão de item existente

        onSuccess: async ({ item }: { item: { id: string } }) => {
          setConnecting(false);
          toast.info("Reconectando banco...");
          try {
            await callEdgeFunction(
              "pluggy-register-item",
              { pluggyItemId: item.id },
              session.access_token
            );
            toast.success("Banco reconectado com sucesso!");
            await loadConnections();
          } catch (e) {
            toast.error("Erro ao reconectar: " + String(e));
          }
        },
        onError: (err: { message: string }) => {
          setConnecting(false);
          toast.error("Erro ao reconectar: " + (err?.message ?? "Erro"));
        },
        onClose: () => setConnecting(false),
      });
      widget.init();
      widgetRef.current = widget;
    } catch (e) {
      setConnecting(false);
      toast.error("Erro ao reconectar: " + String(e));
    }
  }, [session?.access_token, profile?.store_id, loadConnections]);

  // ── Desconectar banco ─────────────────────────────────────────────
  const disconnect = useCallback(async (pluggyItemDbId: string) => {
    if (!profile?.store_id) return;
    try {
      const { data, error: err } = await supabase.rpc("disconnect_pluggy_item", {
        p_store_id:          profile.store_id,
        p_pluggy_item_db_id: pluggyItemDbId,
      });
      const rows = data as Array<{ success: boolean; message: string }> | null;
      if (err || !rows?.[0]?.success) throw new Error(rows?.[0]?.message ?? err?.message ?? "Erro");
      toast.success("Banco desconectado com sucesso");
      await loadConnections();
    } catch (e) {
      toast.error("Erro ao desconectar: " + String(e));
    }
  }, [profile?.store_id, loadConnections]);

  // ── Remover conexão manual (sem Pluggy) ──────────────────────────
  const removeManualConnection = useCallback(async (connectionId: string) => {
    try {
      const { error: err } = await supabase
        .from("bank_connections")
        .update({ is_active: false, status: "disconnected", updated_at: new Date().toISOString() })
        .eq("id", connectionId);
      if (err) throw err;
      toast.success("Conexão removida");
      await loadConnections();
    } catch (e) {
      toast.error("Erro ao remover: " + String(e));
    }
  }, [loadConnections]);

  return {
    connections,
    loading,
    syncing,
    connecting,
    error,
    loadConnections,
    openWidget,
    syncNow,
    reconnect,
    disconnect,
    removeManualConnection,
    isReady: true,
  };
}
