# Auditoria Profunda — Estokfy (2026-09-01)

Auditoria técnica read-only do sistema em produção (Supabase `aimasistzxghumuxxuaw`,
Cloudflare Pages). **Nenhum dado, schema ou código foi alterado.** Toda afirmação
abaixo sai de uma query real no banco de produção (`supabase db query --linked`) ou
de uma linha de código citada. Achado sem evidência não entrou.

- Frontend: React 18 + Vite + TS + react-query, ~53k linhas, 200 arquivos.
- Banco: 82 tabelas, 149 migrations (~30k linhas SQL), ~249 funções SECURITY DEFINER.
- Edge Functions: 35 no repo, **25 deployadas**.

Método e limitações: sem Docker (não roda stack local, pgTAP, `db dump/diff`).
Fluxos ponta-a-ponta de escrita **não foram executados** (exigiria escrever em
produção); em vez disso, os mesmos invariantes foram validados contra os **dados
reais já existentes** (3.566 vendas, 3.922 pagamentos, 10 lojas) — evidência mais
forte que um teste sintético. O que não pôde ser provado está em **Pendências**.

---

## Arquitetura compreendida

SaaS multi-tenant PT-BR, isolamento por `store_id`. Cada usuário tem 1 linha em
`profiles` (`auth_user_id → store_id + role`). RLS ligada em **todas as 82 tabelas**
(confirmado: `relrowsecurity=true` em 82/82, e toda tabela tem ao menos 1 policy).
Padrão de policy: `store_id = get_my_store_id()`. Mutações de dinheiro/estoque passam
por RPCs `SECURITY DEFINER` chamadas de Edge Functions com `Idempotency-Key`
(`create_sale_atomic`, `settle_sale_payment`, `stock-adjust`).

Duas camadas de permissão sobre a RLS: **por role** (`roleAccess.ts` +
`RequireRoleRoute`, roles `owner|admin|manager|sales|stock|finance|viewer`) e **por
capability fina** (`get_my_capabilities`). Super Admin é árvore separada
(`is_super_admin()` via tabela `system_admins`). Módulos premium (Connect) por
`store_modules` + `RequireConnectModule`.

**A arquitetura de segurança em si é boa.** O problema não é o desenho — é que o
grant de EXECUTE nas funções SECURITY DEFINER derivou do desenho: como
`SECURITY DEFINER` **ignora RLS**, uma função exposta a `anon` vira um túnel que
contorna todo o isolamento por `store_id`. É aí que estão os achados críticos.

Volume de produção (contexto de impacto):

| Tabela | Linhas | | Tabela | Linhas |
|---|---:|---|---|---:|
| stores | 10 | | sale_items | 5.635 |
| profiles | 17 | | payments | 3.922 |
| customers | 455 | | cash_entries | 3.685 |
| products | 12.628 | | stock_movements | 10.933 |
| sales (não excl.) | 3.421 | | returns / exchanges | 137 / 68 |
| loyalty_credits | 308 | | bank_connections | 6 |
| connect_licenses | 3 | | master_clients | 0 |

---

## HIGH / CRITICAL

### C1 — [CRITICAL] Funções SECURITY DEFINER executáveis por `anon` vazam dados de todas as lojas sem login

- **Onde:** schema `public`, 55 funções. Migrations do módulo Connect/Master
  (`20260617000007_master_financial_rpcs.sql`, e todo o bloco `20260617*`–`20260622*`).
- **Causa:** funções `SECURITY DEFINER` (rodam como dono → **bypassam RLS**) com
  `EXECUTE` concedido a `anon`/`PUBLIC` e **sem guard interno** de store/permissão.
  As duas migrations de "sweep" que revogam anon (`20260501170242`,
  `20260511162944`) foram snapshots pontuais e não cobriram nada criado depois.
- **Evidência (query ao vivo em `pg_proc` + `has_function_privilege`):**
  - 249 funções SECURITY DEFINER; 206 executáveis por `anon`; **55 sem guard**
    (21 escrevem, 34 leem). Triagem exclui 4 triggers (não chamáveis via RPC) e
    `delete_connect_automation` (guardada por `_has_automation_permission`).
  - `has_function_privilege('anon', 'list_master_clients()', 'EXECUTE') = true`,
    idem `get_financial_dashboard_kpis()`, `get_contract_details(uuid)`,
    `list_connect_licenses(...)`, `get_connect_license_stats()`,
    `get_expiring_licenses(int)` — **nenhuma recebe `store_id`**: retornam dados de
    toda a plataforma.
- **Impacto:** qualquer um com a anon key (embutida no JS público em
  `estokfy/.env` → servido no bundle) chama `POST /rest/v1/rpc/<fn>` **sem login** e:
  - **Sem conhecer nenhum UUID:** `list_connect_licenses`/`get_connect_license_stats`/
    `get_expiring_licenses` devolvem e-mail do dono, plano, valor pago e vencimento de
    cada licença (3 hoje); `list_master_clients`/`get_financial_dashboard_kpis`
    devolveriam CRM+faturamento da plataforma (0 linhas hoje — módulo Master vazio,
    então esse subconjunto está **latente**, não ativo).
  - **Recebendo `store_id` arbitrário (IDOR cross-tenant, dados REAIS hoje):**
    `get_customer_ranking` (nome+telefone+total de compra dos 455 clientes),
    `get_sales_trend`/`get_store_financial_summary`/`get_debt_analysis`/
    `get_payment_behavior` (faturamento e inadimplência de qualquer loja),
    `list_bank_transactions`/`list_bank_connections`/`get_transaction_summary`
    (extrato bancário de qualquer loja).
  - **Pior de todas:** `get_bank_connection_token(conn_id, store_id)` retorna o
    **token de acesso bancário DESCRIPTOGRAFADO** (`convert_from(decode(
    access_token_encrypted,'base64'),...)`) — 6 conexões bancárias em produção.
  - `get_store_by_owner_email(email)` mapeia qualquer e-mail → `store_id` (enumeração).
- **Não foi feita PoC via REST** (evitar trafegar a anon key pela rede); a prova via
  catálogo é definitiva e mais precisa. O caminho de **SELECT direto** por anon está
  fechado (RLS ligada em 82/82) — o vetor é exclusivamente as RPCs SECURITY DEFINER.
- **Correção proposta (pronta, NÃO aplicada):**
  `scratchpad/CORRECAO_CRITICAL_revoke_anon.sql` — sweep `DO $$` que faz
  `REVOKE EXECUTE ... FROM anon, PUBLIC` em toda função SECURITY DEFINER de `public`.
  Não toca no grant de `authenticated` (app logado não quebra). Reversível.
  Fecha imediatamente o buraco **anônimo**. Deixa aberto o cross-tenant entre
  logados → ver H2.
- **Teste:** definido, não executável sem aplicar (read-only). Verificação
  pós-aplicação incluída no arquivo (deve zerar a contagem de anon-executáveis).

### C2 — [CRITICAL] `revert_return_effects` reverte estoque/caixa/pagamento sem validar o chamador

- **Onde:** `20260703000003` L286 / redefinida `20260819000001` L538. Assinatura
  `revert_return_effects(p_return_id uuid, p_store uuid, p_profile_id uuid)`.
- **Causa:** `SECURITY DEFINER`, usa `p_store`/`p_profile_id` **crus** em todo
  INSERT/UPDATE, **sem nenhuma checagem** de que `auth.uid()` pertence a `p_store`.
  O comentário na migration diz "sem GRANT para authenticated: só chamada
  internamente" — mas em produção `has_function_privilege('anon',...)='true'`: a
  defesa "por omissão de grant" **é falsa no banco real** (PUBLIC herda EXECUTE).
- **Evidência:** corpo completo confirmado (reverte `products.on_hand`,
  `stock_movements`, `cash_entries`, deleta/reescreve `payments`, atualiza
  `sales.amount_paid/pending/status`); `anon_x = true`.
- **Impacto:** as RPCs oficiais `cancel_return_atomic`/`edit_return_atomic` exigem
  `can_manage_sensitive_operations()`. Chamando `revert_return_effects` **direto**,
  um usuário logado de role baixa (`sales`) — que enxerga os `return_id` da própria
  loja na tela /trocas — reverte devoluções **pulando a trava de permissão**, mexendo
  em estoque e financeiro. Com `return_id` de outra loja, é cross-tenant.
- **Correção proposta:** `REVOKE EXECUTE ... FROM anon, PUBLIC, authenticated`
  (só `service_role`/chamadas internas devem executar). Incluída no fase-2 do
  arquivo de correção.

### H1 — [HIGH] View `pluggy_connection_status` é SECURITY DEFINER e legível por `anon`

- **Onde:** `20260620000012_connect_pluggy_prep.sql:101`.
- **Causa:** `CREATE VIEW` sem `security_invoker` (→ roda como dono, bypassa RLS),
  junta `pluggy_items`×`bank_connections` de **todas as lojas** sem filtro de store,
  e `anon` tem SELECT.
- **Evidência:** advisor oficial da Supabase marca nível **ERROR**
  (`security_definer_view`); query confirma `has_sec_invoker = null`,
  `has_table_privilege('anon', 'pluggy_connection_status', 'SELECT') = true`.
- **Impacto:** `anon` lê status de conexão bancária de qualquer loja (6 conexões).
- **Correção proposta:** `ALTER VIEW public.pluggy_connection_status SET
  (security_invoker = true);` **e** `REVOKE SELECT ... FROM anon;`. A view passa a
  respeitar a RLS das tabelas de base.

### H2 — [HIGH] Cross-tenant entre usuários logados nas 34 funções de leitura Connect

- **Onde:** as 34 funções-leitoras de C1 que recebem `p_store_id`
  (`get_customer_ranking`, `get_sales_trend`, `get_debt_analysis`,
  `get_store_financial_summary`, `list_bank_transactions`, `get_transaction_summary`,
  `get_payment_behavior`, `get_audit_timeline`, `list_connect_audit_logs`, ...).
- **Causa:** confiam no `p_store_id` do argumento sem confirmar que o chamador
  pertence à loja. O sweep de C1 fecha o `anon`, mas `authenticated` mantém EXECUTE.
- **Evidência:** corpos sem cláusula de validação de `auth.uid()` vs `p_store_id`;
  o frontend sempre passa a própria loja, mas nada impede um request forjado.
- **Impacto:** usuário logado da loja A lê clientes/faturamento/extrato da loja B
  informando o `store_id` dela.
- **Correção proposta:** guard interno padrão (no arquivo de correção):
  `IF NOT EXISTS (SELECT 1 FROM profiles WHERE auth_user_id=auth.uid() AND
  store_id=p_store_id) THEN RAISE EXCEPTION 'acesso_negado_store'; END IF;`

---

## MEDIUM

### M1 — Caixa/receita inflados por troco lançado como entrada real (R$ 2.493)

- **Onde:** dados históricos de vendas à vista + `cash_entries`.
- **Causa:** quando o cliente paga um valor redondo acima do total (ex.: R$85 num
  item de R$75), o pagamento foi gravado pelo valor **entregue** (85), não pelo
  **aplicado** (75). O troco virou `amount_paid` e entrou em `cash_entries` como
  income.
- **Evidência (query):** 290 vendas com `amount_paid+amount_pending ≠ net_total`,
  drift total **R$2.533**, 100% "overpaid"; `net_total` está correto em 290/290
  (bate com itens−desconto); `cash_entries = amount_paid` em 283 casos →
  **R$2.493 de troco inflando o livro-caixa**. Distribuição: abr(1) mai(2) jun(2)
  **jul(160) ago(125)**; última ocorrência **2026-08-19** — mesmo dia dos fixes
  `20260819010000/020000/040000`, ou seja **o drift parou**; os 290 são resíduo
  histórico não reconciliado.
- **Impacto:** relatórios que somam caixa/`amount_paid` superestimam receita em
  ~R$2,5k. Efeito colateral: essas 290 vendas violam o invariante que
  `edit_sale_atomic` agora exige (`RAISE EXCEPTION`), então **editá-las hoje falha** —
  bug operacional latente.
- **Correção proposta:** migration de reconciliação (não destrutiva) que, para vendas
  com `amount_paid > net_total` e status `paid`, ajusta `amount_paid = net_total` e
  lança o troco como `cash_entries(entry_type='expense', category='troco')` para
  neutralizar a inflação, preservando o histórico. Rodar dentro de transação com
  contagem antes/depois. **Requer confirmação da regra de negócio de troco.**

### M2 — Dashboard e /relatorios discordam para vendas retroativas (base de data)

- **Onde:** `src/pages/Dashboard.tsx:69,71,79` (`gte('created_at', ...)`) vs
  `supabase/functions/reports-detailed/index.ts:81,85,89` (`sale_date`/`paid_at`).
- **Causa:** Dashboard soma receita do dia/mês por `created_at`; o relatório oficial
  usa `sale_date`. `get_sales_trend`/`get_payment_behavior` também usam `created_at`.
- **Evidência (query):** 50 vendas com `sale_date ≠ created_at` (venda retroativa),
  2 com diferença >7 dias, gap máximo **26 dias**. Para essas, Dashboard as conta num
  período e /relatorios noutro. O Dashboard é ainda internamente inconsistente
  (vendas por `created_at`, recebimentos por `paid_at`).
- **Impacto:** números divergentes entre telas — exatamente o tipo de inconsistência
  que a auditoria pediu para caçar. O relatório principal (`reports-detailed`) está
  **correto** (usa `sale_date`/`paid_at`/`occurred_at`).
- **Correção proposta:** trocar `created_at` por `sale_date` nas queries de receita do
  `Dashboard.tsx` e em `get_sales_trend`/`get_payment_behavior`.

### M3 — Crash condicional (Rules of Hooks) nas páginas de IA

- **Onde:** `src/pages/AI/AIInsights.tsx:52,65`, `AIAssistant.tsx:82,84`,
  `CEODashboard.tsx:120`.
- **Causa:** `return` antecipado de "acesso restrito" (checando `role`) **antes** de
  `useCallback`/`useEffect`. Se `profile` carrega async (hard-refresh/deep-link direto
  na rota), o 1º render tem `role=""` (early return, hooks não chamados) e o 2º tem o
  role (hooks chamados) → contagem de hooks muda entre renders.
- **Evidência:** eslint `react-hooks/rules-of-hooks` (5 erros) nesses 3 arquivos;
  código lido confirma o early-return antes dos hooks.
- **Impacto:** React lança "Rendered more hooks than during the previous render" e a
  página quebra no acesso direto. Mesma classe do race de `modulesLoading` documentado
  no CLAUDE.md.
- **Correção proposta:** mover o bloco de hooks para antes do `return` condicional
  (renderizar o "acesso restrito" via `if` **depois** de todos os hooks declarados).

### M4 — Correção de devolução commitada e NÃO aplicada em produção

- **Onde:** `supabase/migrations/20260902000001_fix_devolucao_silent_noop_and_logging.sql`.
- **Causa:** migration existe no repo mas não está no banco.
- **Evidência:** `supabase migration list --linked` mostra `20260902000001` só em
  Local (coluna Remote vazia). Todas as anteriores estão aplicadas.
- **Impacto:** produção ainda roda a versão de `process_return_with_credit` que
  (a) cria devolução de **valor zero** com "sucesso" silencioso e (b) não loga
  tentativas de abatimento sem dívida. É um fix legítimo e seguro parado fora do ar.
  A migration usa `CREATE OR REPLACE` com a **mesma assinatura** (9 args) → sem risco
  de overload.
- **Correção proposta:** aplicar a migration (`supabase db push` ou SQL Editor).

### M5 — `verify_jwt` do gateway não versionado e cluster legado sem auth (footgun de deploy)

- **Onde:** `supabase/config.toml` (só tem `project_id`, nenhum bloco
  `[functions.*]`); 10 funções não deployadas.
- **Causa/Evidência:** `functions list` mostra `verify_jwt=false` em `pluggy-webhook`,
  `pluggy-sync-transactions`, `run-connect-automations`, `send-alert-email` (as 3
  primeiras têm checagem interna via HMAC/`x-internal-secret` — OK; `send-alert-email`
  exige `SERVICE_ROLE_KEY` — OK). O `verify_jwt` real não está no repo → invisível ao
  code review. As 10 não deployadas incluem o cluster legado **sem autenticação
  nenhuma** (`run-bank-reconciliation`, `sync-bank-accounts`, `sync-bank-transactions`,
  `connect-bank-oauth`, `refresh-bank-connection`, `connect-process-events`).
- **Impacto:** hoje inócuas (não estão no ar). Mas `supabase functions deploy
  --use-api` **sem nome** publica as 10 de uma vez, abrindo endpoints que confiam no
  `store_id` do body sem auth. `connect-webhook` tem `validateSignature()` definida mas
  **nunca chamada** (`signature_valid:true` hardcoded); `connect-alert-email` chama
  `serve()` sem importar `serve` (ReferenceError — quebrada).
- **Correção proposta:** declarar `verify_jwt` por função no `config.toml`; **deletar**
  o cluster legado (supersebido pelo fluxo Pluggy-widget atual); nunca rodar `deploy`
  sem nome.

### M6 — Drift de estoque real em 98 produtos + 1.272 sem estoque inicial rastreável

- **Onde:** `products.on_hand` vs Σ`stock_movements.qty`.
- **Evidência (query):** 1.370 produtos com `on_hand ≠ Σmovimentos`, decompostos em:
  **98** com trilha completa (inclui `initial_stock`) mas ainda divergentes = drift
  real não rastreado (soma **194 unidades**, máx 10/produto); **1.272** (827 sem
  movimento nenhum + 445 sem tipo `initial_stock`) = estoque inicial gravado direto na
  coluna sem movimento. 0 com `on_hand` negativo. 11.258 batem certo.
- **Impacto:** os 98 têm quantidade de estoque possivelmente errada (magnitude pequena,
  sem sinal de perda financeira); os 1.272 têm `on_hand` provavelmente correto mas
  **não reconstruível** a partir do histórico (lacuna de auditoria).
- **Correção proposta:** para os 98, ajuste com movimento `adjustment` de reconciliação
  (auditado). Para o padrão dos 1.272, garantir que a criação de produto sempre gere um
  movimento `initial_stock` (verificar `create_or_update_product_with_stock`).

### M7 — RLS de `connect_ai_queries` quebrada (bloqueia tudo) mas dado vaza pela RPC

- **Onde:** policy `tenant_isolation_ai_queries` (`20260621000021`).
- **Causa/Evidência:** `USING (store_id = (SELECT store_id FROM profiles WHERE
  profiles.id = auth.uid()))` — compara `profiles.id` (PK aleatória) com `auth.uid()`;
  nunca casa → subquery NULL → **bloqueia todo mundo** (SELECT direto). Não é
  vazamento por essa via. Mas `get_ai_query_history(p_store_id)` (SECURITY DEFINER,
  anon, em C1) lê a mesma tabela contornando a RLS.
- **Impacto:** feature de histórico de IA não funciona via tabela direta; e o dado é
  cross-tenant pela RPC (coberto por C1/H2).
- **Correção proposta:** `USING (store_id = get_my_store_id())` (ou
  `auth_user_id = auth.uid()`), como no resto do schema.

---

## LOW

- **L1 — 485 `any` / 506 erros de lint.** `npm run lint` falha; 485 são
  `@typescript-eslint/no-explicit-any` (ruído de tipagem, não bug), + 30
  `exhaustive-deps` (warnings), + `prefer-const`, + `no-require-imports` no
  `tailwind.config.ts`. Piores: `ServiceOrders/Detail.tsx`, `Returns.tsx`,
  `BulkEditProductsDialog.tsx`. Recomendação: `eslint --fix` no fácil, tipar os `any`
  de write-paths financeiros aos poucos.
- **L2 — `config.toml` com `project_id` errado** (`fkmogaunoraeyxgpxxjq` ≠
  `aimasistzxghumuxxuaw` linkado). Impacto baixo (CLI usa `.temp/linked-project.json`),
  mas confunde `supabase link` e mascara o M5.
- **L3 — Fila offline órfã.** `addToSyncQueue` (`src/lib/offlineDb.ts:100`) e o writer
  genérico de `syncEngine.ts` não têm **nenhum chamador** em `src/`. Infra offline
  existe mas nada enfileira mutação — nenhum write é de fato offline-safe. Código morto
  ou feature incompleta.
- **L4 — Buckets públicos.** `product-images` e `service-order-photos` são `public`
  (URLs por UUID). `payment-receipts`/`purchase-receipts` corretamente privados.
  Fotos de OS públicas por URL — privacidade menor.
- **L5 — Duplicação de implementação.** Dois fluxos Pluggy (legado sem auth vs widget
  atual) escrevendo em `bank_connections` por RPCs diferentes; `connect-webhook`+
  `connect-process-events` duplicam `pluggy-webhook`+`pluggy-sync-transactions`;
  `reports-summary` e `finance-api` sem chamador no `src/` (órfãos). Consolidar/remover.
- **L6 — Bundle 805 KB** (`index-*.js`, gzip 246 KB) sem code-split; build avisa. UX de
  primeira carga.
- **L7 — Cobertura de teste ~zero.** Só `src/test/example.test.ts` (trivial). Os
  `supabase/tests/*.sql` nunca rodam em CI; `connect_isolation_tests.sql` **não troca o
  contexto JWT** → roda como superuser e passaria mesmo com RLS desligada
  (falso-positivo); e faz `INSERT INTO profiles(... name ...)` numa coluna que se chama
  `full_name` (erraria antes de asserir). Esse arquivo não testa o que afirma testar.

---

## Banco / Supabase

- RLS: ligada e com policy em 82/82 tabelas. SELECT direto por `anon` retorna 0 linhas
  (`get_my_store_id()` nulo sem JWT). ✔ O vetor de vazamento é só via SECURITY DEFINER.
- `is_master_user()` usa e-mail **hardcoded** (`vitorargoloo001@gmail.com`) em paralelo
  ao `is_super_admin()` (tabela `system_admins`). Duas portas de admin — reconciliar
  para uma só (`is_super_admin`); e-mail fixo não rotaciona sem migration.
- Footgun de overload: `get_reconciliation_by_method` teve assinatura trocada sem
  `DROP` (limpo depois em `20260804000001`). Hoje sem overload órfão pendente
  detectado nos nomes de alto risco.
- Advisor: 1 ERROR (view H1) + vários WARN `function_search_path_mutable` (LOW,
  hardening; recomenda `SET search_path` fixo nas funções).
- `permissive_true_policies`: só `role_capabilities.role_cap_read` (config pública,
  benigno). Nenhum `GRANT ... TO anon` em tabela nas 149 migrations.

## Segurança (resumo)

CRITICAL: C1 (anon → dados de todas as lojas via 55 RPCs), C2 (revert de devolução sem
auth). HIGH: H1 (view definer anon), H2 (cross-tenant entre logados). Fix imediato =
sweep `REVOKE EXECUTE FROM anon, PUBLIC` (pronto em
`scratchpad/CORRECAO_CRITICAL_revoke_anon.sql`). Segredos de terceiro
(`PLUGGY_*`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`) **não existem em produção**
(`secrets list`) → Connect/IA/e-mail estão inertes, o que reduz o dano ativo do módulo
bancário hoje, mas o token bancário de 6 conexões reais segue exposto por C1.

## Multi-tenant (resultado da validação)

- Isolamento por RLS direto nas tabelas: **APROVADO** (82/82, sem `USING(true)`
  perigoso, sem tabela sem policy).
- Isolamento nas RPCs SECURITY DEFINER: **REPROVADO** — 55 funções contornam o
  isolamento (C1/C2/H2). É o furo central da auditoria.
- `profiles`: escalonamento de role bloqueado corretamente no backend (a policy
  `profiles_update` só deixa owner conceder owner/admin) — o `.update()` cru do
  `Settings.tsx` **não** é explorável para virar owner. ✔

## Dados financeiros (resultado da validação)

- Invariante `amount_paid+amount_pending=net_total`: 290 violações históricas (troco,
  M1), drift **parado** desde 2026-08-19. Sem duplicidade: 0 pagamentos no mesmo
  minuto, 0 `sale_items` duplicados. 0 `cash_entries` órfãos. Abatimento
  (`credit`/`return_offset`/`pending`) corretamente **fora** de `cash_entries` (0
  ocorrências) → abatimento não vira dinheiro. ✔ exceto o troco de M1.
- Relatório oficial usa datas corretas (`sale_date`/`paid_at`); Dashboard não (M2).

## Estoque (resultado da validação)

`on_hand` reconciliado contra `stock_movements`: 11.258 corretos; 98 com drift real
pequeno (194 un.); 1.272 com estoque inicial não rastreável; 0 negativo; 0 movimento
duplicado. Fórmula `inicial + entradas − saídas + devoluções ± ajustes` fecha para a
grande maioria. Detalhe em M6.

## Testes

| Verificação | Resultado | Observação |
|---|---|---|
| `npx tsc --noEmit` | **PASSOU** (exit 0) | sem erro de tipo |
| `npm run test` (vitest) | **PASSOU** (1/1) | só 1 teste trivial — cobertura ~zero (L7) |
| `npm run build` | **PASSOU** (exit 0) | avisa chunk de 805 KB (L6) |
| `npm run lint` | **FALHOU** (506 erros, 35 warn) | 485 `any` (ruído) + 5 rules-of-hooks reais (M3) |
| Fluxos E2E de escrita | **NÃO EXECUTADOS** | exigiriam escrever em prod; validados via invariantes sobre dados reais |
| Testes SQL de RLS | **NÃO CONFIÁVEIS** | `connect_isolation_tests.sql` não troca JWT (L7) |

## Pendências (não corrigido / não provável sem ação sua)

1. **Aplicar as correções** — por decisão sua, esta sessão é read-only. Nada foi
   aplicado. Os arquivos de correção estão prontos (C1/C2/H1/H2 em
   `scratchpad/CORRECAO_CRITICAL_revoke_anon.sql`; M4 já é uma migration no repo).
2. **Regra de negócio do troco (M1)** — a reconciliação dos R$2.493 depende de você
   confirmar como o troco deve ser modelado antes de eu escrever a migration de acerto.
3. **PoC via REST não executada** — bloqueada pelo classificador (trafegar anon key);
   prova via catálogo é suficiente e definitiva.
4. **E2E reais** — sem stack local (Docker) e sem poder escrever em prod, os fluxos
   venda→estoque→CR→pagamento→devolução não foram exercitados de ponta a ponta; foram
   validados pelos invariantes sobre os dados existentes.
5. **Triagem fina das 34 leitoras (H2)** — o guard por função precisa ser escrito uma a
   uma; entreguei o padrão, não as 34 edições.

## Nota sobre "Usskills" / skills

Não existe agente "Usskills" (nem `.claude/agents/`) em nenhuma das duas árvores. As
skills da pasta externa (`Projeto Estokfy/.claude/skills/*`: carrossel, seo, salvar,
relatorio-ads, ...) são o **MazyOS**, um sistema de marketing/conteúdo **sem relação
nenhuma** com o código do Estokfy — grep por `estokfy|supabase|react|typescript` nas 15
skills retorna zero. Não apontam para código antigo do app nem influenciam decisões
técnicas dele; nada a consolidar do lado do Estokfy. O `estokfy/CLAUDE.md` (esse sim
específico do app) está correto e atualizado.
