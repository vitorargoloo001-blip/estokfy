import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface PendingReconciliation {
  id: string;
  bank_transaction_id: string;
  transaction_date: string;
  transaction_amount: number;
  transaction_description: string | null;
  bank_name: string;
  suggested_sale_id: string | null;
  sale_number: string | null;
  sale_amount: number | null;
  sale_date: string | null;
  customer_name: string | null;
  confidence_score: number;
  match_type: string;
  amount_difference: number | null;
  date_difference_days: number | null;
}

export function useReconciliation() {
  const { profile } = useAuth();
  const [pendingMatches, setPendingMatches] = useState<PendingReconciliation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const loadPendingMatches = async () => {
    if (!profile?.store_id) return;

    try {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("get_pending_reconciliations", {
        p_store_id: profile.store_id,
      });

      if (err) throw err;
      setPendingMatches(data || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPendingMatches();
  }, [profile?.store_id]);

  const confirmMatch = async (reconciliationId: string, saleId?: string) => {
    try {
      const { error: err } = await supabase.rpc("confirm_reconciliation", {
        p_reconciliation_id: reconciliationId,
        p_sale_id: saleId || null,
      });

      if (err) throw err;
      await loadPendingMatches();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const ignoreMatch = async (reconciliationId: string) => {
    try {
      const { error: err } = await supabase.rpc("ignore_reconciliation", {
        p_reconciliation_id: reconciliationId,
      });

      if (err) throw err;
      await loadPendingMatches();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const bulkAction = async (action: "confirm" | "ignore") => {
    try {
      const ids = Array.from(selectedIds);
      const { error: err } = await supabase.rpc("bulk_reconcile", {
        p_reconciliation_ids: ids,
        p_action: action,
      });

      if (err) throw err;
      setSelectedIds(new Set());
      await loadPendingMatches();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  const toggleSelected = (id: string) => {
    const newSet = new Set(selectedIds);
    if (newSet.has(id)) {
      newSet.delete(id);
    } else {
      newSet.add(id);
    }
    setSelectedIds(newSet);
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === pendingMatches.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(pendingMatches.map((m) => m.id)));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  return {
    pendingMatches,
    loading,
    error,
    selectedIds,
    loadPendingMatches,
    confirmMatch,
    ignoreMatch,
    bulkAction,
    toggleSelected,
    toggleSelectAll,
    clearSelection,
  };
}
