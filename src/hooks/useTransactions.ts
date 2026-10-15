import type { Database } from "@/integrations/supabase/types";
import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

// Campos de provider acrescentados em 20261015000001_connect_mercadopago_v1.sql.
// Opcionais para o tipo valer antes e depois de regenerar types.ts.
export type BankTransaction = Database['public']['Functions']['list_bank_transactions']['Returns'][number] & Partial<{
  provider: string | null;
  external_id: string | null;
  provider_status: string | null;
  gross_amount: number | null;
  fee_amount: number | null;
  net_amount: number | null;
  refunded_amount: number | null;
  payer_name: string | null;
  external_reference: string | null;
}>;

export interface TransactionSummary {
  total_count: number;
  total_amount: number;
  pending_count: number;
  pending_amount: number;
  reconciled_count: number;
  reconciled_amount: number;
  divergent_count: number;
  divergent_amount: number;
  ignored_count: number;
}

export interface TransactionFilters {
  startDate?: string;
  endDate?: string;
  bankConnectionId?: string;
  status?: string;
  minAmount?: number;
  maxAmount?: number;
}

export function useTransactions(initialFilters: TransactionFilters = {}) {
  const { profile } = useAuth();
  const [transactions, setTransactions] = useState<BankTransaction[]>([]);
  const [summary, setSummary] = useState<TransactionSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadTransactions = async (filters: TransactionFilters = {}) => {
    if (!profile?.store_id) return;

    try {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("list_bank_transactions", {
        p_store_id: profile.store_id,
        p_start_date: filters.startDate || null,
        p_end_date: filters.endDate || null,
        p_bank_connection_id: filters.bankConnectionId || null,
        p_status: filters.status || null,
        p_min_amount: filters.minAmount || null,
        p_max_amount: filters.maxAmount || null,
        p_limit: 200,
      });

      if (err) throw err;
      setTransactions(data || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadSummary = async () => {
    if (!profile?.store_id) return;

    try {
      const { data, error: err } = await supabase.rpc("get_transaction_summary", {
        p_store_id: profile.store_id,
      });

      if (err) throw err;
      if (data && data.length > 0) {
        setSummary(data[0]);
      }
    } catch (err) {
      console.error("Error loading summary:", err);
    }
  };

  useEffect(() => {
    loadTransactions(initialFilters);
    loadSummary();
  }, [profile?.store_id]);

  const updateStatus = async (transactionId: string, newStatus: string) => {
    try {
      const { error: err } = await supabase.rpc("update_transaction_status", {
        p_transaction_id: transactionId,
        p_new_status: newStatus,
      });

      if (err) throw err;
      await loadTransactions();
      await loadSummary();
      return true;
    } catch (err) {
      setError(String(err));
      return false;
    }
  };

  return {
    transactions,
    summary,
    loading,
    error,
    loadTransactions,
    loadSummary,
    updateStatus,
  };
}
