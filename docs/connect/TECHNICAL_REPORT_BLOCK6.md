# Estokfy Connect — Relatório Técnico Block 6
**Versão:** Block 6 — IA Financeira  
**Data:** 2026-06-21  
**Supabase Project:** `aimasistzxghumuxxuaw`  
**Deploy:** Cloudflare Pages (auto via `main` branch, commit `bb10c73`)

---

## 1. Objetivo

Transformar o Estokfy Connect em um **consultor financeiro inteligente e proativo**, com análises automáticas baseadas exclusivamente em dados reais da loja — sem hardcode, sem respostas simuladas, sem chatbot fake.

---

## 2. Princípios de Implementação

| Princípio | Implementação |
|-----------|--------------|
| Dados reais | Todas as análises consultam as tabelas `sales`, `payments`, `bank_transactions`, `reconciliation_matches`, `customers` via RPCs SQL |
| Sem hardcode | Textos de recomendações e respostas são gerados dinamicamente com valores reais (ex: `format('Hoje entraram R$ %s...', v_amount)`) |
| Multi-tenant | Todas as RPCs filtram por `p_store_id` com verificação de segurança (`profiles WHERE id = auth.uid()`) |
| Auditável | Cada pergunta respondida é logada em `connect_ai_queries` com o dado bruto e o texto gerado |
| Zero fake | Sem dados mockados; se não há dados, retorna mensagem informativa (ex: "Nenhuma transação para hoje") |

---

## 3. Migrações Aplicadas

### `20260621000020_connect_block6_analysis.sql`

**6 RPCs de análise financeira:**

| RPC | Fonte de dados | Retorno |
|-----|---------------|---------|
| `get_sales_trend(UUID, INT)` | `sales`, `payments` | Série temporal diária: count, total, PIX, cartão, dinheiro, pending/paid |
| `get_payment_behavior(UUID, INT)` | `payments` + `sales` | Por método: current/prev amount, %, change_pct, trend (up/down/stable/new) |
| `get_debt_analysis(UUID)` | `sales` WHERE payment_status IN ('pending','partial') | Buckets de vencimento: 30d/60d/90d+, taxa inadimplência |
| `get_connect_health_analysis(UUID)` | `bank_transactions`, `reconciliation_matches`, `bank_connections` | Score 0-100 ponderado: conciliação (40pts) + sync freshness (30pts) + divergências antigas (30pts) |
| `get_customer_ranking(UUID, INT)` | `sales` JOIN `customers` | Top N: total compras, pago, pendente, última compra, is_debtor |
| `get_store_financial_summary(UUID)` | Todas as fontes acima via CTEs | Resumo semana/mês: received, sales_count, new_customers, growth_pct, delinquency_rate, reconciliation_rate, forecast_30d, at_risk_30d |

**Cálculo do health score:**
```
score = reconciliation_component (0-40)
      + sync_freshness_component (0-30)
      + old_divergences_component (0-30)

reconciliation: ≥90%→40, ≥70%→28, ≥50%→15, <50%→0
sync: ≤24h→30, ≤48h→18, ≤72h→8, >72h→0
divergências >7d: 0→30, ≤3→20, ≤10→10, >10→0
```

---

### `20260621000021_connect_block6_ai_queries.sql`

**Tabela `connect_ai_queries`:**
- `id, store_id, user_id, question_key, question_text, answer_text, answer_data JSONB, created_at`
- RLS: `store_id = (SELECT store_id FROM profiles WHERE id = auth.uid())`
- Índice: `(store_id, created_at DESC)`

**`answer_financial_question(p_store_id UUID, p_question_key TEXT) → JSONB`**

Suporta 9 question keys, cada uma executando SQL real e gerando resposta em português:

| Question Key | Query executada | Exemplo de resposta |
|-------------|----------------|---------------------|
| `quanto_entrou_hoje` | `SUM(amount) FROM bank_transactions WHERE transaction_date = CURRENT_DATE` | "Hoje entraram R$ 1.250 em 5 transações bancárias." |
| `quanto_entrou_mes` | `SUM(amount)` do mês atual | "Este mês entrou R$ 18.340 em 47 transações." |
| `qual_banco_mais_movimentou` | GROUP BY bank_name, ORDER BY SUM DESC, últimos 30d | "Nubank foi o banco que mais movimentou: R$ 9.200 em 23 transações." |
| `qual_metodo_mais_vende` | JOIN payments+sales, GROUP BY method, mês atual | "PIX é o método que mais vendeu este mês: R$ 12.000 em 35 transações." |
| `quanto_conciliado_auto` | COUNT FROM reconciliation_matches WHERE match_type='automatic' | "28 transações conciliadas automaticamente (R$ 8.400) — 82% do total." |
| `quantas_divergencias` | COUNT/SUM FROM bank_transactions WHERE status='divergent' | "Existem 3 divergências abertas totalizando R$ 750." |
| `quem_deve_mais` | JOIN sales+customers, ORDER BY SUM(amount_pending) DESC | "João Silva é o cliente com maior débito: R$ 1.200 em 2 vendas pendentes." |
| `maior_cliente` | JOIN sales+customers, GROUP BY customer_id, mês atual | "Maria Costa é o maior cliente deste mês: R$ 3.500 em 5 compras." |
| `previsao_30_dias` | Média diária banco×30 + pending_due next 30d | "Projeção R$ 15.000 (banco) + R$ 4.200 (a receber) = R$ 19.200 estimado." |

Cada resposta é logada em `connect_ai_queries` (auditável).

**`get_ai_query_history(UUID, INT) → SETOF`** — histórico de perguntas ordenado por `created_at DESC`.

---

### `20260621000022_connect_block6_super_admin_ia.sql`

**`get_master_ia_comparison() → SETOF`** (SECURITY DEFINER + `is_super_admin()` check)

Por loja: `month_revenue`, `revenue_growth_pct`, `month_sales_count`, `delinquency_rate`, `overdue_amount`, `reconciliation_rate`, `divergent_count`, `auto_rate`, `health_score (0-100)`, `active_connect`.

**`get_master_ia_ranking(p_top INT DEFAULT 5) → SETOF`** (SECURITY DEFINER)

Categorias de ranking:
- `maior_faturamento` — top lojas por receita do mês
- `maior_crescimento` — top lojas por crescimento MoM
- `maior_inadimplencia` — lojas com maior taxa (piores)
- `melhor_conciliacao` — lojas com melhor taxa (melhores)
- `mais_divergencias` — lojas com mais divergências (piores)

---

## 4. Frontend — `ConnectAI.tsx`

**Rota:** `/connect/ia`  
**Guard:** `RequireConnectModule`  
**Bundle:** `ConnectAI-2cjGWlZh.js` (24.78 kB / 7.08 kB gzip)

### Estrutura de 4 tabs

#### Tab 1 — Painel
| Seção | Fonte | Descrição |
|-------|-------|-----------|
| Health Gauge SVG | `get_connect_health_analysis` | Score 0-100, cor dinâmica (verde/amarelo/vermelho) |
| 6 KPI cards | `get_store_financial_summary` + health | Recebido, vendas, conciliação, inadimplência, divergências, previsão |
| Resumo executivo (semana/mês) | `get_store_financial_summary` | Comparativo com mês anterior, delta badges |
| Recomendações automáticas | Derivadas dos dados carregados | Geradas por `generateRecommendations()` — 8 regras sobre dados reais |
| Tendência 30 dias | `get_sales_trend` | AreaChart PIX/Cartão/Dinheiro com gradiente |
| Breakdown de métodos | `get_payment_behavior` | BarChart horizontal + lista com trend icons |
| Top clientes | `get_customer_ranking` | Tabela com total, débito, última compra |
| Inadimplência por faixa | `get_debt_analysis` | Cards 30d / 60d / 90d+ / total |

#### Tab 2 — Perguntas
- Grid de 9 botões com ícone e label da pergunta
- Click → `answer_financial_question(store_id, question_key)` RPC
- Resposta exibida em card destacado com cor purple
- Loading state por botão (spinner individual)
- Histórico na tab 4

#### Tab 3 — Insights
- Lista de insights ativos da `connect_ai_insights`
- Botão "Detectar agora" → `detect_ai_insights(store_id)`
- Borda colorida por severidade (vermelho/amarelo/azul)
- Caixa de sugestão com ícone 💡
- Badge counter no TabsTrigger para insights críticos

#### Tab 4 — Histórico
- Últimas 10 perguntas respondidas de `connect_ai_queries`
- Exibe question_text + answer_text + timestamp

### Recomendações automáticas (sem hardcode)

```typescript
// Geradas de dados reais — exemplos de regras:
if (health.open_divergences_7d_plus > 0)
  → "N divergência(s) abertas há mais de 7 dias sem resolução."
if (debt.delinquency_rate > 20)
  → "Inadimplência em X% — taxa crítica. R$ Y em atraso."
if (payment.pix?.change_pct < -15)
  → "PIX caiu X% em relação ao período anterior."
if (summary.received_growth_pct > 20)
  → "Crescimento de X% nos recebimentos este mês."
```

---

## 5. Atualizações em Arquivos Existentes

### `MasterDashboard.tsx`
- Novo toggle de tabs: **Lojas** | **IA Financeira**
- Tab IA: ranking por 5 categorias (top 3 por categoria)
- Tabela comparativa com health score colorido por faixa

### `ConnectOverview.tsx`
- Novo card "🤖 Central IA" → `/connect/ia` adicionado à grade de navegação

### `App.tsx`
- Rota `/connect/ia` → `<ConnectAI>` dentro de `RequireConnectModule`

---

## 6. Segurança

| Mecanismo | RPCs afetadas |
|-----------|--------------|
| Verificação store_id explícita em `answer_financial_question` | `SELECT store_id FROM profiles WHERE id = auth.uid()` |
| SECURITY DEFINER + `is_super_admin()` | `get_master_ia_comparison`, `get_master_ia_ranking` |
| RLS em `connect_ai_queries` | `store_id = (SELECT store_id FROM profiles WHERE id = auth.uid())` |
| REVOKE ALL + GRANT granular | Todos os 8 novos RPCs |
| Sem dados cross-tenant | Todas as queries filtram por `p_store_id` explícito |

---

## 7. Critérios de conclusão — checklist

| Critério | Status |
|----------|--------|
| IA trabalha sobre dados reais (sem mock) | ✅ |
| Sem hardcode nas respostas | ✅ — valores inseridos via `format()` com dados reais |
| Multi-tenant preservado | ✅ — `store_id` em todas as queries + verificação explícita |
| Todas as análises auditáveis | ✅ — `connect_ai_queries` loga cada pergunta/resposta |
| Build 0 erros TypeScript | ✅ — `✓ built in 18.76s` |
| Migrações aplicadas em prod | ✅ — 020, 021, 022 |
| Relatório técnico gerado | ✅ |

---

## 8. Arquivos Criados/Modificados

### Criados
- `src/pages/Connect/ConnectAI.tsx` — componente principal (~700 linhas)
- `supabase/migrations/20260621000020_connect_block6_analysis.sql`
- `supabase/migrations/20260621000021_connect_block6_ai_queries.sql`
- `supabase/migrations/20260621000022_connect_block6_super_admin_ia.sql`
- `docs/connect/TECHNICAL_REPORT_BLOCK6.md`

### Modificados
- `src/App.tsx` — rota `/connect/ia`
- `src/pages/Connect/ConnectOverview.tsx` — card Central IA na grade
- `src/pages/Connect/MasterDashboard.tsx` — tabs + IA comparison/ranking

---

*Estokfy Connect Block 6 — 2026-06-21 — commit `bb10c73`*
