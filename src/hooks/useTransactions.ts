import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface BankTransaction {
  id: string;
  transaction_date: string;
  transaction_time: string | null;
  amount: number;
  transaction_type: "debit" | "credit";
  description: string | null;
  bank_name: string;
  method: string | null;
  status: "pending" | "reconciled" | "divergent" | "ignored";
  origin_account: string | null;
  destination_account: string | null;
  category: string | null;
  reconciled_with: string;
  created_at: string;
}

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

export function useTransactions() {
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
    loadTransactions();
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
