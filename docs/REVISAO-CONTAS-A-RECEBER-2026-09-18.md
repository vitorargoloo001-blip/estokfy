# Revisão de Contas a Receber — 18/09/2026

Base: `98c7c0c` (`origin/main`). Alterações na branch `codex/corrigir-contas-a-receber`.

## Escopo e limites

Revisão direcionada do fluxo de recebíveis: tela, baixa individual, lote, baixa por item, chamadas HTTP, autorização, idempotência, rotinas SQL, alocações e extratos. A arquitetura geral foi mapeada pela estrutura e documentação do repositório, com rastreamento das integrações financeiras nas migrations.

A varredura sintática automatizada percorreu 237 arquivos TypeScript/TSX (61.083 linhas, incluindo testes e tipos gerados), sem erros de sintaxe. O repositório possui 164 migrations após esta alteração. Isso não equivale a uma auditoria manual linha a linha dos demais módulos, nem a uma garantia de ausência de outros defeitos.

## Funcionamento e dependências

- React/Vite apresenta as telas; AuthContext identifica usuário e loja. Permissões de rota e capabilities controlam a interface.
- Supabase autentica e persiste dados. `store_id`, políticas RLS e validações das RPCs delimitam cada loja.
- Vendas criam `sales`, `sale_items` e `payments`. Estoque, caixa, fidelidade, devoluções e edição de vendas podem afetar o contexto financeiro.
- Recebíveis usam `sales.amount_pending` como saldo da venda; `payment_allocations` detalha os pagamentos por item, sem substituir o saldo da venda.
- A interface chama `sales-settle-payment` ou `sales-settle-items-payment`. As funções autenticam, verificam loja e chave de idempotência e chamam a RPC com a identidade do usuário.
- As RPCs travam a venda com `FOR UPDATE`, inserem pagamentos/alocações/caixa, atualizam saldo e status e registram auditoria na mesma transação.
- O lote continua sendo uma sequência de transações por venda: não é uma transação única para todas as vendas. Ao falhar, os recebimentos anteriores permanecem válidos e o processamento para.
- Connect também usa `settle_sale_payment`; a assinatura e o retorno `payment_id` foram preservados.
- Estoque, fiscal, ordens de serviço, relatórios, administração e IA têm módulos próprios; não foram refatorados nesta alteração.

## Problemas corrigidos

| Problema | Correção |
|---|---|
| Consulta sem paginação omitia contas além do limite da API | Leitura paginada, ordenação determinística e falha explícita se uma página falhar |
| Falha de consulta aparecia como lista vazia | Estado de erro com opção de nova tentativa |
| Estado local não participava da atualização global | Consultas integradas ao React Query, com chaves por loja/vendedor e alocações |
| Horário UTC antecipava o vencimento após 21h no Brasil | Comparação de datas no fuso America/Sao_Paulo |
| Vendas canceladas ou sem saldo podiam entrar na lista | Filtros de cancelamento, exclusão lógica e saldo positivo |
| Saldos por item eram recalculados com quantidade × preço | Uso de `line_total` persistido e cálculo em centavos |
| Desconto, frete ou alocação antiga fazia itens divergirem da dívida | Baixa por item bloqueada nessa situação, também na RPC; recebimento por valor continua disponível |
| Extrato podia mostrar valores por item não conferidos | Detalhamento financeiro por item omitido quando não validado; totais da venda preservados |
| Lote reduzia silenciosamente o valor quando o saldo mudava | Confere saldos antes de enviar e pede revisão se houver alteração |
| Após timeout o lote continuava distribuindo o valor | Para na primeira falha, informa confirmações, fecha e atualiza para conferência |
| Cliques rápidos podiam iniciar dois processamentos | Trava síncrona por referência, além do botão desabilitado |
| Atualização da lista podia mudar o cliente do diálogo | Cliente, vendas e itens são capturados ao abrir o fluxo |
| Tolerância de R$ 0,01 permitia exceder a dívida | RPC rejeita qualquer excesso e frações de centavo |
| RPC aceitava métodos arbitrários e recebimento futuro | Lista de métodos válidos e validação da data |
| Venda excluída/cancelada podia ser quitada diretamente | Validação na função HTTP e na RPC |
| Resposta idempotente era consultada antes da autorização da loja | Verifica perfil ativo, cargo e loja antes da leitura privilegiada/cache |
| Chave reutilizada com outro conteúdo devolvia sucesso anterior | Valida hash e ação da chave antes de reutilizar resposta |

O detalhamento por item não inventa uma divisão proporcional de desconto/frete nem altera recebimentos históricos. A redistribuição contábil desses valores exige uma regra de negócio própria; por isso, nesses casos o fluxo orienta a baixa por valor.

## Validação

- `npm test`: 31 testes aprovados; 23 novos (18 de regras/utilitários e 5 de interação do lote).
- ESLint dos arquivos alterados de interface, utilitários, testes e funções HTTP: aprovado.
- `npm run build`: aprovado. Avisos preexistentes de tamanho dos pacotes, Browserslist e posição de importação CSS permanecem.
- TypeScript global: 35 erros preexistentes, comparados com os arquivos originais de HEAD; nenhuma nova ocorrência na comparação. Principais áreas afetadas: Connect, Finance e Super Admin. O build Vite não substitui essa checagem de tipos.
- `scripts/test-receivables-sql.mjs`: 17 cenários aprovados executando as duas RPCs da migration em PostgreSQL embarcado (PGlite), com schema mínimo isolado e o alocador FIFO original.
- Cenários SQL incluem baixa parcial/total, caixa e alocações, excesso de um centavo, frações, NaN, valor negativo, método inválido, data futura, venda excluída/cancelada, outra loja, perfil viewer, item duplicado e divergência de desconto/frete.
- Esses testes isolados não reproduzem todos os triggers/RLS da produção. Não houve operação em dados reais nem teste ponta a ponta com sessão autenticada em produção.

Reprodução dos testes SQL (sem dependência nova no app): instale `@electric-sql/pglite` em uma pasta temporária e execute `node scripts/test-receivables-sql.mjs <caminho-absoluto-para-pglite/dist/index.js>` na raiz do repositório.

## Aplicação

1. Validar em homologação com o conjunto real de migrations, RLS e triggers.
2. Aplicar `supabase/migrations/20260918000001_receivables_payment_guards.sql`.
3. Publicar as funções `sales-settle-payment` e `sales-settle-items-payment`.
4. Publicar o frontend e conferir baixa parcial, integral, por item, filtros, extrato e acesso financeiro.

A migration substitui apenas as duas rotinas de baixa, preserva suas assinaturas e não reescreve registros históricos. Nenhuma migration ou função foi publicada em produção nesta revisão.

## Riscos remanescentes

- A reserva de idempotência HTTP e a RPC são operações separadas. Uma interrupção entre a confirmação do banco e a gravação da resposta pode deixar uma chave em processamento; a alteração não promete idempotência transacional ponta a ponta.
- Um timeout não prova falha no banco. A interface interrompe a sequência e orienta conferir os recebimentos antes de tentar novamente.
- A paginação evita o limite de linhas, mas não representa um snapshot transacional entre páginas. As RPCs continuam revalidando o saldo sob trava.
- Pagamentos legados e ajustes que causam divergência por item devem ser investigados com dados reais antes de qualquer correção histórica.
