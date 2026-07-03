import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export function useSensitiveOpsPermission() {
  const { profile } = useAuth();
  const [allowed, setAllowed] = useState(false);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!profile?.store_id) return;
    setLoading(true);
    const { data } = await supabase.rpc('can_manage_sensitive_operations' as any, {
      p_store_id: profile.store_id,
    } as any);
    setAllowed(!!data);
    setLoading(false);
  }, [profile?.store_id]);

  useEffect(() => { reload(); }, [reload]);

  return { allowed, loading };
}
