import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface BankConnection {
  id: string;
  bank_name: string;
  agency: string;
  account_number: string;
  account_type: "checking" | "savings" | "other";
  status: "pending" | "connected" | "disconnected" | "error";
  last_sync_at: string | null;
  last_sync_status: string | null;
  total_transactions: number;
  is_active: boolean;
  created_at: string;
}

export interface SyncHistory {
  id: string;
  sync_started_at: string;
  sync_completed_at: string | null;
  status: "pending" | "success" | "partial" | "failed";
  transactions_found: number;
  transactions_imported: number;
  transactions_skipped: number;
  error_message: string | null;
  duration_minutes: number | null;
}

export function useBankConnections() {
  const { profile } = useAuth();
  const [connections, setConnections] = useState<BankConnection[]>([]);
  const [syncHistory, setSyncHistory] = useState<SyncHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadConnections = async (storeId: string) => {
    try {
      const { data, error: err } = await supabase.rpc("list_bank_connections", {
        p_store_id: storeId,
      });

      if (err) throw err;
      setConnections(data || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSyncHistory = async (connectionId: string) => {
    try {
      const { data, error: err } = await supabase.rpc("get_sync_history", {
        p_connection_id: connectionId,
        p_limit: 20,
      });

      if (err) throw err;
      setSyncHistory(data || []);
    } catch (err) {
      console.error("Error loading sync history:", err);
    }
  };

  useEffect(() => {
    if (profile?.store_id) {
      setLoading(true);
      loadConnections(profile.store_id);
    }
  }, [profile?.store_id]);

  const addConnection = async (
    bankName: string,
    agency: string,
    accountNumber: string,
    accountType: string,
    accountHolder?: string
  ) => {
    if (!profile?.store_id) return false;

    try {
      const { data, error: err } = await supabase.rpc("create_bank_connection", {
        p_store_id: profile.store_id,
        p_bank_name: bankName,
        p_agency: agency,
        p_account_number: accountNumber,
        p_account_type: accountType,
        p_account_holder: accountHolder || null,
      });

      if (err) throw err;
      await loadConnections(profile.store_id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const removeConnection = async (connectionId: string) => {
    if (!profile?.store_id) return false;

    try {
      const { error: err } = await supabase.rpc("delete_bank_connection", {
        p_connection_id: connectionId,
      });

      if (err) throw err;
      await loadConnections(profile.store_id);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const recordSync = async (
    connectionId: string,
    status: string,
    found: number = 0,
    imported: number = 0,
    errorMsg?: string
  ) => {
    try {
      const { error: err } = await supabase.rpc("update_bank_sync", {
        p_connection_id: connectionId,
        p_status: status,
        p_found: found,
        p_imported: imported,
        p_error: errorMsg || null,
      });

      if (err) throw err;
      if (profile?.store_id) await loadConnections(profile.store_id);
      await loadSyncHistory(connectionId);
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  return {
    connections,
    syncHistory,
    loading,
    error,
    addConnection,
    removeConnection,
    recordSync,
    loadSyncHistory,
    reloadConnections: () => profile?.store_id && loadConnections(profile.store_id),
  };
}
