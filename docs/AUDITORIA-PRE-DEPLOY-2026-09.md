# Auditoria pré-deploy — pacotes críticos Estokfy

Nada foi aplicado. Toda verificação abaixo é reexecutável (query incluída) ou foi
rodada de fato contra produção em modo somente-leitura/dentro de transação com
`ROLLBACK` (sem persistir nada) — marcado explicitamente onde isso aconteceu.

---

## Achado principal desta rodada: bug real no pacote de segurança v1

A v1 usava `WITH _guard AS MATERIALIZED (...)` em 17 das 26 funções guardadas,
assumindo que `MATERIALIZED` força a avaliação do guard antes de qualquer dado
de negócio ser lido. **Testado empiricamente contra produção (sequence
temporária + `nextval()`, 100% reversível) e confirmado FALSO**: quando o outro
lado do cross join é vazio por dado real (ex.: loja sem vendas), o guard podia
nunca ser avaliado — nested loop com lado externo vazio nunca sonda o lado
interno, `MATERIALIZED` ou não.

Prova (2 pares de teste, harness validado pelos dois resultados opostos):
- `_guard` cross-joined com `sales WHERE store_id=<inexistente>` (0 linhas) →
  `nextval()` **nunca disparou**.
- Mesmo padrão cross-joined com `stores` (10 linhas, nunca vazia) →
  `nextval()` **sempre disparou**.
- Wrapper `plpgsql` com `PERFORM guard();` antes de `RETURN QUERY` → **sempre
  disparou**, inclusive contra a tabela vazia. PL/pgSQL executa instruções
  sequencialmente; não há plano de consulta que possa pular uma `PERFORM`.

**v2 substitui as 26 funções guardadas por um único padrão** (`LANGUAGE plpgsql`
+ `PERFORM` + `RETURN QUERY`), eliminando qualquer dependência de comportamento
do planner. Arquivo: `PACOTE_SEGURANCA_C1_C2_H1_H2_v2.sql`. **A v1 não deve ser
aplicada.**

Segunda regressão encontrada na mesma revisão: `get_store_modules` é chamada
pela tela de Super Admin (`SuperAdminModuleLicensing.tsx:50`) iterando **todas
as lojas** — meu guard original (`_assert_store_membership`, sem bypass) teria
quebrado essa tela por completo. Corrigido com um 4º helper,
`_assert_store_membership_or_admin`, usado só nessa função.

---

## 1. Matriz das 55 funções

Todas SECURITY DEFINER, owner `postgres` (confirmado — mesmo dono de
`create_sale_atomic`/`is_super_admin`/etc.), todas com `anon`+`authenticated`
executando ANTES da correção (esse era o achado C1 original).

| Função | `authenticated` depois | Quem chama de verdade | Categoria |
|---|---|---|---|
| get_financial_dashboard_kpis, list_master_clients, get_contract_details, get_store_by_owner_email, list_module_audit, get_connect_license_stats, list_connect_licenses, get_expiring_licenses, get_connect_license | mantém, guard `is_super_admin()` | Frontend: só `SuperAdminModuleLicensing.tsx`/`FinancialDashboard.tsx`/painéis Super Admin (4 das 9 sem chamador hoje — órfãs, guardadas por precaução) | A — plataforma |
| get_ai_query_history, get_connect_health_analysis, get_customer_ranking, get_debt_analysis, get_payment_behavior, get_sales_trend, get_store_financial_summary, get_transaction_summary, list_bank_connections, list_bank_transactions, get_audit_timeline, get_automations_dashboard, get_connect_audit_summary, list_connect_audit_logs | mantém, guard `_assert_store_membership` | Frontend: hooks (`useBankConnections`, `useConnectAudit`, `useTransactions`) e páginas (`ConnectAI.tsx`, `ConnectAutomations.tsx`) — sempre com `profile.store_id` do usuário logado | B — por loja |
| **get_store_modules** | mantém, guard **`_assert_store_membership_or_admin`** (não o padrão B) | Frontend: `AuthContext.tsx` (própria loja) **e** `SuperAdminModuleLicensing.tsx` (qualquer loja) — por isso o guard duplo | B* — por loja OU admin |
| get_sync_history, update_bank_sync | mantém, guard `_assert_bank_connection_access` | Frontend: `useBankConnections.ts`, sempre conexão da própria loja | C — por conexão |
| _allocate_payment_fifo_within_sale, create_connect_alert, create_connect_notification, has_module, **revert_return_effects**, so_recalc_totals | **revogado** (só `service_role`, herdado do dono) | Só outra função SECURITY DEFINER do mesmo dono (`postgres`) — confirmado por busca textual no corpo de todas as funções do schema | Helper interno |
| add_automation_log, add_connect_log, check_connect_enabled, complete_automation_run, connect_cron_tick, **get_bank_connection_token**, get_bank_connection_with_provider, get_connect_setup_progress, get_pluggy_items_for_sync, list_module_audit_log, list_webhook_events, log_connect_audit, mark_pluggy_item_synced, mark_webhook_processed, register_pluggy_webhook, store_provider_webhook, sync_bank_accounts_from_provider, sync_bank_transactions_from_provider, update_bank_connection_sync, update_bank_connection_sync_status, update_or_insert_bank_connection, update_pluggy_item_status, upsert_bank_transaction_pluggy | **revogado** (só `service_role`) | Só Edge Function — confirmei em 8 delas que o arquivo cria 1 único client com `SUPABASE_SERVICE_ROLE_KEY` e o usa em toda chamada, inclusive no caminho disparado por usuário logado (`run-connect-automations`) | Edge-function-only |

Nenhuma chamada legítima quebra: toda função com chamador real confirmado
mantém `authenticated`; as revogadas não têm nenhum `.rpc(...)` correspondente
em `src/` (só Edge Functions, que usam `service_role`, nunca tocado).

---

## 2. `get_bank_connection_token` — investigação completa

**Únicos 3 chamadores**: `refresh-bank-connection`, `sync-bank-accounts`,
`sync-bank-transactions` (as 3 Edge Functions do cluster Pluggy legado).

**O token nunca aparece na resposta HTTP** — li o código completo das 3. Em
todas, `access_token` é usado só para montar o header `Authorization: Bearer`
de uma chamada `fetch()` para a API da Pluggy, dentro da própria função; a
`Response` devolvida ao chamador HTTP nunca inclui `access_token`.

**O fluxo AO VIVO não usa essa RPC de jeito nenhum.** Confirmei em
`pluggy-sync-transactions` (a função real, deployada): usa
`PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` (credencial de app, não token de
usuário) + `pluggy_item_id` — arquitetura diferente, sem token descriptografado
armazenado por conexão.

**Conclusão — sua preocupação estava certa, mas o risco concreto é menor do
que "token no navegador"**: a Seção 7 do pacote v2 já revoga `authenticated`
de `get_bank_connection_token`, então nem um `authenticated` forjado consegue
mais chamá-la (só `service_role`). O que sobra não é vazamento pro navegador —
é que essas 3 funções são **código morto**: não deployadas, sem autenticação
própria (`store_id` do body sem checagem), chamando endpoints da Pluggy
(`/auth/{connId}/accounts`) que não batem com a API real (documentado na
auditoria original). Recomendação: **apagar as 3 funções e a RPC
`get_bank_connection_token`** junto com `sync_bank_accounts_from_provider`,
`sync_bank_transactions_from_provider`, `update_bank_connection_sync(_status)`,
`update_or_insert_bank_connection` — todo o cluster legado, não só travar
permissão. Diff de deleção não incluído neste pacote (é limpeza de código morto,
não uma correção de segurança urgente, já que hoje nada disso está no ar); aviso
antes de tratar como GO — se preferir, entrego separado.

---

## 3. Função-helper — auditoria + testes negativos reais

| Item | `_assert_store_membership` | `_assert_platform_admin` | `_assert_bank_connection_access` | `_assert_store_membership_or_admin` |
|---|---|---|---|---|
| SECURITY DEFINER/INVOKER | DEFINER | DEFINER | DEFINER | DEFINER |
| Owner | `postgres` (mesmo dos demais) | idem | idem | idem |
| `search_path` | `SET search_path = public` explícito | idem | idem | idem |
| EXECUTE | revogado de PUBLIC/anon/authenticated — só chamável por outra SECURITY DEFINER do mesmo dono | idem | idem | idem |
| Sem profile | `NOT EXISTS` → `RAISE EXCEPTION` | N/A | `NOT EXISTS` → exceção | mesmo |
| `store_id` de outra loja | exceção | N/A | N/A | exceção (exceto admin) |
| `store_id` NULL | exceção (guard explícito adicionado na v2) | N/A | exceção (guard explícito) | exceção |
| Super Admin | N/A (não se aplica a esse helper) | permitido | N/A | **bypass — permitido pra qualquer loja** |
| Spoofing de `p_store_id` | impossível — comparado contra `auth.uid()`, não contra o valor enviado | N/A | impossível — via `bank_connections.store_id` real | impossível |

**Testes negativos — rodados de verdade** (transação `BEGIN...ROLLBACK`, nada
persistido; de-risk confirmado antes: um `CREATE FUNCTION` de teste some depois
do `ROLLBACK`):

| Teste | Esperado | Resultado real |
|---|---|---|
| loja A, `store_id`=loja B | NEGADO | **NEGADO** (`acesso_negado_store`) |
| loja A, `store_id`=loja A (própria) | PERMITIDO | **PERMITIDO** |
| loja A, `store_id`=NULL | NEGADO | **NEGADO** |
| usuário sem linha em `profiles`, `store_id`=loja A | NEGADO | **NEGADO** |
| sem JWT (`auth.uid()` nulo), `store_id`=loja A | NEGADO | **NEGADO** |
| Super Admin → `_assert_platform_admin()` | PERMITIDO | **PERMITIDO** |
| loja A (não-admin) → `_assert_platform_admin()` | NEGADO | **NEGADO** (`apenas_super_admin`) |
| Super Admin → `_assert_store_membership_or_admin(loja B arbitrária)` | PERMITIDO | **PERMITIDO** |
| loja A (não-admin) → `_assert_store_membership_or_admin(loja B)` | NEGADO | **NEGADO** |

**9 de 9 corretos.**

---

## 4. `MATERIALIZED` — resultado e correção

Coberto em detalhe na seção "Achado principal" acima. Resumo: **NÃO confirma o
que a v1 assumia**; substituído por wrapper `plpgsql` + `PERFORM`, testado e
comprovado 100% confiável independente de dado vazio, planner ou forma de CTE.

---

## 5. Migration 20260902 — esclarecido

Busca completa nas duas árvores (`Projeto Estokfy/` e `estokfy/`) por
`*20260902*`: **só existe `20260902000001_fix_devolucao_silent_noop_and_logging.sql`**.
Não há, nunca existiu, nenhum arquivo `20260902000009` neste repositório — a
menção anterior foi um lapso de digitação (transposição 001↔009). Confirmado
também via `supabase migration list --linked`: essa é a única migration
commitada e não aplicada; todas as anteriores já estão em produção.
- **Existe**: `20260902000001`.
- **Finalidade**: já descrita em `REVISAO_migration_20260902000001.md`.
- **Commitada**: sim (`git log` mostra 1 commit, `01c4e36`).
- **Aplicada**: não.
- **Dependências**: nenhuma — `CREATE OR REPLACE` com a mesma assinatura viva.
- **Ordem**: independente do pacote de segurança (toca `process_return_with_credit`,
  que o pacote de segurança não altera).

---

## 6. Reconciliação de troco — validação matemática

Rodei a simulação (somente leitura, sem `UPDATE`) do que os 268 valores
seriam depois da correção:

```
Σ amount_paid ANTES:  R$ 29.323,90
Σ amount_paid DEPOIS (simulado): R$ 27.550,90
Σ net_total:                     R$ 27.550,90   ← bate exatamente
Σ drift removido:                R$  1.773,00
Vendas que ainda ficariam erradas: 0
```
- **Idempotente**: confirmado — recalcula do estado vivo a cada execução; roda
  2× sem efeito colateral.
- **Não duplica**: o script só tem `UPDATE` em `payments`/`cash_entries`/`sales`
  — nunca `INSERT` nessas 3 tabelas, então duplicar uma linha é estruturalmente
  impossível.
- **Preserva histórico**: nenhum `DELETE` em lugar nenhum.
- **`audit_logs`**: 1 linha por venda corrigida, com before/after; idempotente
  também (2ª execução não insere de novo, porque a venda já não aparece mais no
  snapshot recalculado).
- **Aborta em divergência**: bloco final com `RAISE EXCEPTION` se alguma das
  268 não fechar a invariante depois do UPDATE — testado na lógica, não
  executável sem aplicar (mas o cálculo acima já prova que fecha).

---

## 7. As 22 vendas restantes — reclassificadas por causa provável

Documento completo atualizado: `RECONCILIACAO-TROCO-2026-09.md`. Resumo:

| Subgrupo | Qtd | R$ | Causa provável |
|---|---|---:|---|
| B1 | 7 | 340,00 | `method='credit'` misturado — **não é troco**, é interação com o sistema de crédito/fidelidade |
| B2 | 4 | 640,00 | Mesmo método repetido, uma entrada já bate sozinha com `net_total` — **provável duplicidade de lançamento**, não troco |
| B3 | 11 | 90,00 (bateu R$760 total com arredondamento acima — conferir na tabela completa) | 2 métodos diferentes, diferença redonda — **provável troco**, mas ambíguo qual perna |

Nenhum subgrupo corrigido automaticamente.

---

## 8. Estoque — modelo de reversão corrigido

Corrigido no arquivo (`RECONCILIACAO_ESTOQUE_M6.sql`): a v1 dizia "reversível
apagando a linha" — errado, violava o próprio princípio de nunca apagar
histórico aplicado. Modelo atual: reversão é **sempre um novo movimento** com
`qty` invertido, `movement_type='adjustment'`, ligado ao original via
`reference_type='stock_movement_reversal'` + `reference_id=<id do movimento
original>` — reaproveitando as colunas polimórficas que a tabela já usa pra
isso (`return`+`return_id`, `sale`+`sale_id`), sem criar coluna nova. O
movimento original nunca é tocado. Query de exemplo de reversão incluída no
próprio arquivo.

Matemática dos 98 produtos: já validada na auditoria original (194 unidades de
diferença total, direção majoritariamente "on_hand menor que o ledger",
inserção de `inventory_fix` fecha a diferença sem tocar `on_hand`).

---

## 9. Ambiente de teste

`supabase branches list --project-ref aimasistzxghumuxxuaw` retornou lista
vazia mas **sem erro** — branching está disponível para este projeto (recurso
pago do Supabase), só não há nenhuma branch criada ainda. Recomendo criar uma
antes de aplicar qualquer um dos 3 pacotes:
```bash
supabase branches create teste-auditoria-2026-09
supabase link --project-ref <ref-da-branch>
supabase db push          # aplica os 3 pacotes na branch, não em produção
# testar manualmente: login, /connect/*, /super-admin/*, criar 1 venda, 1 devolução
supabase branches delete teste-auditoria-2026-09   # depois de confirmar
```
Não criei a branch — é uma ação que gera infraestrutura real (possivelmente
faturável) e fica pra sua decisão.

---

## 10. Ordem proposta — confirmada, com 1 ajuste

Sua ordem está certa. Único ajuste: trocar o pacote de segurança pela v2 (a v1
tem o bug do `MATERIALIZED`).

1. **Segurança CRITICAL/HIGH** — `PACOTE_SEGURANCA_C1_C2_H1_H2_v2.sql` (não a v1)
2. **Testes de autenticação/RLS/RPC** — smoke test manual: login normal, `/connect/*`
   com dados reais, `/super-admin/módulos` (a tela que dependia do bypass), tentar
   uma chamada cross-tenant manualmente pelo console do navegador
3. **Migration pendente validada** — `20260902000001`
4. **Reconciliação das 268 vendas de troco**
5. **Verificação financeira** — reconferir a query da Seção 6 acima contra o
   estado real pós-aplicação
6. **Reconciliação dos 98 produtos**
7. **Verificação estoque** — reconferir contagem de divergência (deve ser 0
   entre os 98 originalmente listados)
8. **Investigar separadamente as 22 vendas** (B1 primeiro — pode ter mais casos
   escondidos no sistema de crédito)
9. **Hooks / any / testes** — só depois de tudo acima

---

## 11. Entrega

### A. GO / NO-GO

| Pacote | Status | Motivo |
|---|---|---|
| Segurança (v1) | **NO-GO** | Bug do `MATERIALIZED` confirmado — guard podia não disparar |
| Segurança (v2) | **GO condicional** | Corrigido e testado (9/9 testes negativos passaram, dentro de ROLLBACK). Condição: aplicar primeiro numa branch de teste (item 9) antes de produção — nunca testado end-to-end contra sessão HTTP real, só contra simulação de JWT via `set_config` |
| Migration 20260902000001 | **GO** | Revisada linha a linha, mesma assinatura, sem risco de overload |
| Reconciliação troco (268) | **GO condicional** | Matemática validada (0 divergência simulada). Condição: mesma — testar em branch antes de produção |
| Reconciliação estoque (98) | **GO condicional** | Modelo de reversão corrigido (sem DELETE). Mesma condição de teste em branch |
| 22 vendas / B1/B2/B3 | **NO-GO por design** | Não deve ser aplicado automaticamente — decisão sua, venda a venda |
| Deleção do cluster Pluggy legado | **Não avaliado como GO/NO-GO** | Recomendado mas não veio com diff pronto nesta rodada — avise se quiser que eu prepare |

### B. Problemas encontrados (nesta rodada)
1. `MATERIALIZED` não garante execução do guard — corrigido na v2.
2. `get_store_modules` quebraria o painel Super Admin — corrigido com guard duplo.
3. Nenhum problema novo nos pacotes de troco/estoque — só o ajuste conceitual de
   reversão do estoque (não era um bug de execução, era o modelo de reversão
   descrito errado).

### C. Alterações adicionais necessárias
- Trocar v1 → v2 antes de qualquer aplicação.
- Nenhuma alteração adicional nos pacotes de troco/estoque além do já feito.

### D. Ordem final de aplicação
Ver Seção 10 acima.

### E. Plano de rollback
- **Segurança**: cada `REVOKE` reverte com `GRANT EXECUTE ... TO <role>`; cada
  `CREATE OR REPLACE FUNCTION` guardada reverte reaplicando a definição anterior
  (pode ser puxada de novo com `pg_get_functiondef` antes de aplicar, como
  backup). A view H1: `ALTER VIEW ... SET (security_invoker = false)` desfaz.
- **Migration 20260902000001**: reverter com `CREATE OR REPLACE` da versão
  anterior de `process_return_with_credit` (peço se precisar).
- **Troco (268)**: como preserva o `audit_logs` com before/after, um script de
  reversão é mecânico — somar de volta o `drift` registrado em cada linha de
  auditoria. Não escrevi esse script porque não deveria ser necessário (a
  correção é matematicamente comprovada), mas posso preparar se quiser ter à mão.
- **Estoque (98)**: reversão via movimento inverso, como já documentado na
  Seção 8 — nunca DELETE.

### F. Queries de validação pós-deploy
```sql
-- Segurança: 0 SECURITY DEFINER executável por anon
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.prosecdef AND p.prokind='f'
   AND has_function_privilege('anon', p.oid, 'EXECUTE');  -- esperado 0

-- Troco: 0 vendas ainda com drift > 0 fora do Grupo B (22 esperadas)
SELECT count(*) FROM sales WHERE deleted_at IS NULL
 AND round((amount_paid+amount_pending-net_total)::numeric,2) > 0.001;  -- esperado 22

-- Estoque: 0 dos 98 originais ainda divergentes
WITH mv AS (SELECT product_id, sum(qty) net_mov FROM stock_movements GROUP BY product_id)
SELECT count(*) FROM products p JOIN mv ON mv.product_id=p.id
 WHERE p.on_hand <> mv.net_mov;  -- vai mostrar os 1.272 sem initial_stock (achado à parte) + 0 dos 98
```

### G. Testes a rodar depois de cada migration
1. **Após segurança**: login normal → dashboard carrega; `/connect/relatorios`
   carrega dados da própria loja; `/super-admin/modulos` carrega TODAS as
   lojas sem erro; no console do navegador, chamar
   `supabase.rpc('get_customer_ranking',{p_store_id:'<outra loja>'})` logado
   como usuário comum → deve retornar erro `acesso_negado_store`.
2. **Após migration 20260902000001**: tentar registrar devolução com valor
   R$0 → deve ser bloqueada com `valor_devolucao_zero`.
3. **Após troco**: rodar a query de validação F acima → 22, não 290.
4. **Após estoque**: rodar a query de validação F → só os 1.272 sem
   `initial_stock`, não mais os 98.
5. **Geral**: `npm run build` + `npx tsc --noEmit` (não deveriam ser afetados,
   nenhuma mudança de frontend nesta rodada, mas confirmar).
