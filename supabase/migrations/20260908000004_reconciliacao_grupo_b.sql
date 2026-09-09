-- =====================================================================
-- RECONCILIAÇÃO — GRUPO B: abatimento antigo rotulado 'credit'
-- 2 vendas: 03485db1..., c2b8a073...
-- Confirmado via payments.note='Abatimento por devolução' + return_id
-- real vinculado a uma linha em `returns` (status='approved') — mesmo
-- mecanismo de abatimento já corrigido no Grupo A (268 vendas), só que
-- de uma época em que o método ainda se chamava 'credit' em vez de
-- 'return_offset'. NÃO envolve loyalty_credits (confirmado: zero linhas
-- em loyalty_credit_uses para essas duas).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _grupo_b_snapshot ON COMMIT DROP AS
WITH inv AS (
  SELECT s.id AS sale_id, s.store_id, s.net_total, s.amount_paid,
         round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) AS drift
  FROM public.sales s
  WHERE s.id IN ('03485db1-f240-4df3-b6fa-0626b0cbb0e9', 'c2b8a073-556b-43e1-bd61-9dd702904ab9')
    AND s.deleted_at IS NULL
    AND round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) > 0.001
)
SELECT inv.*, p.id AS payment_id, p.amount AS pay_amount, p.method
FROM inv
JOIN public.payments p ON p.sale_id = inv.sale_id AND p.method NOT IN ('credit')
-- perna a ajustar: 03485db1 -> cash (Lote); c2b8a073 não tem outra perna,
-- então ajusta a própria linha credit (única). Tratado abaixo caso a caso.
;

-- 03485db1: ajusta a perna cash (não a credit, que é o abatimento real)
UPDATE public.payments p
SET amount = p.amount - t.drift
FROM _grupo_b_snapshot t
WHERE p.id = t.payment_id
  AND t.sale_id = '03485db1-f240-4df3-b6fa-0626b0cbb0e9';

UPDATE public.cash_entries ce
SET amount = ce.amount - t.drift
FROM _grupo_b_snapshot t
WHERE ce.reference_type = 'sale' AND ce.reference_id = t.sale_id
  AND t.sale_id = '03485db1-f240-4df3-b6fa-0626b0cbb0e9';

-- c2b8a073: só tem a perna credit (abatimento), ajusta ela diretamente
UPDATE public.payments p
SET amount = p.amount - drift.d
FROM (
  SELECT s.id AS sale_id, round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) AS d
  FROM public.sales s WHERE s.id = 'c2b8a073-556b-43e1-bd61-9dd702904ab9'
) drift
WHERE p.sale_id = drift.sale_id AND p.method = 'credit';

-- Ambas: corrige o total pago da venda
UPDATE public.sales s
SET amount_paid = s.net_total
WHERE s.id IN ('03485db1-f240-4df3-b6fa-0626b0cbb0e9', 'c2b8a073-556b-43e1-bd61-9dd702904ab9')
  AND s.deleted_at IS NULL;

-- Auditoria
INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
SELECT s.store_id, NULL, 'reconciliacao_grupo_b_abatimento_relabeled', 'sale', s.id,
  jsonb_build_object('amount_paid_before', s.amount_paid),
  jsonb_build_object('amount_paid_after', s.net_total)
FROM public.sales s WHERE s.id IN ('03485db1-f240-4df3-b6fa-0626b0cbb0e9', 'c2b8a073-556b-43e1-bd61-9dd702904ab9');

-- Trava: aborta se não fechou
DO $$
DECLARE v_remaining int;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.sales
   WHERE id IN ('03485db1-f240-4df3-b6fa-0626b0cbb0e9', 'c2b8a073-556b-43e1-bd61-9dd702904ab9')
     AND round((amount_paid + amount_pending - net_total)::numeric, 2) > 0.001;
  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Grupo B: % venda(s) ainda com drift — abortando.', v_remaining;
  END IF;
END $$;

COMMIT;
