# Revisão e publicação — 19/09/2026

## Falha de recebíveis

Reproduzido um caminho concreto que reabria uma venda: o editor carregava uma venda pendente, outra sessão quitava, e a edição antiga enviava `p_confirm_revert_payment=true` automaticamente. O frontend agora só envia essa autorização quando a pessoa efetivamente digita ESTORNAR para uma venda originalmente paga. O banco também rejeita confirmação nula. O teste da confirmação nula falhou contra a função antiga e passou com a migration.

Edições de vendas pagas em parcelas preservam IDs, métodos, valores e alocações de cada recebimento. Antes, a última parcela era substituída pelo total. Aumentos do total geram apenas o recebimento adicional; reduções abaixo do recebido exigem estorno explícito prévio. O campo de forma de pagamento do editor se aplica a novos valores. Falhas de carregamento impedem salvar dados incompletos, respostas de carregamentos antigos são descartadas e cliques simultâneos são bloqueados.

## Revisão adicional

- Corrigidos os 35 erros anteriores de TypeScript com contratos gerados para RPCs e tratamento de JSON; adicionado `npm run typecheck`.
- Corrigidos hooks condicionais que podiam derrubar três telas de IA ao carregar a autenticação.
- Configurações Connect usam o conflito composto loja/categoria para atualizar o registro existente.
- Corrigidas 22 rotinas apontadas pelo lint SQL do banco: colunas inexistentes, agregações aninhadas, formatos inválidos, tipos retornados incorretos, gravação em coluna gerada e conflito sem índice correspondente.
- Conciliação em lote usa a rotina de recebimento existente. A confirmação individual trava a conciliação e a transação bancária; não repete confirmação de match já processado e valida a loja da venda.
- Fluxo de caixa não soma novamente os pagamentos que já geraram entrada no caixa; despesas pagas não são somadas novamente às saídas do caixa. Metas e painéis usam a data de pagamento e excluem placeholders pendentes.
- Registros e resumos mantêm verificação de acesso; funções alteradas não podem ser executadas anonimamente. Não houve mudança de assinatura pública.

## Evidências e limites

- 34 testes frontend (incluindo editor aberto antes da quitação, clique duplicado e estorno digitado).
- 17 cenários SQL isolados de recebimento por valor/item.
- 18 verificações em `accounts_receivable_regression_tests.sql` com schema/triggers reais, dentro de BEGIN/ROLLBACK e loja temporária.
- `audited_rpc_regression_tests.sql`: exercício integrado de resumos IA/financeiro, conexão bancária, conciliação em lote, não duplicação, notas, classificação, ignorar/reabrir/desfazer, isolamento da venda e registro repetido de conta. Dados temporários descartados por rollback.
- Verificação estática das funções PL/pgSQL não-trigger: zero erros após a migration; conferência global pós-publicação registrada abaixo.
- TypeScript e build aprovados. O ESLint global ainda tem dívida técnica preexistente, predominantemente `any` e dependências de hooks. Não é correto declarar o lint global aprovado.
- Não houve teste manual autenticado de todas as telas, nem garantia de ausência de todo defeito no sistema. A revisão combina análise direcionada, verificações globais e testes dos fluxos corrigidos.

## Dados históricos

Auditoria somente leitura encontrou 16 vendas com soma pago+pendente diferente do total e 9 com divergência entre o valor pago e os registros de pagamento. Essas vendas estão marcadas como pagas. Não foram reabertas, apagadas nem tiveram recebimentos inventados. Para corrigir o histórico, é necessário confrontar os registros com comprovantes e estornos; os números isolados não determinam qual valor está correto.

## Publicação

A ser preenchido após confirmar migrations, funções e frontend em produção.
