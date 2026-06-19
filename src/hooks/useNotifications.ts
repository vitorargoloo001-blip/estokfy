import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/contexts/AuthContext';

export interface Notification {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  title: string;
  description: string | null;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export function useNotifications() {
  const { profile } = useAuth();
  const storeId = profile?.store_id;
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(false);
  const unread = items.filter(n => !n.read_at).length;

  const refresh = useCallback(async () => {
    if (!storeId) return;
    setLoading(true);
    try {
      // gera as automáticas (idempotente por dedupe_key)
      await supabase.rpc('refresh_store_notifications');
      const { data } = await supabase
        .from('notifications')
        .select('*')
        .eq('store_id', storeId)
        .order('created_at', { ascending: false })
        .limit(50);
      setItems((data as Notification[]) || []);
    } finally {
      setLoading(false);
    }
  }, [storeId]);

  useEffect(() => {
    if (!storeId) return;
    refresh();
    const t = setInterval(refresh, 60_000);
    return () => clearInterval(t);
  }, [storeId, refresh]);

  const markRead = useCallback(async (id: string) => {
    setItems(prev => prev.map(n => n.id === id ? { ...n, read_at: new Date().toISOString() } : n));
    await supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('id', id);
  }, []);

  const markAllRead = useCallback(async () => {
    if (!storeId) return;
    const now = new Date().toISOString();
    setItems(prev => prev.map(n => ({ ...n, read_at: n.read_at || now })));
    await supabase.from('notifications').update({ read_at: now })
      .eq('store_id', storeId).is('read_at', null);
  }, [storeId]);

  return { items, unread, loading, refresh, markRead, markAllRead };
}
