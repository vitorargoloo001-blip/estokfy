-- =====================================================================
-- Fix: connect_run_matching casava bank_transactions contra sales.net_total,
-- sem filtrar por forma de pagamento. Isso não reflete o objetivo do Connect
-- (verificar especificamente vendas PIX/Cartão contra o extrato) e quebra em
-- vendas com pagamento dividido, já que payments é uma tabela separada de
-- sales e suporta múltiplos tenders por venda (create_sale_atomic aceita
-- p_payments como array).
--
-- Passa a casar contra public.payments (method IN pix/card/credit_card/
-- debit_card), usando payments.amount / payments.paid_at em vez de
-- sales.net_total / sales.sale_date. reconciliation_matches ganha payment_id
-- (aditivo, sale_id continua existindo) para saber exatamente qual tender
-- foi conciliado quando a venda tem mais de um pagamento.
--
-- Também corrige uma falha latente: nada impedia duas transações bancárias
-- diferentes de casarem com a mesma venda/pagamento (a exclusão só existia
-- no nível da bank_transaction, não no candidato). Agora cada payment só
-- pode ter um match ativo (pending/confirmed) por vez.
-- =====================================================================

ALTER TABLE public.reconciliation_matches
  ADD COLUMN IF NOT EXISTS payment_id UUID REFERENCES public.payments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_reconciliation_payment
  ON public.reconciliation_matches(payment_id);

-- =====================================================================
-- connect_run_matching — reescrita para casar por payment, não por sale
-- =====================================================================

CREATE OR REPLACE FUNCTION public.connect_run_matching(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.auth_user_id = auth.uid()
      AND p.store_id = p_store_id
      AND p.role IN ('owner','admin','manager','finance')
  ) THEN
    RAISE EXCEPTION 'sem_permissao';
  END IF;

  RETURN public._connect_run_matching_core(p_store_id);
END;
$$;

-- Core sem check de auth — reaproveitado pelo wrapper acima (chamado com
-- sessão de usuário) e pelo tick de cron da Fase 3 (sem sessão de usuário).
-- Não tem GRANT para authenticated/anon: só é alcançável via connect_run_matching
-- (que valida permissão) ou via SECURITY DEFINER de outra função do servidor.
CREATE OR REPLACE FUNCTION public._connect_run_matching_core(p_store_id UUID)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tx          RECORD;
  v_best_pmt_id UUID;
  v_best_sale_id UUID;
  v_best_score  NUMERIC;
  v_match_type  TEXT;
  v_amt_diff    NUMERIC;
  v_date_diff   INTEGER;
  v_pmt_amount  NUMERIC;
  v_pmt_date    DATE;
  v_tol5        NUMERIC;
  v_tol15       NUMERIC;
  v_created     INTEGER := 0;
  v_no_match    INTEGER := 0;
BEGIN
  FOR v_tx IN
    SELECT bt.id, bt.amount, bt.transaction_date
    FROM public.bank_transactions bt
    WHERE bt.store_id = p_store_id
      AND bt.status = 'pending'
      AND bt.transaction_type = 'credit'
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_matches rm
        WHERE rm.bank_transaction_id = bt.id
          AND rm.status IN ('pending','confirmed')
      )
  LOOP
    v_best_pmt_id  := NULL;
    v_best_sale_id := NULL;
    v_best_score   := 0;
    v_match_type   := NULL;
    v_tol5         := v_tx.amount * 0.05;
    v_tol15        := v_tx.amount * 0.15;

    -- Pass 1: Determinístico
    SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
    INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
    FROM public.payments pmt
    JOIN public.sales s ON s.id = pmt.sale_id
    WHERE s.store_id = p_store_id
      AND s.deleted_at IS NULL
      AND s.status NOT IN ('cancelled','refunded','returned')
      AND pmt.method IN ('pix','card','credit_card','debit_card')
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_matches rm2
        WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
      )
      AND ABS(pmt.amount - v_tx.amount) < 0.01
      AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 3
    ORDER BY ABS(pmt.paid_at::date - v_tx.transaction_date)
    LIMIT 1;

    IF v_best_pmt_id IS NOT NULL THEN
      v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
      v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
      v_best_score := LEAST(100, 95 + (3 - v_date_diff) * 1.5);
      v_match_type := 'deterministic';
    END IF;

    -- Pass 2: Heurístico
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND pmt.method IN ('pix','card','credit_card','debit_card')
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
        AND ABS(pmt.amount - v_tx.amount) <= v_tol5
        AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 7
      ORDER BY ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
      LIMIT 1;

      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := GREATEST(70, LEAST(88,
          88 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 200) - (v_date_diff * 2)
        ));
        v_match_type := 'heuristic';
      END IF;
    END IF;

    -- Pass 3: Fuzzy
    IF v_best_pmt_id IS NULL THEN
      SELECT pmt.id, pmt.sale_id, pmt.amount, pmt.paid_at::date
      INTO v_best_pmt_id, v_best_sale_id, v_pmt_amount, v_pmt_date
      FROM public.payments pmt
      JOIN public.sales s ON s.id = pmt.sale_id
      WHERE s.store_id = p_store_id
        AND s.deleted_at IS NULL
        AND s.status NOT IN ('cancelled','refunded','returned')
        AND pmt.method IN ('pix','card','credit_card','debit_card')
        AND NOT EXISTS (
          SELECT 1 FROM public.reconciliation_matches rm2
          WHERE rm2.payment_id = pmt.id AND rm2.status IN ('pending','confirmed')
        )
        AND ABS(pmt.amount - v_tx.amount) <= v_tol15
        AND ABS(pmt.paid_at::date - v_tx.transaction_date) <= 14
      ORDER BY ABS(pmt.amount - v_tx.amount), ABS(pmt.paid_at::date - v_tx.transaction_date)
      LIMIT 1;

      IF v_best_pmt_id IS NOT NULL THEN
        v_amt_diff   := ABS(v_pmt_amount - v_tx.amount);
        v_date_diff  := ABS(v_pmt_date - v_tx.transaction_date);
        v_best_score := GREATEST(40, LEAST(69,
          65 - (v_amt_diff / NULLIF(v_tx.amount, 0) * 100) - (v_date_diff * 1.5)
        ));
        v_match_type := 'fuzzy';
      END IF;
    END IF;

    IF v_best_pmt_id IS NOT NULL THEN
      INSERT INTO public.reconciliation_matches (
        store_id, bank_transaction_id, sale_id, payment_id,
        match_type, confidence_score,
        amount_difference, date_difference_days, match_reason, status
      ) VALUES (
        p_store_id, v_tx.id, v_best_sale_id, v_best_pmt_id,
        v_match_type, round(v_best_score::numeric, 0),
        v_amt_diff, v_date_diff,
        CASE v_match_type
          WHEN 'deterministic' THEN 'Valor exato e data correspondente'
          WHEN 'heuristic'     THEN 'Valor e data dentro da tolerância configurada'
          ELSE                      'Correspondência aproximada por similaridade'
        END,
        'pending'
      )
      ON CONFLICT DO NOTHING;
      v_created := v_created + 1;
    ELSE
      v_no_match := v_no_match + 1;
    END IF;

  END LOOP;

  RETURN jsonb_build_object(
    'matches_created', v_created,
    'no_match',        v_no_match,
    'total_processed', v_created + v_no_match
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.connect_run_matching(UUID) TO authenticated;

-- =====================================================================
-- get_pending_reconciliations — expõe payment_id/method para diferenciar
-- tenders quando a venda tem mais de um pagamento
-- =====================================================================

DROP FUNCTION IF EXISTS public.get_pending_reconciliations(UUID);

CREATE FUNCTION public.get_pending_reconciliations(p_store_id UUID)
RETURNS TABLE (
  id UUID,
  bank_transaction_id UUID,
  transaction_date DATE,
  transaction_amount NUMERIC,
  transaction_description TEXT,
  bank_name TEXT,
  suggested_sale_id UUID,
  sale_number TEXT,
  sale_amount NUMERIC,
  sale_date DATE,
  customer_name TEXT,
  confidence_score NUMERIC,
  match_type TEXT,
  amount_difference NUMERIC,
  date_difference_days INTEGER,
  payment_id UUID,
  payment_method TEXT
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $FUNC$
  SELECT
    rm.id,
    bt.id,
    bt.transaction_date,
    bt.amount,
    bt.description,
    bt.bank_name,
    s.id,
    s.id::text,
    s.net_total,
    s.sale_date::date,
    c.name,
    rm.confidence_score,
    rm.match_type,
    rm.amount_difference,
    rm.date_difference_days,
    rm.payment_id,
    pmt.method
  FROM public.reconciliation_matches rm
  JOIN public.bank_transactions bt ON rm.bank_transaction_id = bt.id
  LEFT JOIN public.sales s ON rm.sale_id = s.id
  LEFT JOIN public.customers c ON s.customer_id = c.id
  LEFT JOIN public.payments pmt ON rm.payment_id = pmt.id
  WHERE rm.store_id = p_store_id
    AND rm.status = 'pending'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.auth_user_id = auth.uid()
        AND p.store_id = p_store_id
        AND p.role IN ('owner','admin','manager','finance')
    )
  ORDER BY rm.confidence_score DESC, rm.created_at DESC
  LIMIT 100;
$FUNC$;

GRANT EXECUTE ON FUNCTION public.get_pending_reconciliations(UUID) TO authenticated;
