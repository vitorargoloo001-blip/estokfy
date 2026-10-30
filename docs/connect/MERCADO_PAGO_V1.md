# Mercado Pago direto no Estokfy Connect — V1

Provider `mercado_pago` em `bank_connections`, ao lado de `pluggy`, `manual` e
`itau_direct`. Os recebimentos aprovados da conta Mercado Pago viram linhas de
`bank_transactions` e passam pelo motor de conciliação existente
(`_connect_run_matching_core`) e pela confirmação existente
(`confirm_reconciliation` / `bulk_reconcile` → `settle_sale_payment`). Nenhum
dos três foi alterado.

**Status:** código pronto e testado unitariamente. Migrations, Edge Functions,
secrets e webhook **ainda não estão em produção**. Nada disso foi testado com
dinheiro real.

## Escopo

- Dentro: importar pagamentos recebidos (Point, Pix/QR do app, link), webhook,
  sincronização periódica de rede de segurança, conciliação, taxa e líquido
  visíveis.
- Fora: checkout, criação de Pix/QR/Point, OAuth multi-loja (fase 2), relatório
  de liberações (fase 2), lançamento automático de taxa, mudanças no motor.
- Sem histórico: a janela de busca começa na conexão (`connected_at`).

## Endpoints oficiais usados

| Uso | Endpoint |
|---|---|
| Testar credencial e descobrir `user_id` | `GET /users/me` |
| Busca incremental | `GET /v1/payments/search` com `range=date_last_updated`, `begin_date`, `end_date`, `sort=date_last_updated`, `criteria=asc`, `limit ≤ 50`, `offset ≤ 10000` |
| Dados oficiais de um pagamento (webhook) | `GET /v1/payments/{id}` |

Assinatura do webhook: header `x-signature` (`ts=…,v1=…`), manifest
`id:{data.id em minúsculas};request-id:{x-request-id};ts:{ts};`, HMAC-SHA256 em
hex com a assinatura secreta da aplicação. O corpo da notificação é tratado só
como aviso; valor e status vêm sempre de `GET /v1/payments/{id}`.

## Arquivos

- `supabase/migrations/20261015000001_connect_mercadopago_v1.sql` — colunas,
  índice de conta única, `upsert_mercadopago_connection`,
  `upsert_bank_transaction_mercadopago`, `list_bank_transactions` ampliado.
- `supabase/migrations/20261015000002_connect_mercadopago_cron.sql` — `pg_net`,
  segredo do cron no Vault, job a cada 10 min.
- `supabase/functions/_shared/mercadopago.ts` — assinatura, normalização,
  busca, cliente HTTP (sem dependências, testado em vitest).
- `supabase/functions/_shared/mercadopago-server.ts` — autorização, papel,
  licença, credencial V1, ingestão.
- `supabase/functions/mercadopago-connect` — conecta a conta à loja.
- `supabase/functions/mercadopago-sync-payments` — sincronização (usuário ou cron).
- `supabase/functions/mercadopago-webhook` — notificações (deploy com `--no-verify-jwt`).
- UI: `src/pages/Connect/Connections.tsx`, `src/pages/Connect/Transactions.tsx`,
  `src/hooks/usePluggyConnection.ts`, `src/hooks/useTransactions.ts`.

## Regras de status

| Situação no Mercado Pago | Efeito em `bank_transactions` |
|---|---|
| Nunca aprovado (pending, rejected, cancelled sem aprovação) | Não cria linha |
| `approved` (primeira vez) | Cria `pending` (entra no motor) |
| Atualização com `date_last_updated` mais antigo que o guardado | Ignorada |
| `refunded` / `charged_back` / `cancelled`, ainda não conciliado | `ignored`; sugestões pendentes descartadas |
| `refunded` / `charged_back`, já conciliado | Mantém `reconciled`; alerta `error` em `connect_alerts` para revisão manual |
| Estorno parcial de algo conciliado | Atualiza `refunded_amount`; alerta `warning` |
| Voltou a `approved` após estorno não conciliado | Volta a `pending` |

**Nenhum estorno automático de dinheiro.** O financeiro só muda pelo fluxo
normal de conciliação.

## Valores

- `amount` = bruto pago pelo cliente (é o que casa com `payments`).
- `fee_amount` = soma das taxas com `fee_payer = collector` em `fee_details`.
  Sem `fee_details`, cai para `gross − net_received_amount`.
- `net_amount` = `transaction_details.net_received_amount`.
- A venda nunca vira o líquido. Não há lançamento automático de taxa: o núcleo
  financeiro não tem modelo de taxa de adquirente, e isso depende de decisão de produto.

## Conciliação com o Pix gerado pelo Estokfy (2026-10-30)

Migration `20261030000001_connect_matching_pix_e_nome.sql` alterou
`_connect_run_matching_core` (antes intocado nesta V1):

- **Passe 0:** a cobrança Pix (`mercadopago_pix_charges`) manda o próprio id
  como `external_reference`. Recebimento com esse `external_reference` liga ao
  pagamento criado pela cobrança (`idempotency_key = 'mercadopago:' ||
  mp_payment_id`) com nota 100. **Não confirmado ainda** que o
  `external_reference` da order chega ao `/v1/payments` importado — conferir no
  primeiro Pix real; se não chegar, o pagamento continua nos passes 1-3.
- **Passes 1-3:** desempate pelo nome do pagador (`payer_name`, ou a descrição)
  contra o nome do cliente da venda (`_connect_payer_matches_customer`: primeiro
  e último nome como palavras inteiras, sem acento). Pagamentos do Pix do
  Estokfy ficam por último nesses passes. Notas não mudaram.
- Teste: `supabase/tests/connect_matching_regression_tests.sql`.

Na tela de Nova Venda, "PIX QR Code" (só para a loja de `MP_PIX_STORE_ID`)
registra essa parte como pendente com vencimento hoje e abre a cobrança. Exige
cliente com e-mail (o Mercado Pago exige `payer.email`).

## Dados pessoais

`raw_data` é uma lista branca (ids, status, valores, datas, taxas, método,
`external_reference`). Documento, telefone, endereço e dados de cartão não são
gravados. Nome e e-mail do pagador ficam em colunas próprias, usados só para
conciliação — o próprio Mercado Pago restringe o uso desses dados a isso.

## Secrets (só nomes — valores nunca no repositório nem no chat)

- `MP_ACCESS_TOKEN` — Access Token de produção da aplicação "Estokfy Connect"
- `MP_WEBHOOK_SECRET` — assinatura secreta do webhook
- `MP_V1_STORE_ID` — UUID da única loja autorizada nesta V1
- `MP_CRON_SECRET` — **não usado**: o segredo do cron fica no Vault
  (`mercadopago_cron_secret`), criado pela migration 20261015000002

## Antes de aplicar em produção

1. Confirmar que `pg_net`, `supabase_vault` e `pg_cron` estão disponíveis
   (`pg_available_extensions`).
2. Confirmar que `bank_transactions.bank_reference` tem UNIQUE.
3. Ensaiar as migrations em `BEGIN … ROLLBACK` contra produção (padrão do projeto).
4. Deploy: `mercadopago-connect` com `--use-api`; `mercadopago-sync-payments`
   e `mercadopago-webhook` com `--use-api --no-verify-jwt`. A sincronização
   precisa do `--no-verify-jwt` porque o cron não manda JWT, só `x-cron-secret`;
   com `verify_jwt` ligado o gateway recusa com 401 antes de a função rodar.
   O `supabase/config.toml` já fixa isso por função.
5. Regenerar `src/integrations/supabase/types.ts` com `supabase gen types`.

## Testes

- `src/lib/mercadopago.test.ts` (17 casos): assinatura válida/inválida/adulterada,
  manifest sem `x-request-id`, `data.id` em maiúsculas, normalização (bruto,
  taxa, líquido, fuso, método), redação de `raw_data`, pagamento de outra conta
  ou moeda, paginação, janela de busca, retry de 429/5xx e ausência de retry em 4xx.
- Suíte completa: 81 testes passando, `tsc --noEmit` limpo.

**Não testado ainda:** SQL das migrations (sem Postgres local), Edge Functions
(sem Deno local), webhook real, pagamento real, estorno real, cron real.

## Fase 2 (não implementada)

- OAuth Authorization Code + PKCE por loja (`auth.mercadopago.com/authorization`),
  tokens por conexão (180 dias, `refresh_token` rotativo), guardados fora de
  `bank_connections` (que é legível pelo perfil `finance`).
- Trocar só `getAccessToken` em `mercadopago-server.ts` para ler o token da conexão.
- Relatório de liberações (`/v1/account/release_report`) para conciliar taxas,
  saques e liquidação.
