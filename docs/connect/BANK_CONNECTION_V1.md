# Conexão bancária funcional V1 — Estokfy Connect (Pluggy)

Data: 2026-08-22

## Resumo

Fluxo completo **Conectar Banco → Importar Conta → Importar Transações →
Conciliar** ponta a ponta, usando Pluggy só como infraestrutura bancária
(sem marca visível ao usuário além do inevitável, sem infraestrutura
bancária própria). A conciliação, além de confirmar pagamentos já
registrados (comportamento que já existia), agora também **cria um
pagamento novo de verdade** quando uma transação bancária bate com uma
venda em aberto sem nenhum pagamento ainda (fiado/pendente) — reaproveitando
`settle_sale_payment`, não uma lógica de dinheiro nova.

**Estado real hoje**: o código está pronto e testado no que dá pra testar
sem credencial. `PLUGGY_CLIENT_ID`, `PLUGGY_CLIENT_SECRET` e
`PLUGGY_WEBHOOK_SECRET` **não estão configuradas** no projeto Supabase —
clicar em "Conectar Banco" hoje retorna o erro amigável "credenciais não
configuradas" em vez de travar com erro técnico (isso já era tratado, e
agora também aparece pro Super Admin antes de qualquer loja tentar). Ver
seção "Como ativar" no final.

## Auditoria: dois grupos de código "Pluggy" no repositório

Antes de mexer em qualquer coisa, auditei o que já existia (leitura de
código-fonte real, não só documentação). Achado importante:

- **Grupo A — real, funcionando, o único chamado pelo frontend**:
  `pluggy-connect-token`, `pluggy-register-item`, `pluggy-sync-transactions`,
  `pluggy-webhook` + tabelas `pluggy_items`, `pluggy_webhooks`,
  `bank_connections`, `bank_transactions`. É onde toda a V1 foi construída.
- **Grupo B — código morto de uma versão anterior abandonada**:
  `connect-bank-oauth`, `connect-pluggy-auth-callback`,
  `bank-webhook-handler`, `sync-bank-accounts`, `sync-bank-transactions`,
  `refresh-bank-connection`, `connect-webhook`, `connect-process-events`.
  Referenciam tabelas que nunca foram criadas (`bank_accounts`,
  `webhook_events`) e endpoints que não existem na API real da Pluggy —
  quebrariam se fossem chamados. **Não foram tocados** nesta rodada (fora do
  pedido "não reimplementar / não criar infraestrutura própria"). Ficam
  aqui documentados pra quem for fazer limpeza de código morto no futuro.

## Bug pré-existente encontrado e corrigido de passagem

Ao testar `confirm_reconciliation`/`bulk_reconcile` pela primeira vez de
forma isolada (antes de qualquer mudança minha), as duas falhavam sempre
com `ERROR 428C9: cannot insert a non-DEFAULT value into column
"created_at_date"` — essa coluna de `connect_audit_logs` é
`GENERATED ALWAYS ... STORED` desde a criação da tabela, e as duas funções
tentavam gravar `CURRENT_DATE` nela explicitamente. **Isso significa que
nenhuma conciliação (nem a antiga, "confirmar pagamento já existente") nunca
tinha conseguido ser confirmada com sucesso em produção**, desde que a
auditoria foi adicionada a essas funções (migration `20260619000002`).
Corrigido na mesma migration desta entrega (removido `created_at_date` do
INSERT, deixando a coluna se gerar sozinha).

## O que foi construído

### 1. Botão "Conectar Banco" (`Connections.tsx`)

Já existia, ligado a `usePluggyConnection().openWidget()`. Ajustado:

- Removida toda menção visível a "Pluggy" (textos, banner, rodapé com link
  pro dashboard da Pluggy e nomes crus de env var) — trocado por linguagem
  genérica "conexão bancária segura" / "Estokfy Connect".
- Número da conta mascarado (`•••• 2841`).
- Saldo exibido quando disponível.
- "Conciliações realizadas" / "Pendências" por conexão.
- Botões de conectar/sincronizar/reconectar/desconectar agora só aparecem
  pra quem tem a capability `canManageConnect` (existia definida desde
  antes em `useCapabilities.ts`, nunca tinha sido ligada em lugar nenhum —
  gap real de autorização fechado, exposto também via `usePermissions()`
  pra ficar no padrão do resto do app).

Não é feita nenhuma tentativa de listar apps bancários instalados — a
própria Pluggy Connect Widget mostra a lista de instituições suportadas.

### 2. `pluggy-connect-token` — Connect Token

Já criava o token corretamente (secrets só no backend, nunca expostos).
Acrescentado ao corpo de `/connect_tokens`:

- `webhookUrl`: aponta pra `pluggy-webhook`, deixando a própria Pluggy
  notificar por item em vez de depender só de sincronização manual.
- `avoidDuplicates: true`: impede conectar a mesma conta duas vezes.
- `oauthRedirectUri`: aponta pra `/connect/bancos` (rota autenticada que já
  existe) — instituições que exigem redirect completo (em vez de rodar
  tudo dentro do widget) mandam o usuário de volta pra lá; como é
  same-origin, sessão e `store_id` não se perdem no meio do caminho
  (item 12/13 do pedido — mobile e mudança de página).

**Não verificado contra a API real da Pluggy** (sem credenciais). A
documentação oficial confirma os 3 campos (`webhookUrl`, `avoidDuplicates`,
`oauthRedirectUri`) como parte do schema de `POST /connect_tokens`, mas o
comportamento exato do redirect (query params que a Pluggy anexa ao voltar,
se o SDK resume sozinho ao recarregar `/connect/bancos`) só dá pra
confirmar com uma conexão real.

### 3. `pluggy-webhook` — idempotência por evento

Antes, um webhook reentregue pela Pluggy (comum em qualquer webhook — rede
instável, timeout) só era absorvido indiretamente, via o `UNIQUE` em
`bank_transactions.bank_reference` a jusante. Agora deduplica pelo próprio
`eventId` que a Pluggy manda em todo webhook: evento já visto vira no-op
(`{received:true, action:"duplicate_event_ignored"}`) sem reprocessar nada.

### 4. Motor de conciliação — 4º passe (não mexeu nos 3 existentes)

`_connect_run_matching_core` continua com os 3 passes originais
(determinístico/heurístico/fuzzy, todos contra `payments` já existentes)
**intocados byte a byte** (verificado por diff antes de aplicar). Acrescenta
um 4º passe, só quando os 3 primeiros não acham nada: venda em aberto
(`amount_pending > 0`) sem nenhum pagamento ainda, casada por valor exato +
data em até 3 dias + nome do cliente aparecendo na descrição da transação
bancária (mais restritivo de propósito, porque confirmar isso cria dinheiro
novo, não só confirma algo que já existia).

`confirm_reconciliation` e `bulk_reconcile`: quando o match vem desse 4º
passe (identificado por `payment_id IS NULL` no registro de
`reconciliation_matches`), confirmar chama `settle_sale_payment` de
verdade — herdando de graça a trava contra sobrepagamento, a alocação por
item e o lançamento em `cash_entries` que essa RPC já tinha (endurecida
numa correção anterior desta mesma sessão). O pagamento novo fica
registrado normalmente: atualiza saldo, status, financeiro e relatórios
(que já leem de `sales`/`payments` como fonte única), e gera auditoria em
`connect_audit_logs`. Comportamento pra um match que já tinha `payment_id`
(o caso de sempre, "confirmar pagamento existente") fica **idêntico ao que
já era** — verificado por teste.

### 5. Não duplicar pagamento

- `payments.bank_transaction_id` (nova coluna, `UNIQUE`) — cada transação
  bancária só pode virar no máximo um pagamento, garantido no banco, não só
  na aplicação.
- `confirm_reconciliation` também confere antes de tentar de novo (retorna
  erro amigável se a transação já tiver gerado um pagamento).

### 6. Super Admin — status da Pluggy

Nova função `pluggy-config-status` (só Super Admin, via `is_super_admin()`)
retorna se `PLUGGY_CLIENT_ID`/`PLUGGY_CLIENT_SECRET` estão configuradas —
nunca os valores. Card no topo de `ConnectLicenses.tsx` mostra
"Pluggy configurada" ou "Pluggy não configurada" antes de qualquer loja
esbarrar no erro técnico.

### 7. Saldo da conta

`bank_connections.balance` (nova coluna). `pluggy-register-item` já grava
no cadastro inicial (o `GET /accounts` que já fazia já trazia o saldo,
só não estava sendo salvo). `pluggy-sync-transactions` passou a buscar
`/accounts` a cada sincronização (antes só buscava como fallback quando o
cache de contas vinha vazio) — saldo puxado de novo a cada sync, não só na
conexão inicial.

## Migration

`supabase/migrations/20260822000001_connect_bank_v1.sql` — schema
(`payments.bank_transaction_id`, `pluggy_webhooks.pluggy_event_id`,
`bank_connections.balance`) + `CREATE OR REPLACE` de `settle_sale_payment`
(só acrescenta `payment_id` no retorno), `_connect_run_matching_core`
(4º passe), `confirm_reconciliation`, `bulk_reconcile` (settle real +
correção do `created_at_date`) + `get_bank_connections_with_pluggy`
(precisou `DROP`+`CREATE` porque muda o formato de retorno, não só
`CREATE OR REPLACE` — adiciona `balance`).

## Edge Functions alteradas/criadas

- `pluggy-connect-token` — `webhookUrl`/`avoidDuplicates`/`oauthRedirectUri`
- `pluggy-webhook` — idempotência por `eventId`
- `pluggy-register-item` — grava saldo inicial
- `pluggy-sync-transactions` — busca e grava saldo a cada sync
- `pluggy-config-status` — **novo**, status pro Super Admin

Todas já deployadas (`supabase functions deploy <nome> --use-api`).

## Secrets necessários (nomes — nunca valores commitados)

```
PLUGGY_CLIENT_ID
PLUGGY_CLIENT_SECRET
PLUGGY_WEBHOOK_SECRET
```

Confirmado hoje, direto no Supabase: **nenhuma das 3 está configurada.**

## Testes executados

Todos via `BEGIN...ROLLBACK` contra produção (zero risco, mesmo padrão já
usado nesta sessão para as outras correções de pagamento):

1. `settle_sale_payment` continua retornando o mesmo resultado de sempre,
   agora com `payment_id` a mais.
2. 4º passe: venda aberta sem pagamento + transação simulada com valor
   exato e nome do cliente na descrição → gera match com `payment_id NULL`.
3. Confirmar esse match → `settle_sale_payment` roda de verdade, venda vira
   paga, `payments.bank_transaction_id` preenchido, transação marcada
   `reconciled`.
4. `payments.bank_transaction_id` `UNIQUE` bloqueia fisicamente uma segunda
   tentativa de vincular a mesma transação a outro pagamento.
5. Match do jeito antigo (payment_id já preenchido) confirma exatamente
   como antes — nenhum pagamento novo, nenhuma mudança de comportamento.
6. `bulk_reconcile` também cria o pagamento quando necessário.
7. Diff byte a byte de `settle_sale_payment`, `_connect_run_matching_core`
   (passes 1-3), `confirm_reconciliation` e `bulk_reconcile` contra a
   versão ao vivo antes de aplicar a migration, confirmando que nada além
   do pretendido mudou.

**Não testado nesta rodada** (depende das credenciais reais da Pluggy, que
não estão configuradas):

- Abrir o widget de verdade, escolher um banco real, autorizar.
- Receber webhook real da Pluggy (`eventId`, formato exato do payload).
- Comportamento exato do `oauthRedirectUri` pra instituições que exigem
  redirect completo.
- Sincronização de contas/transações/saldo com dados bancários reais.

## Como ativar quando as credenciais chegarem

1. Criar/obter `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` no
   [dashboard da Pluggy](https://dashboard.pluggy.ai) (ambiente sandbox ou
   produção).
2. Configurar as 3 env vars nas Edge Functions do projeto Supabase
   (`aimasistzxghumuxxuaw`) — painel do Supabase → Edge Functions → Secrets,
   ou `supabase secrets set` (precisa terminal interativo autenticado).
3. Conferir em Super Admin → Connect → Licenças que o card passa a mostrar
   "Pluggy configurada".
4. Numa loja com o módulo Connect licenciado, testar o fluxo completo:
   Conectar Banco → escolher instituição de teste (sandbox da Pluggy tem
   bancos de teste com dados fake) → autorizar → conferir que a conexão
   aparece, contas e transações foram importadas, e que rodar a conciliação
   gera os matches esperados (incluindo pelo menos um cenário de venda em
   aberto sem pagamento, pra validar o 4º passe end-to-end com dado real).
5. Registrar a URL de webhook (`https://aimasistzxghumuxxuaw.supabase.co/
   functions/v1/pluggy-webhook`) no dashboard da Pluggy, se não for
   suficiente só o `webhookUrl` mandado no connect token.

## Fora de escopo (mantido conforme pedido)

Grupo B (código morto), lista de apps bancários instalados, infraestrutura
de Open Finance própria, novos dashboards/relatórios/IA, toggle
mock/pluggy como controle de runtime — o sandbox de demonstração que já
existia (`connect_seed_demo_data`, restrito a Super Admin) continua
funcionando exatamente como estava, sem mudança.
