import { useAuth } from '@/contexts/AuthContext';

function cap(caps: Record<string, boolean>, key: string): boolean {
  return caps[key] === true;
}

export interface Capabilities {
  // Vendas
  canCreateSales: boolean;
  canEditOwnDaySales: boolean;
  canReceivePayments: boolean;
  canPartialPayments: boolean;
  // Clientes
  canManageCustomers: boolean;
  canViewCustomerHistory: boolean;
  // Contas a receber
  canManageReceivables: boolean;
  // Trocas & devoluções
  canCreateReturns: boolean;
  canCreateExchanges: boolean;
  canStandaloneExchange: boolean;
  canGenerateCustomerCredit: boolean;
  canCreditAgainstDebt: boolean;
  canCashRefund: boolean;
  // Fidelidade
  canViewLoyalty: boolean;
  canUseLoyalty: boolean;
  canGenerateLoyalty: boolean;
  // Ordem de Serviço
  canManageOs: boolean;
  canUpdateOsStatus: boolean;
  canDeliverOs: boolean;
  // Estoque / Produtos
  canManualStockAdjustment: boolean;
  canViewCostPrice: boolean;
  canManageProducts: boolean;
  canDeleteProducts: boolean;
  // Administrativo
  canManageEmployees: boolean;
  canViewAdvancedReports: boolean;
  canSystemSettings: boolean;
  canViewFinancials: boolean;
  canManageConnect: boolean;
  canCreateOwnerOrAdmin: boolean;
  // Estado
  loading: boolean;
}

export function useCapabilities(): Capabilities {
  const { capabilities, capabilitiesLoading } = useAuth();
  const c = capabilities;

  return {
    canCreateSales:          cap(c, 'can_create_sales'),
    canEditOwnDaySales:      cap(c, 'can_edit_own_day_sales'),
    canReceivePayments:      cap(c, 'can_receive_payments'),
    canPartialPayments:      cap(c, 'can_partial_payments'),
    canManageCustomers:      cap(c, 'can_manage_customers'),
    canViewCustomerHistory:  cap(c, 'can_view_customer_history'),
    canManageReceivables:    cap(c, 'can_manage_receivables'),
    canCreateReturns:        cap(c, 'can_create_returns'),
    canCreateExchanges:      cap(c, 'can_create_exchanges'),
    canStandaloneExchange:   cap(c, 'can_standalone_exchange'),
    canGenerateCustomerCredit: cap(c, 'can_generate_customer_credit'),
    canCreditAgainstDebt:    cap(c, 'can_credit_against_debt'),
    canCashRefund:           cap(c, 'can_cash_refund'),
    canViewLoyalty:          cap(c, 'can_view_loyalty'),
    canUseLoyalty:           cap(c, 'can_use_loyalty'),
    canGenerateLoyalty:      cap(c, 'can_generate_loyalty'),
    canManageOs:             cap(c, 'can_manage_os'),
    canUpdateOsStatus:       cap(c, 'can_update_os_status'),
    canDeliverOs:            cap(c, 'can_deliver_os'),
    canManualStockAdjustment: cap(c, 'can_manual_stock_adjustment'),
    canViewCostPrice:        cap(c, 'can_view_cost_price'),
    canManageProducts:       cap(c, 'can_manage_products'),
    canDeleteProducts:       cap(c, 'can_delete_products'),
    canManageEmployees:      cap(c, 'can_manage_employees'),
    canViewAdvancedReports:  cap(c, 'can_view_advanced_reports'),
    canSystemSettings:       cap(c, 'can_system_settings'),
    canViewFinancials:       cap(c, 'can_view_financials'),
    canManageConnect:        cap(c, 'can_manage_connect'),
    canCreateOwnerOrAdmin:   cap(c, 'can_create_owner_or_admin'),
    loading: capabilitiesLoading,
  };
}
