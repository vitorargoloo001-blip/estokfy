import { useEffect, useCallback, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';
import { logger } from '@/lib/logger';

/**
 * Tables to subscribe for realtime changes.
 * All filtered by store_id via RLS.
 */
const REALTIME_TABLES = [
  'products',
  'customers',
  'categories',
  'sales',
  'stock_movements',
  'deliveries',
  'returns',
  'store_settings',
  'payments',
] as const;

/**
 * Hook that:
 * 1. Subscribes to Supabase Realtime for all key tables
 * 2. Invalidates React Query cache on changes
 * 3. Refetches data when app returns from background (visibility change)
 * 4. Refetches data when coming back online
 */
export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const storeId = profile?.store_id;
  const lastVisibleRef = useRef(Date.now());

  // Invalidate all queries for a given table
  const invalidateTable = useCallback(
    (table: string) => {
      queryClient.invalidateQueries({ queryKey: [table] });
      // Also invalidate common composite keys
      queryClient.invalidateQueries({
        predicate: (query) => {
          const key = query.queryKey;
          return Array.isArray(key) && key.some((k) => k === table);
        },
      });
    },
    [queryClient],
  );

  // Invalidate all queries (used on visibility change / online)
  const invalidateAll = useCallback(() => {
    queryClient.invalidateQueries();
    logger.info('[RealtimeSync] All queries invalidated');
  }, [queryClient]);

  // Realtime subscriptions
  useEffect(() => {
    if (!storeId) return;

    const channel = supabase
      .channel(`store-sync-${storeId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', filter: `store_id=eq.${storeId}` },
        (payload) => {
          const table = payload.table;
          logger.info(`[Realtime] ${payload.eventType} on ${table}`);
          invalidateTable(table);
        },
      )
      .subscribe((status) => {
        logger.info(`[Realtime] Subscription status: ${status}`);
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [storeId, invalidateTable]);

  // Visibility change: refetch when returning from background
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        const elapsed = Date.now() - lastVisibleRef.current;
        // Only refetch if away for more than 30 seconds
        if (elapsed > 30_000) {
          logger.info(`[RealtimeSync] App resumed after ${Math.round(elapsed / 1000)}s, refreshing`);
          invalidateAll();
        }
      } else {
        lastVisibleRef.current = Date.now();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [invalidateAll]);

  // Online event: refetch when reconnecting
  useEffect(() => {
    const handleOnline = () => {
      logger.info('[RealtimeSync] Back online, refreshing all data');
      // Small delay to let connection stabilize
      setTimeout(invalidateAll, 1500);
    };

    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, [invalidateAll]);
}
