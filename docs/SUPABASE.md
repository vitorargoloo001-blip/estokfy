# SUPABASE.md — Estokfy

Documenta tudo do backend: RPCs, Edge Functions, Triggers, Views, Policies.

---

## 1. Convenções

- Isolamento por loja: `store_id` em quase todas as tabelas.
- Funções helper SECURITY DEFINER:
  - `get_my_store_id()` → `uuid` da loja do usuário autenticado.
  - `get_my_role()` → role textual (`owner|admin|manager|sales|stock|finance|viewer`).
  - `current_profile()` → linha completa do perfil ativo.
  - `is_super_admin()` → checa `system_admins`.
  - `check_store_access(store_id)` → loja ativa / não suspensa.
  - `require_active_profile()` → garante `is_active=true`.
- Todas as tabelas `public` têm RLS habilitada + GRANT explícito.

---

## 2. RPCs (funções públicas chamadas pelo frontend / edge)

### Auth / bootstrap

| Função | Para que serve |
|---|---|
| `bootstrap_new_store(p_auth_user_id, p_store_name, p_full_name)` | Provisiona loja completa no primeiro login: store, owner profile, 12 categorias, cash_ledger, 9 store_settings, audit. Idempotente. |
| `get_my_store_id()` | Retorna store do usuário atual (usada em policies). |
| `get_my_role()` | Retorna role do usuário atual. |
| `current_profile()` | Linha do profile do usuário. |
| `require_active_profile()` | Erro se perfil inativo. |

### Funcionários

| Função | Para que serve |
|---|---|
| `list_employees()` | Lista perfis da loja com email do auth. |
| `get_employee_performance(p_start, p_end)` | Métricas: vendas, ticket, devoluções por funcionário. |
| `update_employee_role(p_profile_id, p_new_role)` | Troca role com validação. |
| `set_employee_active(p_profile_id, p_active)` | Bloqueia/desbloqueia. |
| `can_delete_employee(p_profile_id)` | Valida se pode excluir (não-owner, sem vendas críticas). |

### Vendas

| Função | Para que serve |
|---|---|
| `create_sale_atomic(p_store_id, p_customer_id, p_items, p_payments, p_delivery, p_discount, p_due_date, p_sale_date, p_notes)` | **SSOT** de venda: cria sale + sale_items + payments + delivery, baixa estoque, gera stock_movements, alimenta cash_ledger, idempotente. Várias sobrecargas para retro-compat. |
| `edit_sale_atomic(...)` | Edita venda já criada com auditoria, reverte estoque/pagamento conforme flags. |
| `delete_sale_permanently(p_sale_id, p_reason)` | Exclusão definitiva com log em `sale_deletion_logs`. |
| `settle_sale_payment(p_sale_id, p_payments, p_paid_at, p_note)` | Quita parcial/total uma venda em aberto. |
| `revert_loyalty_credit_uses_for_sale(p_sale_id)` | Helper de reversão de créditos fidelidade. |

### Trocas / Devoluções

| Função | Para que serve |
|---|---|
| `create_return_atomic(p_store_id, p_sale_id, p_reason, p_items, p_notes)` | Cria devolução + return_items, devolve estoque, atualiza venda. |

### Produtos / Estoque

| Função | Para que serve |
|---|---|
| `create_or_update_product_with_stock(p_product, p_stock)` | Upsert de produto + ajuste inicial de estoque. |
| `apply_bulk_product_updates(...)` | Bulk update por ids/filter, processa em lotes, registra em `bulk_operations_log`. |
| `resolve_product_ids_by_filter(...)` / `_page(...)` | Resolve filtros complexos com paginação keyset. |
| `count_products_by_filter(...)` | Total para paginação. |
| `product_history(p_product_id)` | Timeline unificada (compras, vendas, ajustes, trocas). |
| `product_analytics(p_store_id)` | Margem, dias parados, dias até zerar, qty vendida 30d. |

### Contas a pagar

| Função | Para que serve |
|---|---|
| `settle_payable(p_payable_id, p_payment_method, p_paid_amount, p_paid_at)` | Marca conta paga e lança cash_entry. |

### Clientes / Fidelidade

| Função | Para que serve |
|---|---|
| `customer_360(p_customer_id)` | Resumo total do cliente: vendas, débitos, fidelidade. |
| `customer_loyalty_summary(p_customer_id)` | Status fidelidade. |
| `get_loyalty_settings()` / `_for_store(id)` | Lê configurações. |
| `loyalty_ranking()` | Ranking de clientes por progresso. |
| `loyalty_recalc_preview()` | Preview de recálculo. |
| `recalc_loyalty_for_customer(id)` / `_for_store()` | Reprocessa créditos. |
| `use_loyalty_credit_atomic(p_sale_id, p_amount)` | Aplica crédito numa venda. |

### Ordens de Serviço

| Função | Para que serve |
|---|---|
| `create_service_order(p_payload)` | Cria OS com itens iniciais. |
| `so_add_part(os, product, qty, unit_price)` | Adiciona peça. |
| `so_add_service(os, desc, qty, unit_price)` | Adiciona serviço. |
| `so_remove_item(item)` | Remove item. |
| `so_change_status(os, status, note)` | Muda status (registra em `service_order_status_history`). |
| `so_settle_payment(os, amount, method, note)` | Lança pagamento da OS. |
| `so_recalc_totals(id)` | Recalcula totais. |

### Relatórios (SSOT)

| Função | Para que serve |
|---|---|
| `obter_relatorio_operacional_v2(p_store_id, p_start, p_end, p_employee_id, p_payment_method, p_customer_id)` | **Fonte única** de relatórios. "Vendido" usa `sales.sale_date`, "recebido" usa `payments.paid_at`. NUNCA recalcular no frontend. |
| `get_financial_report_summary(...)` | Resumo financeiro consolidado. |
| `dashboard_intelligence(p_limit)` | Cards inteligentes do dashboard. |
| `refresh_store_notifications()` | Atualiza alertas. |

### Super Admin / Acesso

| Função | Para que serve |
|---|---|
| `is_super_admin()` | Checa `system_admins`. |
| `check_store_access(p_store_id)` | Loja suspensa/bloqueada/inativa? |

### Triggers (funções `RETURNS trigger`)

| Trigger | Tabela | Função |
|---|---|---|
| `audit_product_changes` | products | Auditoria automática em `audit_logs`. |
| `generate_category_slug` | categories | Slug automático no insert. |
| `set_occurred_at_minute` | stock_movements | Trunca timestamp ao minuto. |
| `set_paid_at_minute` | payments | Idem para `paid_at`. |
| `touch_accounts_payable` | accounts_payable | `updated_at = now()`. |
| `so_set_updated_at` | service_orders | `updated_at = now()`. |
| `trg_sales_loyalty_recalc` | sales (AFTER) | Recalcula créditos do cliente. |
| `trg_returns_loyalty_recalc` | returns (AFTER) | Idem após devolução. |

---

## 3. Edge Functions (`supabase/functions/`)

| Função | Descrição | Auth |
|---|---|---|
| `ai-support-chat` | Chat IA com Lovable AI Gateway, contexto + ações. | JWT |
| `employees-invite` | Cria auth user com senha + profile + audit. | JWT (owner/admin/manager) |
| `employees-admin` | Ações `update / reset_password / delete`. | JWT |
| `sales-create` | (legacy) wrapper de `create_sale_atomic`, valida `check_store_access`. | JWT |
| `sales-settle-payment` | Quita venda (parcial/total). | JWT |
| `returns-create` | Wrapper de `create_return_atomic`. | JWT |
| `stock-adjust` | Ajuste manual de estoque + auditoria. | JWT |
| `reports-summary` | Resumo agregado para IA. | JWT |
| `reports-detailed` | Detalhamento por dimensão. | JWT |
| `reports-ai-analysis` | Insight gerado por IA sobre relatório. | JWT |
| `pixel-events` | Webhook público: recebe eventos de sites externos (purchase_approved, refund, customer_created…). Valida `x-pixel-id`+`x-pixel-key`. | **público (sem JWT)** |
| `verify-payment` | Recebe comprovante de pagamento da assinatura. | JWT |

---

## 4. Views

Nenhuma view materializada/regular em `public`. Toda agregação vive em RPCs (mais flexível e RLS-safe).

---

## 5. Políticas RLS — padrão por tabela

Padrão recorrente:

```
SELECT  USING (store_id = get_my_store_id())
INSERT  WITH CHECK (store_id = get_my_store_id() AND get_my_role() IN (...))
UPDATE  USING (store_id = get_my_store_id() AND get_my_role() IN (...))
DELETE  USING (store_id = get_my_store_id() AND get_my_role() IN (...))
```

Tabelas e níveis de acesso (resumo):

- **stores** — SELECT própria; UPDATE owner; super_admin SELECT/UPDATE todas.
- **profiles** — SELECT próprios da loja; INSERT/UPDATE/DELETE owner/admin/manager. Super admin SELECT total.
- **user roles** — *NÃO existe `user_roles` separada*; role mora em `profiles.role` mas é **lido apenas via `get_my_role()` SECURITY DEFINER** para evitar recursão. (Privilege escalation evitada porque INSERT/UPDATE do próprio `profiles.role` é bloqueado por role checks.)
- **categories / suppliers / products** — SELECT da loja; mutações owner/admin/manager/stock.
- **stock_movements** — SELECT da loja; INSERT owner/admin/manager/stock; UPDATE/DELETE owner/admin.
- **sales / sale_items / payments / deliveries** — SELECT da loja; mutações owner/admin/manager/sales (sales mutáveis até confirmação).
- **returns / return_items** — SELECT loja; mutações owner/admin/manager/sales.
- **accounts_payable / cash_entries / cash_ledger** — SELECT loja; mutações owner/admin/manager/finance.
- **customers** — SELECT loja; mutações owner/admin/manager/sales/finance.
- **service_orders / _items / _payments / _photos / _status_history** — SELECT loja; mutações owner/admin/manager/sales/stock.
- **loyalty_credits / _uses** — SELECT loja; managed por triggers/RPC.
- **store_settings** — SELECT loja; UPDATE owner/admin.
- **store_pixels** — SELECT/INSERT/UPDATE owner/admin; super admin SELECT.
- **pixel_events** — SELECT da loja; INSERT via service_role (edge `pixel-events`).
- **notifications** — SELECT loja; INSERT sistema; UPDATE/DELETE do destinatário.
- **audit_logs / sale_audit_logs / sale_deletion_logs / bulk_operations_log** — SELECT owner/admin/manager; INSERT por triggers/RPC.
- **idempotency_keys** — usado por RPCs (acesso restrito).
- **ai_conversations / ai_messages** — usuário vê só os próprios.
- **ai_events** — escopo da loja.
- **ai_handoffs / ai_training_data** — owner/admin/manager.
- **system_admins** — SELECT/UPDATE só por super_admin via função.
- **super_admin_logs** — SELECT/INSERT só por super_admin.
- **payment_verifications** — SELECT própria loja + super_admin; INSERT loja; UPDATE super_admin.
- **report_ai_analyses** — escopo da loja, mutações owner/admin/manager.

GRANT em todas as tabelas `public`:

```sql
GRANT SELECT, INSERT, UPDATE, DELETE ON public.<t> TO authenticated;
GRANT ALL ON public.<t> TO service_role;
```

`anon` só recebe SELECT em tabelas com política pública (nenhuma atual além de leitura via edge `pixel-events` que usa service_role).
