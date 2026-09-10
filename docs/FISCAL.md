# Módulo Fiscal — controle de notas fiscais para declaração

**Status:** V1 em produção desde 2026-09-09. Migration base aplicada
(`20260909000001_fiscal_documents.sql`) e validada ponta a ponta no navegador:
lançamento, importação de XML, anexo de PDF, envio ao contador, declaração,
cancelamento e exportação PDF/CSV.

## O que o módulo é — e o que não é

É um **organizador documental**: registra a nota, guarda o XML/PDF, controla o
status até a declaração e avisa o que está pendente. Resolve o problema de
"emiti/recebi nota durante o mês e esqueci de mandar pro contador".

**Não** emite nota, **não** declara, **não** calcula tributo e **não** presume
prazo legal — isso depende do regime tributário e da orientação contábil de cada
empresa. O prazo de alerta é configurável pela própria loja.

## Invariante de projeto

Lançar, editar ou cancelar uma nota **nunca** pode criar venda, mexer em
estoque, gerar recebimento ou lançar caixa. O vínculo com uma venda é apenas
documental.

Isso é garantido estruturalmente: as RPCs escrevem exclusivamente em
`fiscal_documents` e `audit_logs` — nenhuma delas referencia
`sales`/`stock_movements`/`cash_entries`/`payments` em escrita. O teste 13–16 da
validação confirma isso contando as linhas dessas quatro tabelas antes e depois
de um lançamento.

## Modelo de dados

Tabela única `fiscal_documents` (multi-tenant por `store_id`).

- `document_type`: `nfe | nfce | nfse | entrada | saida | outro`
- `direction`: `incoming | outgoing`
- `fiscal_status`: `pending | sent_to_accountant | declared | cancelled`
- Competência separada da emissão (`competence_month`/`competence_year`) — é ela
  que responde "o que precisa ser tratado em setembro/2026".
- Vínculos **opcionais**: `sale_id`, `customer_id`, `supplier_id`. Nota sem venda
  é caso de primeira classe (compra, despesa, serviço, documento externo).
- Contraparte livre (`counterpart_name`, `counterpart_doc`) para quando o
  cliente/fornecedor não está cadastrado.
- Carimbos de autoria por transição: `sent_to_accountant_at/by`,
  `declared_at/by`, `cancelled_at/by`.

**Sem hard delete.** Erro se resolve cancelando (`fiscal_status = 'cancelled'`,
`cancelled_at/by` preenchidos) ou corrigindo — toda alteração grava
`before_json`/`after_json` em `audit_logs`.

**Cancelar uma nota NÃO apaga seus anexos.** Regra oficial, para preservação de
histórico e auditoria: o XML e o PDF continuam no bucket e continuam vinculados
ao documento cancelado (`xml_path`/`pdf_path` são mantidos), e quem tem
permissão fiscal segue conseguindo abri-los. `set_fiscal_document_status` só
carimba `cancelled_at`/`cancelled_by` — não toca nos caminhos nem remove
objeto de storage. Nunca implementar limpeza automática de anexo no
cancelamento; remoção de arquivo é sempre ação humana e deliberada.

**Anti-duplicidade** por dois índices únicos parciais (notas canceladas saem do
índice, para permitir relançar): `(store_id, access_key)` e
`(store_id, document_type, direction, invoice_number, coalesce(series,''))`.

## Segurança

`fiscal_documents` tem **apenas policy de SELECT**. Não existe policy de
INSERT/UPDATE/DELETE — logo o browser não consegue gravar direto na tabela nem
forjar as colunas de autoria. Toda escrita passa pelas RPCs `SECURITY DEFINER`
auditadas, seguindo a convenção pós-auditoria 2026-09 (plpgsql + `PERFORM` do
guard antes de qualquer leitura, `search_path` fixo, `REVOKE` de `anon`/`PUBLIC`
e `GRANT` explícito só para `authenticated`).

| RPC | Papéis | Observação |
|---|---|---|
| `create_fiscal_document(...)` | owner, admin, manager, finance | valida que `sale_id`/`customer_id`/`supplier_id` são da mesma loja |
| `update_fiscal_document(...)` | idem | bloqueia edição de nota cancelada |
| `set_fiscal_document_status(id, status, notes)` | idem | carimba autor/data no servidor |
| `get_fiscal_summary(store, ano, mês)` | idem | KPIs do módulo e do Dashboard |
| `_assert_fiscal_manage(store)` | — | helper interno, revogado até de `authenticated` |

**Vendedor** (`sales`) tem acesso à rota `/fiscal`, mas a policy de SELECT só
devolve notas ligadas a vendas que ele mesmo criou, e os KPIs da loja ficam
ocultos (a RPC de resumo recusa o papel). Vendedor não vê o quadro fiscal geral
da empresa.

**Anexos** ficam no bucket privado `fiscal-documents`, path
`<store_id>/<timestamp>-<rand>.<ext>`, com as policies de `storage.objects`
espelhando as de `purchase-receipts` e limitadas aos papéis de gestão. Leitura
sempre por URL assinada de 5 min (`createSignedUrl`), nunca URL pública.

## Importação de XML

`src/lib/nfeXml.ts` lê o XML no browser com `DOMParser` (sem dependência nova) e
pré-preenche o formulário — chave de acesso, número, série, emissão, modelo
(55 = NF-e, 65 = NFC-e), direção (`tpNF`), contraparte e total.

É **conveniência de digitação, não fonte de verdade**: o usuário confirma os
dados antes de salvar. NF-e/NFC-e seguem o layout nacional e são lidas com
confiança; NFS-e é municipal (cada prefeitura tem schema próprio), então só os
campos que casarem são aproveitados e o resto fica em branco.

## Configuração por loja

Prazo de alerta em `store_settings`, `category = 'fiscal'`,
`settings->>'alert_days'`. Editável em **Configurações → Fiscal → Dias para
alerta de nota pendente** (owner/admin, pela policy de `store_settings`). É o
que alimenta o aviso "N notas pendentes há mais de X dias".

Fonte única: quem decide o valor efetivo é `get_fiscal_summary`, que lê
`store_settings` e devolve `alert_days` junto dos KPIs — a tela Fiscal e o card
do Dashboard apenas exibem o que veio da RPC, sem recalcular prazo. No frontend
o padrão vive só em `FISCAL_ALERT_DAYS_DEFAULT` (`src/lib/fiscalApi.ts`), usado
apenas se a RPC não devolver nada.

A tela grava o campo como **texto livre**, então a RPC valida: só aceita inteiro
entre 1 e 3650; texto, vazio, zero, negativo ou decimal caem no padrão de 15
dias em vez de derrubar a consulta. Sem essa proteção um `"quinze"` digitado nas
configurações quebraria de uma vez o card do Dashboard e a tela Fiscal.

## Por que não existe notificação fiscal em `notifications`

A policy de SELECT de `public.notifications` é apenas
`store_id = get_my_store_id()`, **sem recorte por papel** — qualquer papel da
loja, vendedor incluído, lê todas as notificações. Criar ali um alerta do tipo
"N notas pendentes de declaração" exporia o quadro fiscal da empresa ao
vendedor, quebrando a regra central do módulo. Por isso o alerta fiscal vive no
Dashboard (card "Notas a Declarar" + toast), que já é restrito: o Dashboard
financeiro nem renderiza para vendedor, e `get_fiscal_summary` recusa o papel
`sales`. Só dá para mudar isso depois de dar recorte por papel a
`notifications`.

## Arquivos

- `supabase/migrations/20260909000001_fiscal_documents.sql` — tabela, RLS, bucket, RPCs
- `src/lib/fiscalApi.ts` — camada de acesso tipada (concentra o cast que sai depois de regenerar `types.ts`)
- `src/lib/nfeXml.ts` — parser de XML
- `src/pages/Fiscal.tsx` — lista, filtros, KPIs, exportação
- `src/components/FiscalDocumentFormDialog.tsx` — lançamento/edição + anexos
- Ligações: `src/App.tsx` (rota `/fiscal`), `src/lib/roleAccess.ts`, `src/components/AppSidebar.tsx`, `src/pages/Dashboard.tsx` (card "Notas a Declarar")

## Pendências

1. **Visão do vendedor não foi testada no navegador.** O backend está provado
   (vê apenas notas das próprias vendas; recebe `sem_permissao_fiscal` ao tentar
   declarar, enviar, cancelar ou editar), mas falta exercitar a tela com um
   login de papel `sales`. Não relaxar o backend para viabilizar esse teste.
2. Nota de teste nº 39416497 permanece em produção como cancelada, com os dois
   anexos — coerente com a regra de não apagar histórico.
