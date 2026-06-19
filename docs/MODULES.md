# MODULES.md — Estokfy

Cada módulo: página, tabelas, RPCs, relatórios alimentados.

---

## Dashboard (`/`)
- **Página:** `Dashboard.tsx`
- **Funções:** `dashboard_intelligence`, `obter_relatorio_operacional_v2`, `get_employee_performance`.
- **Componentes:** `DashboardCharts`, `TeamPerformanceCard`, `SmartRecommendations`, `NotificationBell`.
- Mostra KPIs do dia/mês, top produtos, alertas de estoque, ranking de funcionários.

## Produtos (`/produtos`)
- **Página:** `Products.tsx` + `Categories.tsx` (`/categorias`).
- **Tabelas:** `products`, `categories`, `stock_movements`.
- **RPCs:** `create_or_update_product_with_stock`, `apply_bulk_product_updates`, `resolve_product_ids_by_filter`, `count_products_by_filter`, `product_history`, `product_analytics`.
- **Componentes:** `BulkProductDialog`, `BulkEditProductsDialog`, `ProductHistoryDialog`, `ProductSearch`.
- Suporta imagens (bucket `product-images`), import/export `xlsx`.

## Estoque (`/estoque`)
- **Página:** `Stock.tsx`, secundária `IdleProducts.tsx` (`/produtos-parados`).
- **Tabelas:** `stock_movements`, `products`.
- **Edge:** `stock-adjust`.
- Lança entradas/saídas, exibe histórico, identifica estoque parado via `product_analytics`.

## Compras (`/relatorios/compras`)
- **Página:** `PurchasesReport.tsx`.
- **Tabela:** `stock_movements` (tipo `purchase`) + `suppliers`.
- Anexa nota em bucket `purchase-receipts`.

## Vendas (`/vendas`, `/vendas/nova`)
- **Páginas:** `Sales.tsx`, `NewSale.tsx`.
- **Tabelas:** `sales`, `sale_items`, `payments`, `deliveries`, `customers`, `products`.
- **RPCs:** `create_sale_atomic` (SSOT), `edit_sale_atomic`, `delete_sale_permanently`, `use_loyalty_credit_atomic`.
- **Edge:** `sales-create`, `sales-settle-payment`.
- **Componentes:** `SaleDetailDialog`, `EditSaleDialog`, `SettlePaymentDialog`, `BatchSettlePaymentDialog`, `ReceiptActions`, `CustomerSearch`, `ProductSearch`.
- Alimenta: relatórios v2, fidelidade (trigger), contas a receber, caixa.

## Contas a Receber (`/contas-a-receber`)
- **Página:** `AccountsReceivable.tsx`.
- **Tabelas:** `sales` (status pending/partial), `payments`, `customers`.
- **RPC:** `settle_sale_payment`.
- **PDF:** `customerStatementPdf.ts` — extrato do cliente (todas/apenas vencidas) + envio WhatsApp.
- Ordena do mais recente ao mais antigo.

## Contas a Pagar (`/contas-a-pagar`)
- **Página:** `AccountsPayable.tsx`.
- **Tabelas:** `accounts_payable`, `suppliers`, `cash_entries`.
- **RPC:** `settle_payable`.
- **Componentes:** `PayableFormDialog`.

## Clientes (`/clientes`)
- **Página:** `Customers.tsx`.
- **Tabelas:** `customers`, `sales`, `loyalty_credits`.
- **RPC:** `customer_360`, `customer_loyalty_summary`.
- **Componente:** `Customer360Dialog`.

## Fidelidade (`/fidelidade`)
- **Página:** `Loyalty.tsx`.
- **Tabelas:** `loyalty_credits`, `loyalty_credit_uses`.
- **RPCs:** `loyalty_ranking`, `recalc_loyalty_for_store`, `get_loyalty_settings_for_store`, `loyalty_recalc_preview`.

## Entregas (`/entregas`)
- **Página:** `Deliveries.tsx`.
- **Tabela:** `deliveries`.
- Status: pending → scheduled → done.

## Trocas (`/trocas`)
- **Página:** `Returns.tsx`.
- **Tabelas:** `returns`, `return_items`, reabastece `stock_movements`.
- **RPC/Edge:** `create_return_atomic` / `returns-create`.

## Funcionários (`/funcionarios`)
- **Página:** `Employees.tsx`.
- **Tabela:** `profiles` + `audit_logs`.
- **RPCs:** `list_employees`, `get_employee_performance`, `update_employee_role`, `set_employee_active`, `can_delete_employee`.
- **Edges:** `employees-invite`, `employees-admin`.

## Financeiro / Caixa (`/financeiro`)
- **Página:** `Finance.tsx`.
- **Tabelas:** `cash_ledger`, `cash_entries`, `payments`.
- **RPC:** `get_financial_report_summary`.
- **Lib:** `financialReport.ts`.

## Relatórios (`/relatorios`)
- **Página:** `Reports.tsx`.
- **RPC SSOT:** `obter_relatorio_operacional_v2` (NUNCA recalcular no frontend).
- **Lib:** `reportV2.ts`, `reportPdf.ts`.
- **Edges:** `reports-summary`, `reports-detailed`, `reports-ai-analysis`.

## Ordens de Serviço (`/os`)
- **Páginas:** `ServiceOrders/Index`, `/New`, `/Detail`.
- **Tabelas:** `service_orders`, `service_order_items`, `service_order_payments`, `service_order_photos`, `service_order_status_history`.
- **RPCs:** `create_service_order`, `so_add_part`, `so_add_service`, `so_remove_item`, `so_change_status`, `so_settle_payment`, `so_recalc_totals`.
- **Componente:** `StatusBadge`.
- **PDF:** `serviceOrderPdf.ts`.

## Configurações (`/configuracoes`)
- **Página:** `Settings.tsx`.
- **Tabela:** `store_settings` (9 blocos JSON).
- **Componentes:** `PrintingSettings`, `SettingControls`.

## Auditoria (`/historico`)
- **Página:** `AuditHistory.tsx`.
- **Tabelas:** `audit_logs`, `sale_audit_logs`, `sale_deletion_logs`, `bulk_operations_log`.

## Pixel (`/pixel`) + `/docs/pixel`
- **Página:** `PixelSettings.tsx`.
- **Tabelas:** `store_pixels`, `pixel_events`.
- **Edge pública:** `pixel-events`.

## Ajuda (`/ajuda`)
- Manual interativo (estático).

## Super Admin (`/super-admin/*`)
- Dashboard global, lista de lojas, detalhe (suspender/ativar), verificações de pagamento.
- **Tabelas:** `stores` (+plan/status), `system_admins`, `super_admin_logs`, `payment_verifications`.

## Pagamento de Assinatura
- `/verificacao-pagamento` (`PaymentVerification.tsx`) — envia comprovante.
- `/acesso-suspenso` (`AccessSuspended.tsx`).
- **Edge:** `verify-payment`.
