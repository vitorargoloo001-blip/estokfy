-- =====================================================================
-- Feature: permitir que owner/admin/manager estornem um pagamento
-- lançado errado direto pelo sistema (ex: lote de "Lançar pagamento" que
-- registrou o valor total em vez do parcial realmente recebido).
--
-- Estorna UM pagamento específico: remove a linha de payments, remove o
-- lançamento de caixa correspondente, e devolve a venda para o estado de
-- pendência correto (restaura/atualiza a linha 'pending' que o
-- settle_sale_payment teria deletado/ajustado). Pagamentos anteriores da
-- mesma venda não são tocados.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.revert_sale_payment(
  p_payment_id UUID,
  p_reason TEXT
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ctx RECORD;
  v_pmt RECORD;
  v_sale RECORD;
  v_new_paid NUMERIC;
  v_new_pending NUMERIC;
  v_new_status TEXT;
BEGIN
  PERFORM public.require_active_profile();
  SELECT * INTO v_ctx FROM public.current_profile();

  IF v_ctx.role NOT IN ('owner','admin','manager') THEN
    RAISE EXCEPTION 'sem_permissao_para_estornar';
  END IF;

  IF p_reason IS NULL OR length(btrim(p_reason)) < 3 THEN
    RAISE EXCEPTION 'motivo_obrigatorio';
  END IF;

  SELECT * INTO v_pmt FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'pagamento_nao_encontrado'; END IF;
  IF v_pmt.store_id <> v_ctx.store_id THEN RAISE EXCEPTION 'store_invalida'; END IF;
  IF v_pmt.method = 'pending' THEN RAISE EXCEPTION 'nao_e_um_pagamento_real'; END IF;

  SELECT * INTO v_sale FROM public.sales WHERE id = v_pmt.sale_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'venda_nao_encontrada'; END IF;

  DELETE FROM public.payments WHERE id = p_payment_id;

  DELETE FROM public.cash_entries
   WHERE id = (
     SELECT id FROM public.cash_entries
      WHERE store_id = v_sale.store_id
        AND reference_type = 'sale' AND reference_id = v_sale.id
        AND entry_type = 'income'
        AND payment_method = v_pmt.method
        AND amount = v_pmt.amount
        AND occurred_at = v_pmt.paid_at
      LIMIT 1
   );

  v_new_paid := GREATEST(v_sale.amount_paid - v_pmt.amount, 0);
  v_new_pending := GREATEST(v_sale.net_total - v_new_paid, 0);

  IF v_new_pending <= 0 THEN
    v_new_status := 'paid';
    DELETE FROM public.payments WHERE sale_id = v_sale.id AND method = 'pending';
  ELSE
    v_new_status := CASE WHEN v_new_paid > 0 THEN 'partial' ELSE 'pending' END;
    IF EXISTS (SELECT 1 FROM public.payments WHERE sale_id = v_sale.id AND method = 'pending') THEN
      UPDATE public.payments SET amount = v_new_pending WHERE sale_id = v_sale.id AND method = 'pending';
    ELSE
      INSERT INTO public.payments (store_id, sale_id, method, amount, paid_at)
      VALUES (v_sale.store_id, v_sale.id, 'pending', v_new_pending, v_sale.created_at);
    END IF;
  END IF;

  UPDATE public.sales
     SET amount_paid = v_new_paid, amount_pending = v_new_pending, payment_status = v_new_status
   WHERE id = v_sale.id;

  INSERT INTO public.sale_audit_logs (store_id, sale_id, actor_profile_id, actor_user_id, reason, changes, before_json, after_json)
  VALUES (
    v_sale.store_id, v_sale.id, v_ctx.profile_id, auth.uid(),
    p_reason,
    jsonb_build_object('reverted_payment_id', p_payment_id, 'reverted_amount', v_pmt.amount, 'reverted_method', v_pmt.method),
    jsonb_build_object('amount_paid', v_sale.amount_paid, 'amount_pending', v_sale.amount_pending, 'payment_status', v_sale.payment_status),
    jsonb_build_object('amount_paid', v_new_paid, 'amount_pending', v_new_pending, 'payment_status', v_new_status)
  );

  RETURN jsonb_build_object(
    'sale_id', v_sale.id,
    'reverted_amount', v_pmt.amount,
    'amount_paid', v_new_paid,
    'amount_pending', v_new_pending,
    'payment_status', v_new_status
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.revert_sale_payment(UUID, TEXT) TO authenticated;
