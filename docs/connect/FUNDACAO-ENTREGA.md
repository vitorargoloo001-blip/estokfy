# Estokfy Connect — Entrega da Fundação Unificada (2026-06-16)

**Status:** preparado e validado — **NÃO publicado** (conforme pedido). Banco de produção `aimasistzxghumuxxuaw` **intacto**; site no ar inalterado.
**Validação:** migrations testadas com transação revertida (BEGIN…ROLLBACK) contra o banco real + build de produção.

## 1. Decisão de arquitetura
Padronizado no **Desenho B** (o que as telas usam) + **blindagem de segurança**. O Desenho A (inbox/webhooks) foi removido como duplicado e fica guardado na pasta antiga para a fase Pluggy.

## 2. Arquivos alterados / criados / removidos (frontend)
**Criados:**
- `src/components/RequireConnectModule.tsx` — trava de licença nas rotas do Connect
- `src/components/ErrorBoundary.tsx` — captura erros e mostra mensagem amigável (nunca tela branca / "object object")

**Alterados:**
- `src/App.tsx` — rotas do Connect (`/connect/*`) com trava de licença + rotas super-admin (módulos, licenças Connect, financeiro) + ErrorBoundary
- `src/components/AppSidebar.tsx` — grupo de menu "Estokfy Connect" visível só com licença ativa (ou super admin)
- `src/contexts/AuthContext.tsx` — passa a carregar os módulos licenciados da loja (`get_store_modules`), com falha-segura (nega acesso se não carregar)
- `src/lib/roleAccess.ts` — `/connect` liberado para gerente e financeiro (dono/admin já têm tudo)
- `src/pages/Connect/Settings.tsx` — corrigido import inexistente (`StoreContext` → `useAuth`; caminho do supabase)

**Copiados da pasta antiga (dependências que faltavam):** `RequireMasterUser.tsx`, `ModuleToggleControl.tsx`, `useTransactions.ts`, `useReconciliation.ts`, `useMasterUser.ts`

**Removidos (legado/duplicado/quebrado):**
- Páginas `Connect/Overview.tsx`, `Connect/Audit.tsx` (usavam tabelas removidas) e `Connect/Setup.tsx` (dependia de componente inexistente `SetupWizard`)
- Hooks órfãos `useConnectBank.ts`, `useConnectRealtime.ts`

## 3. Migrations
**Removidas (duplicadas do Desenho A):** `…_estokfy_connect_schema.sql`, `…_estokfy_connect_rpc_core.sql`

**Conjunto final = 15 migrations (`20260617000003`…`000017`)**, todas reconciliadas com o schema real e prontas para aplicar:
store_modules_schema, store_modules_rpcs, module_audit_logs, master_financial_system, master_financial_rpcs, connect_setup_progress, bank_connections, bank_transactions, reconciliation_matches, connect_audit_logs, connect_licenses, pluggy_integration, pluggy_rpc_helpers, super_admin_stores_rpc, fix_connect_licenses_rpcs.

Principais correções aplicadas: ligação de perfil (`auth_user_id`), colunas reais de `stores`/`sales`/`customers`, política de RLS válida, sintaxe PostgreSQL (não MySQL), FK circular resolvida, `update_updated_at_column` criado, escapes `\$\$`.

## 4. Tabelas impactadas (todas NOVAS — nada existente foi alterado)
store_modules, connect_oauth_tokens, module_audit_logs, master_clients, master_contracts, master_contract_modules, master_payments, master_installation_status, master_audit_logs, connect_setup_progress, bank_connections, bank_sync_history, bank_transactions, reconciliation_matches, connect_audit_logs, connect_licenses, provider_webhooks.

## 5. RPCs criadas/alteradas (principais)
- **Licenciamento:** `has_module` (helper global), `get_store_modules`, `check_connect_enabled`, `toggle_store_module` 🔒
- **Licenças Connect:** `list/get_connect_license(s)`, `activate/suspend/cancel_connect_license` 🔒, `get_connect_license_stats`, `get_expiring_licenses`
- **Financeiro Impetus:** `is_master_user`, `get_financial_dashboard_kpis`, `list/create_master_client`, `get_contract_details`, `activate_contract_module` 🔒, `record_payment` 🔒
- **Bancos/Transações/Conciliação:** `list/create/delete_bank_connection`, `get_sync_history`, `list_bank_transactions`, `get_transaction_summary`, `update_transaction_status`, `get_pending_reconciliations`, `confirm/ignore/bulk_reconcile`
- **Auditoria:** `log_connect_audit`, `list_connect_audit_logs`, `get_connect_audit_summary`, `get_audit_timeline`, `list_module_audit`

🔒 = exige `is_super_admin()` / `is_master_user()` (só vitorargoloo001@gmail.com).

## 6. Edge Functions
12 funções presentes no repositório (manage-store-modules, connect-bank-oauth, connect-pluggy-auth-callback, sync-bank-accounts, sync-bank-transactions, run-bank-reconciliation, bank-webhook-handler, connect-webhook, connect-process-events, refresh-bank-connection, connect-alert-email, log-connect-audit). **Nenhuma publicada** (prepare-only). As de webhook/sync pertencem ao caminho Pluggy (adiado) e ficam estacionadas.

## 7. Testes executados
1. **Aplicação das 15 migrations** (transação revertida no banco real): **limpa, sem erros**.
2. **Segurança/licença** (usuário simulado): `is_super_admin` master=✓ / outro=✗; `toggle_store_module` master=sucesso, **não-master=RECUSADO**; `has_module` ✓.
3. **Isolamento entre lojas** (RLS, role authenticated): usuário vê só a própria loja (2 de 11 linhas).
4. **Build de produção**: ✓ compilou (todas as telas e rotas).

## 8. Pendências
- **Publicação** (quando você aprovar): aplicar migrations + deploy das funções + deploy do site.
- **Pluggy / integração bancária real** (Fases 5–7): adiada por sua decisão; funções de sync/webhook estacionadas (precisam de reescrita leve quando o Pluggy entrar).
- **"Renovar" licença:** existem ativar/suspender/cancelar; criar/renovar pode ser adicionado quando precisar.
- **Verificação visual** das telas (Super Admin/Connect): pendente — o preview local não roda nesta máquina (bug do Windows com espaço no caminho da pasta). Recomendo verificar após a publicação.
- `analytics`/`mobile`: reservados na lista de módulos (ainda sem funcionalidade).
