# Estokfy Connect V1 — Relatório Técnico Block 2

**Data:** 2026-06-20  
**Build:** ✅ 0 erros TypeScript (4493 módulos, 17.5s)

---

## 1. Arquivos Alterados / Criados

### Migrations (novas)

| Arquivo | Descrição |
|---------|-----------|
| `supabase/migrations/20260620000006_connect_conciliation_v2.sql` | Notes em matches, undo, search v2 com score |
| `supabase/migrations/20260620000007_connect_divergences.sql` | Central de divergências: tipos, RPCs, trigger |
| `supabase/migrations/20260620000008_connect_dashboard_v3.sql` | KPI manual_reconciled, trend por período |
| `supabase/migrations/20260620000009_connect_scenario.sql` | Sandbox cenário completo (40 txns) |

### Frontend (alterado)

| Arquivo | Tipo | Descrição |
|---------|------|-----------|
| `src/pages/Connect/ConnectReconciliation.tsx` | Atualizado | Busca estendida (nome/tel/produto/obs), score de compatibilidade, dialog notas, botão Desfazer, fix tbody |
| `src/pages/Connect/Discrepancies.tsx` | Rebuild completo | Central de Divergências com 6 classificações, filtros, Classificar/Vincular/Ignorar |
| `src/pages/Connect/ConnectOverview.tsx` | Atualizado | Card manual_reconciled, seletor período (7d/30d/90d), botão "Gerar cenário completo" |
| `src/pages/Connect/ConnectAudit.tsx` | Corrigido | Fix bug `<tbody>` aninhado → `React.Fragment` |
| `_migracao/apply-connect-v1-migrations.mjs` | Atualizado | Inclui migrations 006-009 |

---

## 2. Tabelas Criadas / Alteradas

### Tabelas alteradas

| Tabela | Coluna adicionada | Tipo | Descrição |
|--------|-------------------|------|-----------|
| `reconciliation_matches` | `notes` | TEXT | Observação do operador |
| `bank_transactions` | `divergence_type` | TEXT (CHECK) | Classificação da divergência |
| `bank_transactions` | `divergence_reason` | TEXT | Motivo textual da divergência |
| `connect_alerts` | constraint atualizado | — | Novos tipos: `duplicate_payment`, `suspicious_receipt` |

### Tabelas criadas (Block 1 — aguardando deploy)

| Tabela | Descrição |
|--------|-----------|
| `connect_alerts` | Alertas do módulo Connect com RLS |

---

## 3. RPCs Criadas / Atualizadas

### Block 2 — novas

| RPC | Assinatura resumida | Descrição |
|-----|---------------------|-----------|
| `add_reconciliation_note` | `(match_id, note)` | Adiciona observação a um match (com audit before/after) |
| `undo_reconciliation` | `(match_id)` | Desfaz conciliação confirmada → pending (com audit before/after) |
| `search_sales_for_match_v2` | `(store_id, amount?, date?, name?, phone?, product?, obs?, limit)` | Busca estendida com compatibility_score 0-100 |
| `get_divergences_detailed` | `(store_id, type?, date_start?, date_end?, amount_min?, amount_max?, customer?, limit, offset)` | Lista divergências com todos os filtros |
| `classify_divergence` | `(tx_id, type, reason?)` | Classifica o tipo de divergência (audit before/after) |
| `resolve_divergence_link` | `(tx_id, sale_id)` | Vincula divergência a uma venda → status reconciled |
| `ignore_divergence` | `(tx_id, reason?)` | Ignora divergência (audit registrado) |
| `get_reconciliation_trend_by_period` | `(store_id, period)` | Trend diário: period = 'week'\|'month'\|'quarter' |
| `connect_seed_scenario_completo` | `(store_id)` | Sandbox completo: 40 txns, 6 tipos divergência, 6 alertas |

### Block 2 — atualizadas (CREATE OR REPLACE)

| RPC | Mudança |
|-----|---------|
| `connect_get_dashboard_kpis` | Adicionado campo `manual_reconciled` |

### Block 1 — novas (aguardando deploy)

| RPC | Descrição |
|-----|-----------|
| `get_reconciliation_history` | Histórico confirmadas/ignoradas com contexto |
| `reopen_reconciliation` | Reverte ignored → pending |
| `get_reconciliation_report` | Relatório consolidado com KPIs |
| `get_reconciliation_trend` | Trend 30d (legado, mantido para compatibilidade) |
| `get_reconciliation_by_method` | Breakdown por método de pagamento |
| `create_connect_alert` | Cria alerta (chamado por triggers) |
| `list_connect_alerts` | Lista alertas ativos da loja |
| `dismiss_connect_alert` | Dispensa alerta individual |
| `mark_connect_alert_read` | Marca como lido |
| `dismiss_all_connect_alerts` | Dispensa todos |
| `get_unread_alert_count` | Contador de não lidos |
| `connect_seed_demo_data` | Sandbox básico V2 |

---

## 4. Triggers

| Trigger | Tabela | Evento | Ação |
|---------|--------|--------|------|
| `trg_divergent_transaction_alert` | `bank_transactions` | INSERT/UPDATE status='divergent' | Cria alerta `divergent_transaction` |
| `trg_auto_classify_divergence` | `bank_transactions` | INSERT/UPDATE status='divergent' | Define `divergence_type = 'receipt_without_sale'` se NULL |

---

## 5. Edge Functions

Nenhuma Edge Function foi criada neste bloco. Toda a lógica está em RPCs PostgreSQL com `SECURITY DEFINER`.

---

## 6. Fluxos Implementados

### Conciliação manual profissional
- **Busca por:** nome, telefone, produto, observação
- **Score de compatibilidade:** 0–100 baseado em desvio de valor, data, match de telefone/nome
- **Ações:** Confirmar, Buscar, Ignorar (bulk ou individual), Adicionar nota, Desfazer
- **Histórico:** aba Confirmadas + aba Ignoradas com Reabrir
- **Auditoria:** `before` e `after` em todos os eventos

### Central de Divergências
- **6 classificações:** valor diferente, data diferente, cliente não identificado, pagamento duplicado, recebimento sem venda, venda sem recebimento
- **Filtros:** tipo, data início/fim, valor min/max, busca por descrição
- **Cards de contagem** clicáveis (filtram a tabela)
- **Ações:** Classificar (dialog), Vincular (busca por venda + score), Ignorar (com motivo)

### Dashboard Executivo V3
- **Novos KPIs:** `Conciliado manualmente` (teal)
- **Seletor de período:** 7d / 30d / 90d no gráfico de tendência
- **Sandbox:** Botão "Gerar cenário completo" (indigo, super admin)

### Sandbox — Cenário Completo
- **40 transações:** PIX (15), Cartão crédito/débito (8), TED/Boleto/Dinheiro (6), Recebimentos atrasados (5), Divergências (6), Ignoradas (3)
- **Divergências de todos os 5 tipos** com razões detalhadas
- **6 alertas** criados automaticamente (info, warning, error)
- **Gate:** somente `vitorargoloo001@gmail.com`

---

## 7. Isolamento e Segurança

- Todas as RPCs verificam `store_id` via `auth.uid()` → `profiles` antes de operar
- `connect_seed_scenario_completo` verifica email exato do super admin
- Novas colunas (`divergence_type`, `notes`) passam por mesmo gate de RLS
- Audit logs registram `before`/`after` em todas as ações de Block 2
- Trigger `trg_auto_classify_divergence` é BEFORE INSERT/UPDATE (não pode ser bypassado)

---

## 8. Status de Deploy

| Item | Status |
|------|--------|
| Build TypeScript | ✅ 0 erros |
| Migrations 001-005 (Block 1) | ⏳ Aguardando autorização |
| Migrations 006-009 (Block 2) | ⏳ Aguardando autorização |
| Git push → Cloudflare Pages | ⏳ Aguardando autorização |

---

## 9. Próximos passos (Connect V2)

Após deploy e homologação do V1:
- Integração Pluggy (OAuth, sync-accounts, sync-transactions)
- Webhook de eventos bancários em tempo real
- Motor de reconciliação automática com dados reais
