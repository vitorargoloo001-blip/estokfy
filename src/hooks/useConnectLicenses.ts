import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface ConnectLicense {
  id: string;
  store_id: string;
  store_name: string;
  owner_email: string;
  plan_type: "starter" | "professional" | "enterprise";
  status: "active" | "suspended" | "cancelled";
  contracted_at: string;
  expires_at: string;
  amount_paid: number;
  currency: string;
  suspended_at: string | null;
  cancelled_at: string | null;
  auto_renew: boolean;
  days_until_expiry: number | null;
  created_at: string;
}

export interface ConnectLicenseDetail extends ConnectLicense {
  suspended_by: string | null;
  suspension_reason: string | null;
  cancelled_by: string | null;
  cancellation_reason: string | null;
  is_expired: boolean;
}

export interface LicenseStats {
  total_licenses: number;
  active_count: number;
  suspended_count: number;
  cancelled_count: number;
  expiring_soon: number;
  total_revenue: number;
}

export function useConnectLicenses() {
  const [licenses, setLicenses] = useState<ConnectLicense[]>([]);
  const [stats, setStats] = useState<LicenseStats | null>(null);
  const [expiringLicenses, setExpiringLicenses] = useState<ConnectLicense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLicenses = async (filters?: {
    status?: string;
    planType?: string;
  }) => {
    try {
      setLoading(true);
      const { data, error: err } = await supabase.rpc("list_connect_licenses", {
        p_status: filters?.status || null,
        p_plan_type: filters?.planType || null,
        p_limit: 1000,
        p_offset: 0,
      });

      if (err) throw err;
      setLicenses(data || []);
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const { data, error: err } = await supabase.rpc("get_connect_license_stats");

      if (err) throw err;
      if (data && data.length > 0) {
        setStats(data[0]);
      }
    } catch (err) {
      console.error("Error loading license stats:", err);
    }
  };

  const loadExpiringLicenses = async () => {
    try {
      const { data, error: err } = await supabase.rpc("get_expiring_licenses", {
        p_days: 7,
      });

      if (err) throw err;
      setExpiringLicenses(data || []);
    } catch (err) {
      console.error("Error loading expiring licenses:", err);
    }
  };

  useEffect(() => {
    loadLicenses();
    loadStats();
    loadExpiringLicenses();
  }, []);

  const getLicenseDetail = async (licenseId: string): Promise<ConnectLicenseDetail | null> => {
    try {
      // Find license in current list
      const license = licenses.find((l) => l.id === licenseId);
      if (!license) return null;

      // For now, return the basic license with null for additional fields
      // In production, would call separate RPC if needed
      return {
        ...license,
        suspended_by: null,
        suspension_reason: null,
        cancelled_by: null,
        cancellation_reason: null,
        is_expired: new Date(license.expires_at) < new Date(),
      };
    } catch (err) {
      console.error("Error loading license detail:", err);
      return null;
    }
  };

  const activateLicense = async (licenseId: string) => {
    try {
      const { data, error: err } = await supabase.rpc("activate_connect_license", {
        p_license_id: licenseId,
      });

      if (err) throw err;

      if (data && data[0]?.success) {
        await loadLicenses();
        return { success: true, message: data[0].message };
      } else {
        return { success: false, message: data?.[0]?.message || "Erro ao ativar licença" };
      }
    } catch (err) {
      return { success: false, message: String(err) };
    }
  };

  const suspendLicense = async (licenseId: string, reason?: string) => {
    try {
      const { data, error: err } = await supabase.rpc("suspend_connect_license", {
        p_license_id: licenseId,
        p_reason: reason || null,
      });

      if (err) throw err;

      if (data && data[0]?.success) {
        await loadLicenses();
        return { success: true, message: data[0].message };
      } else {
        return { success: false, message: data?.[0]?.message || "Erro ao suspender licença" };
      }
    } catch (err) {
      return { success: false, message: String(err) };
    }
  };

  const cancelLicense = async (licenseId: string, reason?: string) => {
    try {
      const { data, error: err } = await supabase.rpc("cancel_connect_license", {
        p_license_id: licenseId,
        p_reason: reason || null,
      });

      if (err) throw err;

      if (data && data[0]?.success) {
        await loadLicenses();
        return { success: true, message: data[0].message };
      } else {
        return { success: false, message: data?.[0]?.message || "Erro ao cancelar licença" };
      }
    } catch (err) {
      return { success: false, message: String(err) };
    }
  };

  return {
    licenses,
    stats,
    expiringLicenses,
    loading,
    error,
    loadLicenses,
    loadStats,
    loadExpiringLicenses,
    getLicenseDetail,
    activateLicense,
    suspendLicense,
    cancelLicense,
  };
}
