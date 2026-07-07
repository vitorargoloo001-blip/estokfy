import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useOsPaymentTerms() {
  const { profile } = useAuth();
  const [enabled, setEnabled] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    const { data } = await supabase
      .from('store_settings' as any)
      .select('settings')
      .eq('store_id', profile.store_id)
      .eq('category', 'os_payment_terms')
      .maybeSingle();
    const settings = (data as any)?.settings;
    setEnabled(!!(settings && typeof settings === 'object' && settings.enable_payment_terms_field));
    setLoading(false);
  }, [profile?.store_id]);

  useEffect(() => { reload(); }, [reload]);

  return { enabled, loading };
}
