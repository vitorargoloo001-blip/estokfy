# TECHNICAL REPORT — Block 8: Estokfy Finance Platform

**Data:** 2026-06-22
**Branch:** main
**Commit:** e738a66
**Status:** ✅ Concluído e em produção

---

## Objetivo

Transformar o Estokfy Connect em uma plataforma financeira completa para pequenas e médias empresas.

---

## Arquivos criados

### Frontend — `src/pages/Finance/`

| Arquivo | Rota | Descrição |
|---|---|---|
| `FinanceDashboard.tsx` | `/finance/dashboard` | Dashboard executivo com 6 KPIs, growth badges, metas |
| `FluxoCaixa.tsx` | `/finance/fluxo-caixa` | Fluxo de caixa profissional hoje/semana/mês/custom |
| `DRE.tsx` | `/finance/dre` | DRE Gerencial com comparativo mês anterior |
| `Metas.tsx` | `/finance/metas` | CRUD de metas financeiras com progresso realizado |

### Backend

| Arquivo | Tipo | Descrição |
|---|---|---|
| `supabase/migrations/20260622000040_block8_finance.sql` | Migration | Tabelas + 13 RPCs |
| `supabase/functions/finance-api/index.ts` | Edge Function | REST API pública autenticada |

---

## Migration — Tabelas criadas

### `finance_cost_centers`
```sql
id UUID, store_id UUID, name TEXT, budget_monthly NUMERIC,
category CHECK IN ('aluguel','funcionarios','impostos','marketing','compras','outros'),
is_active BOOLEAN, created_by UUID
```
- RLS: store_id = get_my_store_id()
- 2 RPCs: `get_cost_centers`, `upsert_cost_center`

### `finance_goals`
```sql
id UUID, store_id UUID, goal_type TEXT, period_month INT, period_year INT,
target_value NUMERIC, notes TEXT
UNIQUE (store_id, goal_type, period_month, period_year)
goal_type CHECK IN ('faturamento','lucro','recebimentos','inadimplencia')
```
- RLS: store_id = get_my_store_id()
- 3 RPCs: `get_finance_goals_progress`, `upsert_finance_goal`, `delete_finance_goal`

### `store_groups` + `store_group_members`
```sql
store_groups: id, name, owner_id FK auth.users
store_group_members: group_id, store_id, PRIMARY KEY(group_id, store_id)
```
- RLS: owner_id = auth.uid()
- 1 RPC: `get_consolidated_finance(group_id)`

### ALTER `accounts_payable`
```sql
ADD cost_center_id UUID FK finance_cost_centers
ADD recurrence TEXT CHECK IN ('none','weekly','monthly','yearly') DEFAULT 'none'
ADD recurrence_config JSONB
```

---

## RPCs implementados

### `get_professional_cashflow(p_store_id, p_period, p_start, p_end)`
**Retorno:** TABLE com série diária
```
day DATE, confirmed_in NUMERIC, projected_in NUMERIC, total_out NUMERIC,
daily_balance NUMERIC, running_balance NUMERIC (SUM OVER)
```
**Fontes:**
- `confirmed_in`: payments.amount (vendas pagas) + cash_entries income
- `projected_in`: sales.amount_pending (status pending/partial)
- `total_out`: accounts_payable.amount (paid_at no período) + cash_entries expense

**Períodos suportados:** `today`, `week`, `month`, `custom` (+ p_start/p_end)

### `get_dre(p_store_id, p_month, p_year)` → JSONB
```json
{
  "receita_bruta": 0,
  "cogs": 0,
  "lucro_bruto": 0,
  "margem_bruta": 0.0,
  "despesas_operacionais": 0,
  "desp_breakdown": {"impostos":0,"pessoal":0,"aluguel":0,"marketing":0,"outros":0},
  "lucro_operacional": 0,
  "lucro_liquido": 0,
  "margem_liquida": 0.0
}
```
**Fontes:**
- Receita: `sales.net_total` (created_at no mês, não deletadas)
- COGS: `cash_entries` com category ILIKE '%Compra de%'
- Despesas: `accounts_payable.paid_at` + `cash_entries.expense` por categoria

### `get_dre_comparison(p_store_id, p_month, p_year)` → JSONB
Chama `get_dre` para mês atual e mês anterior, retorna `{current, previous}`.

### `get_finance_goals_progress(p_store_id, p_month, p_year)` → TABLE
```
goal_id, goal_type, target_value, realized, progress_pct, notes, on_track BOOLEAN
```
**Cálculo de `realized` por tipo:**
- `faturamento`: SUM(sales.net_total) do mês
- `lucro`: lucro_bruto do DRE
- `recebimentos`: SUM(payments.amount) do mês
- `inadimplencia`: (valor overdue / valor total pendente) × 100
- `on_track`: `realized >= target * (day_of_month / days_in_month)` (proporcional ao dia)
  - Para inadimplencia: `realized <= target`

### `upsert_finance_goal(store_id, goal_type, month, year, target, notes)` → UUID
ON CONFLICT (store_id, goal_type, period_month, period_year) DO UPDATE

### `delete_finance_goal(id, store_id)` → BOOLEAN
Requer que store_id = get_my_store_id()

### `get_cost_centers(p_store_id)` → SETOF finance_cost_centers
### `upsert_cost_center(store_id, id, name, category, budget, active)` → UUID

### `get_executive_finance_dashboard(p_store_id)` → JSONB
```json
{
  "receita_mes": 0, "receita_semana": 0, "receita_hoje": 0,
  "receita_growth_pct": null,
  "despesas_mes": 0, "lucro_mes": 0, "lucro_growth_pct": null,
  "margem_pct": 0.0, "recebido_mes": 0, "a_receber": 0, "a_pagar": 0,
  "delinquency_rate": 0.0, "saldo_caixa": 0,
  "goals_total": 0, "goals_on_track": 0
}
```

### `get_ar_risk_analysis(p_store_id, p_limit)` → TABLE
```
customer_id, customer_name, total_pending, overdue_amount, max_days_late,
payment_rate, risk_score (0-100), risk_level ('alto'/'medio'/'baixo'), avg_delay_days
```
**Score:** days_overdue (0-50pts) + amount_factor (0-30pts) + history_factor (0-20pts)

### `get_consolidated_finance(p_group_id)` → JSONB
Agrega receita, a_receber, a_pagar de todas as lojas do grupo

### `get_payables_with_alerts(p_store_id, p_status)` → TABLE
```
id, description, amount, due_date, supplier_name, cost_center_name,
recurrence, alert_level ('vencido'/'hoje'/'vencendo'/'ok'), days_until_due
```

---

## Edge Function — `finance-api`

**URL:** `{SUPABASE_URL}/functions/v1/finance-api/{endpoint}`
**Auth:** `Authorization: Bearer {JWT}`

| Endpoint | Método | Query params | RPC chamado |
|---|---|---|---|
| `/cashflow` | GET | `store_id`, `period`, `start`, `end` | `get_professional_cashflow` |
| `/dre` | GET | `store_id`, `month`, `year` | `get_dre_comparison` |
| `/goals` | GET | `store_id`, `month`, `year` | `get_finance_goals_progress` |
| `/accounts` | GET | `store_id`, `status` | `get_payables_with_alerts` + sales query |
| `/dashboard` | GET | `store_id` | `get_executive_finance_dashboard` |
| `/ar-risk` | GET | `store_id`, `limit` | `get_ar_risk_analysis` |

**Response envelope:**
```json
{"success": true, "data": {...}, "ts": "2026-06-22T..."}
{"success": false, "error": "mensagem"}
```

---

## Frontend — Funcionalidades

### FinanceDashboard (`/finance/dashboard`)
- 6 KPI cards: Receita Mês, Lucro Mês, Recebido Mês, A Pagar, Inadimplência, Saldo Caixa
- `GrowthBadge` component com ArrowUpRight/ArrowDownRight colorido
- Card de progresso de metas quando `goals_total > 0`
- Navigation grid para todos os módulos finance

### FluxoCaixa (`/finance/fluxo-caixa`)
- Period switcher: Hoje / Semana / Mês / Personalizado
- 4 KPIs: Confirmadas, Previstas, Saídas, Saldo Líquido
- AreaChart duplo: Entradas×Saídas + Saldo Acumulado
- Tabela diária detalhada com 6 colunas

### DRE (`/finance/dre`)
- Seletor mês+ano com Select components
- 4 KPI cards com Delta component (% variação vs anterior)
- Tabela DRE com indent visual, highlight de subtotais
- BarChart comparativo atual×anterior
- Breakdown de despesas com progress bars e % de composição

### Metas (`/finance/metas`)
- CRUD completo: criar / editar / excluir meta
- 4 tipos com metadados (`GOAL_META` object): label, unit (BRL/PCT), icon, color
- `ProgressBar` component com color dinâmica (verde/azul/âmbar)
- Inadimplência: lógica invertida (menor = melhor)
- `on_track` proporcional ao dia atual do mês
- Dialog com Select de tipos disponíveis (exclui já definidos)
- Permissões: somente owner/admin/manager/finance podem criar/editar

---

## Rotas adicionadas (`App.tsx`)

```tsx
<Route path="finance/dashboard"    element={<RequireRoleRoute><FinanceDashboard /></RequireRoleRoute>} />
<Route path="finance/fluxo-caixa"  element={<RequireRoleRoute><FluxoCaixa /></RequireRoleRoute>} />
<Route path="finance/dre"          element={<RequireRoleRoute><DRE /></RequireRoleRoute>} />
<Route path="finance/metas"        element={<RequireRoleRoute><Metas /></RequireRoleRoute>} />
```

Todas lazy-loaded. Acesso via `RequireRoleRoute` (sem licença adicional — disponível para todos os roles com acesso ao sistema).

---

## Segurança e Multi-tenant

- Todas as tabelas têm `store_id` com RLS `store_id = get_my_store_id()`
- Todos os RPCs recebem `p_store_id` e validam `store_id = get_my_store_id()` internamente
- `REVOKE ALL ON FUNCTION ... FROM PUBLIC; GRANT ... TO authenticated;`
- `store_groups` usa `owner_id = auth.uid()` no RLS
- Nenhuma credencial em frontend — somente dados anonimizados via JWT

---

## Critério de conclusão

> "Considerar Block 8 concluído quando o Estokfy Connect se tornar uma plataforma financeira completa."

✅ Fluxo de Caixa Profissional (confirmado + previsto + saídas + saldo acumulado)
✅ DRE Gerencial com comparativo mensal
✅ Metas Financeiras com acompanhamento realizado × meta
✅ Dashboard Executivo unificado
✅ REST API Finance (6 endpoints)
✅ Multi-empresa via store_groups
✅ Centro de custo integrado a contas a pagar
✅ Análise de risco AR (score 0-100)
✅ Alertas de vencimento em contas a pagar
✅ Migration aplicada em produção
✅ Build 0 erros TypeScript
✅ Deploy via Cloudflare Pages (commit e738a66 → main)

**Block 8: CONCLUÍDO ✅**
