-- =====================================================================
-- RECONCILIAÇÃO — GRUPO C: 2087ce59 e 4ed63276
-- Únicas 2 vendas confirmadas via loyalty_credit_uses como consumo
-- REAL de crédito de fidelidade (não abatimento de devolução, não
-- recebimento agrupado) — sem outra perna de pagamento pra preferir.
-- Corrigir exige devolver o drift ao saldo do cliente em
-- loyalty_credits, não só ajustar a venda.
--
-- Método: reduz o drift do loyalty_credit_uses consumido por ÚLTIMO no
-- laço FIFO da venda (o de generated_at mais recente entre os créditos
-- usados nessa venda) — é a unidade "marginal" que este bug aplicou a
-- mais. Segue o MESMO padrão de ajuste que
-- revert_loyalty_credit_uses_for_sale já usa no restante do sistema
-- (mexe em loyalty_credits.amount_used/status, nunca em
-- amount_generated), mas como redução PARCIAL do valor aplicado, não
-- reversão total — a compra em si continua válida, só o valor exagerado
-- é devolvido ao saldo do cliente.
--
-- 2087ce59: drift=5, reduz de loyalty_credit_uses id=42fd085b (credit_id
--   be67042b, gerado 2026-08-12 — consumido depois de 3426c908, gerado
--   2026-07-28, dentro do mesmo laço).
-- 4ed63276: drift=5, reduz de loyalty_credit_uses id (a resolver via
--   consulta abaixo, única linha da venda).
-- =====================================================================

BEGIN;

CREATE TEMP TABLE _grupo_c_snapshot ON COMMIT DROP AS
SELECT s.id AS sale_id, s.store_id, s.net_total,
       round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) AS drift
FROM public.sales s
WHERE s.id IN ('2087ce59-7456-408d-852b-2c50d7c724e5', '4ed63276-4458-4e76-a02c-e1e3d4618485')
  AND s.deleted_at IS NULL
  AND round((s.amount_paid + s.amount_pending - s.net_total)::numeric, 2) > 0.001;

-- Passo 1: reduz o loyalty_credit_uses "marginal" (último consumido no
-- laço FIFO da venda = credit_id de generated_at mais recente entre os
-- usados nessa venda) e o loyalty_credits correspondente.
WITH marginal AS (
  SELECT DISTINCT ON (lcu.sale_id)
    lcu.id AS use_id, lcu.credit_id, lcu.amount_applied, t.drift
  FROM public.loyalty_credit_uses lcu
  JOIN public.loyalty_credits lc ON lc.id = lcu.credit_id
  JOIN _grupo_c_snapshot t ON t.sale_id = lcu.sale_id
  WHERE lcu.reverted_at IS NULL
  ORDER BY lcu.sale_id, lc.generated_at DESC
)
UPDATE public.loyalty_credit_uses lcu
SET amount_applied = lcu.amount_applied - marginal.drift
FROM marginal
WHERE lcu.id = marginal.use_id;

WITH marginal AS (
  SELECT DISTINCT ON (lcu.sale_id)
    lcu.credit_id, t.drift
  FROM public.loyalty_credit_uses lcu
  JOIN public.loyalty_credits lc ON lc.id = lcu.credit_id
  JOIN _grupo_c_snapshot t ON t.sale_id = lcu.sale_id
  WHERE lcu.reverted_at IS NULL
  ORDER BY lcu.sale_id, lc.generated_at DESC
)
UPDATE public.loyalty_credits lc
SET amount_used = GREATEST(lc.amount_used - marginal.drift, 0),
    status = CASE
      WHEN GREATEST(lc.amount_used - marginal.drift, 0) <= 0 THEN 'available'
      WHEN GREATEST(lc.amount_used - marginal.drift, 0) < lc.amount_generated THEN 'partially_used'
      ELSE lc.status
    END
FROM marginal
WHERE lc.id = marginal.credit_id;

-- Passo 2: ajusta o pagamento method='credit' e o total pago da venda.
UPDATE public.payments p
SET amount = p.amount - t.drift
FROM _grupo_c_snapshot t
WHERE p.sale_id = t.sale_id AND p.method = 'credit';

UPDATE public.sales s
SET amount_paid = s.net_total
FROM _grupo_c_snapshot t
WHERE s.id = t.sale_id;

-- Auditoria (antes/depois inclui o efeito no saldo de fidelidade)
INSERT INTO public.audit_logs (store_id, actor_profile_id, action, entity, entity_id, before_json, after_json)
SELECT t.store_id, NULL, 'reconciliacao_grupo_c_loyalty', 'sale', t.sale_id,
  jsonb_build_object('drift', t.drift),
  jsonb_build_object('amount_paid_after', t.net_total, 'loyalty_balance_devolvido', t.drift)
FROM _grupo_c_snapshot t;

-- Trava: aborta se a venda não fechou OU se algum loyalty_credit_uses
-- ficou negativo (proteção contra reduzir mais do que foi aplicado).
DO $$
DECLARE v_remaining int; v_negative_uses int;
BEGIN
  SELECT count(*) INTO v_remaining FROM public.sales
   WHERE id IN ('2087ce59-7456-408d-852b-2c50d7c724e5', '4ed63276-4458-4e76-a02c-e1e3d4618485')
     AND round((amount_paid + amount_pending - net_total)::numeric, 2) > 0.001;

  SELECT count(*) INTO v_negative_uses FROM public.loyalty_credit_uses
   WHERE sale_id IN ('2087ce59-7456-408d-852b-2c50d7c724e5', '4ed63276-4458-4e76-a02c-e1e3d4618485')
     AND amount_applied < 0;

  IF v_remaining > 0 THEN
    RAISE EXCEPTION 'Grupo C: % venda(s) ainda com drift — abortando.', v_remaining;
  END IF;
  IF v_negative_uses > 0 THEN
    RAISE EXCEPTION 'Grupo C: % loyalty_credit_uses ficou negativo — abortando.', v_negative_uses;
  END IF;
END $$;

COMMIT;
