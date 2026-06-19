import { useEffect, useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';

interface ModuleAccessResult {
  isActive: boolean;
  isLoading: boolean;
  error: string | null;
  canAccess: boolean;
  module: {
    activated_at: string | null;
    deactivation_scheduled_at: string | null;
  } | null;
}

/**
 * Hook to check if current store has access to a module
 * Uses cached module list from AuthContext (loaded on login)
 * Falls back to deny access if data unavailable
 */
export function useConnectModuleAccess(): ModuleAccessResult {
  const { storeModules, modulesLoading, profile } = useAuth();
  const [error, setError] = useState<string | null>(null);

  // Get Connect module status from context
  const connectModule = storeModules?.['connect'] || null;
  const isActive = connectModule?.is_active ?? false;

  // Check if deactivation is scheduled but not yet active
  const isDeactivationScheduled = connectModule?.deactivation_scheduled_at
    ? new Date(connectModule.deactivation_scheduled_at) > new Date()
    : false;

  // Can access if: active AND (no deactivation scheduled OR scheduled for future)
  const canAccess = isActive && !isDeactivationScheduled;

  // Set error if module list failed to load
  useEffect(() => {
    if (!modulesLoading && !storeModules && profile?.store_id) {
      setError(
        'Unable to verify module access. Please refresh the page or contact support.'
      );
    } else {
      setError(null);
    }
  }, [modulesLoading, storeModules, profile?.store_id]);

  return {
    isActive,
    isLoading: modulesLoading,
    error,
    canAccess,
    module: connectModule
      ? {
          activated_at: connectModule.activated_at,
          deactivation_scheduled_at: connectModule.deactivation_scheduled_at,
        }
      : null,
  };
}
