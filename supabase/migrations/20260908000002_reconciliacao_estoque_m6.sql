-- =====================================================================
-- RECONCILIAÇÃO DE ESTOQUE — 98 PRODUTOS COM DRIFT REAL (M6)
-- Auditoria Estokfy 2026-09. NÃO APLICADO — arquivo de revisão.
--
-- ACHADO: 98 produtos onde products.on_hand ≠ soma das movimentações em
-- stock_movements, mesmo tendo um movimento 'initial_stock' e histórico
-- completo (ou seja, não é o caso dos 1.272 produtos sem rastro nenhum —
-- esse é outro achado, cadastro sem movimento inicial, não corrigido
-- aqui). Total: 194 unidades de diferença, máximo 10 num único produto.
--
-- DIREÇÃO DA DIVERGÊNCIA: em 97 dos 98 produtos, on_hand é MENOR que a
-- soma das movimentações (ex.: movimentações somam 10, on_hand mostra 0).
-- Isso indica que em algum momento o estoque foi reduzido SEM gerar uma
-- linha correspondente em stock_movements — o dado físico (on_hand) tem
-- menos do que os registros de auditoria dizem que deveria ter. Só 1
-- produto tem o caso oposto (on_hand 1 unidade a mais que o ledger).
--
-- DECISÃO DE DESIGN — o que este script NÃO faz:
--   Não escreve em products.on_hand. on_hand é o número operacional que
--   a equipe vê na tela agora — mexer nele poderia criar uma divergência
--   nova entre o que está na prateleira e o que o sistema mostra, sem
--   ninguém ter contado o estoque físico de novo.
--
-- O QUE ESTE SCRIPT FAZ:
--   Insere UM movimento do tipo 'inventory_fix' por produto divergente,
--   com qty = (on_hand atual − soma das movimentações atuais). Isso fecha
--   a ÚNICA lacuna: depois do ajuste, reconstruir o estoque a partir do
--   histórico bate exatamente com on_hand — sem alterar o número que a
--   operação já usa hoje. Cada linha inserida é rastreável (motivo,
--   quem/quando).
--
-- REVISÃO PRÉ-DEPLOY (correção de modelo): a v1 deste script descrevia a
-- reversão como "apagar a linha do ajuste". Isso violava o princípio de
-- nunca apagar histórico financeiro/estoque já aplicado em produção —
-- um DELETE não deixa rastro de que existiu, nem de quem/quando desfez.
-- Modelo corrigido: reversão é sempre um NOVO movimento com o sinal
-- invertido, nunca um DELETE do original. Vínculo com o movimento
-- original via `reference_type`/`reference_id` — as duas colunas
-- polimórficas que a tabela já usa pra isso (ex.: 'return'+return_id,
-- 'sale'+sale_id) — não foi criada nenhuma coluna nova
-- (`original_movement_id`) porque o mecanismo de vínculo já existe e
-- serve exatamente pra esse propósito; adicionar uma coluna redundante
-- seria duas formas de expressar a mesma relação. Se for necessário
-- desfazer um ajuste de reconciliação já aplicado:
--
--   INSERT INTO stock_movements (
--     store_id, product_id, movement_type, qty,
--     reference_type, reference_id, reason, created_by
--   )
--   SELECT store_id, product_id, 'adjustment', -qty,
--          'stock_movement_reversal', id,
--          'Reversão do ajuste de reconciliação ' || id::text, <profile_id>
--   FROM stock_movements
--   WHERE id = '<id do movimento inventory_fix a reverter>';
--
-- O movimento original PERMANECE na tabela pra sempre — a reversão é só
-- mais uma linha, e o histórico completo (o que foi feito e o que foi
-- desfeito) fica auditável. Consultar `reference_id` do tipo
-- 'stock_movement_reversal' encontra o par revertido/reversão.
--
-- IDEMPOTÊNCIA: recalcula tudo a partir do estado atual a cada execução;
-- depois de rodar uma vez, a diferença é 0 para os 98 produtos e uma
-- segunda execução não insere nada.
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _stock_recon_snapshot ON COMMIT DROP AS
WITH mv AS (
  SELECT product_id, sum(qty) AS net_mov, bool_or(movement_type = 'initial_stock') AS has_init, count(*) AS nmov
  FROM public.stock_movements
  GROUP BY product_id
)
SELECT p.id AS product_id, p.store_id, p.name, p.on_hand, mv.net_mov,
       (p.on_hand - mv.net_mov)::integer AS diff
FROM public.products p
JOIN mv ON mv.product_id = p.id
WHERE mv.has_init AND mv.nmov > 0
  AND p.on_hand <> mv.net_mov;

DO $$
DECLARE v_count int; v_total_abs int;
BEGIN
  SELECT count(*), coalesce(sum(abs(diff)),0) INTO v_count, v_total_abs FROM _stock_recon_snapshot;
  RAISE NOTICE 'Reconciliação de estoque: % produtos a corrigir, % unidades de diferença no total.', v_count, v_total_abs;
  IF v_count = 0 THEN
    RAISE NOTICE 'Nada a fazer — ledger já reconciliado com on_hand.';
  END IF;
END $$;

-- Insere o movimento de fechamento — não toca products.on_hand.
INSERT INTO public.stock_movements (
  store_id, product_id, movement_type, qty, reference_type, reason, created_by
)
SELECT
  t.store_id,
  t.product_id,
  'inventory_fix',
  t.diff,
  'stock_reconciliation',
  'Ajuste de reconciliação de auditoria 2026-09 — fecha divergência entre estoque atual (on_hand) e histórico de movimentações, sem alterar o estoque atual',
  NULL
FROM _stock_recon_snapshot t
WHERE t.diff <> 0;

-- Confirma que o ledger agora bate com on_hand para os produtos tocados.
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining
  FROM public.products p
  JOIN _stock_recon_snapshot t ON t.product_id = p.id
  JOIN (
    SELECT product_id, sum(qty) AS net_mov
    FROM public.stock_movements
    GROUP BY product_id
  ) mv2 ON mv2.product_id = p.id
  WHERE p.on_hand <> mv2.net_mov;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Reconciliação de estoque falhou: % produto(s) ainda divergente(s) — abortando.', v_remaining;
  END IF;
END $$;

COMMIT;

-- Verificação pós-aplicação (deve retornar 0):
-- WITH mv AS (SELECT product_id, sum(qty) net_mov FROM stock_movements GROUP BY product_id)
-- SELECT count(*) FROM products p JOIN mv ON mv.product_id=p.id WHERE p.on_hand <> mv.net_mov;
--
-- Nota: essa verificação ainda vai mostrar os 1.272 produtos sem
-- 'initial_stock' registrado (achado separado, não coberto aqui) — filtre
-- por has_init como no snapshot acima para conferir só os 98 corrigidos.
