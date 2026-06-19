import { useAuth } from '@/contexts/AuthContext';
import { useCapabilities } from '@/hooks/useCapabilities';

export function usePermissions() {
  const { profile } = useAuth();
  const role = profile?.role || 'viewer';
  const caps = useCapabilities();

  return {
    role,
    isOwner: role === 'owner',
    isAdmin: role === 'admin',
    isManager: role === 'manager',
    // capabilities — mesmas chaves de antes, mais as novas
    canManageEmployees:      caps.canManageEmployees,
    canCreateOwnerOrAdmin:   caps.canCreateOwnerOrAdmin,
    canManageProducts:       caps.canManageProducts,
    canDeleteProducts:       caps.canDeleteProducts,
    canManageReceivables:    caps.canManageReceivables,
    canCreateReturns:        caps.canCreateReturns,
    canCreateExchanges:      caps.canCreateExchanges,
    canManageOs:             caps.canManageOs,
    canManualStockAdjustment: caps.canManualStockAdjustment,
    canViewCostPrice:        caps.canViewCostPrice,
    canViewAdvancedReports:  caps.canViewAdvancedReports,
    canSystemSettings:       caps.canSystemSettings,
    canViewFinancials:       caps.canViewFinancials,
  };
}
