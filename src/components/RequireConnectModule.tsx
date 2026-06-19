import { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useConnectModuleAccess } from '@/hooks/useConnectModuleAccess';

/**
 * Route guard for the premium Estokfy Connect module.
 * SINGLE SOURCE OF TRUTH: access is granted only when the store's `connect` module is
 * active — exactly the same check used by the sidebar and the page (useConnectModuleAccess
 * -> hasModule(store,'connect')). No super-admin bypass, so "menu aparece ⟺ página abre".
 * Backend RPCs are independently gated (has_module / is_super_admin).
 */
export default function RequireConnectModule({ children }: { children: ReactNode }) {
  const { canAccess, isLoading } = useConnectModuleAccess();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="animate-spin h-6 w-6 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  if (!canAccess) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
