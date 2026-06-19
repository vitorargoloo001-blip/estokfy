import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';

export interface LoyaltySettings {
  enabled: boolean;
  goal_amount: number;
  credit_amount: number;
  count_paid_only: boolean;
}

export interface LoyaltyRankingItem {
  customer_id: string;
  customer_name: string;
  customer_phone: string | null;
  total_eligible: number;
  current_progress: number;
  remaining_to_next: number;
  milestones_reached: number;
  credits_generated_total: number;
  credits_used_total: number;
  credits_available: number;
  status: 'in_progress' | 'near_goal' | 'goal_reached' | 'credit_available' | 'credit_used';
  goal_amount: number;
  credit_amount: number;
}

export interface LoyaltySummary {
  customer_id: string;
  goal_amount: number;
  credit_amount: number;
  total_paid: number;
  total_refunded: number;
  total_eligible: number;
  milestones_reached: number;
  current_progress: number;
  remaining_to_next: number;
  credits_generated_total: number;
  credits_used_total: number;
  credits_available: number;
  status: LoyaltyRankingItem['status'];
}

const DEFAULTS: LoyaltySettings = {
  enabled: true,
  goal_amount: 1000,
  credit_amount: 80,
  count_paid_only: true,
};

export function useLoyaltySettings() {
  const [settings, setSettings] = useState<LoyaltySettings>(DEFAULTS);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let active = true;
    supabase.rpc('get_loyalty_settings').then(({ data }) => {
      if (!active) return;
      if (data) setSettings({ ...DEFAULTS, ...(data as any) });
      setLoading(false);
    });
    return () => { active = false; };
  }, []);
  return { settings, loading };
}

export function useCustomerLoyalty(customerId: string | null | undefined) {
  const [summary, setSummary] = useState<LoyaltySummary | null>(null);
  const [credits, setCredits] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    if (!customerId) { setSummary(null); setCredits([]); return; }
    setLoading(true);
    const [s, c] = await Promise.all([
      supabase.rpc('customer_loyalty_summary', { p_customer_id: customerId }),
      supabase.from('loyalty_credits')
        .select('id, amount_generated, amount_used, amount_available, status, reason, generated_at, source_sale_id, cancelled_at')
        .eq('customer_id', customerId)
        .order('generated_at', { ascending: false }),
    ]);
    if (s.data) setSummary(s.data as any);
    setCredits((c.data as any[]) || []);
    setLoading(false);
  }, [customerId]);

  useEffect(() => { refresh(); }, [refresh]);
  return { summary, credits, loading, refresh };
}
