import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import {
  BusinessType,
  BusinessLabels,
  BusinessProfile,
  getBusinessProfile,
} from '@/lib/businessProfiles';

// Module-level cache: avoids re-fetching on every component mount within the same session
let _cachedStoreId: string | null = null;
let _cachedType: BusinessType | null = null;

export interface UseBusinessLabelsReturn {
  businessType: BusinessType;
  labels: BusinessLabels;
  profile: BusinessProfile;
  loading: boolean;
  /** Call after changing business_type so the next consumer re-fetches */
  invalidate: () => void;
}

export function useBusinessLabels(): UseBusinessLabelsReturn {
  const { profile } = useAuth();
  const storeId = profile?.store_id ?? null;

  const [businessType, setBusinessType] = useState<BusinessType>(
    storeId && _cachedStoreId === storeId ? (_cachedType ?? 'retail') : 'retail',
  );
  const [loading, setLoading] = useState(
    !storeId || _cachedStoreId !== storeId,
  );

  useEffect(() => {
    if (!storeId) return;

    if (_cachedStoreId === storeId && _cachedType) {
      setBusinessType(_cachedType);
      setLoading(false);
      return;
    }

    setLoading(true);
    supabase
      .from('stores')
      .select('business_type')
      .eq('id', storeId)
      .single()
      .then(({ data }) => {
        const bt = (data?.business_type as BusinessType) ?? 'retail';
        _cachedStoreId = storeId;
        _cachedType = bt;
        setBusinessType(bt);
        setLoading(false);
      });
  }, [storeId]);

  const biz = getBusinessProfile(businessType);

  return {
    businessType,
    labels: biz.labels,
    profile: biz,
    loading,
    invalidate: () => {
      _cachedStoreId = null;
      _cachedType = null;
    },
  };
}
