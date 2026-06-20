import { useEffect, useState, useCallback } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface ConnectAlert {
  id: string;
  alert_type: string;
  severity: "error" | "warning" | "info";
  title: string;
  message: string;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  dismissed_at: string | null;
  created_at: string;
}

export function useConnectAlerts() {
  const { profile } = useAuth();
  const [alerts, setAlerts] = useState<ConnectAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const unreadCount = alerts.filter((a) => !a.is_read && !a.dismissed_at).length;

  const load = useCallback(
    async (includeDismissed = false) => {
      if (!profile?.store_id) return;
      setLoading(true);
      try {
        const { data, error: err } = await supabase.rpc("list_connect_alerts", {
          p_store_id: profile.store_id,
          p_include_dismissed: includeDismissed,
        });
        if (err) throw err;
        setAlerts((data as ConnectAlert[]) || []);
        setError(null);
      } catch (e) {
        setError(String(e));
      } finally {
        setLoading(false);
      }
    },
    [profile?.store_id]
  );

  useEffect(() => {
    load();
  }, [load]);

  const dismissAlert = async (id: string) => {
    const { error: err } = await supabase.rpc("dismiss_connect_alert", { p_alert_id: id });
    if (!err) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, dismissed_at: new Date().toISOString() } : a)));
    }
    return !err;
  };

  const markRead = async (id: string) => {
    const { error: err } = await supabase.rpc("mark_connect_alert_read", { p_alert_id: id });
    if (!err) {
      setAlerts((prev) => prev.map((a) => (a.id === id ? { ...a, is_read: true } : a)));
    }
    return !err;
  };

  const dismissAll = async () => {
    if (!profile?.store_id) return 0;
    const { data } = await supabase.rpc("dismiss_all_connect_alerts", {
      p_store_id: profile.store_id,
    });
    await load();
    return data as number;
  };

  const markAllRead = () => {
    setAlerts((prev) =>
      prev.map((a) => (!a.dismissed_at ? { ...a, is_read: true } : a))
    );
    alerts
      .filter((a) => !a.is_read && !a.dismissed_at)
      .forEach((a) => supabase.rpc("mark_connect_alert_read", { p_alert_id: a.id }));
  };

  return {
    alerts,
    unreadCount,
    loading,
    error,
    load,
    dismissAlert,
    markRead,
    dismissAll,
    markAllRead,
  };
}
