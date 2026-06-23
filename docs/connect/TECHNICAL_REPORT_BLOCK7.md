# Estokfy Connect — Relatório Técnico Block 7
**Versão:** Block 7 — Automações Inteligentes  
**Data:** 2026-06-22  
**Supabase Project:** `aimasistzxghumuxxuaw`  
**Migration:** `20260622000030_connect_block7_automations.sql` ✅ aplicada

---

## 1. Objetivo

Transformar o Estokfy Connect em um módulo que executa **ações automáticas com segurança, auditoria e controle por loja** — configuráveis por usuário autorizado, com aprovação humana obrigatória para automações de impacto financeiro.

---

## 2. Tabelas Criadas

### `connect_automations`
Configuração de cada automação por loja.

| Campo | Tipo | Descrição |
|-------|------|-----------|
| `id` | UUID PK | Identificador único |
| `store_id` | UUID FK → stores | Isolamento multi-tenant |
| `type` | TEXT CHECK | Tipo: auto_reconciliation, divergence_alert, bank_disconnected, daily_report, weekly_report, overdue_collection, cashflow_risk |
| `name` | TEXT | Nome dado pelo usuário |
| `is_active` | BOOLEAN | Ativação por toggle |
| `config` | JSONB | Parâmetros específicos por tipo |
| `schedule_config` | JSONB | frequency, hour, minute, day_of_week, day_of_month |
| `channels` | TEXT[] | internal, email (futuro: whatsapp, sms, webhook) |
| `last_run_at` | TIMESTAMPTZ | Última execução |
| `last_run_status` | TEXT | success \| error \| pending \| skipped \| pending_approval |
| `created_by` | UUID | Auditoria de criação |
| `updated_by` | UUID | Auditoria de atualização |

### `connect_automation_runs`
Registro de cada execução.

| Campo | Descrição |
|-------|-----------|
| `idempotency_key` | UNIQUE — evita execução duplicada (cron) |
| `trigger_type` | manual \| cron \| ai \| test |
| `requires_approval` | true para overdue_collection |
| `approved_by / approved_at` | Aprovação registrada com responsável |
| `result` | JSONB com dados da execução |
| `items_affected` | Quantos itens foram processados |

### `connect_automation_logs`
Log nível info/warning/error por execução — rastreabilidade completa.

### `connect_notifications`
Notificações internas geradas pelas automações. Canal: internal (ativo), email (preparado).

### `connect_notification_recipients`
Destinatários por automação (futuro: multi-usuário por loja).

---

## 3. RPCs Implementadas

| RPC | Permissão | Função |
|-----|-----------|--------|
| `get_connect_automations(store_id)` | authenticated | Listar automações com stats (runs_today, runs_total, errors_total) |
| `create_connect_automation(...)` | owner/admin/manager/finance | Criar automação |
| `update_connect_automation(...)` | owner/admin/manager/finance | Atualizar automação |
| `toggle_connect_automation(id, store_id)` | owner/admin/manager/finance | Ativar/desativar |
| `delete_connect_automation(id, store_id)` | owner/admin/manager/finance | Excluir |
| `start_automation_run(...)` | authenticated + service_role | Iniciar execução com idempotência |
| `complete_automation_run(...)` | authenticated + service_role | Finalizar execução |
| `approve_automation_run(run_id, store_id)` | owner/admin/manager/finance | Aprovar execução pendente |
| `add_automation_log(...)` | authenticated + service_role | Registrar log |
| `create_connect_notification(...)` | authenticated + service_role | Criar notificação interna |
| `get_connect_notifications(store_id, ...)` | authenticated | Listar notificações |
| `mark_notification_read(id, store_id)` | authenticated | Marcar como lida |
| `get_automation_runs(auto_id, store_id)` | authenticated | Histórico de execuções |
| `get_automations_dashboard(store_id)` | authenticated | KPIs: ativas, runs_hoje, erros, aprovações pendentes |
| `get_pending_approvals(store_id)` | authenticated | Execuções aguardando aprovação humana |
| `trigger_ai_automations(store_id)` | authenticated | Integração IA→Automações |
| `_has_automation_permission(store_id)` | internal | Verificação de role |

### Verificação de permissão
```sql
SELECT role NOT IN ('sales', 'stock')
FROM profiles WHERE id = auth.uid() AND store_id = p_store_id;
-- Permite: owner, admin, manager, finance
-- Bloqueia: sales (vendedor), stock (estoquista)
```

---

## 4. Edge Function — `run-connect-automations`

**Deploy:** `supabase/functions/run-connect-automations/index.ts`

### Autenticação
- JWT de usuário (chamadas manuais via frontend)
- `X-Internal-Secret` header (futuro: cron/scheduler)

### Fluxo de execução
```
1. Validar auth (JWT ou X-Internal-Secret)
2. Buscar automação + verificar store_id
3. Verificar licença Connect ativa
4. Gerar idempotency_key (para cron: {automation_id}:{YYYY-MM-DDTHH})
5. start_automation_run() → retorna run_id ou NULL (já executado)
6. Executar lógica por tipo
7. complete_automation_run(run_id, status, result, error, items, duration_ms)
8. Retornar {run_id, status, items_affected, duration_ms}
```

### Lógicas por tipo

| Tipo | O que faz |
|------|-----------|
| `auto_reconciliation` | Chama `connect_run_matching`, confirma matches com score ≥ min_confidence |
| `divergence_alert` | Conta `bank_transactions WHERE status='divergent'`, cria notificação se ≥ min_divergences |
| `bank_disconnected` | Detecta bank_connections offline há mais de max_hours_offline, alerta crítico |
| `daily_report` | Chama `get_store_financial_summary`, cria notificação com resumo semana/mês |
| `weekly_report` | Resumo semanal com semana ISO, crescimento MoM, previsão |
| `overdue_collection` | Agrega clientes com débito vencido por cliente, status = `pending_approval`, NÃO envia nada |
| `cashflow_risk` | Chama `get_cashflow_forecast`, calcula % em risco, notifica se ≥ at_risk_threshold_pct |

---

## 5. Frontend — `ConnectAutomations.tsx`

**Rota:** `/connect/automacoes`  
**Guard:** `RequireConnectModule`  
**Bundle:** `ConnectAutomations-CFz5BCyE.js` (21.06 kB / 6.49 kB gzip)

### 3 tabs

#### Tab "Automações"
- Card por automação: tipo com ícone+cor, toggle ativo/inativo, botão executar agora, editar, excluir
- Histórico expandível (arrow) — últimas 10 execuções com status/duração/erros
- Estado vazio com CTA para criar primeira automação
- Dashboard KPI bar: 6 métricas (ativas, execuções hoje, erros, aprovações, notificações, próxima)

#### Tab "Aprovações"
- Lista de execuções com `status = 'pending_approval'`
- Tabela de clientes com débito (para overdue_collection)
- Template de mensagem preparado (NÃO enviado)
- Botão "Aprovar (marcar como revisado)" — registra `approved_by + approved_at`
- Aviso explícito: "Nenhuma mensagem é enviada automaticamente"

#### Tab "Notificações"
- Notificações internas geradas pelas automações
- Borda colorida por severidade (info/warning/critical)
- Botão marcar como lida

### Dialog criar/editar
- Seletor de tipo (apenas ao criar)
- Frequência: manual / hourly / daily / weekly / monthly
- Configuração JSON (parâmetros por tipo)
- Canais: internal + email (checkbox)
- Toggle ativar imediatamente
- Aviso para overdue_collection sobre aprovação

---

## 6. Tipos de Automação — Configs padrão

| Tipo | Config padrão | Parâmetros |
|------|--------------|------------|
| `auto_reconciliation` | `{"min_confidence": 85}` | min_confidence (0-100) |
| `divergence_alert` | `{"min_divergences": 1}` | min_divergences |
| `bank_disconnected` | `{"max_hours_offline": 24}` | max_hours_offline |
| `daily_report` | `{"send_hour": 8}` | send_hour (0-23) |
| `weekly_report` | `{"send_day": 1, "send_hour": 8}` | send_day (1=seg), send_hour |
| `overdue_collection` | `{"min_days_overdue": 1, "min_amount": 0}` | min_days_overdue, min_amount |
| `cashflow_risk` | `{"at_risk_threshold_pct": 30}` | at_risk_threshold_pct (0-100) |

---

## 7. Integração com IA (Block 6)

`trigger_ai_automations(store_id)` — chamado via botão "Disparar IA" no header.

Percorre automações ativas de tipos de monitoramento e cria notificações internas baseadas em dados reais:

```
divergence_alert → COUNT bank_transactions WHERE status='divergent'
bank_disconnected → COUNT bank_connections WHERE status IN ('error','disconnected') AND last_sync < threshold
cashflow_risk → CTE com debit forecast vs pending receivables
```

Retorna `{triggered: N, notifications_created: N}`.

---

## 8. Segurança

| Mecanismo | Cobertura |
|-----------|-----------|
| RLS em todas as tabelas | `store_id = get_my_store_id()` |
| `_has_automation_permission()` | Roles: owner, admin, manager, finance |
| Permissão explícita em create/update/delete/toggle/approve | Retorna EXCEPTION se role insuficiente |
| Isolamento multi-tenant | Todas as queries filtram por `store_id` |
| Verificação licença na Edge Function | `connect_licenses WHERE status = 'active'` |
| Idempotência para cron | `idempotency_key UNIQUE` — execução duplicada retorna NULL e é ignorada |
| Aprovação humana obrigatória | `overdue_collection` nunca muda status para success sem `approve_automation_run` |
| Auditoria completa | created_by, updated_by, triggered_by, approved_by em cada record |

---

## 9. Permissões por Role

| Ação | owner | admin | manager | finance | sales | stock |
|------|-------|-------|---------|---------|-------|-------|
| Criar automação | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Editar automação | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ativar/desativar | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Executar manualmente | ✅ | ✅ | ✅ | ✅ | ✅* | ✅* |
| Aprovar | ✅ | ✅ | ✅ | ✅ | ❌ | ❌ |
| Ver histórico | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

*Execução manual requer apenas autenticação válida na loja (chama Edge Function via JWT).

---

## 10. Arquivos Criados/Modificados

### Criados
- `supabase/migrations/20260622000030_connect_block7_automations.sql`
- `supabase/functions/run-connect-automations/index.ts`
- `src/pages/Connect/ConnectAutomations.tsx`
- `docs/connect/TECHNICAL_REPORT_BLOCK7.md`

### Modificados
- `src/App.tsx` — lazy import + rota `/connect/automacoes`
- `src/pages/Connect/ConnectOverview.tsx` — card "🤖 Automações" na grade de navegação
- `_migracao/apply-connect-v1-migrations.mjs` — migration Block 7 adicionada

---

## 11. Limitações e Próximos Passos

| Item | Status | Próximo passo |
|------|--------|---------------|
| Cron/scheduler | Preparado na Edge Function | Integrar com Supabase Edge Cron ou Cloudflare Cron Trigger |
| E-mail | Canal preparado (checked no form) | Conectar ao `send-alert-email` Edge Function por canal='email' |
| WhatsApp / SMS | Estrutura no schema | Block 8+ — integração com provider |
| Webhook externo | Campo `channels TEXT[]` suporta 'webhook' | Block 8+ — campo webhook_url na config |
| `next_run_at` | Calculado manualmente | Automatizar via trigger ou cron update |
| Execução automática real | Preparada para cron | Ativar com Supabase pg_cron ou externo |

---

## 12. Critérios de Conclusão — Checklist

| Critério | Status |
|----------|--------|
| Automações configuráveis por loja | ✅ |
| Execução manual funcionando | ✅ — via Edge Function + JWT |
| Logs funcionando | ✅ — connect_automation_logs |
| Auditoria funcionando | ✅ — created_by, updated_by, triggered_by, approved_by |
| Alertas internos funcionando | ✅ — connect_notifications |
| E-mail preparado | ✅ — canal 'email' no schema, pronto para conectar |
| IA alimenta automações | ✅ — `trigger_ai_automations()` RPC |
| Permissões corretas | ✅ — role check em create/update/delete/approve |
| Multi-tenant preservado | ✅ — store_id em todas as tabelas + RLS |
| Build passou | ✅ — `✓ built in 25.21s`, 0 erros TypeScript |
| Relatório técnico gerado | ✅ |
| Aprovação humana obrigatória (overdue) | ✅ — status pending_approval, sem envio automático |
| Idempotência para cron | ✅ — idempotency_key UNIQUE |

---

*Estokfy Connect Block 7 — 2026-06-22*
