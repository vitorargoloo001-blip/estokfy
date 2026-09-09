# Cluster Pluggy legado — mapeamento completo antes de remover

Nada removido ainda. Toda evidência abaixo é verificação real (grep no repo +
query em produção), não suposição.

## LEGADO MORTO (candidato a remoção)

### Edge Functions (6, nenhuma deployada em produção — confirmado via `supabase functions list`)

| Função | O que fazia | Auth própria | Chamada pelo frontend | Chamada por outra função viva |
|---|---|---|---|---|
| `connect-bank-oauth` | Trocava código OAuth por token Pluggy (fluxo antigo `/auth/credential`) | Nenhuma | Não | Não |
| `connect-pluggy-auth-callback` | Callback do redirect OAuth | Não valida `state` (CSRF, já documentado) | Não (é redirect, não fetch) | Não |
| `sync-bank-accounts` | Buscava contas via `/auth/{connId}/accounts` (endpoint que não bate com a API real da Pluggy) | Nenhuma | Não | Não |
| `sync-bank-transactions` | Buscava transações via `/auth/{connId}/accounts/{id}/transactions` (mesmo problema) | Nenhuma | Não | Não |
| `refresh-bank-connection` | Marcava conexão como precisando reautenticar | Nenhuma | Não | Não |
| `run-bank-reconciliation` | Matching bancário heurístico próprio, usa `sales.total_amount`/`status='completed'` — colunas que **não existem** no schema real (`net_total`/`payment_status`) | Nenhuma | Não | Não |

### RPCs (9, todas confirmadas sem chamador vivo)

| RPC | Migration que define | Chamada por Edge Function viva? | Chamada pelo frontend? | Linhas afetadas em produção |
|---|---|---|---|---|
| `update_or_insert_bank_connection` | `20260617000015_pluggy_rpc_helpers.sql` | Não | Não | — |
| `get_bank_connection_token` | `20260617000015_pluggy_rpc_helpers.sql` | Não | Não | — |
| `sync_bank_accounts_from_provider` | `20260617000015_pluggy_rpc_helpers.sql` | Não | Não | — |
| `sync_bank_transactions_from_provider` | `20260617000015_pluggy_rpc_helpers.sql` | Não | Não | — |
| `store_provider_webhook` | `20260617000014_pluggy_integration.sql` | Não | Não | 0 linhas em `provider_webhooks` |
| `update_bank_connection_sync` | `20260617000014_pluggy_integration.sql` | Não | Não | — |
| `get_bank_connection_with_provider` | `20260617000014_pluggy_integration.sql` | Não | Não | — |
| `list_webhook_events` | `20260617000014_pluggy_integration.sql` | Não | Não | — |
| `mark_webhook_processed` | `20260617000014_pluggy_integration.sql` | Não | Não | — |

### Tabela

`provider_webhooks` (criada em `20260617000014_pluggy_integration.sql`,
com índices e 3 policies) — **0 linhas** em produção, confirmado agora.
`connect-process-events` (função separada, também não deployada) lê de uma
tabela `webhook_events` que **não existe** no banco — código morto que
quebraria com erro `relation does not exist` se alguém chamasse.

### Env vars exclusivas do legado

`PLUGGY_REDIRECT_URI` — só usada por `connect-bank-oauth`. Não está em
`supabase secrets list` hoje (nenhum secret de terceiro configurado em
produção), então já não tem efeito nenhum.

## INTEGRAÇÃO CONNECT ATUAL — não tocar

| Componente | Por quê fica |
|---|---|
| Edge Functions `pluggy-connect-token`, `pluggy-register-item`, `pluggy-webhook`, `pluggy-sync-transactions`, `pluggy-config-status` | Deployadas, usadas pelo frontend (`usePluggyConnection.ts`), autenticadas |
| RPCs `register_pluggy_item_auth`, `upsert_bank_transaction_pluggy`, `update_bank_connection_sync_status` (com `_status` — nome parecido com a legada mas é OUTRA função), `mark_pluggy_item_synced`, `update_pluggy_item_status`, `get_pluggy_items_for_sync`, `disconnect_pluggy_item`, `get_bank_connections_with_pluggy` | Todas de `20260621000001_connect_pluggy_v2.sql` — cluster vivo, usado por `pluggy-register-item`/`pluggy-sync-transactions` |
| Tabelas `bank_connections` (6 linhas reais), `pluggy_items`, `pluggy_webhooks` | Dado real de produção |
| Env vars `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` | **Compartilhadas** — usadas tanto pelo legado quanto pelo vivo. Não remover. `PLUGGY_WEBHOOK_SECRET` — só do vivo, fica. |

⚠️ Atenção: `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` aparecem nos dois clusters
— removendo o legado, essas duas continuam necessárias pro cluster vivo.

## Diff de remoção (não aplicado)

Arquivo: `REMOCAO_PLUGGY_LEGADO.sql` (anexo). Como as 9 RPCs e a tabela nunca
tiveram um `DROP` em nenhuma migration, a remoção precisa ser uma migration
NOVA com `DROP FUNCTION`/`DROP TABLE` explícitos — não dá pra simplesmente
apagar os arquivos antigos, porque o banco de produção já tem esses objetos
criados independente do que sobra no repo.

Lado do código: apagar as 6 pastas em `supabase/functions/` (não precisa de
migration, é só remover do repo — elas nunca foram deployadas, então não há
nenhum "undeploy" a fazer).

## Comprovação de que nada ativo depende disso

- 0 chamadas de frontend (`grep -rn` em `src/` — só aparecem no `types.ts` autogerado).
- 0 chamadas internas de outra função SQL viva.
- 0 chamadas de qualquer Edge Function deployada.
- 0 linhas de dado em `provider_webhooks`.
- `webhook_events` (usada por `connect-process-events`, também legado) nem existe.
- 0 das 6 conexões bancárias reais usa a coluna do fluxo legado (`webhook_id`).
