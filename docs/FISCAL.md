# Módulo Fiscal — controle de notas fiscais para declaração

**Status:** implementado, migration **ainda não aplicada** em produção
(`supabase/migrations/20260909000001_fiscal_documents.sql`).

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
`settings->>'alert_days'` (padrão 15 quando ausente). É o que alimenta o aviso
"N notas pendentes há mais de X dias".

## Arquivos

- `supabase/migrations/20260909000001_fiscal_documents.sql` — tabela, RLS, bucket, RPCs
- `src/lib/fiscalApi.ts` — camada de acesso tipada (concentra o cast que sai depois de regenerar `types.ts`)
- `src/lib/nfeXml.ts` — parser de XML
- `src/pages/Fiscal.tsx` — lista, filtros, KPIs, exportação
- `src/components/FiscalDocumentFormDialog.tsx` — lançamento/edição + anexos
- Ligações: `src/App.tsx` (rota `/fiscal`), `src/lib/roleAccess.ts`, `src/components/AppSidebar.tsx`, `src/pages/Dashboard.tsx` (card "Notas a Declarar")

## Pendências antes de considerar o módulo em produção

1. Aplicar a migration (`supabase db push`) — **requer autorização explícita**.
2. Regenerar os tipos: `supabase gen types typescript --linked > src/integrations/supabase/types.ts`,
   depois remover o cast do topo de `src/lib/fiscalApi.ts` e corrigir o que o
   compilador apontar.
3. Smoke test de UI (só possível depois de aplicar): lançar nota sem venda,
   lançar vinculada a venda, anexar XML e conferir o preenchimento, percorrer os
   quatro status, exportar PDF/CSV, e conferir o card no Dashboard.
4. Tela de configuração do `alert_days` — hoje o valor existe e é respeitado,
   mas ainda não há UI para editá-lo (cai no padrão de 15 dias).
