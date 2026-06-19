import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";

export interface SetupProgress {
  id: string;
  module_activated: boolean;
  bank_connected: boolean;
  account_selected: boolean;
  sync_enabled: boolean;
  reconciliation_enabled: boolean;
  audit_enabled: boolean;
  setup_completed: boolean;
  current_step: number;
  completion_percent: number;
}

export function useConnectSetup() {
  const { profile } = useAuth();
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProgress = async (storeId: string) => {
    try {
      const { data, error: err } = await supabase.rpc("get_connect_setup_progress", {
        p_store_id: storeId,
      });

      if (err) {
        console.error("Error loading setup progress:", err);
        setError(err.message);
        return;
      }

      if (data && data.length > 0) {
        setProgress(data[0]);
      } else {
        setProgress(null);
      }
      setError(null);
    } catch (err) {
      console.error("Unexpected error:", err);
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (profile?.store_id) {
      setLoading(true);
      loadProgress(profile.store_id);
    }
  }, [profile?.store_id]);

  const updateStep = async (stepName: string, completed: boolean) => {
    if (!profile?.store_id) return false;

    try {
      const { data, error: err } = await supabase.rpc("update_connect_setup_step", {
        p_store_id: profile.store_id,
        p_step_name: stepName,
        p_completed: completed,
      });

      if (err) {
        setError(err.message);
        return false;
      }

      // Reload progress after update
      await loadProgress(profile.store_id);
      return true;
    } catch (err) {
      console.error("Error updating step:", err);
      setError(String(err));
      return false;
    }
  };

  return {
    progress,
    loading,
    error,
    updateStep,
    reloadProgress: () => profile?.store_id && loadProgress(profile.store_id),
  };
}
