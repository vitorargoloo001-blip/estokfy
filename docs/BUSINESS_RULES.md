# BUSINESS_RULES.md — Estokfy

Fluxos de negócio e regras de autenticação/permissão.

---

## 1. Autenticação

### Login
1. Usuário entra com email+senha em `/login` (`Login.tsx`).
2. `supabase.auth.signInWithPassword`.
3. `AuthContext` busca `profiles` (por `auth_user_id`).
4. Se `profile.is_active = false` → `signOut` automático.
5. Se não existe `profile` → chama RPC `bootstrap_new_store` → cria loja + owner + seeds → continua.
6. `useStoreAccess` valida `check_store_access(store_id)`:
   - `access_enabled = false` ou status `suspended/blocked/inactive` → `/acesso-suspenso`.
   - Pagamento pendente → `/verificacao-pagamento`.
7. Super admin (email em `system_admins`) bypassa as duas checagens.

### Fluxo de funcionários
1. Owner/Admin/Manager acessa `/funcionarios` e clica "Adicionar".
2. Edge `employees-invite` cria auth user com senha admin (sem email de convite) + `profile` ligado ao `store_id` do criador + linha em `audit_logs`.
3. Owner/admin pode `update | reset_password | delete` via edge `employees-admin`.
4. Apenas owner pode excluir; exclusão deleta auth user e desativa profile.
5. Toda ação é auditada.

### Cargos / Roles (`profiles.role`)
| Role | Rotas permitidas |
|---|---|
| `owner` | tudo (*) |
| `admin` | tudo (*) |
| `manager` | tudo, exceto `/configuracoes` |
| `sales` | `/`, `/vendas`, `/clientes`, `/fidelidade`, `/entregas`, `/os`, `/ajuda` |
| `stock` | `/`, `/produtos`, `/categorias`, `/estoque`, `/produtos-parados`, `/relatorios/compras`, `/os`, `/ajuda` |
| `finance` | `/`, `/contas-a-receber`, `/contas-a-pagar`, `/financeiro`, `/relatorios`, `/clientes`, `/os`, `/ajuda` |
| `viewer` | `/`, `/ajuda` |

Implementado em `src/lib/roleAccess.ts` → `canAccessRoute(role, path)` consumido por sidebar/`RequireRoleRoute`.

### Permissões finas
`usePermissions()` deriva flags: `canManageEmployees`, `canCreateOwnerOrAdmin` (somente owner), `canManageProducts`, `canDeleteProducts`. `useCanViewCost()` oculta custos para vendedor.

---

## 2. Fluxo de Venda
1. `/vendas/nova` monta carrinho (produtos via `ProductSearch`, cliente via `CustomerSearch`).
2. Forma de pagamento: dinheiro, cartão, pix, fiado (gera parcela em aberto).
3. Submit → RPC `create_sale_atomic`:
   - Insere `sales` + `sale_items` + `payments` + `deliveries` (se houver).
   - Baixa `products.on_hand`, registra `stock_movements` tipo `sale`.
   - Se pagamento `cash/pix/debit`, lança em `cash_ledger`/`cash_entries`.
   - Se houver crédito fidelidade aplicado, chama `use_loyalty_credit_atomic`.
   - Trigger `trg_sales_loyalty_recalc` recalcula progresso do cliente.
   - Idempotente via `idempotency_keys`.
4. UI exibe `SaleDetailDialog`, com `ReceiptActions` (PDF/print).
5. Editar venda: `edit_sale_atomic` (reverte estoque/pagamento conforme flags).
6. Excluir: `delete_sale_permanently` registra em `sale_deletion_logs`.

## 3. Fluxo de Estoque
- Entradas (compra): `Stock` → `stock-adjust` edge → insere `stock_movements` tipo `purchase` + atualiza `products.on_hand` + `cost_price` (média).
- Saídas (ajuste, perda): mesma edge com tipo correspondente.
- Vendas e devoluções entram automaticamente via RPCs.
- `useLowStockAlert` dispara notificação quando `on_hand <= minimum_stock`.

## 4. Fluxo Financeiro
- Entradas: pagamento de vendas (instantâneo se dinheiro/cartão; futuro se fiado) → `cash_ledger` + `payments.paid_at`.
- Saídas: `accounts_payable` quitada via `settle_payable` → `cash_entries` debit.
- Saldo do caixa: soma `cash_ledger` por dia.
- `get_financial_report_summary` consolida.

## 5. Fluxo de Contas a Receber
1. Venda fiado → `payments` com status `pending`.
2. `/contas-a-receber` lista vendas com `payment_status != 'paid'`, ordenadas do mais recente ao mais antigo.
3. Quitação individual: `SettlePaymentDialog` → `settle_sale_payment`.
4. Quitação em lote: `BatchSettlePaymentDialog`.
5. Extrato PDF: `customerStatementPdf.ts` (todas pendências ou apenas vencidas) + botão WhatsApp.

## 6. Fluxo de Funcionários (performance)
- `get_employee_performance(start, end)` retorna por profile: contagem de vendas, receita, ticket médio, vendas pagas/pendentes, devoluções.
- `TeamPerformanceCard` no dashboard renderiza ranking.

## 7. Fluxo de Relatórios
- **Regra absoluta:** SSOT é `obter_relatorio_operacional_v2`. Nunca recalcular no frontend.
- Filtro "vendido" = `sales.sale_date`; "recebido" = `payments.paid_at`.
- Vendas retroativas: `p_sale_date` no RPC permite backdating com auditoria.
- `reportV2.ts` (frontend) e `reports-detailed`/`reports-summary`/`reports-ai-analysis` (edges).

## 8. Fluxo de Fidelidade
- Cliente acumula valor elegível (vendas pagas, excluídos descontos/devoluções).
- A cada `goal_amount` atingido, gera crédito `credit_amount` em `loyalty_credits`.
- `use_loyalty_credit_atomic` consome crédito durante uma venda (registra em `loyalty_credit_uses`).
- Triggers de sales/returns mantêm progresso em tempo real.
- `recalc_loyalty_for_customer/_for_store` reprocessa quando precisar.

## 9. Fluxo de Trocas
1. `/trocas` → escolhe venda original → marca itens devolvidos + motivo.
2. RPC `create_return_atomic`:
   - Insere `returns` + `return_items`.
   - Devolve estoque (`stock_movements` tipo `return`).
   - Atualiza `sales.total_returned`.
   - Trigger recalcula fidelidade.
3. Política: não permite devolver mais que o vendido.

## 10. Fluxo de Ordem de Serviço
1. `/os/nova` cria OS (cliente + descrição + equipamento).
2. Adiciona peças (`so_add_part`, debita estoque) e serviços (`so_add_service`).
3. Mudança de status registrada em `service_order_status_history` (open → diagnosing → awaiting_parts → in_progress → ready → delivered / cancelled).
4. Pagamentos via `so_settle_payment` (parcial/total).
5. PDF de OS via `serviceOrderPdf.ts`.

## 11. Fluxo Multi-tenant / Super Admin
- Cada `auth.users` ↔ `profiles` ↔ `store_id`.
- RLS força `store_id = get_my_store_id()` em todas as queries.
- Super admin (`system_admins.email`) ignora filtros e pode suspender lojas (`stores.access_enabled`).
- Ações registradas em `super_admin_logs`.
- Loja sem pagamento confirmado pelo super admin → redirecionada para `/verificacao-pagamento`.
