import { useAuth } from '@/contexts/AuthContext';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';

export function useStoreAccess() {
  const { profile } = useAuth();
  const [accessEnabled, setAccessEnabled] = useState(true);
  const [subscriptionStatus, setSubscriptionStatus] = useState<string>('active');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!profile?.store_id) {
      setLoading(false);
      return;
    }

    const check = async () => {
      const { data: store } = await supabase
        .from('stores')
        .select('access_enabled, subscription_status')
        .eq('id', profile.store_id)
        .single();

      if (store) {
        setAccessEnabled(store.access_enabled);
        setSubscriptionStatus(store.subscription_status);
      }

      setLoading(false);
    };

    check();
  }, [profile?.store_id]);

  // pending_payment covers both old and new flows
  const needsPayment = subscriptionStatus === 'pending_payment';

  return { accessEnabled, subscriptionStatus, needsPayment, loading };
}
